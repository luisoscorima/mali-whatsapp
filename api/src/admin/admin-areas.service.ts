import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AREA_LABELS,
  canonicalBusinessAreas,
} from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';

const AREA_ORDER = ['ti', 'pam', 'patronato', 'educacion'];

const IDENTITY_REASONS: Record<string, string> = {
  identidades_distintas: 'El teléfono, el DNI o el correo apuntan a otra persona',
  whatsapp_user_id: 'La identidad de WhatsApp no es de esta persona',
  dni: 'El DNI no es de esta persona',
};

function identityReason(reason: string): string {
  return IDENTITY_REASONS[reason] || 'Llegó un dato que no coincide con la persona';
}

function fichaArea(area: string): string {
  if (area === 'educacion_ca') return 'CA';
  if (area === 'educacion_ep') return 'EP';
  if (area === 'educacion') return 'General';
  return area;
}

type ConsolidationRow = {
  contact_id: number;
  canonical_id: number;
  phone_norm: string;
  name: string;
  last_name: string;
  email: string | null;
  dni: string | null;
  area: string;
  whatsapp_user_id: string | null;
  status_label: string | null;
  advisor: string | null;
  wuid_outside: boolean;
};

function filled(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function groupPhones(rows: ConsolidationRow[]) {
  const groups = new Map<string, ConsolidationRow[]>();
  for (const row of rows) {
    const list = groups.get(row.phone_norm) ?? [];
    list.push(row);
    groups.set(row.phone_norm, list);
  }
  return [...groups.entries()].map(([phone, members]) => {
    const dnis = filled(members.map((member) => {
      const digits = String(member.dni || '').replace(/\D/g, '');
      return digits.length >= 8 ? digits : '';
    }));
    const why = [
      filled(members.map((member) => member.whatsapp_user_id)).length > 1
        ? 'Identidades de WhatsApp distintas'
        : '',
      dnis.length > 1 ? 'DNI distintos' : '',
      filled(members.map((member) => member.status_label)).length > 1
        ? 'Estados de lead distintos'
        : '',
      filled(members.map((member) => member.advisor)).length > 1 ? 'Asesores distintos' : '',
      members.some((member) => member.wuid_outside)
        ? 'Una identidad de WhatsApp también está en otro teléfono'
        : '',
    ].filter(Boolean);
    return {
      phone,
      why: why.length ? why : ['Quedó pendiente al unir las fichas de Educación'],
      fichas: members.map((member) => ({
        id: member.contact_id,
        kept: member.contact_id === member.canonical_id,
        name: [member.name, member.last_name].filter(Boolean).join(' ') || 'Sin nombre',
        area: fichaArea(member.area),
        email: member.email,
        dni: member.dni,
        whatsapp_user_id: member.whatsapp_user_id,
        status: member.status_label,
        advisor: member.advisor,
      })),
    };
  });
}
const EDUCATION_AREAS = ['educacion', 'educacion_ca', 'educacion_ep'];

export type AdminCategorySummary = {
  slug: string;
  label: string;
  segments: number;
  campaigns: number;
  flows: number;
  attributes: number;
  leads: number;
};

export type AdminAreaSummary = {
  slug: string;
  label: string;
  users: number;
  contacts: number;
  campaigns: number;
  segments: number;
  categories?: AdminCategorySummary[];
  review_contacts?: number;
  consolidation_reviews?: number;
  identity_reviews?: number;
};

function canonicalOf(area: string): string {
  if (area === 'educacion_ca' || area === 'educacion_ep') return 'educacion';
  return area;
}

function categoryOf(area: string, programSlug: string | null | undefined): string {
  if (area === 'educacion_ca') return 'ca';
  if (area === 'educacion_ep') return 'ep';
  return programSlug?.trim() || 'general';
}

@Injectable()
export class AdminAreasService {
  constructor(private readonly prisma: PrismaService) {}

  async listSummaries(): Promise<AdminAreaSummary[]> {
    const [users, contacts, campaigns, segments, education] = await Promise.all([
      this.prisma.users.groupBy({ by: ['area'], _count: { _all: true } }),
      this.prisma.contacts.groupBy({ by: ['area'], _count: { _all: true } }),
      this.prisma.campaigns.groupBy({ by: ['area'], _count: { _all: true } }),
      this.prisma.segment_definitions.groupBy({ by: ['area'], _count: { _all: true } }),
      this.educationBreakdown(),
    ]);

    const fold = (rows: { area: string; _count: { _all: number } }[]) => {
      const map = new Map<string, number>();
      for (const row of rows) {
        const key = canonicalOf(row.area);
        map.set(key, (map.get(key) ?? 0) + row._count._all);
      }
      return map;
    };
    const usersMap = fold(users);
    const contactsMap = fold(contacts);
    const campaignsMap = fold(campaigns);
    const segmentsMap = fold(segments);

    return canonicalBusinessAreas()
      .sort((left, right) => AREA_ORDER.indexOf(left) - AREA_ORDER.indexOf(right))
      .map((slug) => ({
        slug,
        label: AREA_LABELS[slug] || slug,
        users: usersMap.get(slug) ?? 0,
        contacts: contactsMap.get(slug) ?? 0,
        campaigns: campaignsMap.get(slug) ?? 0,
        segments: segmentsMap.get(slug) ?? 0,
        ...(slug === 'educacion' ? education : {}),
      }));
  }

  private async educationBreakdown(): Promise<
    Pick<AdminAreaSummary, 'categories' | 'review_contacts' | 'consolidation_reviews' | 'identity_reviews'>
  > {
    const [programs, segmentRows, flowRows, attributeRows, leadRows, campaignRows, reviewContacts, identityReviews, consolidationReviews] =
      await Promise.all([
        this.prisma.business_programs.findMany({
          where: { business_area: { slug: 'educacion' } },
          select: { id: true, slug: true },
        }),
        this.prisma.segment_definitions.findMany({
          where: { area: { in: EDUCATION_AREAS } },
          select: { area: true, program: { select: { slug: true } } },
        }),
        this.prisma.flows.findMany({
          where: { area: { in: EDUCATION_AREAS } },
          select: { area: true, program: { select: { slug: true } } },
        }),
        this.prisma.contact_attribute_definitions.findMany({
          where: { area: { in: EDUCATION_AREAS } },
          select: { area: true, program: { select: { slug: true } } },
        }),
        this.prisma.contact_origins.groupBy({
          by: ['area', 'program_id'],
          where: { area: { in: EDUCATION_AREAS } },
          _count: { _all: true },
        }),
        this.prisma.$queryRaw<{ slug: string; n: number }[]>`
          SELECT
            CASE
              WHEN c.area = 'educacion_ca' THEN 'ca'
              WHEN c.area = 'educacion_ep' THEN 'ep'
              WHEN l.program_id IS NULL AND COALESCE(BTRIM(l.program_key), '') = '' THEN 'general'
              ELSE COALESCE(p.slug, NULLIF(BTRIM(l.program_key), ''), 'general')
            END AS slug,
            COUNT(*)::int AS n
          FROM campaigns c
          LEFT JOIN whatsapp_lines l ON l.id = c.whatsapp_line_id
          LEFT JOIN business_programs p ON p.id = l.program_id
          WHERE c.area IN ('educacion', 'educacion_ca', 'educacion_ep')
          GROUP BY 1
        `,
        this.prisma.contacts.count({
          where: { area: { in: ['educacion_ca', 'educacion_ep'] } },
        }),
        this.prisma.person_identity_reviews.count({
          where: { business_area: { slug: 'educacion' } },
        }),
        this.prisma.$queryRaw<{ n: number }[]>`
          SELECT CASE
            WHEN to_regclass('public.education_consolidation_map') IS NULL THEN 0
            ELSE (
              SELECT COUNT(*) FROM education_consolidation_map WHERE decision = 'review'
            )
          END::int AS n
        `,
      ]);

    const programSlug = new Map(programs.map((row) => [row.id, row.slug]));
    const bump = (map: Map<string, number>, slug: string, amount = 1) => {
      map.set(slug, (map.get(slug) ?? 0) + amount);
    };
    const segments = new Map<string, number>();
    const flows = new Map<string, number>();
    const attributes = new Map<string, number>();
    const leads = new Map<string, number>();
    const campaignCounts = new Map(campaignRows.map((row) => [row.slug, row.n]));
    for (const row of segmentRows) bump(segments, categoryOf(row.area, row.program?.slug));
    for (const row of flowRows) bump(flows, categoryOf(row.area, row.program?.slug));
    for (const row of attributeRows) bump(attributes, categoryOf(row.area, row.program?.slug));
    for (const row of leadRows) {
      bump(
        leads,
        categoryOf(row.area, row.program_id ? programSlug.get(row.program_id) : null),
        row._count._all,
      );
    }

    const slugs = ['general', ...programs.map((row) => row.slug)];
    return {
      categories: slugs.map((slug) => ({
        slug,
        label: slug === 'general' ? 'General' : slug.toUpperCase(),
        segments: segments.get(slug) ?? 0,
        campaigns: campaignCounts.get(slug) ?? 0,
        flows: flows.get(slug) ?? 0,
        attributes: attributes.get(slug) ?? 0,
        leads: leads.get(slug) ?? 0,
      })),
      review_contacts: reviewContacts,
      consolidation_reviews: consolidationReviews[0]?.n ?? 0,
      identity_reviews: identityReviews,
    };
  }

  async listCategories(areaSlug: string) {
    const area = await this.requireArea(areaSlug);
    const programs = await this.prisma.business_programs.findMany({
      where: { business_area_id: area.id },
      orderBy: [{ sort_order: 'asc' }, { slug: 'asc' }],
      select: { id: true, slug: true, label: true, active: true },
    });
    const lines = await this.prisma.whatsapp_lines.groupBy({
      by: ['program_id'],
      where: { business_area_id: area.id, active: true },
      _count: { _all: true },
    });
    const lineCount = new Map(lines.map((row) => [row.program_id, row._count._all]));
    return [
      { id: null, slug: 'general', label: 'General', active: true, lines: lineCount.get(null) ?? 0 },
      ...programs.map((program) => ({
        id: program.id,
        slug: program.slug,
        label: program.label,
        active: program.active,
        lines: lineCount.get(program.id) ?? 0,
      })),
    ];
  }

  async createCategory(areaSlug: string, input: { slug: string; label: string }) {
    const area = await this.requireArea(areaSlug);
    const slug = input.slug.trim().toLowerCase();
    const label = input.label.trim();
    if (slug === 'general' || !/^[a-z][a-z0-9_]{0,9}$/.test(slug)) {
      throw new BadRequestException('Usa un identificador corto, sin la palabra general');
    }
    if (label.length < 2) throw new BadRequestException('Falta el nombre');
    try {
      return await this.prisma.business_programs.create({
        data: { business_area_id: area.id, slug, label },
        select: { id: true, slug: true, label: true, active: true },
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P2002') {
        throw new BadRequestException('Esa categoría ya existe');
      }
      throw error;
    }
  }

  async updateCategory(areaSlug: string, slug: string, input: { label?: string; active?: boolean }) {
    if (slug === 'general') throw new BadRequestException('General no se desactiva');
    const area = await this.requireArea(areaSlug);
    const program = await this.prisma.business_programs.findFirst({
      where: { business_area_id: area.id, slug },
    });
    if (!program) throw new NotFoundException('Categoría no encontrada');
    if (input.active === false) {
      const lines = await this.prisma.whatsapp_lines.count({
        where: { program_id: program.id, active: true },
      });
      if (lines > 0) {
        throw new BadRequestException('Pasa sus líneas a otra categoría antes de darla de baja');
      }
    }
    return this.prisma.business_programs.update({
      where: { id: program.id },
      data: {
        ...(input.label?.trim() ? { label: input.label.trim() } : {}),
        ...(input.active === undefined ? {} : { active: input.active }),
        updated_at: new Date(),
      },
      select: { id: true, slug: true, label: true, active: true },
    });
  }

  async listConflicts(requestedPage = 1) {
    const identityRows = await this.prisma.person_identity_reviews.findMany({
      where: { resolved_at: null },
      orderBy: { created_at: 'desc' },
      take: 100,
      include: {
        person: { select: { name: true, last_name: true, phone: true, email: true, dni: true } },
      },
    });
    const identity = identityRows.map((row) => ({
      id: row.id,
      person_id: row.person_id,
      person_name: [row.person.name, row.person.last_name].filter(Boolean).join(' ') || 'Sin nombre',
      reason: identityReason(row.reason),
      stored_phone: row.person.phone,
      stored_dni: row.person.dni,
      stored_email: row.person.email,
      phone: row.phone,
      dni: row.dni,
      email: row.email,
    }));
    try {
      const counts = await this.prisma.$queryRaw<{ pending: number; done: number }[]>`
        SELECT
          COUNT(DISTINCT phone_norm) FILTER (WHERE decision = 'review')::int AS pending,
          COUNT(DISTINCT phone_norm) FILTER (WHERE decision = 'separate')::int AS done
        FROM education_consolidation_map
      `;
      const pending = counts[0]?.pending ?? 0;
      const done = counts[0]?.done ?? 0;
      const pageSize = 40;
      const pages = Math.max(1, Math.ceil(pending / pageSize));
      const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), pages);
      const offset = (page - 1) * pageSize;
      const rows = await this.prisma.$queryRaw<ConsolidationRow[]>`
        SELECT
          m.contact_id::int AS contact_id,
          m.canonical_id::int AS canonical_id,
          m.phone_norm,
          c.name,
          c.last_name,
          c.email,
          c.dni,
          c.area,
          c.whatsapp_user_id,
          ls.label AS status_label,
          NULLIF(BTRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS advisor,
          EXISTS (
            SELECT 1 FROM contacts other
            WHERE other.whatsapp_user_id = c.whatsapp_user_id
              AND other.id <> c.id
              AND NULLIF(REGEXP_REPLACE(COALESCE(other.phone, ''), '\\D', '', 'g'), '')
                IS DISTINCT FROM m.phone_norm
          ) AS wuid_outside
        FROM education_consolidation_map m
        JOIN contacts c ON c.id = m.contact_id
        LEFT JOIN lead_status_definitions ls ON ls.id = c.lead_status_id
        LEFT JOIN LATERAL (
          SELECT assigned_user_id
          FROM education_lead_cycles ec
          WHERE ec.contact_id = c.id
          ORDER BY ec.last_interaction_at DESC
          LIMIT 1
        ) cycle ON TRUE
        LEFT JOIN users u ON u.id = cycle.assigned_user_id
        WHERE m.decision = 'review'
          AND m.phone_norm IN (
            SELECT phone_norm
            FROM education_consolidation_map
            WHERE decision = 'review'
            GROUP BY phone_norm
            ORDER BY phone_norm
            LIMIT ${pageSize}
            OFFSET ${offset}
          )
        ORDER BY m.phone_norm, (m.contact_id = m.canonical_id) DESC, m.contact_id
      `;
      return {
        page,
        page_size: pageSize,
        phone_pending: pending,
        phone_done: done,
        phones: groupPhones(rows),
        identity,
      };
    } catch {
      return { page: 1, page_size: 40, phone_pending: 0, phone_done: 0, phones: [], identity };
    }
  }

  async separateConsolidationPhone(phone: string) {
    const normalized = phone.replace(/\D/g, '');
    if (!normalized) throw new BadRequestException('Falta el teléfono');
    const updated = await this.prisma.$executeRaw`
      UPDATE education_consolidation_map
      SET decision = 'separate'
      WHERE phone_norm = ${normalized} AND decision = 'review'
    `;
    if (!updated) throw new BadRequestException('Ese teléfono ya no está en revisión');
    return { phone: normalized, decision: 'separate' };
  }

  async separateConsolidation(contactId: number) {
    const updated = await this.prisma.$executeRaw`
      UPDATE education_consolidation_map
      SET decision = 'separate'
      WHERE contact_id = ${contactId} AND decision = 'review'
    `;
    if (!updated) throw new BadRequestException('Ese caso ya no está en revisión');
    return { contact_id: contactId, decision: 'separate' };
  }

  async resolveIdentityReview(id: number) {
    const row = await this.prisma.person_identity_reviews.findUnique({ where: { id } });
    if (!row || row.resolved_at) throw new NotFoundException('Ese conflicto ya no está pendiente');
    await this.prisma.person_identity_reviews.update({
      where: { id },
      data: { resolved_at: new Date() },
    });
    return { id, resolved: true };
  }

  private async requireArea(slug: string) {
    const area = await this.prisma.business_areas.findFirst({
      where: { slug, active: true },
      select: { id: true, slug: true },
    });
    if (!area) throw new NotFoundException('Área no encontrada');
    return area;
  }
}
