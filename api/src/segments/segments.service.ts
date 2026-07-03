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
  normalizeSegmentColorKey,
  SEGMENT_SLUG_REGEX,
  type SegmentDefinition,
  type SegmentDetail,
  type SegmentMember,
} from './segments.types';

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

  async list(area: AuthUser['area']): Promise<SegmentDefinition[]> {
    return this.prisma.segment_definitions.findMany({
      where: { area },
      orderBy: [{ sort_order: 'asc' }, { slug: 'asc' }],
      select: {
        id: true,
        slug: true,
        label: true,
        sort_order: true,
        color_key: true,
      },
    });
  }

  async getById(area: AuthUser['area'], id: number): Promise<SegmentDefinition> {
    const row = await this.prisma.segment_definitions.findFirst({
      where: { id, area },
      select: {
        id: true,
        slug: true,
        label: true,
        sort_order: true,
        color_key: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Segmento no encontrado');
    }
    return row;
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
        data: { area, slug, label, sort_order: sortOrder, color_key: colorKey },
        select: {
          id: true,
          slug: true,
          label: true,
          sort_order: true,
          color_key: true,
        },
      });
      await this.auditLog.write({
        event_type: AuditEvent.SEGMENT_CREATED,
        message: `Segmento creado: ${slug} (${area})`,
        actor: auditActor(user),
        meta: { slug, label, sort_order: sortOrder, color_key: colorKey },
      });
      return row;
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
        data: { label, sort_order: sortOrder, color_key: colorKey },
        select: {
          id: true,
          slug: true,
          label: true,
          sort_order: true,
          color_key: true,
        },
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
          slug_changed: false,
        },
      });
      return row;
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
          },
          select: {
            id: true,
            slug: true,
            label: true,
            sort_order: true,
            color_key: true,
          },
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
          slug_changed: true,
        },
      });
      return row;
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
}
