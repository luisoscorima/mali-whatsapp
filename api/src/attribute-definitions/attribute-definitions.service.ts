import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import {
  ALLOWED_ATTR_KEY,
  normalizeAttrSlug,
  normalizeFieldType,
  normalizeOptions,
  parseStoredOptions,
  type AttributeDefinition,
  type FieldType,
} from './attribute-definitions.types';
import type {
  CreateAttributeDefinitionDto,
  UpdateAttributeDefinitionDto,
} from './dto/attribute-definition.dto';
import {
  fetchAttributeSummary,
  type AttributeSummary,
} from './attribute-analytics.util';

const ATTR_DEF_SELECT = {
  id: true,
  segment_slug: true,
  slug: true,
  label: true,
  field_type: true,
  options: true,
  sort_order: true,
  required: true,
  active: true,
} as const;

function mapDefinition(row: {
  id: number;
  segment_slug: string | null;
  slug: string;
  label: string;
  field_type: string;
  options: Prisma.JsonValue | null;
  sort_order: number;
  required: boolean;
  active: boolean;
}): AttributeDefinition {
  return {
    id: row.id,
    segment_slug: row.segment_slug,
    slug: row.slug,
    label: row.label,
    field_type: row.field_type,
    options: parseStoredOptions(row.options),
    sort_order: row.sort_order,
    required: row.required,
    active: row.active,
  };
}

function resolveOptionsForFieldType(
  fieldType: FieldType,
  rawOptions: unknown,
): string[] | null {
  if (fieldType !== 'select') return null;
  const options = normalizeOptions(rawOptions);
  if (options.length < 1) {
    throw new BadRequestException(
      'La lista desplegable requiere al menos una opción',
    );
  }
  return options;
}

@Injectable()
export class AttributeDefinitionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(area: AuthUser['area']): Promise<AttributeDefinition[]> {
    const rows = await this.prisma.contact_attribute_definitions.findMany({
      where: { area, active: true },
      orderBy: [
        { segment_slug: { sort: 'asc', nulls: 'first' } },
        { sort_order: 'asc' },
        { slug: 'asc' },
      ],
      select: ATTR_DEF_SELECT,
    });
    return rows.map(mapDefinition);
  }

  async listAll(area: AuthUser['area']): Promise<AttributeDefinition[]> {
    const rows = await this.prisma.contact_attribute_definitions.findMany({
      where: { area },
      orderBy: [
        { segment_slug: { sort: 'asc', nulls: 'first' } },
        { sort_order: 'asc' },
        { slug: 'asc' },
      ],
      select: ATTR_DEF_SELECT,
    });
    return rows.map(mapDefinition);
  }

  async getSummary(area: AuthUser['area']): Promise<AttributeSummary> {
    return fetchAttributeSummary(this.prisma, area);
  }

  async getById(area: AuthUser['area'], id: number): Promise<AttributeDefinition> {
    const row = await this.prisma.contact_attribute_definitions.findFirst({
      where: { id, area },
      select: ATTR_DEF_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Atributo no encontrado');
    }
    return mapDefinition(row);
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
    const options = resolveOptionsForFieldType(fieldType, dto.options);
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
          options: options ?? Prisma.JsonNull,
          sort_order: sortOrder,
          required,
          active: true,
        },
        select: ATTR_DEF_SELECT,
      });
      return mapDefinition(row);
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
    const fieldType = normalizeFieldType(dto.field_type);
    const options = resolveOptionsForFieldType(fieldType, dto.options);

    const row = await this.prisma.contact_attribute_definitions.update({
      where: { id },
      data: {
        label,
        field_type: fieldType,
        options: options ?? Prisma.JsonNull,
        sort_order: Number(dto.sort_order ?? 0) || 0,
        required: Boolean(dto.required),
        active: dto.active !== false,
        updated_at: new Date(),
      },
      select: ATTR_DEF_SELECT,
    });
    return mapDefinition(row);
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
      options?: string[];
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
      const fieldType = normalizeFieldType(item.field_type);
      let options: string[] | null = null;
      if (fieldType === 'select') {
        options = normalizeOptions(item.options);
        if (options.length < 1) {
          skipped += 1;
          continue;
        }
      }
      try {
        await this.prisma.contact_attribute_definitions.create({
          data: {
            area,
            segment_slug: null,
            slug,
            label,
            field_type: fieldType,
            options: options ?? Prisma.JsonNull,
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
