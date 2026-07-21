import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import {
  ALLOWED_ATTR_KEY,
  normalizeAttrSlug,
  normalizeFieldType,
  type AttributeDefinition,
} from './attribute-definitions.types';
import type {
  CreateAttributeDefinitionDto,
  UpdateAttributeDefinitionDto,
} from './dto/attribute-definition.dto';

@Injectable()
export class AttributeDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(area: AuthUser['area']): Promise<AttributeDefinition[]> {
    return this.prisma.contact_attribute_definitions.findMany({
      where: { area, active: true },
      orderBy: [
        { segment_slug: { sort: 'asc', nulls: 'first' } },
        { sort_order: 'asc' },
        { slug: 'asc' },
      ],
      select: {
        id: true,
        segment_slug: true,
        slug: true,
        label: true,
        field_type: true,
        sort_order: true,
        required: true,
        active: true,
      },
    });
  }

  async listAll(area: AuthUser['area']): Promise<AttributeDefinition[]> {
    return this.prisma.contact_attribute_definitions.findMany({
      where: { area },
      orderBy: [
        { segment_slug: { sort: 'asc', nulls: 'first' } },
        { sort_order: 'asc' },
        { slug: 'asc' },
      ],
      select: {
        id: true,
        segment_slug: true,
        slug: true,
        label: true,
        field_type: true,
        sort_order: true,
        required: true,
        active: true,
      },
    });
  }

  async getById(area: AuthUser['area'], id: number): Promise<AttributeDefinition> {
    const row = await this.prisma.contact_attribute_definitions.findFirst({
      where: { id, area },
      select: {
        id: true,
        segment_slug: true,
        slug: true,
        label: true,
        field_type: true,
        sort_order: true,
        required: true,
        active: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Atributo no encontrado');
    }
    return row;
  }

  async listSegments(area: AuthUser['area']) {
    return this.prisma.segment_definitions.findMany({
      where: { area },
      orderBy: { sort_order: 'asc' },
      select: { slug: true, label: true },
    });
  }

  async create(area: AuthUser['area'], dto: CreateAttributeDefinitionDto) {
    const slug = normalizeAttrSlug(dto.slug);
    const label = String(dto.label).trim().slice(0, 120);
    const fieldType = normalizeFieldType(dto.field_type);
    const sortOrder = Number(dto.sort_order ?? 0) || 0;
    const required = Boolean(dto.required);
    const segmentSlug =
      dto.scope === 'segment'
        ? String(dto.segment_slug ?? '').trim() || null
        : null;

    if (!ALLOWED_ATTR_KEY.test(slug)) {
      throw new BadRequestException('Slug inválido');
    }
    if (!label) {
      throw new BadRequestException('La etiqueta es obligatoria');
    }
    if (segmentSlug) {
      const seg = await this.prisma.segment_definitions.findFirst({
        where: { area, slug: segmentSlug },
      });
      if (!seg) {
        throw new BadRequestException('Segmento no válido');
      }
    }

    try {
      const row = await this.prisma.contact_attribute_definitions.create({
        data: {
          area,
          segment_slug: segmentSlug,
          slug,
          label,
          field_type: fieldType,
          sort_order: sortOrder,
          required,
          active: true,
        },
        select: {
          id: true,
          segment_slug: true,
          slug: true,
          label: true,
          field_type: true,
          sort_order: true,
          required: true,
          active: true,
        },
      });
      return row;
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe un atributo con ese slug');
      }
      throw error;
    }
  }

  async update(
    area: AuthUser['area'],
    id: number,
    dto: UpdateAttributeDefinitionDto,
  ) {
    await this.getById(area, id);
    const label = String(dto.label).trim().slice(0, 120);
    if (!label) {
      throw new BadRequestException('La etiqueta es obligatoria');
    }

    return this.prisma.contact_attribute_definitions.update({
      where: { id },
      data: {
        label,
        field_type: normalizeFieldType(dto.field_type),
        sort_order: Number(dto.sort_order ?? 0) || 0,
        required: Boolean(dto.required),
        active: dto.active !== false,
        updated_at: new Date(),
      },
      select: {
        id: true,
        segment_slug: true,
        slug: true,
        label: true,
        field_type: true,
        sort_order: true,
        required: true,
        active: true,
      },
    });
  }

  async remove(area: AuthUser['area'], id: number): Promise<void> {
    await this.getById(area, id);
    await this.prisma.contact_attribute_definitions.delete({ where: { id } });
  }

  async reorder(area: AuthUser['area'], orderedIds: number[]): Promise<void> {
    const ids = [...new Set(orderedIds.map((id) => Number(id)).filter((id) => id > 0))];
    if (!ids.length) {
      throw new BadRequestException('Lista de ids inválida');
    }
    const existing = await this.prisma.contact_attribute_definitions.findMany({
      where: { area, id: { in: ids } },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new BadRequestException('Hay atributos que no pertenecen al área');
    }
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.contact_attribute_definitions.update({
          where: { id },
          data: { sort_order: index, updated_at: new Date() },
        }),
      ),
    );
  }

  /**
   * Crea defs de área si no existen (idempotente). No falla si el slug ya está.
   */
  async ensureAreaDefinitions(
    area: AuthUser['area'],
    items: Array<{
      slug: string;
      label: string;
      field_type?: string;
      sort_order?: number;
    }>,
  ): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;
    for (const item of items) {
      const slug = normalizeAttrSlug(item.slug);
      const label = String(item.label ?? slug).trim().slice(0, 120) || slug;
      if (!ALLOWED_ATTR_KEY.test(slug)) {
        skipped += 1;
        continue;
      }
      const existing = await this.prisma.contact_attribute_definitions.findFirst({
        where: { area, slug, segment_slug: null },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      try {
        await this.prisma.contact_attribute_definitions.create({
          data: {
            area,
            segment_slug: null,
            slug,
            label,
            field_type: normalizeFieldType(item.field_type),
            sort_order: Number(item.sort_order ?? 0) || 0,
            required: false,
            active: true,
          },
        });
        created += 1;
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'P2002'
        ) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }
    return { created, skipped };
  }
}
