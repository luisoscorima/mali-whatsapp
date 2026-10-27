import { businessReadScope } from '../config/areas';
import { segmentDefinitionCategorySql } from '../config/category-scope';
import { Prisma } from '@prisma/client';
import { readSessionWindowMs } from './campaign-conversation-window.util';

export type RecipientFilterOptions = {
  categories?: string[] | null;
  contactIds?: number[];
  excludeContactIds?: number[];
  excludeSegmentSlugs?: string[];
  excludeOpenServiceWindow?: boolean;
};

export type RecipientRow = {
  id: number;
  name: string;
  phone: string;
  actual_phone: string | null;
  email: string | null;
  dni: string | null;
  last_user_message_at: Date | null;
};

function buildRecipientQuery(
  area: string,
  segmentSlugs: string[],
  options: RecipientFilterOptions,
  mode: 'count' | 'list',
): Prisma.Sql {
  const scope = businessReadScope(area);
  const categories = scope.program
    ? [scope.program]
    : (options.categories ?? null);
  const categorySql = segmentDefinitionCategorySql(categories);
  const parts: Prisma.Sql[] = [];

  if (mode === 'count') {
    parts.push(Prisma.sql`SELECT COUNT(DISTINCT c.person_id)::int AS n`);
  } else {
    parts.push(
      Prisma.sql`SELECT DISTINCT ON (c.person_id) c.id, c.name, COALESCE(c.phone, c.whatsapp_user_id) AS phone, c.phone AS actual_phone, c.email, c.dni, conv.last_user_message_at`,
    );
  }

  parts.push(Prisma.sql`
    FROM contacts c
    INNER JOIN contact_segments cs ON cs.contact_id = c.id AND cs.area = c.area
    INNER JOIN segment_definitions sd ON sd.area = cs.area
      AND sd.slug = cs.segment_slug
      AND sd.program_id IS NOT DISTINCT FROM cs.program_id
    LEFT JOIN LATERAL (
      SELECT MAX(last_user_message_at) AS last_user_message_at
      FROM conversations
      WHERE area = c.area AND contact_id = c.id
    ) conv ON TRUE
    WHERE c.area = ${scope.canonicalArea}
      AND ${categorySql}
      AND c.opt_in = TRUE
      AND c.active = TRUE
      AND (c.phone IS NOT NULL OR c.whatsapp_user_id IS NOT NULL)
      AND cs.segment_slug = ANY(${segmentSlugs}::varchar[])
  `);

  if (options.contactIds?.length) {
    parts.push(Prisma.sql` AND c.id = ANY(${options.contactIds}::int[])`);
  }

  if (options.excludeContactIds?.length) {
    parts.push(
      Prisma.sql` AND NOT EXISTS (
        SELECT 1 FROM contacts excluded
        WHERE excluded.area = c.area AND excluded.person_id = c.person_id
          AND excluded.id = ANY(${options.excludeContactIds}::int[])
      )`,
    );
  }

  if (options.excludeSegmentSlugs?.length) {
    parts.push(Prisma.sql`
      AND NOT EXISTS (
        SELECT 1 FROM contact_segments cs_ex
        JOIN contacts excluded ON excluded.id = cs_ex.contact_id
        JOIN segment_definitions sd ON sd.area = cs_ex.area
          AND sd.slug = cs_ex.segment_slug
          AND sd.program_id IS NOT DISTINCT FROM cs_ex.program_id
        WHERE excluded.person_id = c.person_id
          AND excluded.area = c.area
          AND cs_ex.area = c.area
          AND ${categorySql}
          AND cs_ex.segment_slug = ANY(${options.excludeSegmentSlugs}::varchar[])
      )
    `);
  }

  if (options.excludeOpenServiceWindow) {
    const windowMs = readSessionWindowMs();
    parts.push(Prisma.sql`
      AND (
        conv.last_user_message_at IS NULL
        OR conv.last_user_message_at < NOW() - (${windowMs}::bigint * INTERVAL '1 millisecond')
      )
    `);
  }

  if (mode === 'list') {
    parts.push(Prisma.sql` ORDER BY c.person_id, c.id ASC`);
  }

  return Prisma.join(parts, '');
}

export async function countRecipientsUnion(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  area: string,
  segmentSlugs: string[],
  options: RecipientFilterOptions = {},
): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>(
    buildRecipientQuery(area, segmentSlugs, options, 'count'),
  );
  return rows[0]?.n ?? 0;
}

export async function fetchRecipientsUnion(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  area: string,
  segmentSlugs: string[],
  options: RecipientFilterOptions = {},
): Promise<RecipientRow[]> {
  return prisma.$queryRaw<RecipientRow[]>(
    buildRecipientQuery(area, segmentSlugs, options, 'list'),
  );
}

export function readRecipientsPreviewMax(): number {
  const n = Number(process.env.CAMPAIGN_RECIPIENTS_PREVIEW_MAX || 5000);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 5000;
}

export function readMaxExcludeContactIds(): number {
  const n = Number(process.env.CAMPAIGN_MAX_RECIPIENT_IDS || 5000);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 5000;
}

export function validateRecipientsMatchRequest(
  rows: { id: number }[],
  requestedUniqueSortedIds: number[],
): boolean {
  if (rows.length !== requestedUniqueSortedIds.length) {
    return false;
  }
  const found = new Set(rows.map((r) => r.id));
  for (const id of requestedUniqueSortedIds) {
    if (!found.has(id)) {
      return false;
    }
  }
  return true;
}
