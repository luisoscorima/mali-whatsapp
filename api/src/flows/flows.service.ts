import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { sanitizeApiResponse } from '../conversations/api-sanitize.util';
import { setMessageSender } from '../conversations/chat-sender.util';
import {
  INTERACTIVE_BUTTON_TITLE_MAX,
  MAX_INTERACTIVE_BUTTONS,
  sendSessionInteractiveButtons,
  sendSessionTextMessage,
} from '../conversations/conversation-whatsapp.util';
import { PrismaService } from '../prisma/prisma.service';
import { TRANSFER_TO_HUMAN_NOTICE } from '../webhook/ai-response.util';
import { formatAdvisorLabel } from '../users/advisor-label.util';
import type { CreateFlowDto, UpdateFlowDto } from './dto/flow.dto';
import type {
  FlowButton,
  FlowDetail,
  FlowEdgeDto,
  FlowListItem,
  FlowNodeDto,
  FlowNodeKind,
  FlowStatus,
} from './flows.types';

const VALID_KINDS = new Set<FlowNodeKind>([
  'message_text',
  'message_buttons',
  'handoff_human',
  'end',
]);

function asStatus(value: string): FlowStatus {
  if (value === 'active' || value === 'paused' || value === 'draft') return value;
  return 'draft';
}

function parseButtons(raw: unknown): FlowButton[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = item as { id?: string; title?: string };
      return {
        id: String(row?.id || '').trim(),
        title: String(row?.title || '').trim(),
      };
    })
    .filter((b) => b.id && b.title);
}

@Injectable()
export class FlowsService {
  private readonly logger = new Logger(FlowsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(area: string): Promise<FlowListItem[]> {
    const rows = await this.prisma.flows.findMany({
      where: { area },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      include: {
        _count: { select: { flow_nodes: true } },
        flow_sessions: { select: { status: true } },
      },
    });
    return rows.map((row) => {
      const sessions = row.flow_sessions;
      return {
        id: row.id,
        name: row.name,
        status: asStatus(row.status),
        trigger_payload: row.trigger_payload,
        entry_node_id: row.entry_node_id,
        node_count: row._count.flow_nodes,
        active_sessions: sessions.filter((s) => s.status === 'active').length,
        completed_sessions: sessions.filter((s) => s.status === 'completed')
          .length,
        handed_off_sessions: sessions.filter((s) => s.status === 'handed_off')
          .length,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      };
    });
  }

  async listAdvisors(
    area: string,
  ): Promise<{ id: number; label: string }[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: number;
        email: string;
        first_name: string | null;
        last_name: string | null;
      }[]
    >`
      SELECT DISTINCT u.id, u.email, u.first_name, u.last_name
      FROM users u
      WHERE u.is_provisioned = TRUE
        AND (
          u.area = ${area}
          OR u.is_master = TRUE
          OR EXISTS (
            SELECT 1 FROM user_areas ua
            WHERE ua.user_id = u.id AND ua.area = ${area}
          )
        )
      ORDER BY u.email ASC
    `;
    return rows.map((row) => ({
      id: row.id,
      label: formatAdvisorLabel(row),
    }));
  }

