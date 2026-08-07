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
  MAX_MEDIA_DOCUMENT_BYTES,
  MEDIA_TYPE_LABEL,
  classifyConversationUpload,
  sendSessionInteractiveButtons,
  sendSessionMediaMessage,
  sendSessionTextMessage,
} from '../conversations/conversation-whatsapp.util';
import { saveFlowMediaFile } from '../conversations/chat-media.util';
import { PrismaService } from '../prisma/prisma.service';
import { TRANSFER_TO_HUMAN_NOTICE } from '../webhook/ai-response.util';
import { formatAdvisorLabel } from '../users/advisor-label.util';
import { readSessionWindowMs } from '../campaigns/campaign-conversation-window.util';
import type { CreateFlowDto, UpdateFlowDto } from './dto/flow.dto';
import {
  buildFlowAnalytics,
  nodeLabelSnapshot,
  recordFlowEvent,
} from './flow-analytics.util';
import {
  fetchFlowSummary,
  type FlowSummary,
} from './flow-summary.util';
import type {
  FlowAnalytics,
  FlowButton,
  FlowDetail,
  FlowEdgeDto,
  FlowEventContactRow,
  FlowEventType,
  FlowListItem,
  FlowNodeDto,
  FlowNodeKind,
  FlowStatus,
} from './flows.types';
import {
  DEFAULT_FLOW_TIMEOUT_BODY,
  FLOW_TIMEOUT_CONTINUE,
  FLOW_TIMEOUT_STOP,
} from './flows.types';

const VALID_KINDS = new Set<FlowNodeKind>([
  'message_text',
  'message_buttons',
  'message_image',
  'message_document',
  'handoff_human',
  'end',
]);

const FLOW_TIMEOUT_BATCH = 50;

