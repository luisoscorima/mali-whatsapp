import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AREA_LABELS,
  canonicalBusinessAreas,
} from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';

const AREA_ORDER = ['ti', 'pam', 'patronato', 'educacion'];
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

  async listConflicts() {
    let consolidation: { contact_id: number; phone_norm: string; canonical_id: number }[] = [];
    try {
      consolidation = await this.prisma.$queryRaw<
        { contact_id: number; phone_norm: string; canonical_id: number }[]
      >`
        SELECT contact_id, phone_norm, canonical_id
        FROM education_consolidation_map
        WHERE decision = 'review'
        ORDER BY phone_norm
        LIMIT 200
      `;
    } catch {
      consolidation = [];
    }
    const identity = await this.prisma.person_identity_reviews.findMany({
      where: { resolved_at: null },
      orderBy: { created_at: 'desc' },
      take: 200,
      select: {
        id: true,
        person_id: true,
        reason: true,
        phone: true,
        dni: true,
        email: true,
        created_at: true,
      },
    });
    return { consolidation, identity };
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
