import { Prisma } from '@prisma/client';
import { readSessionWindowMs } from './campaign-conversation-window.util';

export type RecipientFilterOptions = {
  contactIds?: number[];
  excludeContactIds?: number[];
  excludeSegmentSlugs?: string[];
  excludeOpenServiceWindow?: boolean;
};

export type RecipientRow = {
  id: number;
  name: string;
  phone: string;
  last_user_message_at: Date | null;
};

function buildRecipientQuery(
  area: string,
  segmentSlugs: string[],
  options: RecipientFilterOptions,
  mode: 'count' | 'list',
): Prisma.Sql {
  const parts: Prisma.Sql[] = [];

  if (mode === 'count') {
    parts.push(Prisma.sql`SELECT COUNT(DISTINCT c.id)::int AS n`);
  } else {
    parts.push(
      Prisma.sql`SELECT DISTINCT c.id, c.name, c.phone, conv.last_user_message_at`,
    );
  }

  parts.push(Prisma.sql`
    FROM contacts c
    INNER JOIN contact_segments cs ON cs.contact_id = c.id AND cs.area = c.area
    LEFT JOIN conversations conv ON conv.area = c.area AND conv.contact_id = c.id
    WHERE c.area = ${area}
      AND c.opt_in = TRUE
      AND c.active = TRUE
      AND c.replacement_reason IS NULL
      AND c.replaced_by_contact_id IS NULL
      AND cs.segment_slug = ANY(${segmentSlugs}::varchar[])
  `);

  if (options.contactIds?.length) {
    parts.push(Prisma.sql` AND c.id = ANY(${options.contactIds}::int[])`);
  }

  if (options.excludeContactIds?.length) {
    parts.push(
      Prisma.sql` AND NOT (c.id = ANY(${options.excludeContactIds}::int[]))`,
    );
  }

  if (options.excludeSegmentSlugs?.length) {
    parts.push(Prisma.sql`
      AND NOT EXISTS (
        SELECT 1 FROM contact_segments cs_ex
        WHERE cs_ex.contact_id = c.id
          AND cs_ex.area = c.area
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
    parts.push(Prisma.sql` ORDER BY c.id ASC`);
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
