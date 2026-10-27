import { Injectable, BadRequestException, ConflictException, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { businessReadScope } from '../config/areas';
import {
  applyCategoryGrant,
  categoryOfProgram,
  programIdForCategory,
  programScopeWhere,
} from '../config/category-scope';
import {
  contactAccessPredicate,
} from '../config/business-scope';
import { payloadWithStandardCurso } from '../leads/lead-curso.util';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { parseStoredOptions } from '../attribute-definitions/attribute-definitions.types';
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
  validateContactIdentityInput,
} from './contacts-validation.utils';
import {
  MAX_CSV_ROWS,
  parseContactCsvBuffer,
  parseContactXlsxBuffer,
  type ImportContactRow,
} from './contacts-import.utils';
import {
  buildContactsExportBuffer,
  categoryExportPrefix,
  contactsExportFilename,
  type ContactExportRow,
} from './contacts-export.util';
import type { UpsertContactDto } from './dto/upsert-contact.dto';
import type {
  ContactDetail,
  ContactsFilterOptions,
  ContactsImportResult,
  ContactsListResult,
  ListContactsParams,
} from './contacts.types';
import {
  fetchContactSummary,
  type ContactSummary,
} from './contact-analytics.util';
import { AuditEvent } from '../audit/audit-events';
import { auditActor, phoneMetaTail } from '../audit/audit-actor.util';
import { AuditLogService } from '../audit/audit-log.service';
import { upsertScopedAttribute } from './contact-attribute.util';
import { PersonResolverService } from '../people/person-resolver.service';

