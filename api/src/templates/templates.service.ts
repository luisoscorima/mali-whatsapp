import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { extractTemplateDisplayContent } from './template-display.util';
import type {
  TemplateDetail,
  TemplateListItem,
  TemplateSyncResult,
} from './templates.types';
import {
  fetchAllMessageTemplates,
  getWhatsAppCredentialsForArea,
  resolveWabaId,
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
      },
    });
    if (!row) {
      throw new NotFoundException('Plantilla no encontrada');
    }
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
    };
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
}