  async getDetail(area: string, id: number): Promise<FlowDetail> {
    const row = await this.prisma.flows.findFirst({
      where: { id, area },
      include: {
        flow_nodes: { orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] },
        flow_edges: { orderBy: { id: 'asc' } },
        flow_sessions: { select: { status: true } },
      },
    });
    if (!row) throw new NotFoundException('Flujo no encontrado');
    return this.toDetail(row);
  }

  async create(area: string, dto: CreateFlowDto): Promise<FlowDetail> {
    const name = String(dto.name || '').trim();
    const trigger = String(dto.trigger_payload || '').trim();
    if (!name) throw new BadRequestException('Nombre obligatorio');
    if (!trigger) throw new BadRequestException('Trigger payload obligatorio');

    const nodes = Array.isArray(dto.nodes) ? dto.nodes : [];
    if (nodes.length === 0) {
      throw new BadRequestException('El flujo necesita al menos un paso');
    }
    this.validateGraph(dto);

    const status = asStatus(dto.status || 'draft');
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const flow = await tx.flows.create({
          data: {
            area,
            name,
            trigger_payload: trigger,
            status,
          },
        });
        await this.replaceGraph(tx, flow.id, dto);
        return flow.id;
      });
      return this.getDetail(area, created);
    } catch (error) {
      this.rethrowUnique(error, 'Ya existe un flujo activo con ese trigger');
      throw error;
    }
  }

  async update(
    area: string,
    id: number,
    dto: UpdateFlowDto,
  ): Promise<FlowDetail> {
    const existing = await this.prisma.flows.findFirst({
      where: { id, area },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Flujo no encontrado');

    if (dto.nodes) this.validateGraph(dto as CreateFlowDto);

    try {
      await this.prisma.$transaction(async (tx) => {
        const data: Prisma.flowsUpdateInput = {
          updated_at: new Date(),
        };
        if (dto.name != null) data.name = String(dto.name).trim();
        if (dto.trigger_payload != null) {
          data.trigger_payload = String(dto.trigger_payload).trim();
        }
        if (dto.status != null) data.status = asStatus(dto.status);

        await tx.flows.update({ where: { id }, data });

        if (dto.nodes) {
          await this.replaceGraph(tx, id, {
            nodes: dto.nodes,
            edges: dto.edges || [],
            entry_client_key: dto.entry_client_key ?? undefined,
          });
        } else if (dto.entry_client_key !== undefined && !dto.nodes) {
          // entry solo con client_key requiere nodos; ignorar
        }
      });
      return this.getDetail(area, id);
    } catch (error) {
      this.rethrowUnique(error, 'Ya existe un flujo con ese trigger en el área');
      throw error;
    }
  }

  async remove(area: string, id: number): Promise<void> {
    const result = await this.prisma.flows.deleteMany({ where: { id, area } });
    if (result.count === 0) throw new NotFoundException('Flujo no encontrado');
  }

  /**
   * Procesa inbound para el motor de flujos.
   * @returns handled — si el flujo tomó el control (no correr IA/horario).
   * @returns waiting — sesión activa sin match de botón (tampoco IA).
   */
  async handleInbound(input: {
    area: string;
    conversationId: number;
    phone: string;
    phoneNumberId: string | null;
    buttonPayload: string | null;
  }): Promise<{ handled: boolean; waiting: boolean }> {
    const payload = String(input.buttonPayload || '').trim();

    const activeSession = await this.prisma.flow_sessions.findFirst({
      where: {
        conversation_id: input.conversationId,
        status: 'active',
      },
      orderBy: { updated_at: 'desc' },
    });

    if (activeSession) {
      if (!payload) {
        return { handled: false, waiting: true };
      }
      const advanced = await this.advanceSession({
        sessionId: activeSession.id,
        flowId: activeSession.flow_id,
        currentNodeId: activeSession.current_node_id,
        conversationId: input.conversationId,
        area: input.area,
        phone: input.phone,
        phoneNumberId: input.phoneNumberId,
        matchPayload: payload,
      });
      if (advanced) return { handled: true, waiting: false };
      return { handled: false, waiting: true };
    }

    if (!payload) return { handled: false, waiting: false };

    const flow = await this.prisma.flows.findFirst({
      where: {
        area: input.area,
        status: 'active',
        trigger_payload: payload,
      },
    });
    if (!flow || !flow.entry_node_id) {
      return { handled: false, waiting: false };
    }

    await this.startFlowById({
      area: input.area,
      conversationId: input.conversationId,
      flowId: flow.id,
      phone: input.phone,
      phoneNumberId: input.phoneNumberId,
    });

    return { handled: true, waiting: false };
  }

  /**
   * Arranca un flujo activo sin esperar payload del usuario (p. ej. desde inbox).
   * Requiere ventana de servicio 24h abierta en el caller.
   */
  async startFlowById(input: {
    area: string;
    conversationId: number;
    flowId: number;
    phone: string;
    phoneNumberId: string | null;
  }): Promise<{ flow_id: number; flow_name: string }> {
    const flow = await this.prisma.flows.findFirst({
      where: {
        id: input.flowId,
        area: input.area,
        status: 'active',
      },
    });
    if (!flow) {
      throw new NotFoundException('Flujo no encontrado o no activo');
    }
    if (!flow.entry_node_id) {
      throw new BadRequestException('El flujo no tiene paso inicial');
    }

    await this.prisma.flow_sessions.updateMany({
      where: {
        conversation_id: input.conversationId,
        status: 'active',
      },
      data: { status: 'completed', updated_at: new Date() },
    });

    const session = await this.prisma.flow_sessions.create({
      data: {
        conversation_id: input.conversationId,
        flow_id: flow.id,
        current_node_id: flow.entry_node_id,
        status: 'active',
      },
    });

    await this.prisma.conversations.update({
      where: { id: input.conversationId },
      data: {
        status: 'bot',
        automation_touched_at: new Date(),
        updated_at: new Date(),
      },
    });

    await this.executeNode({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: flow.entry_node_id,
      conversationId: input.conversationId,
      area: input.area,
      phone: input.phone,
      phoneNumberId: input.phoneNumberId,
    });

    return { flow_id: flow.id, flow_name: flow.name };
  }

  private async advanceSession(input: {
    sessionId: number;
    flowId: number;
    currentNodeId: number | null;
    conversationId: number;
    area: string;
    phone: string;
    phoneNumberId: string | null;
    matchPayload: string;
  }): Promise<boolean> {
    if (!input.currentNodeId) return false;

    const edges = await this.prisma.flow_edges.findMany({
      where: {
        flow_id: input.flowId,
        from_node_id: input.currentNodeId,
      },
    });
    const exact = edges.find(
      (e) => String(e.match_payload || '').trim() === input.matchPayload,
    );
    const fallback = edges.find((e) => e.match_payload == null);
    const edge = exact || fallback;
    if (!edge) return false;

    await this.executeNode({
      sessionId: input.sessionId,
      flowId: input.flowId,
      nodeId: edge.to_node_id,
      conversationId: input.conversationId,
      area: input.area,
      phone: input.phone,
      phoneNumberId: input.phoneNumberId,
    });
    return true;
  }

  private async executeNode(input: {
    sessionId: number;
    flowId: number;
    nodeId: number;
    conversationId: number;
    area: string;
    phone: string;
    phoneNumberId: string | null;
  }): Promise<void> {
    const node = await this.prisma.flow_nodes.findFirst({
      where: { id: input.nodeId, flow_id: input.flowId },
    });
    if (!node) {
      await this.closeSession(input.sessionId, 'completed');
      return;
    }

    const kind = String(node.kind) as FlowNodeKind;
    const body = String(node.body_text || '').trim();
    const buttons = parseButtons(node.buttons_json);

    try {
      if (kind === 'end') {
        await this.closeSession(input.sessionId, 'completed', null);
        return;
      }

      if (kind === 'handoff_human') {
        const text = body || TRANSFER_TO_HUMAN_NOTICE;
        await this.sendOutboundText({
          ...input,
          text,
          source: 'flow_handoff',
        });
        const handoffUserId =
          node.handoff_user_id != null &&
          Number.isInteger(node.handoff_user_id) &&
          node.handoff_user_id > 0
            ? node.handoff_user_id
            : null;
        let assignedOk = false;
        if (handoffUserId) {
          const inArea = await this.prisma.user_areas.findFirst({
            where: { user_id: handoffUserId, area: input.area },
            select: { user_id: true },
          });
          const userRow = await this.prisma.users.findFirst({
            where: { id: handoffUserId },
            select: { id: true, area: true, is_master: true },
          });
          assignedOk = Boolean(
            inArea ||
              userRow?.is_master ||
              String(userRow?.area || '') === input.area,
          );
        }
        await this.prisma.conversations.update({
          where: { id: input.conversationId },
          data: {
            status: 'human',
            ...(assignedOk && handoffUserId
              ? {
                  assigned_user_id: handoffUserId,
                  assigned_at: new Date(),
                }
              : {}),
            automation_touched_at: new Date(),
            updated_at: new Date(),
          },
        });
        await this.closeSession(input.sessionId, 'handed_off', node.id);
        return;
      }

      if (kind === 'message_buttons') {
        if (!body || buttons.length === 0) {
          this.logger.warn(
            `Flujo nodo ${node.id}: message_buttons incompleto`,
          );
          await this.closeSession(input.sessionId, 'completed', node.id);
          return;
        }
        await this.sendOutboundButtons({
          ...input,
          bodyText: body,
          buttons: buttons.slice(0, MAX_INTERACTIVE_BUTTONS),
        });
        await this.prisma.flow_sessions.update({
          where: { id: input.sessionId },
          data: {
            current_node_id: node.id,
            updated_at: new Date(),
          },
        });
        return;
      }

      // message_text
      if (body) {
        await this.sendOutboundText({
          ...input,
          text: body,
          source: 'flow',
        });
      }
      await this.prisma.flow_sessions.update({
        where: { id: input.sessionId },
        data: {
          current_node_id: node.id,
          updated_at: new Date(),
        },
      });

      const nextEdge = await this.prisma.flow_edges.findFirst({
        where: {
          flow_id: input.flowId,
          from_node_id: node.id,
        },
        orderBy: { id: 'asc' },
      });
      if (nextEdge) {
        await this.executeNode({
          ...input,
          nodeId: nextEdge.to_node_id,
        });
      } else {
        await this.closeSession(input.sessionId, 'completed', node.id);
      }
    } catch (error) {
      this.logger.warn(
        `executeNode fallo: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async closeSession(
    sessionId: number,
    status: 'completed' | 'handed_off',
    currentNodeId?: number | null,
  ): Promise<void> {
    await this.prisma.flow_sessions.update({
      where: { id: sessionId },
      data: {
        status,
        ...(currentNodeId !== undefined
          ? { current_node_id: currentNodeId }
          : {}),
        updated_at: new Date(),
      },
    });
  }

  private async sendOutboundText(input: {
    conversationId: number;
    area: string;
    phone: string;
    phoneNumberId: string | null;
    text: string;
    source: string;
  }): Promise<void> {
    const apiResponse = await sendSessionTextMessage({
      to: input.phone,
      text: input.text,
      area: input.area,
      phoneNumberId: input.phoneNumberId,
    });
    const msgId = apiResponse.messages?.[0]?.id || null;
    let payload = sanitizeApiResponse(apiResponse) as Record<string, unknown>;
    payload.source = input.source;
    payload = setMessageSender(payload, 'Flujo');
    await this.prisma.chat_messages.create({
      data: {
        conversation_id: input.conversationId,
        direction: 'outbound',
        wa_message_id: msgId,
        body_text: input.text,
        message_type: 'text',
        raw_payload: payload as Prisma.InputJsonValue,
        is_ai: false,
      },
    });
    await this.prisma.conversations.update({
      where: { id: input.conversationId },
      data: { last_message_at: new Date(), updated_at: new Date() },
    });
  }

  private async sendOutboundButtons(input: {
    conversationId: number;
    area: string;
    phone: string;
    phoneNumberId: string | null;
    bodyText: string;
    buttons: FlowButton[];
  }): Promise<void> {
    const apiResponse = await sendSessionInteractiveButtons({
      to: input.phone,
      bodyText: input.bodyText,
      buttons: input.buttons,
      area: input.area,
      phoneNumberId: input.phoneNumberId,
    });
    const msgId = apiResponse.messages?.[0]?.id || null;
    let payload = sanitizeApiResponse(apiResponse) as Record<string, unknown>;
    payload.source = 'flow';
    payload.flow_buttons = input.buttons;
    payload = setMessageSender(payload, 'Flujo');
    const preview =
      input.bodyText +
      '\n' +
      input.buttons.map((b) => `[${b.title}]`).join(' ');
    await this.prisma.chat_messages.create({
      data: {
        conversation_id: input.conversationId,
        direction: 'outbound',
        wa_message_id: msgId,
        body_text: preview.slice(0, 8000),
        message_type: 'interactive',
        raw_payload: payload as Prisma.InputJsonValue,
        is_ai: false,
      },
    });
    await this.prisma.conversations.update({
      where: { id: input.conversationId },
      data: { last_message_at: new Date(), updated_at: new Date() },
    });
  }

  private validateGraph(
    dto: Pick<CreateFlowDto, 'nodes' | 'edges' | 'entry_client_key'>,
  ): void {
    const nodes = dto.nodes || [];
    const keys = new Set<string>();
    for (const node of nodes) {
      const key = String(node.client_key || '').trim();
      if (!key) throw new BadRequestException('Cada paso necesita client_key');
      if (keys.has(key)) {
        throw new BadRequestException(`client_key duplicado: ${key}`);
      }
      keys.add(key);
      const kind = node.kind as FlowNodeKind;
      if (!VALID_KINDS.has(kind)) {
        throw new BadRequestException(`Tipo de paso inválido: ${kind}`);
      }
      if (kind === 'message_buttons') {
        const buttons = Array.isArray(node.buttons) ? node.buttons : [];
        if (!String(node.body_text || '').trim()) {
          throw new BadRequestException(
            'Los pasos con botones necesitan texto',
          );
        }
        if (buttons.length < 1 || buttons.length > MAX_INTERACTIVE_BUTTONS) {
          throw new BadRequestException(
            `Los pasos con botones admiten 1–${MAX_INTERACTIVE_BUTTONS} botones`,
          );
        }
        for (const btn of buttons) {
          if (!String(btn.id || '').trim() || !String(btn.title || '').trim()) {
            throw new BadRequestException(
              'Cada botón necesita payload (id) y título',
            );
          }
          if (String(btn.title).trim().length > INTERACTIVE_BUTTON_TITLE_MAX) {
            throw new BadRequestException(
              `Título de botón máx. ${INTERACTIVE_BUTTON_TITLE_MAX} caracteres`,
            );
          }
        }
      }
      if (kind === 'message_text' && !String(node.body_text || '').trim()) {
        throw new BadRequestException('El paso de texto necesita cuerpo');
      }
    }

    const entryKey = String(dto.entry_client_key || nodes[0]?.client_key || '').trim();
    if (!entryKey || !keys.has(entryKey)) {
      throw new BadRequestException('Paso inicial inválido');
    }

    for (const edge of dto.edges || []) {
      const from = String(edge.from_client_key || '').trim();
      const to = String(edge.to_client_key || '').trim();
      if (!keys.has(from) || !keys.has(to)) {
        throw new BadRequestException('Rama apunta a un paso inexistente');
      }
    }
  }

  private async replaceGraph(
    tx: Prisma.TransactionClient,
    flowId: number,
    dto: {
      nodes: CreateFlowDto['nodes'];
      edges?: CreateFlowDto['edges'];
      entry_client_key?: string;
    },
  ): Promise<void> {
    await tx.flow_sessions.updateMany({
      where: { flow_id: flowId, status: 'active' },
      data: { status: 'completed', current_node_id: null, updated_at: new Date() },
    });
    await tx.flow_edges.deleteMany({ where: { flow_id: flowId } });
    await tx.flow_nodes.deleteMany({ where: { flow_id: flowId } });

    const keyToId = new Map<string, number>();
    let sort = 0;
    for (const node of dto.nodes) {
      const key = String(node.client_key).trim();
      const created = await tx.flow_nodes.create({
        data: {
          flow_id: flowId,
          kind: node.kind,
          body_text: String(node.body_text || '').trim() || null,
          buttons_json:
            node.kind === 'message_buttons'
              ? (parseButtons(node.buttons) as unknown as Prisma.InputJsonValue)
              : undefined,
          sort_order: node.sort_order ?? sort,
          position_x: Number(node.position_x) || 0,
          position_y: Number(node.position_y) || 0,
          handoff_user_id:
            node.kind === 'handoff_human' &&
            node.handoff_user_id != null &&
            Number(node.handoff_user_id) > 0
              ? Number(node.handoff_user_id)
              : null,
        },
      });
      keyToId.set(key, created.id);
      sort += 1;
    }

    for (const edge of dto.edges || []) {
      const fromId = keyToId.get(String(edge.from_client_key).trim());
      const toId = keyToId.get(String(edge.to_client_key).trim());
      if (!fromId || !toId) continue;
      const match = String(edge.match_payload ?? '').trim() || null;
      await tx.flow_edges.create({
        data: {
          flow_id: flowId,
          from_node_id: fromId,
          to_node_id: toId,
          match_payload: match,
        },
      });
    }

    const entryKey = String(
      dto.entry_client_key || dto.nodes[0]?.client_key || '',
    ).trim();
    const entryId = keyToId.get(entryKey) ?? null;
    await tx.flows.update({
      where: { id: flowId },
      data: { entry_node_id: entryId, updated_at: new Date() },
    });
  }

  private toDetail(row: {
    id: number;
    name: string;
    status: string;
    trigger_payload: string;
    entry_node_id: number | null;
    created_at: Date;
    updated_at: Date;
    flow_nodes: {
      id: number;
      kind: string;
      body_text: string | null;
      buttons_json: unknown;
      sort_order: number;
      position_x: number;
      position_y: number;
      handoff_user_id: number | null;
    }[];
    flow_edges: {
      id: number;
      from_node_id: number;
      to_node_id: number;
      match_payload: string | null;
    }[];
    flow_sessions: { status: string }[];
  }): FlowDetail {
    const nodes: FlowNodeDto[] = row.flow_nodes.map((n) => ({
      id: n.id,
      kind: n.kind as FlowNodeKind,
      body_text: String(n.body_text || ''),
      buttons: parseButtons(n.buttons_json),
      sort_order: n.sort_order,
      position_x: Number(n.position_x) || 0,
      position_y: Number(n.position_y) || 0,
      handoff_user_id: n.handoff_user_id ?? null,
    }));
    const edges: FlowEdgeDto[] = row.flow_edges.map((e) => ({
      id: e.id,
      from_node_id: e.from_node_id,
      to_node_id: e.to_node_id,
      match_payload: e.match_payload,
    }));
    const sessions = row.flow_sessions;
    return {
      id: row.id,
      name: row.name,
      status: asStatus(row.status),
      trigger_payload: row.trigger_payload,
      entry_node_id: row.entry_node_id,
      nodes,
      edges,
      metrics: {
        active_sessions: sessions.filter((s) => s.status === 'active').length,
        completed_sessions: sessions.filter((s) => s.status === 'completed')
          .length,
        handed_off_sessions: sessions.filter((s) => s.status === 'handed_off')
          .length,
      },
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }

  private rethrowUnique(error: unknown, message: string): void {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw new BadRequestException(message);
    }
  }
}
