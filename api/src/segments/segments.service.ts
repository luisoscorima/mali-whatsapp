import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditEvent } from '../audit/audit-events';
import { auditActor } from '../audit/audit-actor.util';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import type { CreateSegmentDto, UpdateSegmentDto } from './dto/segment.dto';
import {
  buildContactsExportBuffer,
  type ContactExportRow,
  segmentContactsExportFilename,
} from '../contacts/contacts-export.util';
import { MAX_CSV_ROWS } from '../contacts/contacts-import.utils';
import {
  normalizeSegmentColorKey,
  SEGMENT_SLUG_REGEX,
  SEGMENT_SELECT,
  mapSegmentRow,
  type SegmentDefinition,
  type SegmentDetail,
  type SegmentMember,
} from './segments.types';
import { parseMonthKey } from '../shared/month-filter.util';

function firstSegmentForLegacyColumn(segments: string[]): string | null {
  if (!segments.length) return null;
  return [...segments].sort()[0] ?? null;
}

@Injectable()
export class SegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async list(area: AuthUser['area'], month?: string): Promise<SegmentDefinition[]> {
    const range = parseMonthKey(month);
    const rows = await this.prisma.segment_definitions.findMany({
      where: {
        area,
        ...(range
          ? { created_at: { gte: range.start, lt: range.end } }
          : {}),
      },
      orderBy: [{ sort_order: 'asc' }, { slug: 'asc' }],
      select: SEGMENT_SELECT,
    });
    return rows.map(mapSegmentRow);
  }

  async listForFilters(area: AuthUser['area']): Promise<SegmentDefinition[]> {
    const rows = await this.prisma.segment_definitions.findMany({
      where: { area, active: true, show_in_filter: true },
      orderBy: [{ sort_order: 'asc' }, { slug: 'asc' }],
      select: SEGMENT_SELECT,
    });
    return rows.map(mapSegmentRow);
  }

  async listAssignable(area: AuthUser['area']): Promise<SegmentDefinition[]> {
    const rows = await this.prisma.segment_definitions.findMany({
      where: { area, active: true, assignable: true },
      orderBy: [{ sort_order: 'asc' }, { slug: 'asc' }],
      select: SEGMENT_SELECT,
    });
    return rows.map(mapSegmentRow);
  }

  async listActiveForAudience(area: AuthUser['area']): Promise<SegmentDefinition[]> {
    const rows = await this.prisma.segment_definitions.findMany({
      where: { area, active: true },
      orderBy: [{ sort_order: 'asc' }, { slug: 'asc' }],
      select: SEGMENT_SELECT,
    });
    return rows.map(mapSegmentRow);
  }

  async reorder(area: AuthUser['area'], orderedIds: number[]): Promise<void> {
    const ids = [...new Set(orderedIds.map((id) => Number(id)).filter((id) => id > 0))];
    if (!ids.length) {
      throw new BadRequestException('Lista de ids inválida');
    }
    const existing = await this.prisma.segment_definitions.findMany({
      where: { area, id: { in: ids } },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new BadRequestException('Hay segmentos que no pertenecen al área');
    }
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.segment_definitions.update({
          where: { id },
          data: { sort_order: index },
        }),
      ),
    );
  }

  async getById(area: AuthUser['area'], id: number): Promise<SegmentDefinition> {
    const row = await this.prisma.segment_definitions.findFirst({
      where: { id, area },
      select: SEGMENT_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Segmento no encontrado');
    }
    return mapSegmentRow(row);
  }

  async getDetail(area: AuthUser['area'], id: number): Promise<SegmentDetail> {
    const segment = await this.getById(area, id);
    const members = await this.loadMembers(area, segment.slug);
    return { segment, members };
  }

  private async loadMembers(
    area: string,
    segmentSlug: string,
  ): Promise<SegmentMember[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: number; name: string; last_name: string; phone: string; segment_slugs: string[] }>
    >(Prisma.sql`
      SELECT
        c.id,
        c.name,
        c.last_name,
        c.phone,
        COALESCE((
          SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
          FROM contact_segments cs
          JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
          WHERE cs.contact_id = c.id
        ), ARRAY[]::varchar[]) AS segment_slugs
      FROM contacts c
      WHERE c.area = ${area}
        AND c.replacement_reason IS NULL
        AND c.replaced_by_contact_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM contact_segments csf
          WHERE csf.contact_id = c.id
            AND csf.area = c.area
            AND csf.segment_slug = ${segmentSlug}
        )
      ORDER BY COALESCE(NULLIF(c.name, ''), c.phone) ASC, c.id DESC
      LIMIT 400
    `);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      last_name: row.last_name,
      phone: row.phone,
      segment_slugs: row.segment_slugs ?? [],
    }));
  }

  async create(user: AuthUser, dto: CreateSegmentDto) {
    const area = user.area;
    const slug = String(dto.slug).trim();
    const label = String(dto.label).trim().slice(0, 120);
    const sortOrder = Number(dto.sort_order ?? 0) || 0;
    const colorKey = normalizeSegmentColorKey(dto.color_key);
    const active = dto.active !== false;
    const showInFilter = dto.show_in_filter !== false;
    const assignable = dto.assignable !== false;

    if (!SEGMENT_SLUG_REGEX.test(slug)) {
      throw new BadRequestException(
        'Slug inválido (minúsculas, números y guion bajo, máx. 50)',
      );
    }
    if (!label) {
      throw new BadRequestException('Etiqueta inválida');
    }

    try {
      const row = await this.prisma.segment_definitions.create({
        data: {
          area,
          slug,
          label,
          sort_order: sortOrder,
          color_key: colorKey,
          active,
          show_in_filter: showInFilter,
          assignable,
        },
        select: SEGMENT_SELECT,
      });
      await this.auditLog.write({
        event_type: AuditEvent.SEGMENT_CREATED,
        message: `Segmento creado: ${slug} (${area})`,
        actor: auditActor(user),
        meta: {
          slug,
          label,
          sort_order: sortOrder,
          color_key: colorKey,
          active,
          show_in_filter: showInFilter,
          assignable,
        },
      });
      return mapSegmentRow(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ese slug ya existe en el área');
      }
      throw error;
    }
  }

  async update(user: AuthUser, id: number, dto: UpdateSegmentDto) {
    const area = user.area;
    const existing = await this.getById(area, id);
    const newSlug = String(dto.slug).trim();
    const label = String(dto.label).trim().slice(0, 120);
    const sortOrder = Number(dto.sort_order ?? 0) || 0;
    const colorKey = normalizeSegmentColorKey(dto.color_key);
    const active = dto.active !== undefined ? Boolean(dto.active) : existing.active;
    const showInFilter =
      dto.show_in_filter !== undefined
        ? Boolean(dto.show_in_filter)
        : existing.show_in_filter;
    const assignable =
      dto.assignable !== undefined ? Boolean(dto.assignable) : existing.assignable;

    if (!label) {
      throw new BadRequestException('Etiqueta inválida');
    }
    if (!SEGMENT_SLUG_REGEX.test(newSlug)) {
      throw new BadRequestException(
        'Slug inválido (minúsculas, números y guion bajo, máx. 50)',
      );
    }

    if (newSlug === existing.slug) {
      const row = await this.prisma.segment_definitions.update({
        where: { id },
        data: {
          label,
          sort_order: sortOrder,
          color_key: colorKey,
          active,
          show_in_filter: showInFilter,
          assignable,
        },
        select: SEGMENT_SELECT,
      });
      await this.auditLog.write({
        event_type: AuditEvent.SEGMENT_UPDATED,
        message: `Segmento actualizado: ${existing.slug} (id ${id})`,
        actor: auditActor(user),
        meta: {
          segment_id: id,
          slug: existing.slug,
          label,
          sort_order: sortOrder,
          color_key: colorKey,
          active,
          show_in_filter: showInFilter,
          assignable,
          slug_changed: false,
        },
      });
      return mapSegmentRow(row);
    }

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.segment_definitions.update({
          where: { id },
          data: {
            slug: newSlug,
            label,
            sort_order: sortOrder,
            color_key: colorKey,
            active,
            show_in_filter: showInFilter,
            assignable,
          },
          select: SEGMENT_SELECT,
        });

        await tx.contact_segments.updateMany({
          where: { area, segment_slug: existing.slug },
          data: { segment_slug: newSlug },
        });
        await tx.contacts.updateMany({
          where: { area, segment: existing.slug },
          data: { segment: newSlug, updated_at: new Date() },
        });
        await tx.campaigns.updateMany({
          where: { area, segment: existing.slug },
          data: { segment: newSlug },
        });

        return updated;
      });
      await this.auditLog.write({
        event_type: AuditEvent.SEGMENT_UPDATED,
        message: `Segmento renombrado: ${existing.slug} → ${newSlug} (id ${id})`,
        actor: auditActor(user),
        meta: {
          segment_id: id,
          old_slug: existing.slug,
          new_slug: newSlug,
          label,
          sort_order: sortOrder,
          color_key: colorKey,
          active,
          show_in_filter: showInFilter,
          assignable,
          slug_changed: true,
        },
      });
      return mapSegmentRow(row);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ese slug ya existe en el área');
      }
      throw error;
    }
  }

  async remove(user: AuthUser, id: number): Promise<void> {
    const area = user.area;
    const existing = await this.getById(area, id);
    await this.prisma.$transaction([
      this.prisma.contact_segments.deleteMany({
        where: { area, segment_slug: existing.slug },
      }),
      this.prisma.segment_definitions.delete({ where: { id } }),
    ]);
    await this.auditLog.write({
      event_type: AuditEvent.SEGMENT_DELETED,
      message: `Segmento eliminado: ${existing.slug} (${area})`,
      actor: auditActor(user),
      meta: { segment_id: id, slug: existing.slug },
    });
  }

  async removeMember(
    area: AuthUser['area'],
    segmentId: number,
    contactId: number,
  ): Promise<SegmentDetail> {
    const segment = await this.getById(area, segmentId);

    const membership = await this.prisma.$queryRaw<
      Array<{ id: number; segment_slugs: string[] }>
    >(Prisma.sql`
      SELECT
        c.id,
        COALESCE((
          SELECT array_agg(cs.segment_slug ORDER BY cs.segment_slug)
          FROM contact_segments cs
          WHERE cs.contact_id = c.id AND cs.area = c.area
        ), ARRAY[]::varchar[]) AS segment_slugs
      FROM contacts c
      WHERE c.id = ${contactId}
        AND c.area = ${area}
        AND EXISTS (
          SELECT 1
          FROM contact_segments csf
          WHERE csf.contact_id = c.id
            AND csf.area = c.area
            AND csf.segment_slug = ${segment.slug}
        )
    `);

    const row = membership[0];
    if (!row) {
      throw new NotFoundException('Ese contacto ya no pertenece a este segmento');
    }

    const currentSegments = row.segment_slugs ?? [];
    if (currentSegments.length <= 1) {
      throw new BadRequestException(
        'El contacto debe conservar al menos un segmento',
      );
    }

    const nextSegments = currentSegments.filter((slug) => slug !== segment.slug);

    await this.prisma.$transaction([
      this.prisma.contact_segments.deleteMany({
        where: { contact_id: contactId, area, segment_slug: segment.slug },
      }),
      this.prisma.contacts.update({
        where: { id: contactId },
        data: {
          segment: firstSegmentForLegacyColumn(nextSegments),
          updated_at: new Date(),
        },
      }),
    ]);

    return this.getDetail(area, segmentId);
  }

  async exportMembers(
    area: AuthUser['area'],
    id: number,
    includeAttributes = true,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const segment = await this.getById(area, id);

    const rows = await this.prisma.$queryRaw<ContactExportRow[]>(Prisma.sql`
      SELECT
        c.id,
        c.name,
        c.phone,
        COALESCE((
          SELECT string_agg(sd.label, ', ' ORDER BY sd.sort_order NULLS LAST, sd.label)
          FROM contact_segments cs
          JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
          WHERE cs.contact_id = c.id AND cs.area = ${area}
        ), '') AS segment_labels
      FROM contacts c
      WHERE c.area = ${area}
        AND c.replacement_reason IS NULL
        AND c.replaced_by_contact_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM contact_segments csf
          WHERE csf.contact_id = c.id
            AND csf.area = c.area
            AND csf.segment_slug = ${segment.slug}
        )
      ORDER BY COALESCE(NULLIF(c.name, ''), c.phone) ASC, c.id DESC
      LIMIT ${MAX_CSV_ROWS + 1}
    `);

    if (rows.length > MAX_CSV_ROWS) {
      throw new BadRequestException(
        `Demasiados contactos (${rows.length}). Máximo ${MAX_CSV_ROWS}; contacta al administrador.`,
      );
    }

    const contactIds = rows.map((r) => r.id);
    const attrMap = new Map<number, Record<string, string>>();
    if (includeAttributes && contactIds.length > 0) {
      const attrRows = await this.prisma.contact_attributes.findMany({
        where: { contact_id: { in: contactIds } },
        orderBy: [{ contact_id: 'asc' }, { attr_key: 'asc' }],
        select: { contact_id: true, attr_key: true, attr_value: true },
      });
      for (const row of attrRows) {
        if (!attrMap.has(row.contact_id)) attrMap.set(row.contact_id, {});
        attrMap.get(row.contact_id)![row.attr_key] = row.attr_value;
      }
    }

    const buffer = buildContactsExportBuffer(rows, attrMap, { includeAttributes });
    return {
      buffer,
      filename: segmentContactsExportFilename(segment.slug),
    };
  }
}
