import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import {
  filterAttributesForDefinitions,
  getApplicableAttributeDefinitions,
  normalizeAttributesInput,
  validateRequiredAttributes,
} from './contacts-attributes.utils';
import {
  escapeForLikePattern,
  parseSegmentListFilter,
} from './contacts-filter.utils';
import {
  firstSegmentForLegacyColumn,
  validateContactInput,
} from './contacts-validation.utils';
import {
  MAX_CSV_ROWS,
  parseContactCsvBuffer,
  parseContactXlsxBuffer,
  type ImportContactRow,
} from './contacts-import.utils';
import type { UpsertContactDto } from './dto/upsert-contact.dto';
import type {
  ContactDetail,
  ContactsFilterOptions,
  ContactsImportResult,
  ContactsListResult,
  ListContactsParams,
} from './contacts.types';

type ContactRow = {
  id: number;
  name: string;
  last_name: string;
  phone: string;
  opt_in: boolean;
  active: boolean;
  replaced_by_contact_id: number | null;
  replaced_at: Date | null;
  replacement_reason: string | null;
  created_at: Date;
  segment_slugs: string[];
  _total: number;
};

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  async getFilterOptions(area: AuthUser['area']): Promise<ContactsFilterOptions> {
    const [segments, attributeRows] = await Promise.all([
      this.prisma.segment_definitions.findMany({
        where: { area },
        orderBy: [{ sort_order: 'asc' }, { slug: 'asc' }],
        select: { id: true, slug: true, label: true, color_key: true },
      }),
      this.prisma.contact_attribute_definitions.findMany({
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
        },
      }),
    ]);

    const seen = new Set<string>();
    const attribute_filters = attributeRows
      .map((row) => ({
        slug: row.slug,
        label: row.label,
        segment_slug: row.segment_slug,
      }))
      .filter((row) => {
        const key = `${row.slug}:${row.segment_slug ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    return {
      segments,
      attribute_filters,
      attribute_definitions: attributeRows,
    };
  }

  private async getSegmentSlugSet(area: string): Promise<Set<string>> {
    const rows = await this.prisma.segment_definitions.findMany({
      where: { area },
      select: { slug: true },
    });
    return new Set(rows.map((row) => row.slug));
  }

  private async loadAttributeDefinitions(area: string) {
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
      },
    });
  }

  private async loadContactAttributes(
    contactId: number,
  ): Promise<Record<string, string>> {
    const rows = await this.prisma.contact_attributes.findMany({
      where: { contact_id: contactId },
      orderBy: { attr_key: 'asc' },
      select: { attr_key: true, attr_value: true },
    });
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.attr_key] = row.attr_value;
    }
    return map;
  }

  private async loadContactSegmentSlugs(contactId: number): Promise<string[]> {
    const rows = await this.prisma.contact_segments.findMany({
      where: { contact_id: contactId },
      orderBy: { segment_slug: 'asc' },
      select: { segment_slug: true },
    });
    return rows.map((row) => row.segment_slug);
  }

  private async replaceContactSegments(
    tx: Prisma.TransactionClient,
    contactId: number,
    area: string,
    slugs: string[],
  ): Promise<void> {
    await tx.contact_segments.deleteMany({ where: { contact_id: contactId } });
    if (!slugs.length) return;
    await tx.contact_segments.createMany({
      data: slugs.map((segment_slug) => ({
        contact_id: contactId,
        area,
        segment_slug,
      })),
    });
  }

  private async upsertContactAttributes(
    tx: Prisma.TransactionClient,
    contactId: number,
    attributes: Record<string, string>,
  ): Promise<void> {
    for (const [attr_key, attr_value] of Object.entries(attributes)) {
      await tx.contact_attributes.upsert({
        where: {
          contact_id_attr_key: { contact_id: contactId, attr_key },
        },
        create: { contact_id: contactId, attr_key, attr_value },
        update: { attr_value, updated_at: new Date() },
      });
    }
  }

  private async mapContactDetail(
    area: string,
    row: {
      id: number;
      name: string;
      last_name: string;
      phone: string;
      opt_in: boolean;
      active: boolean;
      replaced_by_contact_id: number | null;
      replaced_at: Date | null;
      replacement_reason: string | null;
      created_at: Date;
    },
    segmentSlugs: string[],
  ): Promise<ContactDetail> {
    const allDefs = await this.loadAttributeDefinitions(area);
    const attributes = await this.loadContactAttributes(row.id);
    return {
      id: row.id,
      name: row.name,
      last_name: row.last_name,
      phone: row.phone,
      opt_in: row.opt_in,
      active: row.active,
      replaced_by_contact_id: row.replaced_by_contact_id,
      replaced_at: row.replaced_at?.toISOString() ?? null,
      replacement_reason: row.replacement_reason,
      created_at: row.created_at.toISOString(),
      segment_slugs: segmentSlugs,
      attributes,
      attribute_definitions: getApplicableAttributeDefinitions(
        allDefs,
        segmentSlugs,
      ),
    };
  }

  async getById(area: AuthUser['area'], id: number): Promise<ContactDetail> {
    const row = await this.prisma.contacts.findFirst({
      where: { id, area },
    });
    if (!row) {
      throw new NotFoundException('Contacto no encontrado');
    }
    const segmentSlugs = await this.loadContactSegmentSlugs(id);
    return this.mapContactDetail(area, row, segmentSlugs);
  }

  async create(area: AuthUser['area'], dto: UpsertContactDto): Promise<ContactDetail> {
    const segmentSet = await this.getSegmentSlugSet(area);
    const validation = validateContactInput(dto, segmentSet, { minSegments: 1 });
    if (!validation.ok) {
      throw new BadRequestException(validation.message);
    }

    const allDefs = await this.loadAttributeDefinitions(area);
    const applicable = getApplicableAttributeDefinitions(
      allDefs,
      validation.value.segments,
    );
    const attrs = filterAttributesForDefinitions(
      normalizeAttributesInput(dto.attributes),
      applicable,
    );
    const requiredError = validateRequiredAttributes(attrs, applicable);
    if (requiredError) {
      throw new BadRequestException(requiredError);
    }

    const { name, last_name, phone, segments } = validation.value;

    try {
      const contactId = await this.prisma.$transaction(async (tx) => {
        const contact = await tx.contacts.create({
          data: {
            name,
            last_name,
            phone,
            segment: firstSegmentForLegacyColumn(segments),
            area,
            opt_in: true,
            active: true,
          },
        });
        await this.replaceContactSegments(tx, contact.id, area, segments);
        await this.upsertContactAttributes(tx, contact.id, attrs);
        await tx.conversations.updateMany({
          where: { area, phone },
          data: { contact_id: contact.id, updated_at: new Date() },
        });
        return contact.id;
      });
      return this.getById(area, contactId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un contacto con ese teléfono en esta área',
        );
      }
      throw error;
    }
  }

  async update(
    area: AuthUser['area'],
    id: number,
    dto: UpsertContactDto,
  ): Promise<ContactDetail> {
    const segmentSet = await this.getSegmentSlugSet(area);
    const validation = validateContactInput(dto, segmentSet, { minSegments: 1 });
    if (!validation.ok) {
      throw new BadRequestException(validation.message);
    }

    const current = await this.prisma.contacts.findFirst({ where: { id, area } });
    if (!current) {
      throw new NotFoundException('Contacto no encontrado');
    }

    const isReplaced =
      Boolean(current.replacement_reason) ||
      current.replaced_by_contact_id != null;
    if (isReplaced) {
      throw new BadRequestException(
        'Este contacto está reemplazado. Reactívalo antes de editarlo.',
      );
    }

    const duplicate = await this.prisma.contacts.findFirst({
      where: { area, phone: validation.value.phone, NOT: { id } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'Ya existe otro contacto con ese teléfono en esta área',
      );
    }

    const applicable = getApplicableAttributeDefinitions(
      await this.loadAttributeDefinitions(area),
      validation.value.segments,
    );
    const attrs = filterAttributesForDefinitions(
      normalizeAttributesInput(dto.attributes),
      applicable,
    );
    const requiredError = validateRequiredAttributes(attrs, applicable);
    if (requiredError) {
      throw new BadRequestException(requiredError);
    }

    const { name, last_name, phone, segments } = validation.value;
    const phoneChanged = String(current.phone) !== String(phone);

    if (!phoneChanged) {
      await this.prisma.$transaction(async (tx) => {
        await tx.contacts.update({
          where: { id },
          data: {
            name,
            last_name,
            phone,
            segment: firstSegmentForLegacyColumn(segments),
            active: true,
            replaced_by_contact_id: null,
            replaced_at: null,
            replacement_reason: null,
            updated_at: new Date(),
          },
        });
        await this.replaceContactSegments(tx, id, area, segments);
        await this.upsertContactAttributes(tx, id, attrs);
      });
      return this.getById(area, id);
    }

    const newContactId = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contacts.create({
        data: {
          name,
          last_name,
          phone,
          segment: firstSegmentForLegacyColumn(segments),
          area,
          opt_in: current.opt_in,
          active: true,
        },
      });
      await this.replaceContactSegments(tx, created.id, area, segments);
      await this.upsertContactAttributes(tx, created.id, attrs);
      await tx.contacts.update({
        where: { id },
        data: {
          active: false,
          replaced_by_contact_id: created.id,
          replaced_at: new Date(),
          replacement_reason: 'phone_change',
          updated_at: new Date(),
        },
      });
      await tx.conversations.updateMany({
        where: { area, phone },
        data: { contact_id: created.id, updated_at: new Date() },
      });
      return created.id;
    });

    return this.getById(area, newContactId);
  }

  async remove(area: AuthUser['area'], id: number): Promise<void> {
    const result = await this.prisma.contacts.deleteMany({ where: { id, area } });
    if (result.count === 0) {
      throw new NotFoundException('Contacto no encontrado');
    }
  }

  async reactivate(area: AuthUser['area'], id: number): Promise<ContactDetail> {
    const current = await this.prisma.contacts.findFirst({ where: { id, area } });
    if (!current) {
      throw new NotFoundException('Contacto no encontrado');
    }
    const isReplaced =
      Boolean(current.replacement_reason) ||
      current.replaced_by_contact_id != null;
    if (!isReplaced) {
      return this.getById(area, id);
    }
    await this.prisma.contacts.update({
      where: { id },
      data: {
        active: true,
        replaced_by_contact_id: null,
        replaced_at: null,
        replacement_reason: null,
        updated_at: new Date(),
      },
    });
    return this.getById(area, id);
  }

  async importFromBuffer(
    area: AuthUser['area'],
    buffer: Buffer,
    filename: string,
  ): Promise<ContactsImportResult> {
    const segmentSet = await this.getSegmentSlugSet(area);
    const lower = String(filename ?? '').toLowerCase();
    const parsed = lower.endsWith('.xlsx')
      ? parseContactXlsxBuffer(buffer, segmentSet)
      : parseContactCsvBuffer(buffer, segmentSet);

    if (parsed.rows.length === 0 && parsed.errors.length === 0) {
      throw new BadRequestException('Archivo sin datos');
    }

    if (parsed.rows.length > MAX_CSV_ROWS) {
      throw new BadRequestException(
        `Demasiadas filas (${parsed.rows.length}). Máximo ${MAX_CSV_ROWS}`,
      );
    }

    const allDefs = await this.loadAttributeDefinitions(area);

    let imported = 0;
    for (const row of parsed.rows) {
      await this.importSingleRow(area, row, allDefs);
      imported += 1;
    }

    return {
      imported,
      errors: parsed.errors.length,
      error_samples: parsed.errors.slice(0, 10),
      duplicate_phones_in_file: parsed.duplicate_phones_in_file,
      duplicate_rows_in_file: parsed.duplicate_rows_in_file,
      duplicate_phone_examples: parsed.duplicate_phone_examples,
    };
  }

  private async importSingleRow(
    area: string,
    row: ImportContactRow,
    allDefs: Awaited<ReturnType<ContactsService['loadAttributeDefinitions']>>,
  ): Promise<void> {
    const applicable = getApplicableAttributeDefinitions(allDefs, row.segments);
    const attrs = filterAttributesForDefinitions(
      normalizeAttributesInput(row.attributes),
      applicable,
    );

    await this.prisma.$transaction(async (tx) => {
      const contact = await tx.contacts.upsert({
        where: { area_phone: { area, phone: row.phone } },
        create: {
          name: row.name,
          last_name: row.last_name,
          phone: row.phone,
          segment: firstSegmentForLegacyColumn(row.segments),
          area,
          opt_in: true,
          active: true,
        },
        update: {
          name: row.name,
          last_name: row.last_name,
          segment: firstSegmentForLegacyColumn(row.segments),
          active: true,
          replaced_by_contact_id: null,
          replaced_at: null,
          replacement_reason: null,
          updated_at: new Date(),
        },
      });

      await this.replaceContactSegments(tx, contact.id, area, row.segments);
      if (Object.keys(attrs).length > 0) {
        await this.upsertContactAttributes(tx, contact.id, attrs);
      }
      await tx.conversations.updateMany({
        where: { area, phone: row.phone },
        data: { contact_id: contact.id, updated_at: new Date() },
      });
    });
  }

  async list(
    area: AuthUser['area'],
    params: ListContactsParams,
  ): Promise<ContactsListResult> {
    const page = Math.max(1, Number(params.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit ?? 50) || 50));
    const offset = (page - 1) * limit;
    const showReplaced = Boolean(params.show_replaced);

    const segments = await this.prisma.segment_definitions.findMany({
      where: { area },
      select: { slug: true },
    });
    const slugSet = new Set(segments.map((row) => row.slug));
    const segmentFilter = parseSegmentListFilter(params.segment, slugSet);

    const conditions: Prisma.Sql[] = [Prisma.sql`c.area = ${area}`];

    if (!showReplaced) {
      conditions.push(
        Prisma.sql`c.replacement_reason IS NULL AND c.replaced_by_contact_id IS NULL`,
      );
    }

    const segmentClauses: Prisma.Sql[] = [];
    if (segmentFilter.slugs.length > 0) {
      segmentClauses.push(Prisma.sql`EXISTS (
        SELECT 1 FROM contact_segments csf
        WHERE csf.contact_id = c.id AND csf.segment_slug = ANY(${segmentFilter.slugs}::varchar[])
      )`);
    }
    if (segmentFilter.includeNone) {
      segmentClauses.push(Prisma.sql`NOT EXISTS (
        SELECT 1 FROM contact_segments csn
        WHERE csn.contact_id = c.id
      )`);
    }
    if (segmentClauses.length > 0) {
      conditions.push(Prisma.sql`(${Prisma.join(segmentClauses, ' OR ')})`);
    }

    const searchQ = String(params.q ?? '').trim();
    const qDigits = searchQ.replace(/\D/g, '');
    if (searchQ) {
      const searchPat = `%${escapeForLikePattern(searchQ)}%`;
      if (qDigits) {
        const digitsPat = `%${qDigits}%`;
        conditions.push(Prisma.sql`(
          COALESCE(c.name, '') ILIKE ${searchPat} ESCAPE '!'
          OR COALESCE(c.last_name, '') ILIKE ${searchPat} ESCAPE '!'
          OR COALESCE(c.phone, '') ILIKE ${searchPat} ESCAPE '!'
          OR regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE ${digitsPat}
        )`);
      } else {
        conditions.push(Prisma.sql`(
          COALESCE(c.name, '') ILIKE ${searchPat} ESCAPE '!'
          OR COALESCE(c.last_name, '') ILIKE ${searchPat} ESCAPE '!'
          OR COALESCE(c.phone, '') ILIKE ${searchPat} ESCAPE '!'
        )`);
      }
    }

    const attrKey = String(params.attr_key ?? '').trim().toLowerCase();
    const attrValue = String(params.attr_value ?? '').trim();
    if (attrKey && attrValue) {
      const attrPat = `%${escapeForLikePattern(attrValue)}%`;
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM contact_attributes ca
        WHERE ca.contact_id = c.id
          AND ca.attr_key = ${attrKey}
          AND ca.attr_value ILIKE ${attrPat} ESCAPE '!'
      )`);
    }

    const where = Prisma.join(conditions, ' AND ');

    const rows = await this.prisma.$queryRaw<ContactRow[]>(Prisma.sql`
      SELECT
        c.id,
        c.name,
        c.last_name,
        c.phone,
        c.opt_in,
        c.active,
        c.replaced_by_contact_id,
        c.replaced_at,
        c.replacement_reason,
        c.created_at,
        COALESCE((
          SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
          FROM contact_segments cs
          JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
          WHERE cs.contact_id = c.id
        ), ARRAY[]::varchar[]) AS segment_slugs,
        COUNT(*) OVER()::int AS _total
      FROM contacts c
      WHERE ${where}
      ORDER BY c.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const total = rows[0]?._total ?? 0;
    const pages = total > 0 ? Math.ceil(total / limit) : 0;

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        last_name: row.last_name,
        phone: row.phone,
        opt_in: row.opt_in,
        active: row.active,
        replaced_by_contact_id: row.replaced_by_contact_id,
        replaced_at: row.replaced_at?.toISOString() ?? null,
        replacement_reason: row.replacement_reason,
        created_at: row.created_at.toISOString(),
        segment_slugs: row.segment_slugs ?? [],
      })),
      total,
      page,
      limit,
      pages,
    };
  }
}
