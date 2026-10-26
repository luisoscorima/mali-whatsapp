import { Injectable } from '@nestjs/common';
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
}
