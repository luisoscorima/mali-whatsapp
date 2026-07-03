import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto, UpdateTemplateDto, ValidateTemplateDto } from './dto/template.dto';
import {
  buildTemplateBuilderState,
  compileTemplateBuilderPayload,
  normalizeBuilderPayload,
  normalizeTemplateName,
  TEMPLATE_NAME_REGEX,
} from './template-builder.util';
import { downloadTemplateMediaFromUrl } from './template-media.util';
import { extractTemplateDisplayContent } from './template-display.util';
import { templateStatusAllowsEdit } from './template-status.util';
import { buildTemplateDefinition } from './template-definition.util';
import type {
  TemplateCreateResult,
  TemplateDefinition,
  TemplateDetail,
  TemplateListItem,
  TemplateSyncResult,
  TemplateValidateResult,
} from './templates.types';
import {
  createMessageTemplateOnWaba,
  fetchAllMessageTemplates,
  getWhatsAppCredentialsForArea,
  resolveWabaId,
  uploadTemplateHeaderHandle,
} from './whatsapp-meta.util';

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(area: AuthUser['area']): Promise<TemplateListItem[]> {
    const rows = await this.prisma.whatsapp_templates.findMany({
      where: { area },
      orderBy: [
        { submitted_at: 'desc' },
        { synced_at: 'desc' },
        { id: 'desc' },
      ],
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        status: true,
        rejection_reason: true,
        submitted_at: true,
        synced_at: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      submitted_at: toIso(row.submitted_at),
      synced_at: row.synced_at.toISOString(),
    }));
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
        components_json: true,
        placeholder_aliases_json: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Plantilla no encontrada');
    }
    return this.mapDetailRow(row);
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

    const row = await this.prisma.whatsapp_templates.upsert({
      where: {
        area_name_language: { area, name, language },
      },
      create: {
        area,
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

  async sync(area: AuthUser['area']): Promise<TemplateSyncResult> {
    const { token, phoneNumberId } = getWhatsAppCredentialsForArea(area);
    if (!token) {
      throw new BadRequestException(
        'Falta token de WhatsApp para esta área',
      );
    }

    const wabaId = await resolveWabaId(area, token, phoneNumberId);
    const templates = await fetchAllMessageTemplates(wabaId, token);

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
            area_name_language: { area, name, language },
          },
          create: {
            area,
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
        await tx.whatsapp_templates.deleteMany({ where: { area } });
      } else {
        await tx.whatsapp_templates.deleteMany({
          where: {
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

    return { count: templates.length };
  }

  private mapDetailRow(row: {
    id: number;
    meta_id: string | null;
    name: string;
    language: string;
    category: string | null;
    status: string;
    rejection_reason: string | null;
    submitted_at: Date | null;
    synced_at: Date;
    components_json: unknown;
    placeholder_aliases_json: unknown;
  }): TemplateDetail {
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
      display: extractTemplateDisplayContent(row.components_json),
      can_edit: templateStatusAllowsEdit(row.status),
      builder: buildTemplateBuilderState(
        row.components_json,
        row.placeholder_aliases_json,
      ),
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