type ContactRow = {
  id: number;
  name: string;
  last_name: string;
  phone: string | null;
  whatsapp_user_id: string | null;
  wa_username: string | null;
  email: string | null;
  dni: string | null;
  opt_in: boolean;
  opt_in_email: boolean;
  active: boolean;
  created_at: Date;
  segment_slugs: string[];
  _total: number;
};

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    @Optional() private readonly people?: PersonResolverService,
  ) {}

  async getFilterOptions(
    area: AuthUser['area'],
    categories: string[] | null = null,
  ): Promise<ContactsFilterOptions> {
    const [segments, attributeRows] = await Promise.all([
      this.prisma.segment_definitions.findMany({
        where: { area, active: true, show_in_filter: true, ...programScopeWhere(categories) },
        orderBy: [{ sort_order: 'asc' }, { slug: 'asc' }],
        select: {
          id: true,
          slug: true,
          label: true,
          color_key: true,
          program: { select: { slug: true } },
        },
      }),
      this.prisma.contact_attribute_definitions.findMany({
        where: { area, active: true, ...programScopeWhere(categories) },
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
          options: true,
          sort_order: true,
          required: true,
          program: { select: { slug: true } },
        },
      }),
    ]);

    const seen = new Set<string>();
    const attribute_filters = attributeRows
      .map((row) => ({
        slug: row.slug,
        label: row.label,
        segment_slug: row.segment_slug,
        category: categoryOfProgram(row.program?.slug),
      }))
      .filter((row) => {
        const key = `${row.category}:${row.slug}:${row.segment_slug ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    return {
      segments: segments.map((row) => ({
        id: row.id,
        slug: row.slug,
        label: row.label,
        color_key: row.color_key,
        category: categoryOfProgram(row.program?.slug),
      })),
      attribute_filters,
      attribute_definitions: attributeRows.map((row) => ({
        id: row.id,
        segment_slug: row.segment_slug,
        slug: row.slug,
        label: row.label,
        field_type: row.field_type,
        options: parseStoredOptions(row.options),
        sort_order: row.sort_order,
        required: row.required,
        category: categoryOfProgram(row.program?.slug),
      })),
    };
  }

  private async getSegmentSlugSet(
    area: string,
    programId?: number | null,
  ): Promise<Set<string>> {
    const rows = await this.prisma.segment_definitions.findMany({
      where: {
        area,
        ...(programId !== undefined ? { program_id: programId } : {}),
      },
      select: { slug: true },
    });
    return new Set(rows.map((row) => row.slug));
  }

  /** null = sin filtro. */
  private async resolveCategoryFilter(
    area: string,
    categories: string[] | null | undefined,
  ): Promise<{ includeGeneral: boolean; programIds: number[] } | null> {
    const granted = applyCategoryGrant(categories ?? null);
    if (!granted?.length) return null;
    if (granted.includes('__none__')) {
      return { includeGeneral: false, programIds: [-1] };
    }
    const includeGeneral = granted.includes('general');
    const slugs = granted.filter((slug) => slug !== 'general');
    if (!slugs.length) return { includeGeneral, programIds: [] };
    const canonical = businessReadScope(area).canonicalArea;
    const rows = await this.prisma.business_programs.findMany({
      where: {
        slug: { in: slugs },
        business_area: { slug: canonical },
      },
      select: { id: true },
    });
    return {
      includeGeneral,
      programIds: rows.map((row) => row.id),
    };
  }

  private contactCategoryMatchSql(
    filter: { includeGeneral: boolean; programIds: number[] },
  ): Prisma.Sql {
    const parts: Prisma.Sql[] = [];
    if (filter.includeGeneral) {
      parts.push(Prisma.sql`EXISTS (
        SELECT 1 FROM contact_segments cs_g
        WHERE cs_g.contact_id = c.id AND cs_g.program_id IS NULL
      )`);
      parts.push(Prisma.sql`EXISTS (
        SELECT 1 FROM contact_attributes ca_g
        WHERE ca_g.contact_id = c.id AND ca_g.program_id IS NULL
      )`);
      parts.push(Prisma.sql`(
        NOT EXISTS (
          SELECT 1 FROM contact_segments cs_ng
          WHERE cs_ng.contact_id = c.id AND cs_ng.program_id IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM contact_attributes ca_ng
          WHERE ca_ng.contact_id = c.id AND ca_ng.program_id IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM contact_programs cp_ng WHERE cp_ng.contact_id = c.id
        )
      )`);
    }
    if (filter.programIds.length) {
      const ids = Prisma.join(filter.programIds);
      parts.push(Prisma.sql`EXISTS (
        SELECT 1 FROM contact_segments cs_p
        WHERE cs_p.contact_id = c.id AND cs_p.program_id IN (${ids})
      )`);
      parts.push(Prisma.sql`EXISTS (
        SELECT 1 FROM contact_attributes ca_p
        WHERE ca_p.contact_id = c.id AND ca_p.program_id IN (${ids})
      )`);
      parts.push(Prisma.sql`EXISTS (
        SELECT 1 FROM contact_programs cp_p
        WHERE cp_p.contact_id = c.id AND cp_p.program_id IN (${ids})
      )`);
    }
    if (!parts.length) return Prisma.sql`FALSE`;
    return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
  }

  private async loadAttributeDefinitions(area: string, programId?: number | null) {
    const rows = await this.prisma.contact_attribute_definitions.findMany({
      where: {
        area,
        active: true,
        ...(programId !== undefined ? { program_id: programId } : {}),
      },
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
        options: true,
        sort_order: true,
        required: true,
        program: { select: { slug: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      segment_slug: row.segment_slug,
      slug: row.slug,
      label: row.label,
      field_type: row.field_type,
      options: parseStoredOptions(row.options),
      sort_order: row.sort_order,
      required: row.required,
      category: categoryOfProgram(row.program?.slug),
    }));
  }

  private async loadContactAttributes(
    contactId: number,
    programId: number | null = null,
  ): Promise<Record<string, string>> {
    const rows = await this.prisma.contact_attributes.findMany({
      where: { contact_id: contactId, program_id: programId },
      orderBy: { attr_key: 'asc' },
      select: { attr_key: true, attr_value: true },
    });
    const map: Record<string, string> = {};
    for (const row of rows) {
      map[row.attr_key] = row.attr_value;
    }
    return map;
  }

  private async loadContactSegmentSlugs(
    contactId: number,
    area?: string,
    programId?: number | null,
  ): Promise<string[]> {
    const rows = await this.prisma.contact_segments.findMany({
      where: { contact_id: contactId },
      orderBy: { segment_slug: 'asc' },
      select: { segment_slug: true },
    });
    if (programId === undefined || !area) {
      return rows.map((row) => row.segment_slug);
    }
    const defs = await this.prisma.segment_definitions.findMany({
      where: { area, program_id: programId },
      select: { slug: true },
    });
    const allowed = new Set(defs.map((def) => def.slug));
    return rows.map((row) => row.segment_slug).filter((slug) => allowed.has(slug));
  }

  private async buildListWhereClause(
    area: string,
    params: ListContactsParams,
    slugSet: Set<string>,
  ): Promise<Prisma.Sql> {
    const segmentFilter = parseSegmentListFilter(params.segment, slugSet);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`c.area = ${area}`,
      contactAccessPredicate('c'),
    ];

    const categoryFilter = await this.resolveCategoryFilter(
      area,
      params.categories,
    );
    if (categoryFilter) {
      conditions.push(this.contactCategoryMatchSql(categoryFilter));
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
      const usernameSearchPat = `%${escapeForLikePattern(searchQ.replace(/^@/, ''))}%`;
      if (qDigits) {
        const digitsPat = `%${qDigits}%`;
        conditions.push(Prisma.sql`(
          COALESCE(c.name, '') ILIKE ${searchPat} ESCAPE '!'
          OR COALESCE(c.last_name, '') ILIKE ${searchPat} ESCAPE '!'
          OR COALESCE(c.phone, '') ILIKE ${searchPat} ESCAPE '!'
          OR COALESCE(c.email, '') ILIKE ${searchPat} ESCAPE '!'
          OR COALESCE(c.dni, '') ILIKE ${searchPat} ESCAPE '!'
          OR EXISTS (SELECT 1 FROM conversations conv WHERE conv.area = c.area AND conv.contact_id = c.id AND COALESCE(conv.wa_username, '') ILIKE ${usernameSearchPat} ESCAPE '!')
          OR regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE ${digitsPat}
        )`);
      } else {
        conditions.push(Prisma.sql`(
          COALESCE(c.name, '') ILIKE ${searchPat} ESCAPE '!'
          OR COALESCE(c.last_name, '') ILIKE ${searchPat} ESCAPE '!'
          OR COALESCE(c.phone, '') ILIKE ${searchPat} ESCAPE '!'
          OR COALESCE(c.email, '') ILIKE ${searchPat} ESCAPE '!'
          OR COALESCE(c.dni, '') ILIKE ${searchPat} ESCAPE '!'
          OR EXISTS (SELECT 1 FROM conversations conv WHERE conv.area = c.area AND conv.contact_id = c.id AND COALESCE(conv.wa_username, '') ILIKE ${usernameSearchPat} ESCAPE '!')
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
    } else if (attrKey) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM contact_attributes ca
        WHERE ca.contact_id = c.id
          AND ca.attr_key = ${attrKey}
          AND TRIM(COALESCE(ca.attr_value, '')) <> ''
      )`);
    }

    return Prisma.join(conditions, ' AND ');
  }

  async bulkAddSegment(
    user: AuthUser,
    segmentSlug: string,
    contactIds: number[],
    assignableOnly = false,
  ): Promise<{ updated: number }> {
    const area = user.area;
    const slug = String(segmentSlug || '').trim();
    if (assignableOnly) {
      const assignable = await this.prisma.segment_definitions.findFirst({
        where: {
          area,
          active: true,
          assignable: true,
          slug,
          assignment_group: { not: null },
        },
        select: { slug: true, assignment_group: true },
      });
      if (!assignable?.assignment_group) {
        throw new BadRequestException('Segmento no asignable');
      }
    } else {
      const segmentSet = await this.getSegmentSlugSet(area);
      if (!segmentSet.has(slug)) {
        throw new BadRequestException('Segmento invalido');
      }
    }

    const assignableRows = assignableOnly
      ? await this.prisma.segment_definitions.findMany({
          where: {
            area,
            active: true,
            assignable: true,
            assignment_group: { not: null },
          },
          select: { slug: true, assignment_group: true },
        })
      : [];
    const assignableBySlug = new Map(
      assignableRows.map((row) => [
        row.slug,
        String(row.assignment_group ?? '').trim(),
      ]),
    );
    const targetGroup = assignableBySlug.get(slug) ?? '';

    const ids = [
      ...new Set(
        contactIds
          .map((x) => Number(x))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
    if (ids.length === 0) {
      throw new BadRequestException('Selecciona al menos un contacto');
    }

    let updated = 0;
    const pendingAudits: {
      contactId: number;
      change: { added: string[]; removed: string[]; next: string[] };
    }[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const cid of ids) {
        const own = await tx.contacts.findFirst({
          where: {
            id: cid,
            area,
          },
          select: { id: true },
        });
        if (!own) continue;

        const current = await tx.contact_segments.findMany({
          where: { contact_id: cid, area },
          select: { segment_slug: true },
        });
        let nextSlugs = current.map((row) => row.segment_slug);

        if (assignableOnly && targetGroup) {
          nextSlugs = nextSlugs.filter((s) => {
            const g = assignableBySlug.get(s);
            return !(g && g === targetGroup && s !== slug);
          });
        }
        if (!nextSlugs.includes(slug)) {
          nextSlugs = [...nextSlugs, slug];
        }

        const change = await this.replaceContactSegments(
          tx,
          cid,
          area,
          nextSlugs,
        );
        if (change.added.length || change.removed.length) {
          pendingAudits.push({ contactId: cid, change });
          updated += 1;
        }
      }
    });

    for (const item of pendingAudits) {
      await this.auditSegmentChange(user, item.contactId, area, item.change);
    }

    await this.auditLog.write({
      event_type: AuditEvent.CONTACT_BULK_SEGMENT,
      message: `Asignación masiva al segmento «${slug}» (${ids.length} contactos)`,
      actor: auditActor(user),
      meta: {
        segment_slug: slug,
        contact_count: updated,
        assignable_only: assignableOnly,
      },
    });

    return { updated };
  }

  async bulkSetAttribute(
    user: AuthUser,
    attrKey: string,
    attrValue: string,
    contactIds: number[],
  ): Promise<{ updated: number }> {
    const area = user.area;
    const normalized = normalizeAttributesInput({ [attrKey]: attrValue });
    const keys = Object.keys(normalized);
    if (keys.length !== 1) {
      throw new BadRequestException('Atributo invalido');
    }
    const key = keys[0];
    const value = normalized[key];
    if (key === 'dni') {
      throw new BadRequestException('No se puede asignar DNI de forma masiva');
    }

    const allDefs = await this.loadAttributeDefinitions(area);
    const defExists = allDefs.some((d) => d.slug === key);
    if (!defExists) {
      throw new BadRequestException('Atributo invalido');
    }

    const ids = [
      ...new Set(
        contactIds
          .map((x) => Number(x))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
    if (ids.length === 0) {
      throw new BadRequestException('Selecciona al menos un contacto');
    }

    let updated = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const cid of ids) {
        const own = await tx.contacts.findFirst({
          where: {
            id: cid,
            area,
          },
          select: { id: true },
        });
        if (!own) continue;

        const segmentRows = await tx.contact_segments.findMany({
          where: { contact_id: cid, area },
          select: { segment_slug: true },
        });
        const segmentSlugs = segmentRows.map((r) => r.segment_slug);
        const applicable = getApplicableAttributeDefinitions(
          allDefs,
          segmentSlugs,
        );
        if (!applicable.some((d) => d.slug === key)) continue;

        await this.upsertContactAttributes(tx, cid, { [key]: value });
        updated += 1;
      }
    });

    await this.auditLog.write({
      event_type: AuditEvent.CONTACT_BULK_ATTRIBUTE,
      message: `Asignación masiva del atributo «${key}» (${updated} contactos)`,
      actor: auditActor(user),
      meta: {
        attr_key: key,
        contact_count: updated,
      },
    });

    return { updated };
  }

  async setAssignableSegment(
    user: AuthUser,
    contactId: number,
    segmentSlug: string,
    category?: string | null,
  ): Promise<{ segment_slugs: string[] }> {
    const area = user.area;
    const slug = String(segmentSlug || '').trim();
    if (!slug) {
      throw new BadRequestException('Segmento invalido');
    }

    const segmentProgramId = await this.programIdFromCategory(area, category);
    const assignableRows = await this.prisma.segment_definitions.findMany({
      where: {
        area,
        active: true,
        assignable: true,
        assignment_group: { not: null },
        program_id: segmentProgramId,
      },
      select: { slug: true, assignment_group: true },
    });
    const assignableBySlug = new Map(
      assignableRows.map((row) => [
        row.slug,
        String(row.assignment_group ?? '').trim(),
      ]),
    );
    const targetGroup = assignableBySlug.get(slug);
    if (!targetGroup) {
      throw new BadRequestException('Segmento no asignable desde chat');
    }

    const contact = await this.prisma.contacts.findFirst({
      where: {
        id: contactId,
        area,
      },
      select: { id: true },
    });
    if (!contact) {
      throw new NotFoundException('Contacto no encontrado');
    }

    const currentSlugs = await this.loadContactSegmentSlugs(
      contactId,
      area,
      segmentProgramId,
    );
    const otherSlugs = currentSlugs.filter((s) => !assignableBySlug.has(s));
    const currentAssignable = currentSlugs.filter((s) =>
      assignableBySlug.has(s),
    );
    const nextAssignable = currentAssignable.includes(slug)
      ? currentAssignable.filter((s) => s !== slug)
      : [
          ...currentAssignable.filter(
            (s) => assignableBySlug.get(s) !== targetGroup,
          ),
          slug,
        ];
    const nextSlugs = [...otherSlugs, ...nextAssignable];

    let segmentChange: {
      added: string[];
      removed: string[];
      next: string[];
    } | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.contacts.update({
        where: { id: contactId },
        data: {
          segment: firstSegmentForLegacyColumn(nextSlugs),
          updated_at: new Date(),
        },
      });
      segmentChange = await this.replaceContactSegments(
        tx,
        contactId,
        area,
        nextSlugs,
        segmentProgramId,
      );
    });

    if (segmentChange) {
      await this.auditSegmentChange(user, contactId, area, segmentChange);
    }

    await this.auditLog.write({
      event_type: AuditEvent.CONTACT_UPDATED,
      message: `Segmento asignable en chat (contacto ${contactId})`,
      actor: auditActor(user),
      meta: {
        contact_id: contactId,
        segment_slug: slug,
        segments: nextSlugs,
        toggled_off: currentAssignable.includes(slug),
      },
    });

    return { segment_slugs: nextSlugs };
  }

  async exportFiltered(
    area: AuthUser['area'],
    params: ListContactsParams,
    includeAttributes = true,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const segments = await this.prisma.segment_definitions.findMany({
      where: { area },
      select: { slug: true },
    });
    const slugSet = new Set(segments.map((row) => row.slug));
    const where = await this.buildListWhereClause(area, params, slugSet);
    const categoryFilter = await this.resolveCategoryFilter(
      area,
      params.categories,
    );
    const prefixCategories =
      !categoryFilter ||
      (categoryFilter.includeGeneral ? 1 : 0) + categoryFilter.programIds.length !==
        1;

    const baseRows = await this.prisma.$queryRaw<
      Array<{
        id: number;
        name: string;
        last_name: string;
        phone: string | null;
        wa_username: string | null;
        email: string | null;
        dni: string | null;
      }>
    >(Prisma.sql`
      SELECT
        c.id,
        c.name,
        c.last_name,
        c.phone,
        (SELECT conv.wa_username FROM conversations conv
         WHERE conv.area = c.area AND conv.contact_id = c.id AND conv.wa_username IS NOT NULL
         ORDER BY conv.updated_at DESC LIMIT 1) AS wa_username,
        c.email,
        c.dni
      FROM contacts c
      WHERE ${where}
      ORDER BY COALESCE(NULLIF(c.name, ''), c.phone) ASC, c.id DESC
      LIMIT ${MAX_CSV_ROWS + 1}
    `);

    if (baseRows.length > MAX_CSV_ROWS) {
      throw new BadRequestException(
        `Demasiados contactos (${baseRows.length}). Máximo ${MAX_CSV_ROWS}; acota los filtros.`,
      );
    }

    const contactIds = baseRows.map((r) => r.id);
    const segWhere: Prisma.contact_segmentsWhereInput = {
      contact_id: { in: contactIds },
      area,
      ...(categoryFilter
        ? {
            OR: [
              ...(categoryFilter.includeGeneral ? [{ program_id: null }] : []),
              ...(categoryFilter.programIds.length
                ? [{ program_id: { in: categoryFilter.programIds } }]
                : []),
            ],
          }
        : {}),
    };
    const segRows = contactIds.length
      ? await this.prisma.contact_segments.findMany({
          where: segWhere,
          select: {
            contact_id: true,
            segment_slug: true,
            program_id: true,
            program: { select: { slug: true } },
          },
          orderBy: [{ contact_id: 'asc' }, { segment_slug: 'asc' }],
        })
      : [];

    const categoriesByContact = new Map<number, Set<string>>();
    const segmentsByContact = new Map<number, string[]>();
    for (const row of segRows) {
      const cat = categoryOfProgram(row.program?.slug);
      if (!categoriesByContact.has(row.contact_id)) {
        categoriesByContact.set(row.contact_id, new Set());
      }
      categoriesByContact.get(row.contact_id)!.add(cat);
      const label = prefixCategories
        ? `${categoryExportPrefix(cat)}:${row.segment_slug}`
        : row.segment_slug;
      if (!segmentsByContact.has(row.contact_id)) {
        segmentsByContact.set(row.contact_id, []);
      }
      segmentsByContact.get(row.contact_id)!.push(label);
    }

    const attrMap = new Map<number, Record<string, string>>();
    if (includeAttributes && contactIds.length > 0) {
      const attrWhere: Prisma.contact_attributesWhereInput = {
        contact_id: { in: contactIds },
        ...(categoryFilter
          ? {
              OR: [
                ...(categoryFilter.includeGeneral ? [{ program_id: null }] : []),
                ...(categoryFilter.programIds.length
                  ? [{ program_id: { in: categoryFilter.programIds } }]
                  : []),
              ],
            }
          : {}),
      };
      const attrRows = await this.prisma.contact_attributes.findMany({
        where: attrWhere,
        orderBy: [{ contact_id: 'asc' }, { attr_key: 'asc' }],
        select: {
          contact_id: true,
          attr_key: true,
          attr_value: true,
          program: { select: { slug: true } },
        },
      });
      for (const row of attrRows) {
        const cat = categoryOfProgram(row.program?.slug);
        if (!categoriesByContact.has(row.contact_id)) {
          categoriesByContact.set(row.contact_id, new Set());
        }
        categoriesByContact.get(row.contact_id)!.add(cat);
        if (!attrMap.has(row.contact_id)) attrMap.set(row.contact_id, {});
        const key = prefixCategories
          ? `${cat}.${row.attr_key}`
          : row.attr_key;
        attrMap.get(row.contact_id)![key] = row.attr_value;
      }
    }

    const programRows = contactIds.length
      ? await this.prisma.contact_programs.findMany({
          where: {
            contact_id: { in: contactIds },
            ...(categoryFilter?.programIds.length
              ? { program_id: { in: categoryFilter.programIds } }
              : {}),
          },
          select: {
            contact_id: true,
            program: { select: { slug: true } },
          },
        })
      : [];
    for (const row of programRows) {
      const cat = categoryOfProgram(row.program?.slug);
      if (!categoriesByContact.has(row.contact_id)) {
        categoriesByContact.set(row.contact_id, new Set());
      }
      categoriesByContact.get(row.contact_id)!.add(cat);
    }

    const rows: ContactExportRow[] = baseRows.map((c) => {
      const cats = [...(categoriesByContact.get(c.id) ?? [])].sort();
      return {
        ...c,
        categories_label: cats.length ? cats.join(', ') : 'general',
        segment_labels: (segmentsByContact.get(c.id) ?? []).join(', '),
      };
    });

    const buffer = buildContactsExportBuffer(rows, attrMap, { includeAttributes });
    return { buffer, filename: contactsExportFilename() };
  }

  private async replaceContactSegments(
    tx: Prisma.TransactionClient,
    contactId: number,
    area: string,
    slugs: string[],
    programId: number | null = null,
  ): Promise<{
    program_id: number | null;
    previous: string[];
    next: string[];
    added: string[];
    removed: string[];
  }> {
    const prevRows = await tx.contact_segments.findMany({
      where: { contact_id: contactId, program_id: programId },
      select: { segment_slug: true },
    });
    const previous = [
      ...new Set(prevRows.map((r) => r.segment_slug)),
    ].sort();
    const requested = [...new Set(slugs.map((s) => String(s).trim()).filter(Boolean))];
    const defs = requested.length
      ? await tx.segment_definitions.findMany({
          where: { area, program_id: programId, slug: { in: requested } },
          select: { slug: true },
        })
      : [];
    const allowed = new Set(defs.map((def) => def.slug));
    const next = requested.filter((slug) => allowed.has(slug)).sort();
    const prevSet = new Set(previous);
    const nextSet = new Set(next);
    const added = next.filter((s) => !prevSet.has(s));
    const removed = previous.filter((s) => !nextSet.has(s));

    await tx.contact_segments.deleteMany({
      where: { contact_id: contactId, program_id: programId },
    });
    if (next.length) {
      await tx.contact_segments.createMany({
        data: next.map((segment_slug) => ({
          contact_id: contactId,
          area,
          segment_slug,
          program_id: programId,
        })),
      });
    }
    return { previous, next, added, removed, program_id: programId };
  }

  private async programIdFromCategory(
    area: string,
    category: unknown,
  ): Promise<number | null> {
    const slug = String(category ?? '').trim().toLowerCase();
    if (!slug || slug === 'general') return null;
    const canonical = businessReadScope(area).canonicalArea;
    const id = await programIdForCategory(
      (programSlug) =>
        this.prisma.business_programs.findFirst({
          where: {
            slug: programSlug,
            business_area: { slug: canonical },
          },
          select: { id: true },
        }),
      slug,
    );
    if (!id) throw new BadRequestException('Categoría no válida');
    return id;
  }

  private async auditSegmentChange(
    user: AuthUser,
    contactId: number,
    area: string,
    change: { added: string[]; removed: string[]; next: string[]; program_id?: number | null },
    phone?: string | null,
  ): Promise<void> {
    if (!change.added.length && !change.removed.length) return;
    await this.auditLog.write({
      event_type: AuditEvent.CONTACT_SEGMENT_CHANGE,
      message: `Segmentos contacto ${contactId}: +${change.added.join(',') || '—'} / -${change.removed.join(',') || '—'}`,
      actor: auditActor(user),
      meta: {
        contact_id: contactId,
        added: change.added,
        removed: change.removed,
        segments: change.next,
        ...(change.program_id !== undefined ? { program_id: change.program_id } : {}),
        ...(phone ? { phone, phone_tail: phoneMetaTail(phone) } : {}),
      },
    });
  }

  private async upsertContactAttributes(
    tx: Prisma.TransactionClient,
    contactId: number,
    attributes: Record<string, string>,
    programId: number | null = null,
  ): Promise<void> {
    for (const [attr_key, attr_value] of Object.entries(attributes)) {
      await upsertScopedAttribute(tx, contactId, attr_key, attr_value, programId);
    }
  }

  private async ensureContactProgram(
    tx: Prisma.TransactionClient,
    contactId: number,
    programId: number | null,
    source: string,
  ): Promise<void> {
    if (!programId) return;
    await tx.contact_programs.upsert({
      where: {
        contact_id_program_id: {
          contact_id: contactId,
          program_id: programId,
        },
      },
      create: {
        contact_id: contactId,
        program_id: programId,
        source,
      },
      update: { last_seen_at: new Date() },
    });
  }

  private async mapContactDetail(
    area: string,
    row: {
      id: number;
      name: string;
      last_name: string;
      phone: string | null;
      whatsapp_user_id: string | null;
      email: string | null;
      dni: string | null;
      opt_in: boolean;
      opt_in_email: boolean;
      active: boolean;
      created_at: Date;
      lead_status_id: number | null;
      lead_status: { id: number; slug: string; label: string } | null;
    },
    segmentSlugs: string[],
    programId?: number | null,
  ): Promise<ContactDetail> {
    const allDefs = await this.loadAttributeDefinitions(area, programId);
    const attributes = await this.loadContactAttributes(row.id, programId ?? null);
    const originRows = await this.prisma.contact_origins.findMany({
      where: { contact_id: row.id, area },
      orderBy: { last_seen_at: 'desc' },
      take: 20,
      select: {
        id: true,
        channel: true,
        external_id: true,
        source_key: true,
        source_label: true,
        payload: true,
        first_seen_at: true,
        last_seen_at: true,
      },
    });
    const linkedConversation = await this.prisma.conversations.findFirst({
      where: { area, contact_id: row.id, wa_username: { not: null } },
      select: { wa_username: true },
      orderBy: { updated_at: 'desc' },
    });
    return {
      id: row.id,
      name: row.name,
      last_name: row.last_name,
      phone: row.phone,
      whatsapp_user_id: row.whatsapp_user_id,
      wa_username: linkedConversation?.wa_username ?? null,
      email: row.email,
      dni: row.dni,
      opt_in: row.opt_in,
      opt_in_email: row.opt_in_email,
      active: row.active,
      created_at: row.created_at.toISOString(),
      segment_slugs: segmentSlugs,
      lead_status_id: row.lead_status_id,
      lead_status: row.lead_status,
      attributes,
      attribute_definitions: getApplicableAttributeDefinitions(
        allDefs,
        segmentSlugs,
      ).filter((d) => d.slug !== 'dni'),
      origins: originRows.map((o) => ({
        id: o.id,
        channel: o.channel,
        external_id: o.external_id,
        source_key: o.source_key,
        source_label: o.source_label,
        payload: payloadWithStandardCurso(o.payload),
        first_seen_at: o.first_seen_at.toISOString(),
        last_seen_at: o.last_seen_at.toISOString(),
      })),
    };
  }

  async getById(
    area: AuthUser['area'],
    id: number,
    category?: string | null,
  ): Promise<ContactDetail> {
    const row = await this.prisma.contacts.findFirst({
      where: { id, area },
      include: {
        lead_status: { select: { id: true, slug: true, label: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Contacto no encontrado');
    }
    const scoped = Boolean(category);
    const programId = !scoped
      ? undefined
      : category === 'general'
        ? null
        : (await this.programIdFromCategory(area, category)) ?? -1;
    const segmentSlugs = await this.loadContactSegmentSlugs(
      id,
      scoped ? area : undefined,
      programId,
    );
    return this.mapContactDetail(area, row, segmentSlugs, programId);
  }

  private async assertConversationIdentityCompatible(
    tx: Prisma.TransactionClient,
    area: string,
    phone: string | null,
    userId: string | null,
  ): Promise<void> {
    if (!phone || !userId) return;
    const conflict = await tx.conversations.findFirst({
      where: { area, OR: [
        { phone, whatsapp_user_id: { not: userId } },
        { whatsapp_user_id: userId, phone: { not: phone } },
      ] },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException('El teléfono y la identidad de WhatsApp pertenecen a conversaciones distintas');
    }
  }

  async create(user: AuthUser, dto: UpsertContactDto): Promise<ContactDetail> {
    const area = user.area;
    const segmentSet = await this.getSegmentSlugSet(area);
    const validation = validateContactIdentityInput(dto, segmentSet);
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

    const { name, last_name, phone, whatsapp_user_id, segments } = validation.value;
    const email = this.normalizeOptionalEmail(dto.email);
    const dni = this.normalizeOptionalDni(dto.dni);
    const opt_in_email =
      dto.opt_in_email !== undefined ? Boolean(dto.opt_in_email) : true;
    const segmentProgramId = await this.programIdFromCategory(area, dto.category);

    try {
      if (this.people) {
        const resolved = await this.people.resolve(this.prisma, {
          area,
          name,
          last_name,
          phone,
          whatsapp_user_id,
          email,
          dni,
          opt_in: true,
          opt_in_email,
        });
        const created = await this.prisma.$transaction(async (tx) => {
          await this.assertConversationIdentityCompatible(tx, area, phone, whatsapp_user_id);
          const change = await this.replaceContactSegments(tx, resolved.contact_id, area, segments, segmentProgramId);
          await this.upsertContactAttributes(tx, resolved.contact_id, attrs, segmentProgramId);
          if (dni) await this.upsertContactAttributes(tx, resolved.contact_id, { dni }, segmentProgramId);
          await this.ensureContactProgram(tx, resolved.contact_id, segmentProgramId, 'contact');
          await tx.conversations.updateMany({
            where: { area, contact_id: null, OR: [
              ...(phone ? [{ phone }] : []),
              ...(whatsapp_user_id ? [{ whatsapp_user_id }] : []),
            ] },
            data: { contact_id: resolved.contact_id, updated_at: new Date() },
          });
          return { contactId: resolved.contact_id, change };
        });
        await this.auditLog.write({
          event_type: resolved.created ? AuditEvent.CONTACT_CREATED : AuditEvent.CONTACT_UPDATED,
          message: resolved.created
            ? `Contacto creado (id ${created.contactId})`
            : `Ficha reutilizada (id ${created.contactId})`,
          actor: auditActor(user),
          meta: {
            contact_id: created.contactId,
            person_id: resolved.person_id,
            conflict: resolved.conflict,
            phone,
            phone_tail: phone ? phoneMetaTail(phone) : null,
            email,
            dni,
            segments: validation.value.segments,
          },
        });
        await this.auditSegmentChange(user, created.contactId, area, created.change, phone);
        const stored = await this.prisma.contacts.findFirst({
          where: { id: created.contactId },
          select: { area: true },
        });
        return this.getById(stored?.area ?? area, created.contactId);
      }
      const created = await this.prisma.$transaction(async (tx) => {
        await this.assertConversationIdentityCompatible(tx, area, phone, whatsapp_user_id);
        const contact = await tx.contacts.create({
          data: {
            name,
            last_name,
            phone,
            whatsapp_user_id,
            email,
            dni,
            segment: firstSegmentForLegacyColumn(segments),
            area,
            opt_in: true,
            opt_in_email,
            active: true,
          },
        });
        const change = await this.replaceContactSegments(
          tx,
          contact.id,
          area,
          segments,
          segmentProgramId,
        );
        await this.upsertContactAttributes(tx, contact.id, attrs, segmentProgramId);
        if (dni) {
          await this.upsertContactAttributes(tx, contact.id, { dni }, segmentProgramId);
        }
        await this.ensureContactProgram(tx, contact.id, segmentProgramId, 'contact');
        await tx.conversations.updateMany({
          where: { area, contact_id: null, OR: [
            ...(phone ? [{ phone }] : []),
            ...(whatsapp_user_id ? [{ whatsapp_user_id }] : []),
          ] },
          data: { contact_id: contact.id, updated_at: new Date() },
        });
        return { contactId: contact.id, change };
      });
      await this.auditLog.write({
        event_type: AuditEvent.CONTACT_CREATED,
        message: `Contacto creado (id ${created.contactId})`,
        actor: auditActor(user),
        meta: {
          contact_id: created.contactId,
          phone,
          phone_tail: phone ? phoneMetaTail(phone) : null,
          email,
          dni,
          segments: validation.value.segments,
        },
      });
      await this.auditSegmentChange(
        user,
        created.contactId,
        area,
        created.change,
        phone,
      );
      return this.getById(area, created.contactId);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Ya existe un contacto con ese teléfono o identidad de WhatsApp en esta área',
        );
      }
      throw error;
    }
  }

  async update(
    user: AuthUser,
    id: number,
    dto: UpsertContactDto,
  ): Promise<ContactDetail> {
    const area = user.area;
    const current = await this.prisma.contacts.findFirst({ where: { id, area } });
    if (!current) {
      throw new NotFoundException('Contacto no encontrado');
    }
    if (
      current.whatsapp_user_id &&
      dto.whatsapp_user_id != null &&
      dto.whatsapp_user_id !== current.whatsapp_user_id
    ) {
      throw new BadRequestException('La identidad de WhatsApp no se edita manualmente');
    }
    const segmentSet = await this.getSegmentSlugSet(area);
    const validation = validateContactIdentityInput(
      {
        ...dto,
        phone: dto.phone ?? (dto.phone_local === undefined ? current.phone ?? undefined : undefined),
        whatsapp_user_id: dto.whatsapp_user_id ?? current.whatsapp_user_id ?? undefined,
      },
      segmentSet,
    );
    if (!validation.ok) {
      throw new BadRequestException(validation.message);
    }

    if (current.phone && validation.value.phone !== current.phone) {
      throw new BadRequestException(
        'El teléfono no se puede cambiar. Crea otro contacto para el número nuevo.',
      );
    }

    const duplicate = validation.value.phone
      ? await this.prisma.contacts.findFirst({
          where: { area, phone: validation.value.phone, NOT: { id } },
          select: { id: true },
        })
      : null;
    if (duplicate) {
      throw new ConflictException(
        'Ya existe otro contacto con ese teléfono en esta área',
      );
    }
    if (validation.value.whatsapp_user_id) {
      const duplicateUserId = await this.prisma.contacts.findFirst({
        where: { area, whatsapp_user_id: validation.value.whatsapp_user_id, NOT: { id } },
        select: { id: true },
      });
      if (duplicateUserId) {
        throw new ConflictException('Esta identidad de WhatsApp ya pertenece a otro contacto');
      }
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

    const { name, last_name, phone, whatsapp_user_id, segments } = validation.value;
    const email =
      dto.email !== undefined
        ? this.normalizeOptionalEmail(dto.email)
        : current.email;
    const dni =
      dto.dni !== undefined
        ? this.normalizeOptionalDni(dto.dni)
        : current.dni;
    const opt_in_email =
      dto.opt_in_email !== undefined
        ? Boolean(dto.opt_in_email)
        : current.opt_in_email;
    const segmentProgramId = await this.programIdFromCategory(area, dto.category);
    {
      const change = await this.prisma.$transaction(async (tx) => {
        await this.assertConversationIdentityCompatible(tx, area, phone, whatsapp_user_id);
        await tx.contacts.update({
          where: { id },
          data: {
            name,
            last_name,
            phone,
            whatsapp_user_id,
            email,
            dni,
            opt_in_email,
            segment: firstSegmentForLegacyColumn(segments),
            active: true,
            updated_at: new Date(),
          },
        });
        const segmentChange = await this.replaceContactSegments(
          tx,
          id,
          area,
          segments,
          segmentProgramId,
        );
        await this.upsertContactAttributes(tx, id, attrs, segmentProgramId);
        if (dto.dni !== undefined) {
          await this.upsertContactAttributes(
            tx,
            id,
            { dni: dni ?? '' },
            segmentProgramId,
          );
        }
        await this.ensureContactProgram(tx, id, segmentProgramId, 'contact');
        await tx.conversations.updateMany({
          where: { area, AND: [
            { OR: [{ contact_id: null }, { contact_id: id }] },
            { OR: [
              ...(phone ? [{ phone }] : []),
              ...(whatsapp_user_id ? [{ whatsapp_user_id }] : []),
            ] },
          ] },
          data: { contact_id: id, updated_at: new Date() },
        });
        return segmentChange;
      });
      await this.auditSegmentChange(user, id, area, change, phone);
      await this.auditLog.write({
        event_type: AuditEvent.CONTACT_UPDATED,
        message: `Contacto actualizado (id ${id})`,
        actor: auditActor(user),
        meta: {
          contact_id: id,
          phone,
          phone_tail: phone ? phoneMetaTail(phone) : null,
          email,
          dni,
          segments,
        },
      });
      return this.getById(area, id);
    }
  }

  async remove(user: AuthUser, id: number): Promise<void> {
    const area = user.area;
    const result = await this.prisma.contacts.deleteMany({ where: { id, area } });
    if (result.count === 0) {
      throw new NotFoundException('Contacto no encontrado');
    }
    await this.auditLog.write({
      event_type: AuditEvent.CONTACT_DELETED,
      message: `Contacto eliminado (id ${id})`,
      actor: auditActor(user),
      meta: { contact_id: id },
    });
  }

  async reactivate(area: AuthUser['area'], id: number): Promise<ContactDetail> {
    const current = await this.prisma.contacts.findFirst({ where: { id, area } });
    if (!current) {
      throw new NotFoundException('Contacto no encontrado');
    }
    if (current.active) {
      return this.getById(area, id);
    }
    await this.prisma.contacts.update({
      where: { id },
      data: {
        active: true,
        updated_at: new Date(),
      },
    });
    return this.getById(area, id);
  }

  private defaultImportCategory(categories: string[] | null | undefined): string {
    const granted = applyCategoryGrant(categories ?? null);
    if (granted?.length === 1 && granted[0] !== '__none__') return granted[0];
    return 'general';
  }

  async previewImport(
    area: string,
    buffer: Buffer,
    filename: string,
    categories: string[] | null = null,
  ): Promise<import('./contacts.types').ContactsImportPreview> {
    const segmentSet = await this.getSegmentSlugSet(area);
    const lower = String(filename ?? '').toLowerCase();
    const parsed = lower.endsWith('.xlsx')
      ? parseContactXlsxBuffer(buffer, segmentSet)
      : parseContactCsvBuffer(buffer, segmentSet);
    const fallbackCategory = this.defaultImportCategory(categories);
    for (const row of parsed.rows) {
      if (!row.category) row.category = fallbackCategory;
    }

    if (parsed.rows.length === 0 && parsed.errors.length === 0) {
      throw new BadRequestException('Archivo sin datos');
    }
    if (parsed.rows.length > MAX_CSV_ROWS) {
      throw new BadRequestException(
        `Demasiadas filas (${parsed.rows.length}). Máximo ${MAX_CSV_ROWS}`,
      );
    }

    const phones = parsed.rows.map((r) => r.phone);
    const existingContacts = await this.prisma.contacts.findMany({
      where: { area, phone: { in: phones } },
      select: { phone: true, email: true },
    });
    const existingByPhone = new Map(
      existingContacts.map((c) => [c.phone, c]),
    );

    let willUpdate = 0;
    let willCreate = 0;
    let duplicateEmailsSkipped = 0;

    const allEmails = await this.prisma.contacts.findMany({
      where: {
        area,
        email: {
          in: parsed.rows
            .map((r) => r.email)
            .filter((e): e is string => !!e),
        },
      },
      select: { phone: true, email: true },
    });
    const emailOwnerPhone = new Map(
      allEmails.map((c) => [c.email, c.phone]),
    );

    for (const row of parsed.rows) {
      const existing = existingByPhone.get(row.phone);
      if (existing) {
        willUpdate++;
      } else {
        willCreate++;
      }
      if (
        row.email &&
        emailOwnerPhone.has(row.email) &&
        emailOwnerPhone.get(row.email) !== row.phone
      ) {
        duplicateEmailsSkipped++;
      }
    }

    return {
      ready_to_import: parsed.rows.length,
      will_update: willUpdate,
      will_create: willCreate,
      duplicate_emails_skipped: duplicateEmailsSkipped,
      parse_errors: parsed.errors.length,
      error_samples: parsed.errors.slice(0, 10),
      duplicate_phones_in_file: parsed.duplicate_phones_in_file,
      duplicate_rows_in_file: parsed.duplicate_rows_in_file,
      duplicate_phone_examples: parsed.duplicate_phone_examples,
    };
  }

  async importFromBuffer(
    user: AuthUser,
    buffer: Buffer,
    filename: string,
    categories: string[] | null = null,
  ): Promise<ContactsImportResult> {
    const area = user.area;
    const segmentSet = await this.getSegmentSlugSet(area);
    const lower = String(filename ?? '').toLowerCase();
    const parsed = lower.endsWith('.xlsx')
      ? parseContactXlsxBuffer(buffer, segmentSet)
      : parseContactCsvBuffer(buffer, segmentSet);
    const fallbackCategory = this.defaultImportCategory(categories);
    for (const row of parsed.rows) {
      if (!row.category) row.category = fallbackCategory;
    }

    if (parsed.rows.length === 0 && parsed.errors.length === 0) {
      throw new BadRequestException('Archivo sin datos');
    }

    if (parsed.rows.length > MAX_CSV_ROWS) {
      throw new BadRequestException(
        `Demasiadas filas (${parsed.rows.length}). Máximo ${MAX_CSV_ROWS}`,
      );
    }

    let imported = 0;
    for (const row of parsed.rows) {
      await this.importSingleRow(user, area, row);
      imported += 1;
    }

    await this.auditLog.write({
      event_type: AuditEvent.CONTACT_IMPORT,
      message: `Importación de contactos: ${imported} filas guardadas`,
      actor: auditActor(user),
      meta: {
        rows_saved: imported,
        row_errors_in_file: parsed.errors.length,
        duplicate_phones_in_file: parsed.duplicate_phones_in_file,
        duplicate_rows_in_file: parsed.duplicate_rows_in_file,
        duplicate_phone_examples: parsed.duplicate_phone_examples,
        filename: String(filename ?? '').slice(0, 200),
      },
    });

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
    user: AuthUser,
    area: string,
    row: ImportContactRow,
  ): Promise<void> {
    const programId = await this.programIdFromCategory(area, row.category || 'general');
    const allDefs = await this.loadAttributeDefinitions(area, programId);
    const applicable = getApplicableAttributeDefinitions(allDefs, row.segments);
    const attrs = filterAttributesForDefinitions(
      normalizeAttributesInput(row.attributes),
      applicable,
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.contacts.findFirst({
        where: { area, phone: row.phone },
      });

      let safeEmail: string | null | undefined = row.email;
      if (safeEmail) {
        const emailOwner = await tx.contacts.findFirst({
          where: { area, email: safeEmail },
          select: { id: true },
        });
        if (emailOwner && emailOwner.id !== existing?.id) {
          safeEmail = undefined;
        }
      }

      const contact = existing
        ? await tx.contacts.update({
            where: { id: existing.id },
            data: {
              name: row.name,
              last_name: row.last_name,
              ...(safeEmail !== undefined ? { email: safeEmail } : {}),
              ...(row.dni !== undefined ? { dni: row.dni } : {}),
              segment: firstSegmentForLegacyColumn(row.segments),
              active: true,
              updated_at: new Date(),
            },
          })
        : await tx.contacts.create({
            data: {
              name: row.name,
              last_name: row.last_name,
              phone: row.phone,
              email: safeEmail ?? null,
              dni: row.dni ?? null,
              segment: firstSegmentForLegacyColumn(row.segments),
              area,
              opt_in: true,
              active: true,
            },
          });

      const change = await this.replaceContactSegments(
        tx,
        contact.id,
        area,
        row.segments,
        programId,
      );
      if (Object.keys(attrs).length > 0) {
        await this.upsertContactAttributes(tx, contact.id, attrs, programId);
      }
      if (row.dni) {
        await this.upsertContactAttributes(tx, contact.id, { dni: row.dni }, programId);
      }
      await this.ensureContactProgram(tx, contact.id, programId, 'import');
      await tx.conversations.updateMany({
        where: { area, phone: row.phone, OR: [{ contact_id: null }, { contact_id: contact.id }] },
        data: { contact_id: contact.id, updated_at: new Date() },
      });
      return { contactId: contact.id, change };
    });

    await this.auditSegmentChange(
      user,
      result.contactId,
      area,
      result.change,
      row.phone,
    );
  }

  async getSummary(
    area: AuthUser['area'],
    daysRaw?: string,
  ): Promise<ContactSummary> {
    const days = Number(daysRaw ?? 30) || 30;
    return fetchContactSummary(this.prisma, area, days);
  }

  async list(
    area: AuthUser['area'],
    params: ListContactsParams,
  ): Promise<ContactsListResult> {
    const page = Math.max(1, Number(params.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit ?? 50) || 50));
    const offset = (page - 1) * limit;

    const segments = await this.prisma.segment_definitions.findMany({
      where: { area },
      select: { slug: true },
    });
    const slugSet = new Set(segments.map((row) => row.slug));
    const where = await this.buildListWhereClause(area, params, slugSet);

    const rows = await this.prisma.$queryRaw<ContactRow[]>(Prisma.sql`
      SELECT
        c.id,
        c.name,
        c.last_name,
        c.phone,
        c.whatsapp_user_id,
        (SELECT conv.wa_username FROM conversations conv
         WHERE conv.area = c.area AND conv.contact_id = c.id AND conv.wa_username IS NOT NULL
         ORDER BY conv.updated_at DESC LIMIT 1) AS wa_username,
        c.email,
        c.dni,
        c.opt_in,
        c.opt_in_email,
        c.active,
        c.created_at,
        COALESCE((
          SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
          FROM contact_segments cs
          JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug AND sd.program_id IS NOT DISTINCT FROM cs.program_id
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
        whatsapp_user_id: row.whatsapp_user_id,
        wa_username: row.wa_username,
        email: row.email,
        dni: row.dni,
        opt_in: row.opt_in,
        opt_in_email: row.opt_in_email,
        active: row.active,
        created_at: row.created_at.toISOString(),
        segment_slugs: row.segment_slugs ?? [],
      })),
      total,
      page,
      limit,
      pages,
    };
  }

  private normalizeOptionalEmail(value: unknown): string | null {
    const email = String(value ?? '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, '')
      .trim()
      .replace(/^["']+|["']+$/g, '')
      .toLowerCase();
    if (!email) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Email inválido');
    }
    return email;
  }

  private normalizeOptionalDni(value: unknown): string | null {
    const dni = String(value ?? '')
      .trim()
      .replace(/\s+/g, '');
    if (!dni) return null;
    return dni.slice(0, 32);
  }
}