const FLOW_TIMEOUT_CONFIRM_BUTTONS: FlowButton[] = [
  { id: FLOW_TIMEOUT_CONTINUE, title: 'Continuar' },
  { id: FLOW_TIMEOUT_STOP, title: 'Ahora no' },
];

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

  async getSummary(area: string): Promise<FlowSummary> {
    return fetchFlowSummary(this.prisma, area);
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

  async uploadMedia(
    _area: string,
    file: { buffer: Buffer; mimetype: string; originalname: string },
    kind: 'image' | 'document',
  ): Promise<{
    url: string;
    mime: string;
    filename: string;
    wa_type: 'image' | 'document';
  }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo vacío');
    }
    let waType: 'image' | 'document';
    try {
      const classified = classifyConversationUpload(
        file.mimetype,
        file.buffer.length,
      );
      if (classified.waType !== 'image' && classified.waType !== 'document') {
        throw new BadRequestException(
          'Solo se admiten imágenes JPEG/PNG o PDF',
        );
      }
      waType = classified.waType;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Archivo no válido',
      );
    }
    if (kind === 'image' && waType !== 'image') {
      throw new BadRequestException('Este nodo requiere una imagen JPEG/PNG');
    }
    if (kind === 'document' && waType !== 'document') {
      throw new BadRequestException('Este nodo requiere un PDF');
    }
    if (file.buffer.length > MAX_MEDIA_DOCUMENT_BYTES) {
      throw new BadRequestException('Archivo demasiado grande');
    }
    try {
      const saved = await saveFlowMediaFile({
        buffer: file.buffer,
        mimeType: file.mimetype,
        filename: file.originalname,
      });
      return {
        url: saved.url,
        mime: saved.mime || file.mimetype,
        filename: saved.filename,
        wa_type: waType,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'No se pudo guardar el archivo (revisa S3)',
      );
    }
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
    const analytics = await this.buildAnalyticsForFlow(id, row.flow_nodes, row.flow_sessions);
    return this.toDetail(row, analytics);
  }

  async listEventContacts(
    area: string,
    flowId: number,
    query: {
      client_key?: string;
      event_type?: string;
    },
  ): Promise<FlowEventContactRow[]> {
    const flow = await this.prisma.flows.findFirst({
      where: { id: flowId, area },
      select: { id: true },
    });
    if (!flow) throw new NotFoundException('Flujo no encontrado');

    const eventType = String(query.event_type || '').trim();
    const clientKey = String(query.client_key || '').trim();
    const where: Prisma.flow_session_eventsWhereInput = { flow_id: flowId };
    if (clientKey) where.client_key = clientKey;
    if (
      eventType &&
      eventType !== 'started' &&
      eventType !== 'active' &&
      eventType !== 'completed' &&
      eventType !== 'handed_off'
    ) {
      where.event_type = eventType;
    }

    if (eventType === 'active') {
      const sessions = await this.prisma.flow_sessions.findMany({
        where: {
          flow_id: flowId,
          status: 'active',
          ...(clientKey
            ? { current_node: { client_key: clientKey } }
            : {}),
        },
        take: 500,
        orderBy: { updated_at: 'desc' },
        include: {
          conversations: {
            select: {
              id: true,
              phone: true,
              contact_id: true,
              contacts: { select: { name: true, last_name: true } },
            },
          },
          current_node: { select: { client_key: true, body_text: true, kind: true } },
        },
      });
      return sessions.map((s) => {
        const c = s.conversations;
        const name = [c.contacts?.name, c.contacts?.last_name]
          .filter(Boolean)
          .join(' ')
          .trim();
        return {
          conversation_id: c.id,
          contact_id: c.contact_id,
          contact_name: name || c.phone,
          phone: c.phone,
          event_type: 'active',
          client_key: s.current_node?.client_key ?? null,
          node_label: s.current_node
            ? nodeLabelSnapshot(s.current_node.kind, s.current_node.body_text)
            : null,
          match_payload: null,
          created_at: s.updated_at.toISOString(),
        };
      });
    }

    if (eventType === 'started') {
      const sessions = await this.prisma.flow_sessions.findMany({
        where: { flow_id: flowId },
        take: 500,
        orderBy: { started_at: 'desc' },
        include: {
          conversations: {
            select: {
              id: true,
              phone: true,
              contact_id: true,
              contacts: { select: { name: true, last_name: true } },
            },
          },
        },
      });
      return sessions.map((s) => {
        const c = s.conversations;
        const name = [c.contacts?.name, c.contacts?.last_name]
          .filter(Boolean)
          .join(' ')
          .trim();
        return {
          conversation_id: c.id,
          contact_id: c.contact_id,
          contact_name: name || c.phone,
          phone: c.phone,
          event_type: 'started',
          client_key: null,
          node_label: null,
          match_payload: s.status,
          created_at: s.started_at.toISOString(),
        };
      });
    }

    if (eventType === 'completed' || eventType === 'handed_off') {
      const sessions = await this.prisma.flow_sessions.findMany({
        where: { flow_id: flowId, status: eventType },
        take: 500,
        orderBy: { updated_at: 'desc' },
        include: {
          conversations: {
            select: {
              id: true,
              phone: true,
              contact_id: true,
              contacts: { select: { name: true, last_name: true } },
            },
          },
        },
      });
      return sessions.map((s) => {
        const c = s.conversations;
        const name = [c.contacts?.name, c.contacts?.last_name]
          .filter(Boolean)
          .join(' ')
          .trim();
        return {
          conversation_id: c.id,
          contact_id: c.contact_id,
          contact_name: name || c.phone,
          phone: c.phone,
          event_type: eventType,
          client_key: null,
          node_label: null,
          match_payload: null,
          created_at: s.updated_at.toISOString(),
        };
      });
    }

    const events = await this.prisma.flow_session_events.findMany({
      where,
      take: 500,
      orderBy: { created_at: 'desc' },
    });

    const convIds = [...new Set(events.map((e) => e.conversation_id))];
    const convs = await this.prisma.conversations.findMany({
      where: { id: { in: convIds } },
      select: {
        id: true,
        phone: true,
        contact_id: true,
        contacts: { select: { name: true, last_name: true } },
      },
    });
    const convMap = new Map(convs.map((c) => [c.id, c]));

    const seen = new Set<string>();
    const rows: FlowEventContactRow[] = [];
    for (const e of events) {
      const dedupeKey = `${e.conversation_id}:${e.event_type}:${e.client_key || ''}`;
      if (eventType === 'started' || eventType === 'entered' || eventType === 'replied' || eventType === 'completed' || eventType === 'handed_off' || eventType === 'timeout_closed') {
        if (seen.has(`${e.conversation_id}:${eventType || e.event_type}`)) continue;
        seen.add(`${e.conversation_id}:${eventType || e.event_type}`);
      } else if (seen.has(dedupeKey)) {
        continue;
      } else {
        seen.add(dedupeKey);
      }
      const c = convMap.get(e.conversation_id);
      if (!c) continue;
      const name = [c.contacts?.name, c.contacts?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim();
      rows.push({
        conversation_id: c.id,
        contact_id: c.contact_id,
        contact_name: name || c.phone,
        phone: c.phone,
        event_type: e.event_type,
        client_key: e.client_key,
        node_label: e.node_label,
        match_payload: e.match_payload,
        created_at: e.created_at.toISOString(),
      });
    }
    return rows;
  }

  private async buildAnalyticsForFlow(
    flowId: number,
    nodes: {
      id: number;
      client_key: string | null;
      kind: string;
      body_text: string | null;
      media_filename?: string | null;
    }[],
    sessions: { status: string }[],
  ): Promise<FlowAnalytics> {
    const eventAggs = await this.prisma.flow_session_events.groupBy({
      by: ['client_key', 'event_type'],
      where: {
        flow_id: flowId,
        event_type: { in: ['entered', 'replied'] },
      },
      _count: { _all: true },
    });

    const waitingRaw = await this.prisma.$queryRaw<
      { client_key: string | null; count: bigint }[]
    >`
      SELECT n.client_key, COUNT(*)::bigint AS count
      FROM flow_sessions s
      LEFT JOIN flow_nodes n ON n.id = s.current_node_id
      WHERE s.flow_id = ${flowId} AND s.status = 'active'
      GROUP BY n.client_key
    `;

    const timeoutClosed = await this.prisma.flow_session_events.count({
      where: { flow_id: flowId, event_type: 'timeout_closed' },
    });

    return buildFlowAnalytics({
      sessions,
      nodes,
      eventAggs: eventAggs.map((r) => ({
        client_key: r.client_key,
        event_type: r.event_type,
        count: r._count._all,
      })),
      waitingByKey: waitingRaw,
      timeoutClosed,
    });
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

  /** Poll de maintenance: envía confirmación o cierra por silencio. */
  async processDueTimeouts(): Promise<number> {
    const now = new Date();
    const due = await this.prisma.flow_sessions.findMany({
      where: {
        status: 'active',
        timeout_at: { lte: now },
      },
      take: FLOW_TIMEOUT_BATCH,
      orderBy: { timeout_at: 'asc' },
      include: {
        conversations: {
          select: {
            id: true,
            area: true,
            phone: true,
            whatsapp_phone_number_id: true,
            last_user_message_at: true,
          },
        },
        current_node: true,
      },
    });

    let sent = 0;
    for (const session of due) {
      const conv = session.conversations;
      const node = session.current_node;
      if (!conv || !node || String(node.kind) !== 'message_buttons') {
        await this.markTimeoutHandled(session.id);
        continue;
      }

      const maxNudges = this.effectiveMaxNudges(node);
      const count = session.timeout_nudge_count || 0;

      if (node.timeout_close_on_silence && count >= maxNudges) {
        await this.recordNodeEvent({
          flowId: session.flow_id,
          sessionId: session.id,
          conversationId: conv.id,
          node,
          eventType: 'timeout_closed',
        });
        await this.closeSession(session.id, 'completed', node.id, {
          flowId: session.flow_id,
          conversationId: conv.id,
          skipStatusEvent: true,
        });
        continue;
      }

      const bodyText =
        String(node.timeout_body_text || '').trim() || DEFAULT_FLOW_TIMEOUT_BODY;

      try {
        await this.sendOutboundButtons({
          conversationId: conv.id,
          area: conv.area,
          phone: conv.phone,
          phoneNumberId: conv.whatsapp_phone_number_id,
          bodyText,
          buttons: FLOW_TIMEOUT_CONFIRM_BUTTONS,
          source: 'flow_timeout',
        });
        const nextCount = count + 1;
        await this.recordNodeEvent({
          flowId: session.flow_id,
          sessionId: session.id,
          conversationId: conv.id,
          node,
          eventType: 'timeout_sent',
        });

        const shouldRepeat =
          Boolean(node.timeout_repeat) && nextCount < maxNudges;
        const shouldWaitToClose =
          Boolean(node.timeout_close_on_silence) && nextCount >= maxNudges;

        if (shouldRepeat || shouldWaitToClose) {
          const nextAt = this.computeTimeoutAt({
            timeoutMinutes: node.timeout_minutes,
            windowGuard: node.timeout_window_guard,
            windowLeadMinutes: node.timeout_window_lead_minutes,
            lastUserMessageAt: conv.last_user_message_at,
          });
          await this.prisma.flow_sessions.update({
            where: { id: session.id },
            data: {
              timeout_nudge_count: nextCount,
              timeout_sent_at: now,
              timeout_at: nextAt,
              updated_at: now,
            },
          });
        } else {
          await this.prisma.flow_sessions.update({
            where: { id: session.id },
            data: {
              timeout_nudge_count: nextCount,
              timeout_sent_at: now,
              timeout_at: null,
              updated_at: now,
            },
          });
        }
        sent += 1;
      } catch (error) {
        this.logger.warn(
          `Flujo timeout sesión ${session.id}: ${
            error instanceof Error ? error.message : error
          }`,
        );
        await this.markTimeoutHandled(session.id);
      }
    }
    return sent;
  }

  private async markTimeoutHandled(sessionId: number): Promise<void> {
    await this.prisma.flow_sessions.update({
      where: { id: sessionId },
      data: {
        timeout_sent_at: new Date(),
        timeout_at: null,
        updated_at: new Date(),
      },
    });
  }

  private effectiveMaxNudges(node: {
    timeout_repeat?: boolean | null;
    timeout_max_nudges?: number | null;
  }): number {
    if (!node.timeout_repeat) return 1;
    const n = Number(node.timeout_max_nudges);
    if (!Number.isInteger(n) || n < 1) return 3;
    return Math.min(5, n);
  }

  private computeTimeoutAt(input: {
    timeoutMinutes: number | null | undefined;
    windowGuard: boolean | null | undefined;
    windowLeadMinutes: number | null | undefined;
    lastUserMessageAt: Date | null | undefined;
  }): Date | null {
    const candidates: number[] = [];
    const minutes = this.parseTimeoutMinutes(input.timeoutMinutes);
    if (minutes) {
      candidates.push(Date.now() + minutes * 60_000);
    }
    if (input.windowGuard && input.lastUserMessageAt) {
      const lead =
        this.parseTimeoutMinutes(input.windowLeadMinutes) ?? 60;
      const windowEnd =
        new Date(input.lastUserMessageAt).getTime() + readSessionWindowMs();
      const at = windowEnd - lead * 60_000;
      if (at > Date.now() + 5_000) {
        candidates.push(at);
      }
    }
    if (!candidates.length) return null;
    return new Date(Math.min(...candidates));
  }

  private async scheduleSessionTimeout(input: {
    sessionId: number;
    conversationId: number;
    node: {
      timeout_minutes: number | null;
      timeout_window_guard: boolean;
      timeout_window_lead_minutes: number | null;
    };
    resetCount?: boolean;
  }): Promise<void> {
    const conv = await this.prisma.conversations.findFirst({
      where: { id: input.conversationId },
      select: { last_user_message_at: true },
    });
    const timeoutAt = this.computeTimeoutAt({
      timeoutMinutes: input.node.timeout_minutes,
      windowGuard: input.node.timeout_window_guard,
      windowLeadMinutes: input.node.timeout_window_lead_minutes,
      lastUserMessageAt: conv?.last_user_message_at,
    });
    if (!timeoutAt) {
      await this.clearSessionTimeout(input.sessionId);
      return;
    }
    await this.prisma.flow_sessions.update({
      where: { id: input.sessionId },
      data: {
        timeout_at: timeoutAt,
        timeout_sent_at: null,
        ...(input.resetCount ? { timeout_nudge_count: 0 } : {}),
        updated_at: new Date(),
      },
    });
  }

  private async clearSessionTimeout(sessionId: number): Promise<void> {
    await this.prisma.flow_sessions.update({
      where: { id: sessionId },
      data: {
        timeout_at: null,
        timeout_sent_at: null,
        timeout_nudge_count: 0,
        updated_at: new Date(),
      },
    });
  }

  private parseTimeoutMinutes(value: unknown): number | null {
    if (value == null) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 1440) return null;
    return n;
  }

  private normalizeNodeTimeoutFields(
    kind: FlowNodeKind,
    node: {
      timeout_minutes?: number | null;
      timeout_body_text?: string | null;
      timeout_repeat?: boolean;
      timeout_max_nudges?: number | null;
      timeout_close_on_silence?: boolean;
      timeout_window_guard?: boolean;
      timeout_window_lead_minutes?: number | null;
    },
  ): {
    timeout_minutes: number | null;
    timeout_body_text: string | null;
    timeout_repeat: boolean;
    timeout_max_nudges: number | null;
    timeout_close_on_silence: boolean;
    timeout_window_guard: boolean;
    timeout_window_lead_minutes: number | null;
  } {
    const empty = {
      timeout_minutes: null as number | null,
      timeout_body_text: null as string | null,
      timeout_repeat: false,
      timeout_max_nudges: null as number | null,
      timeout_close_on_silence: false,
      timeout_window_guard: false,
      timeout_window_lead_minutes: null as number | null,
    };
    if (kind !== 'message_buttons') return empty;

    const minutes = this.parseTimeoutMinutes(node.timeout_minutes);
    const windowGuard = Boolean(node.timeout_window_guard);
    if (!minutes && !windowGuard) return empty;

    const repeat = Boolean(node.timeout_repeat) && Boolean(minutes);
    let maxNudges: number | null = null;
    if (repeat) {
      const n = Number(node.timeout_max_nudges);
      maxNudges = Number.isInteger(n) && n >= 1 && n <= 5 ? n : 3;
    }
    const lead = windowGuard
      ? this.parseTimeoutMinutes(node.timeout_window_lead_minutes) ?? 60
      : null;

    return {
      timeout_minutes: minutes,
      timeout_body_text: String(node.timeout_body_text || '').trim() || null,
      timeout_repeat: repeat,
      timeout_max_nudges: maxNudges,
      timeout_close_on_silence: Boolean(node.timeout_close_on_silence),
      timeout_window_guard: windowGuard,
      timeout_window_lead_minutes: lead,
    };
  }

  private async recordNodeEvent(input: {
    flowId: number;
    sessionId: number;
    conversationId: number;
    node: {
      id: number;
      client_key?: string | null;
      kind: string;
      body_text?: string | null;
      media_filename?: string | null;
    };
    eventType: FlowEventType;
    matchPayload?: string | null;
  }): Promise<void> {
    await recordFlowEvent(this.prisma, {
      flowId: input.flowId,
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      nodeId: input.node.id,
      clientKey: input.node.client_key,
      nodeKind: input.node.kind,
      nodeLabel: nodeLabelSnapshot(
        input.node.kind,
        input.node.body_text,
        input.node.media_filename,
      ),
      eventType: input.eventType,
      matchPayload: input.matchPayload,
    });
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

    if (input.matchPayload === FLOW_TIMEOUT_STOP) {
      await this.clearSessionTimeout(input.sessionId);
      await this.closeSession(input.sessionId, 'completed', input.currentNodeId, {
        flowId: input.flowId,
        conversationId: input.conversationId,
      });
      return true;
    }

    if (input.matchPayload === FLOW_TIMEOUT_CONTINUE) {
      await this.clearSessionTimeout(input.sessionId);
      await this.executeNode({
        sessionId: input.sessionId,
        flowId: input.flowId,
        nodeId: input.currentNodeId,
        conversationId: input.conversationId,
        area: input.area,
        phone: input.phone,
        phoneNumberId: input.phoneNumberId,
      });
      return true;
    }

    const currentNode = await this.prisma.flow_nodes.findFirst({
      where: { id: input.currentNodeId, flow_id: input.flowId },
    });

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

    if (!edge) {
      const buttons = parseButtons(currentNode?.buttons_json);
      const isOwnButton = buttons.some(
        (b) => String(b.id || '').trim() === input.matchPayload,
      );
      if (isOwnButton) {
        this.logger.log(
          `Flujo: botón ${input.matchPayload} sin arista; se cierra la sesión`,
        );
        if (currentNode) {
          await this.recordNodeEvent({
            flowId: input.flowId,
            sessionId: input.sessionId,
            conversationId: input.conversationId,
            node: currentNode,
            eventType: 'replied',
            matchPayload: input.matchPayload,
          });
        }
        await this.closeSession(
          input.sessionId,
          'completed',
          input.currentNodeId,
          {
            flowId: input.flowId,
            conversationId: input.conversationId,
          },
        );
        return true;
      }
      this.logger.log(
        `Flujo: clic fuera de contexto payload=${input.matchPayload} nodo=${input.currentNodeId}`,
      );
      try {
        await this.sendOutboundText({
          conversationId: input.conversationId,
          area: input.area,
          phone: input.phone,
          phoneNumberId: input.phoneNumberId,
          text: 'Esa opción ya no aplica. Usa los botones del último mensaje del asistente.',
          source: 'flow',
        });
      } catch (error) {
        this.logger.warn(
          `Flujo: no se pudo avisar clic fuera de contexto: ${
            error instanceof Error ? error.message : error
          }`,
        );
      }
      return true;
    }

    if (currentNode) {
      await this.recordNodeEvent({
        flowId: input.flowId,
        sessionId: input.sessionId,
        conversationId: input.conversationId,
        node: currentNode,
        eventType: 'replied',
        matchPayload: input.matchPayload,
      });
    }
    await this.clearSessionTimeout(input.sessionId);
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
      await this.closeSession(input.sessionId, 'completed', undefined, {
        flowId: input.flowId,
        conversationId: input.conversationId,
      });
      return;
    }

    const kind = String(node.kind) as FlowNodeKind;
    const body = String(node.body_text || '').trim();
    const buttons = parseButtons(node.buttons_json);

    await this.recordNodeEvent({
      flowId: input.flowId,
      sessionId: input.sessionId,
      conversationId: input.conversationId,
      node,
      eventType: 'entered',
    });

    try {
      if (kind === 'end') {
        await this.closeSession(input.sessionId, 'completed', null, {
          flowId: input.flowId,
          conversationId: input.conversationId,
        });
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
        await this.closeSession(input.sessionId, 'handed_off', node.id, {
          flowId: input.flowId,
          conversationId: input.conversationId,
        });
        return;
      }

      if (kind === 'message_buttons') {
        if (!body || buttons.length === 0) {
          this.logger.warn(
            `Flujo nodo ${node.id}: message_buttons incompleto`,
          );
          await this.closeSession(input.sessionId, 'completed', node.id, {
            flowId: input.flowId,
            conversationId: input.conversationId,
          });
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
        await this.scheduleSessionTimeout({
          sessionId: input.sessionId,
          conversationId: input.conversationId,
          node,
          resetCount: true,
        });
        return;
      }

      if (kind === 'message_image' || kind === 'message_document') {
        const mediaUrl = String(node.media_url || '').trim();
        if (!mediaUrl) {
          this.logger.warn(`Flujo nodo ${node.id}: media sin URL`);
          await this.closeSession(input.sessionId, 'completed', node.id, {
            flowId: input.flowId,
            conversationId: input.conversationId,
          });
          return;
        }
        await this.sendOutboundMedia({
          ...input,
          waType: kind === 'message_image' ? 'image' : 'document',
          mediaUrl,
          caption: body,
          filename: String(node.media_filename || '').trim() || undefined,
          mime: String(node.media_mime || '').trim() || null,
        });
        await this.prisma.flow_sessions.update({
          where: { id: input.sessionId },
          data: {
            current_node_id: node.id,
            updated_at: new Date(),
          },
        });

        const nextMediaEdge = await this.prisma.flow_edges.findFirst({
          where: {
            flow_id: input.flowId,
            from_node_id: node.id,
          },
          orderBy: { id: 'asc' },
        });
        if (nextMediaEdge) {
          await this.executeNode({
            ...input,
            nodeId: nextMediaEdge.to_node_id,
          });
        } else {
          await this.closeSession(input.sessionId, 'completed', node.id, {
            flowId: input.flowId,
            conversationId: input.conversationId,
          });
        }
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
        await this.closeSession(input.sessionId, 'completed', node.id, {
          flowId: input.flowId,
          conversationId: input.conversationId,
        });
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
    meta?: {
      flowId: number;
      conversationId: number;
      skipStatusEvent?: boolean;
    },
  ): Promise<void> {
    const session = await this.prisma.flow_sessions.findFirst({
      where: { id: sessionId },
      include: {
        current_node: {
          select: {
            id: true,
            client_key: true,
            kind: true,
            body_text: true,
            media_filename: true,
          },
        },
      },
    });
    await this.prisma.flow_sessions.update({
      where: { id: sessionId },
      data: {
        status,
        timeout_at: null,
        timeout_sent_at: null,
        timeout_nudge_count: 0,
        ...(currentNodeId !== undefined
          ? { current_node_id: currentNodeId }
          : {}),
        updated_at: new Date(),
      },
    });
    if (meta && !meta.skipStatusEvent) {
      const node = session?.current_node;
      await recordFlowEvent(this.prisma, {
        flowId: meta.flowId,
        sessionId,
        conversationId: meta.conversationId,
        nodeId: node?.id ?? (typeof currentNodeId === 'number' ? currentNodeId : null),
        clientKey: node?.client_key,
        nodeKind: node?.kind,
        nodeLabel: node
          ? nodeLabelSnapshot(node.kind, node.body_text, node.media_filename)
          : null,
        eventType: status === 'handed_off' ? 'handed_off' : 'completed',
      });
    }
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
    source?: string;
  }): Promise<void> {
    const source = input.source || 'flow';
    const apiResponse = await sendSessionInteractiveButtons({
      to: input.phone,
      bodyText: input.bodyText,
      buttons: input.buttons,
      area: input.area,
      phoneNumberId: input.phoneNumberId,
    });
    const msgId = apiResponse.messages?.[0]?.id || null;
    let payload = sanitizeApiResponse(apiResponse) as Record<string, unknown>;
    payload.source = source;
    payload.flow_buttons = input.buttons;
    payload = setMessageSender(payload, 'Flujo');
    await this.prisma.chat_messages.create({
      data: {
        conversation_id: input.conversationId,
        direction: 'outbound',
        wa_message_id: msgId,
        body_text: input.bodyText.slice(0, 8000),
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

  private async sendOutboundMedia(input: {
    conversationId: number;
    area: string;
    phone: string;
    phoneNumberId: string | null;
    waType: 'image' | 'document';
    mediaUrl: string;
    caption?: string;
    filename?: string;
    mime?: string | null;
  }): Promise<void> {
    const apiResponse = await sendSessionMediaMessage({
      to: input.phone,
      area: input.area,
      waType: input.waType,
      mediaLink: input.mediaUrl,
      caption: input.caption,
      documentFilename: input.filename,
      phoneNumberId: input.phoneNumberId,
    });
    const msgId = apiResponse.messages?.[0]?.id || null;
    const label = MEDIA_TYPE_LABEL[input.waType] || 'Archivo';
    const caption = String(input.caption || '').trim();
    const bodyText = caption
      ? caption.slice(0, 8000)
      : `[${label}] ${input.filename || input.mediaUrl}`.slice(0, 8000);
    let payload = sanitizeApiResponse(apiResponse) as Record<string, unknown>;
    payload.source = 'flow';
    payload.local_preview = {
      url: input.mediaUrl,
      mime: input.mime || null,
    };
    payload = setMessageSender(payload, 'Flujo');
    await this.prisma.chat_messages.create({
      data: {
        conversation_id: input.conversationId,
        direction: 'outbound',
        wa_message_id: msgId,
        body_text: bodyText,
        message_type: input.waType,
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
      if (kind === 'message_image' || kind === 'message_document') {
        const mediaUrl = String(node.media_url || '').trim();
        if (!mediaUrl) {
          throw new BadRequestException(
            kind === 'message_image'
              ? 'El paso de imagen necesita un archivo o URL'
              : 'El paso de PDF necesita un archivo o URL',
          );
        }
        try {
          const parsed = new URL(mediaUrl);
          if (parsed.protocol !== 'https:') {
            throw new BadRequestException(
              'La URL de media debe usar HTTPS',
            );
          }
        } catch (error) {
          if (error instanceof BadRequestException) throw error;
          throw new BadRequestException('URL de media inválida');
        }
      }
      if (kind === 'message_buttons') {
        const timeoutMinutes = this.parseTimeoutMinutes(node.timeout_minutes);
        if (node.timeout_minutes != null && timeoutMinutes == null) {
          throw new BadRequestException(
            'El recordatorio debe ser entre 1 y 1440 minutos',
          );
        }
        if (
          !timeoutMinutes &&
          !node.timeout_window_guard &&
          (node.timeout_repeat || node.timeout_close_on_silence)
        ) {
          throw new BadRequestException(
            'Activa minutos de recordatorio o aviso 24h antes de repetir/cerrar',
          );
        }
        if (node.timeout_window_guard) {
          const lead = this.parseTimeoutMinutes(
            node.timeout_window_lead_minutes ?? 60,
          );
          if (!lead) {
            throw new BadRequestException(
              'El margen de ventana 24h debe ser entre 1 y 1440 minutos',
            );
          }
        }
      } else if (
        (node.timeout_minutes != null && Number(node.timeout_minutes) > 0) ||
        node.timeout_window_guard ||
        node.timeout_repeat ||
        node.timeout_close_on_silence
      ) {
        throw new BadRequestException(
          'El recordatorio solo aplica a pasos con botones',
        );
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
      const kind = node.kind as FlowNodeKind;
      const timeoutFields = this.normalizeNodeTimeoutFields(kind, node);
      const created = await tx.flow_nodes.create({
        data: {
          flow_id: flowId,
          client_key: key,
          kind: node.kind,
          body_text: String(node.body_text || '').trim() || null,
          buttons_json:
            node.kind === 'message_buttons'
              ? (parseButtons(node.buttons) as unknown as Prisma.InputJsonValue)
              : undefined,
          media_url:
            kind === 'message_image' || kind === 'message_document'
              ? String(node.media_url || '').trim() || null
              : null,
          media_mime:
            kind === 'message_image' || kind === 'message_document'
              ? String(node.media_mime || '').trim() || null
              : null,
          media_filename:
            kind === 'message_image' || kind === 'message_document'
              ? String(node.media_filename || '').trim() || null
              : null,
          timeout_minutes: timeoutFields.timeout_minutes,
          timeout_body_text: timeoutFields.timeout_body_text,
          timeout_repeat: timeoutFields.timeout_repeat,
          timeout_max_nudges: timeoutFields.timeout_max_nudges,
          timeout_close_on_silence: timeoutFields.timeout_close_on_silence,
          timeout_window_guard: timeoutFields.timeout_window_guard,
          timeout_window_lead_minutes:
            timeoutFields.timeout_window_lead_minutes,
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

  private toDetail(
    row: {
      id: number;
      name: string;
      status: string;
      trigger_payload: string;
      entry_node_id: number | null;
      created_at: Date;
      updated_at: Date;
      flow_nodes: {
        id: number;
        client_key: string | null;
        kind: string;
        body_text: string | null;
        buttons_json: unknown;
        media_url: string | null;
        media_mime: string | null;
        media_filename: string | null;
        timeout_minutes: number | null;
        timeout_body_text: string | null;
        timeout_repeat: boolean;
        timeout_max_nudges: number | null;
        timeout_close_on_silence: boolean;
        timeout_window_guard: boolean;
        timeout_window_lead_minutes: number | null;
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
    },
    analytics: FlowAnalytics,
  ): FlowDetail {
    const nodes: FlowNodeDto[] = row.flow_nodes.map((n) => ({
      id: n.id,
      client_key: String(n.client_key || `n_${n.id}`),
      kind: n.kind as FlowNodeKind,
      body_text: String(n.body_text || ''),
      buttons: parseButtons(n.buttons_json),
      media_url: n.media_url ? String(n.media_url) : null,
      media_mime: n.media_mime ? String(n.media_mime) : null,
      media_filename: n.media_filename ? String(n.media_filename) : null,
      timeout_minutes: n.timeout_minutes ?? null,
      timeout_body_text: String(n.timeout_body_text || ''),
      timeout_repeat: Boolean(n.timeout_repeat),
      timeout_max_nudges: n.timeout_max_nudges ?? null,
      timeout_close_on_silence: Boolean(n.timeout_close_on_silence),
      timeout_window_guard: Boolean(n.timeout_window_guard),
      timeout_window_lead_minutes: n.timeout_window_lead_minutes ?? null,
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
      analytics,
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
