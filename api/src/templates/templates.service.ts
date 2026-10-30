import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AuditEvent } from '../audit/audit-events';
import { auditActor } from '../audit/audit-actor.util';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  UpdateTemplateFlagsDto,
  ValidateTemplateDto,
} from './dto/template.dto';
import {
  buildTemplateBuilderState,
  compileTemplateBuilderPayload,
  normalizeBuilderPayload,
  normalizeTemplateName,
  parseStoredPlaceholderAliases,
  TEMPLATE_NAME_REGEX,
} from './template-builder.util';
import { downloadTemplateMediaFromUrl } from './template-media.util';
import {
  extractTemplateDisplayContent,
  extractTemplateSearchText,
} from './template-display.util';
import { templateStatusAllowsEdit } from './template-status.util';
import { buildTemplateDefinition } from './template-definition.util';
import type {
  TemplateCreateResult,
  TemplateDefinition,
  TemplateDetail,
  TemplateListItem,
  SendableTemplateListItem,
  TemplateSyncResult,
  TemplateUsage,
  TemplateValidateResult,
} from './templates.types';
import {
  createMessageTemplateOnWaba,
  fetchAllMessageTemplates,
  getConfiguredWhatsAppCatalogLines,
  getWhatsAppCredentialsForArea,
  resolveWabaId,
  uploadTemplateHeaderHandle,
} from './whatsapp-meta.util';
import {
  fetchTemplateSummary,
  type TemplateSummary,
} from './template-analytics.util';
import { businessReadScope } from '../config/areas';

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

type TemplateListOptions = {
  whatsappLineId?: number | null;
  conversationId?: number | null;
};

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(
    area: AuthUser['area'],
    options: TemplateListOptions = {},
  ): Promise<TemplateListItem[]> {
    const wabaId = await this.resolveFilterWabaId(area, options);
    const rows = await this.prisma.whatsapp_templates.findMany({
      where: {
        area,
        ...(wabaId != null ? { whatsapp_waba_id: wabaId } : {}),
      },
      orderBy: [{ id: 'desc' }],
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        rejection_reason: true,
        submitted_at: true,
        synced_at: true,
        active: true,
        components_json: true,
      },
    });
    return rows.map((row) => {
      const { components_json, ...rest } = row;
      return {
        ...rest,
        search_text: extractTemplateSearchText(components_json),
        submitted_at: toIso(row.submitted_at),
        synced_at: row.synced_at.toISOString(),
      };
    });
  }

  async listSendable(
    area: AuthUser['area'],
    options: TemplateListOptions = {},
  ): Promise<SendableTemplateListItem[]> {
    const wabaId = await this.resolveFilterWabaId(area, options);
    return this.prisma.whatsapp_templates.findMany({
      where: {
        area,
        status: 'APPROVED',
        active: true,
        ...(wabaId != null ? { whatsapp_waba_id: wabaId } : {}),
      },
      orderBy: [{ name: 'asc' }, { language: 'asc' }],
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        active: true,
      },
    });
  }

  async getSendableDefinition(area: AuthUser['area'], id: number): Promise<TemplateDefinition> {
    const row = await this.prisma.whatsapp_templates.findFirst({
      where: { id, area, status: 'APPROVED', active: true },
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        components_json: true,
        placeholder_aliases_json: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Plantilla no encontrada o no disponible');
    }
    return buildTemplateDefinition(row);
  }

  async getSummary(area: AuthUser['area']): Promise<TemplateSummary> {
    return fetchTemplateSummary(this.prisma, area);
  }

  async getById(
    area: AuthUser['area'],
    id: number,
  ): Promise<TemplateDetail> {
    const row = await this.prisma.whatsapp_templates.findFirst({
      where: { id, area },
      select: {
        id: true,
        meta_id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        rejection_reason: true,
        submitted_at: true,
        synced_at: true,
        active: true,
        components_json: true,
        placeholder_aliases_json: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Plantilla no encontrada');
    }
    const usage = await this.loadUsage(
      area,
      row.name,
      row.placeholder_aliases_json,
    );
    return this.mapDetailRow(row, usage);
  }

  async getDefinition(
    area: AuthUser['area'],
    id: number,
  ): Promise<TemplateDefinition> {
    const row = await this.prisma.whatsapp_templates.findFirst({
      where: { id, area },
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        components_json: true,
        placeholder_aliases_json: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Plantilla no encontrada');
    }
    return buildTemplateDefinition(row);
  }

  async validateBuilder(
    area: AuthUser['area'],
    dto: ValidateTemplateDto,
  ): Promise<TemplateValidateResult> {
    try {
      await this.compileBuilderForArea(area, dto.builder);
      return { valid: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Plantilla no válida';
      throw new BadRequestException(message);
    }
  }

  async create(
    area: AuthUser['area'],
    userId: number,
    dto: CreateTemplateDto,
  ): Promise<TemplateCreateResult> {
    const name = normalizeTemplateName(dto.name);
    const language = String(dto.language || 'es').trim();
    const category = String(dto.category || 'MARKETING')
      .trim()
      .toUpperCase();

    if (!TEMPLATE_NAME_REGEX.test(name)) {
      throw new BadRequestException(
        'El nombre debe ir en snake_case (solo letras minúsculas, números y guion bajo).',
      );
    }

    if (dto.source_template_id) {
      const source = await this.prisma.whatsapp_templates.findFirst({
        where: { id: dto.source_template_id, area },
        select: { name: true, language: true },
      });
      if (
        source &&
        source.name.toLowerCase() === name &&
        source.language === language
      ) {
        throw new ConflictException(
          'Para crear una nueva versión usa otro nombre o idioma distinto al original.',
        );
      }
    }

    const { components, placeholderAliases, status, metaId } =
      await this.compileAndSubmitToMeta(area, dto.builder, {
        name,
        language,
        category,
      });

    const whatsappWabaId = await this.resolveDefaultLocalWabaId(area);

    const row = await this.prisma.whatsapp_templates.upsert({
      where: {
        whatsapp_waba_id_name_language: {
          whatsapp_waba_id: whatsappWabaId,
          name,
          language,
        },
      },
      create: {
        area,
        whatsapp_waba_id: whatsappWabaId,
        meta_id: metaId,
        name,
        language,
        category,
        status,
        components_json: components as Prisma.InputJsonValue,
        placeholder_aliases_json:
          (placeholderAliases as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        submitted_at: new Date(),
        submitted_by: userId,
        rejection_reason: null,
      },
      update: {
        meta_id: metaId,
        category,
        status,
        components_json: components as Prisma.InputJsonValue,
        placeholder_aliases_json:
          (placeholderAliases as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        submitted_at: new Date(),
        submitted_by: userId,
        rejection_reason: null,
        synced_at: new Date(),
      },
      select: { id: true, status: true, meta_id: true },
    });

    return { id: row.id, status: row.status };
  }

  async update(
    area: AuthUser['area'],
    userId: number,
    id: number,
    dto: UpdateTemplateDto,
  ): Promise<TemplateCreateResult> {
    const existing = await this.prisma.whatsapp_templates.findFirst({
      where: { id, area },
    });
    if (!existing) {
      throw new NotFoundException('Plantilla no encontrada');
    }
    if (!templateStatusAllowsEdit(existing.status)) {
      throw new BadRequestException(
        'Esta plantilla no se puede editar en su estado actual',
      );
    }

    const category = String(dto.category || existing.category || 'MARKETING')
      .trim()
      .toUpperCase();

    const { components, placeholderAliases, status, metaId } =
      await this.compileAndSubmitToMeta(area, dto.builder, {
        name: existing.name,
        language: existing.language,
        category,
      });

    const row = await this.prisma.whatsapp_templates.update({
      where: { id },
      data: {
        meta_id: metaId,
        category,
        status,
        components_json: components as Prisma.InputJsonValue,
        placeholder_aliases_json:
          (placeholderAliases as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        rejection_reason: null,
        submitted_at: new Date(),
        submitted_by: userId,
        synced_at: new Date(),
      },
      select: { id: true, status: true },
    });

    return { id: row.id, status: row.status };
  }

  async updateFlags(
    area: AuthUser['area'],
    id: number,
    dto: UpdateTemplateFlagsDto,
  ): Promise<TemplateDetail> {
    const existing = await this.prisma.whatsapp_templates.findFirst({
      where: { id, area },
    });
    if (!existing) {
      throw new NotFoundException('Plantilla no encontrada');
    }

    const active =
      dto.active !== undefined ? Boolean(dto.active) : existing.active;

    const row = await this.prisma.whatsapp_templates.update({
      where: { id },
      data: { active },
      select: {
        id: true,
        meta_id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        rejection_reason: true,
        submitted_at: true,
        synced_at: true,
        active: true,
        components_json: true,
        placeholder_aliases_json: true,
      },
    });

    return this.mapDetailRow(
      row,
      await this.loadUsage(area, row.name, row.placeholder_aliases_json),
    );
  }

  async sync(user: AuthUser): Promise<TemplateSyncResult> {
    const area = user.area;
    const targets = await this.resolveSyncTargets(area);
    if (!targets.length) {
      throw new BadRequestException(
        'Falta token o WABA de WhatsApp para esta área',
      );
    }

    let count = 0;
    for (const target of targets) {
      const templates = await fetchAllMessageTemplates(
        target.metaWabaId,
        target.token,
      );
      await this.upsertTemplatesForWaba(area, target.localWabaId, templates);
      count += templates.length;
    }

    await this.auditLog.write({
      event_type: AuditEvent.TEMPLATE_SYNC,
      message: `Sincronización de plantillas Meta (área ${area})`,
      actor: auditActor(user),
      meta: { area, count, wabas: targets.length },
    });

    return { count };
  }

  private async resolveFilterWabaId(
    area: AuthUser['area'],
    options: TemplateListOptions,
  ): Promise<number | null> {
    if (options.whatsappLineId) {
      const line = await this.prisma.whatsapp_lines.findFirst({
        where: {
          id: options.whatsappLineId,
          business_area: { slug: businessReadScope(area).canonicalArea },
        },
        select: { waba_id: true },
      });
      return line?.waba_id ?? null;
    }
    if (options.conversationId) {
      const conversation = await this.prisma.conversations.findFirst({
        where: {
          id: options.conversationId,
          area: { in: businessReadScope(area).areas },
        },
        select: { whatsapp_line: { select: { waba_id: true } } },
      });
      return conversation?.whatsapp_line?.waba_id ?? null;
    }
    return null;
  }

  private async resolveDefaultLocalWabaId(area: AuthUser['area']): Promise<number> {
    const { token, phoneNumberId } = getWhatsAppCredentialsForArea(area);
    if (!token) {
      throw new BadRequestException('Falta token de WhatsApp para esta área');
    }
    const metaWabaId = await resolveWabaId(area, token, phoneNumberId);
    return this.ensureLocalWabaId(metaWabaId);
  }

  private async ensureLocalWabaId(metaWabaId: string): Promise<number> {
    const id = String(metaWabaId || '').trim();
    if (!id) {
      throw new BadRequestException('WABA de Meta no resuelta');
    }
    const existing = await this.prisma.whatsapp_wabas.findUnique({
      where: { meta_waba_id: id },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await this.prisma.whatsapp_wabas.create({
      data: {
        meta_waba_id: id,
        label: `WABA ${id.slice(-6)}`,
        active: true,
      },
      select: { id: true },
    });
    return created.id;
  }

  private async resolveSyncTargets(
    area: AuthUser['area'],
  ): Promise<{ metaWabaId: string; token: string; localWabaId: number }[]> {
    const canonical = businessReadScope(area).canonicalArea;
    const byMeta = new Map<string, string>();
    for (const line of getConfiguredWhatsAppCatalogLines()) {
      if (line.canonicalArea !== canonical) continue;
      if (!line.token || !line.wabaId) continue;
      if (!byMeta.has(line.wabaId)) byMeta.set(line.wabaId, line.token);
    }
    if (!byMeta.size) {
      const { token, phoneNumberId } = getWhatsAppCredentialsForArea(area);
      if (!token) return [];
      const metaWabaId = await resolveWabaId(area, token, phoneNumberId);
      byMeta.set(metaWabaId, token);
    }
    const targets: { metaWabaId: string; token: string; localWabaId: number }[] =
      [];
    for (const [metaWabaId, token] of byMeta) {
      targets.push({
        metaWabaId,
        token,
        localWabaId: await this.ensureLocalWabaId(metaWabaId),
      });
    }
    return targets;
  }

  private async upsertTemplatesForWaba(
    area: AuthUser['area'],
    localWabaId: number,
    templates: Awaited<ReturnType<typeof fetchAllMessageTemplates>>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const keys: { name: string; language: string }[] = [];

      for (const t of templates) {
        const name = String(t.name || '').trim();
        const language = String(t.language || '').trim();
        if (!name || !language) continue;

        keys.push({ name, language });
        const category = String(t.category || '').trim() || null;
        const status = String(t.status || '').trim();
        const metaId = t.id != null ? String(t.id) : null;
        const components = Array.isArray(t.components) ? t.components : [];

        await tx.whatsapp_templates.upsert({
          where: {
            whatsapp_waba_id_name_language: {
              whatsapp_waba_id: localWabaId,
              name,
              language,
            },
          },
          create: {
            area,
            whatsapp_waba_id: localWabaId,
            meta_id: metaId,
            name,
            language,
            category,
            status,
            components_json: components as Prisma.InputJsonValue,
          },
          update: {
            meta_id: metaId,
            category,
            status,
            components_json: components as Prisma.InputJsonValue,
            rejection_reason:
              status.toUpperCase() === 'REJECTED' ? undefined : null,
            synced_at: new Date(),
          },
        });
      }

      if (keys.length === 0) {
        await tx.whatsapp_templates.deleteMany({
          where: { whatsapp_waba_id: localWabaId, area },
        });
      } else {
        await tx.whatsapp_templates.deleteMany({
          where: {
            whatsapp_waba_id: localWabaId,
            area,
            NOT: {
              OR: keys.map((k) => ({
                name: k.name,
                language: k.language,
              })),
            },
          },
        });
      }
    });
  }

  private async loadUsage(
    area: AuthUser['area'],
    templateName: string,
    placeholderAliasesJson: unknown,
  ): Promise<TemplateUsage> {
    const [massRows, directSendsCount] = await Promise.all([
      this.prisma.campaigns.findMany({
        where: {
          area,
          template_name: templateName,
          send_mode: { not: 'direct' },
        },
        orderBy: { created_at: 'desc' },
        take: 30,
        select: {
          id: true,
          status: true,
          segment: true,
          total_recipients: true,
          created_at: true,
          scheduled_at: true,
        },
      }),
      this.prisma.campaigns.count({
        where: {
          area,
          template_name: templateName,
          send_mode: 'direct',
        },
      }),
    ]);

    const aliases = parseStoredPlaceholderAliases(placeholderAliasesJson);
    const payloadToButtonIndex = new Map<string, number>();
    for (const entry of aliases.quickReplyPayloads) {
      const payload = String(entry.payload || '').trim();
      if (!payload) continue;
      if (!payloadToButtonIndex.has(payload)) {
        payloadToButtonIndex.set(payload, entry.index);
      }
    }
    const payloads = [...payloadToButtonIndex.keys()];

    const flowRows =
      payloads.length === 0
        ? []
        : await this.prisma.flows.findMany({
            where: {
              area,
              trigger_payload: { in: payloads },
            },
            select: {
              id: true,
              name: true,
              status: true,
              trigger_payload: true,
            },
            orderBy: { name: 'asc' },
          });

    return {
      mass_campaigns: massRows.map((c) => ({
        id: c.id,
        status: c.status,
        segment: c.segment,
        total_recipients: c.total_recipients,
        created_at: c.created_at.toISOString(),
        scheduled_at: toIso(c.scheduled_at),
      })),
      direct_sends_count: directSendsCount,
      linked_flows: flowRows.map((f) => ({
        id: f.id,
        name: f.name,
        status: f.status,
        trigger_payload: f.trigger_payload,
        button_index: payloadToButtonIndex.get(f.trigger_payload) ?? null,
      })),
    };
  }

  private mapDetailRow(
    row: {
      id: number;
      meta_id: string | null;
      name: string;
      language: string;
      category: string | null;
      status: string;
      rejection_reason: string | null;
      submitted_at: Date | null;
      synced_at: Date;
      active: boolean;
      components_json: unknown;
      placeholder_aliases_json: unknown;
    },
    usage: TemplateUsage,
  ): TemplateDetail {
    return {
      id: row.id,
      meta_id: row.meta_id,
      name: row.name,
      language: row.language,
      category: row.category,
      status: row.status,
      rejection_reason: row.rejection_reason,
      submitted_at: toIso(row.submitted_at),
      synced_at: row.synced_at.toISOString(),
      active: row.active,
      display: extractTemplateDisplayContent(row.components_json),
      can_edit: templateStatusAllowsEdit(row.status),
      builder: buildTemplateBuilderState(
        row.components_json,
        row.placeholder_aliases_json,
      ),
      usage,
    };
  }

  private async compileBuilderForArea(
    area: AuthUser['area'],
    builderRaw: Record<string, unknown>,
  ) {
    const builderPayload = normalizeBuilderPayload(builderRaw);
    return compileTemplateBuilderPayload(builderPayload, {
      resolveHeaderMediaHandle: async ({
        format,
        exampleMediaUrl,
        existingHandle,
      }) => {
        const keepHandle = String(existingHandle || '').trim();
        const url = String(exampleMediaUrl || '').trim();
        if (!url) {
          if (keepHandle) return keepHandle;
          throw new Error(
            'La cabecera media requiere una URL pública de ejemplo para revisión en Meta.',
          );
        }
        const media = await downloadTemplateMediaFromUrl(url);
        if (media.format !== String(format || '').trim().toUpperCase()) {
          throw new Error(
            `La URL de ejemplo no corresponde a una cabecera ${String(format || '').toUpperCase()}.`,
          );
        }
        return uploadTemplateHeaderHandle({
          area,
          buffer: media.buffer,
          mimeType: media.mimeType,
          filename: media.filename,
        });
      },
    });
  }

  private async compileAndSubmitToMeta(
    area: AuthUser['area'],
    builderRaw: Record<string, unknown>,
    meta: { name: string; language: string; category: string },
  ) {
    try {
      const { components, placeholderAliases } =
        await this.compileBuilderForArea(area, builderRaw);

      const apiData = await createMessageTemplateOnWaba({
        area,
        name: meta.name,
        language: meta.language,
        category: meta.category,
        components,
      });

      const metaId = apiData?.id != null ? String(apiData.id) : null;
      const status = String(apiData?.status || 'PENDING')
        .trim()
        .toUpperCase();

      return { components, placeholderAliases, status, metaId };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error creando plantilla';
      throw new BadRequestException(message);
    }
  }
}
