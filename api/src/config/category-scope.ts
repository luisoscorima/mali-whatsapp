import { Prisma } from '@prisma/client';
import { conversationCategoryPredicate } from './business-scope';

const SLUG = /^[a-z0-9_]+$/;

/** null = sin filtro (todas las categorías). */
export function parseCategorySlugs(
  raw: string | string[] | undefined | null,
): string[] | null {
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap((item) =>
    String(item).split(','),
  );
  const selected = [
    ...new Set(
      list
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item === 'general' || SLUG.test(item)),
    ),
  ];
  return selected.length ? selected : null;
}

type ProgramScope = {
  program_id?: null;
  program?: { slug: { in: string[] } };
  OR?: Array<{ program_id: null } | { program: { slug: { in: string[] } } }>;
};

/** program_id null es General. */
export function programScopeWhere(slugs: string[] | null): ProgramScope {
  if (!slugs?.length) return {};
  const or: NonNullable<ProgramScope['OR']> = [];
  if (slugs.includes('general')) or.push({ program_id: null });
  const programs = slugs.filter((slug) => slug !== 'general');
  if (programs.length) or.push({ program: { slug: { in: programs } } });
  if (or.length === 1) return or[0];
  return { OR: or };
}

export function categoryOfProgram(slug: string | null | undefined): string {
  return slug?.trim() || 'general';
}

export async function programIdForCategory(
  findProgram: (slug: string) => Promise<{ id: number } | null>,
  category: unknown,
): Promise<number | null> {
  const slug = String(category ?? '').trim().toLowerCase();
  if (!slug || slug === 'general' || !SLUG.test(slug)) return null;
  const row = await findProgram(slug);
  return row?.id ?? null;
}

/** El segmento pertenece a la línea ya unida como scope_line. */
export function segmentMatchesOuterLineSql(): Prisma.Sql {
  return Prisma.sql`(
    (
      scope_line.id IS NULL
      OR (
        scope_line.program_id IS NULL
        AND COALESCE(BTRIM(scope_line.program_key), '') = ''
      )
    ) AND sd.program_id IS NULL
    OR sd.program_id IS NOT DISTINCT FROM scope_line.program_id
    OR EXISTS (
      SELECT 1 FROM business_programs seg_p
      WHERE seg_p.id = sd.program_id
        AND seg_p.slug = NULLIF(BTRIM(scope_line.program_key), '')
    )
  )`;
}

export function segmentMatchesConversationSql(conversationId: number): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM conversations seg_c
    LEFT JOIN whatsapp_lines seg_l ON seg_l.id = seg_c.whatsapp_line_id
    WHERE seg_c.id = ${conversationId}
      AND (
        (
          (seg_l.id IS NULL OR (
            seg_l.program_id IS NULL
            AND COALESCE(BTRIM(seg_l.program_key), '') = ''
          ))
          AND sd.program_id IS NULL
        )
        OR sd.program_id IS NOT DISTINCT FROM seg_l.program_id
        OR EXISTS (
          SELECT 1 FROM business_programs seg_p
          WHERE seg_p.id = sd.program_id
            AND seg_p.slug = NULLIF(BTRIM(seg_l.program_key), '')
        )
      )
  )`;
}

export function segmentDefinitionCategorySql(slugs: string[] | null): Prisma.Sql {
  if (!slugs?.length) return Prisma.sql`TRUE`;
  const parts: Prisma.Sql[] = [];
  if (slugs.includes('general')) parts.push(Prisma.sql`sd.program_id IS NULL`);
  const programs = slugs.filter((slug) => slug !== 'general');
  if (programs.length) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM business_programs seg_p
      WHERE seg_p.id = sd.program_id AND seg_p.slug IN (${Prisma.join(programs)})
    )`);
  }
  if (!parts.length) return Prisma.sql`FALSE`;
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

/** Campaña o registro con whatsapp_line_id. Sin línea cuenta como General. */
export function recordLineCategorySql(
  alias: string,
  slugs: string[] | null,
): Prisma.Sql {
  if (!slugs?.length) return Prisma.sql`TRUE`;
  const column = Prisma.raw(`${alias}.whatsapp_line_id`);
  const missing = slugs.includes('general')
    ? Prisma.sql`${column} IS NULL`
    : Prisma.sql`FALSE`;
  return Prisma.sql`(
    ${conversationCategoryPredicate(alias, slugs)}
    OR ${missing}
  )`;
}

function sqlList(slugs: string[]): string {
  return slugs.map((slug) => `'${slug}'`).join(',');
}

/** Fragmento AND para consultas de bitácora de reportería. Vacío si no hay filtro. */
export function auditConversationCategorySql(slugs: string[] | null): string {
  if (!slugs?.length) return '';
  const programs = slugs.filter((slug) => slug !== 'general' && SLUG.test(slug));
  const parts: string[] = [];
  if (slugs.includes('general')) {
    parts.push(`EXISTS (
      SELECT 1 FROM whatsapp_lines wl
      WHERE wl.id = conv.whatsapp_line_id
        AND wl.program_id IS NULL
        AND COALESCE(BTRIM(wl.program_key), '') = ''
    )`);
  }
  if (programs.length) {
    const list = sqlList(programs);
    const aliases = sqlList(programs.map((slug) => `educacion_${slug}`));
    parts.push(`(
      conv.area IN (${aliases})
      OR EXISTS (
        SELECT 1 FROM whatsapp_lines wl
        LEFT JOIN business_programs p ON p.id = wl.program_id
        WHERE wl.id = conv.whatsapp_line_id
          AND (p.slug IN (${list}) OR wl.program_key IN (${list}))
      )
    )`);
  }
  if (!parts.length) return ' AND FALSE';
  return ` AND EXISTS (
    SELECT 1 FROM conversations conv
    WHERE conv.id = CASE
      WHEN (meta->>'conversation_id') ~ '^[0-9]+$' THEN (meta->>'conversation_id')::int
      ELSE NULL
    END
      AND (${parts.join(' OR ')})
  )`;
}

export function auditSegmentCategorySql(slugs: string[] | null): string {
  if (!slugs?.length) return '';
  const programs = slugs.filter((slug) => slug !== 'general' && SLUG.test(slug));
  const parts: string[] = [];
  if (slugs.includes('general')) parts.push('sd.program_id IS NULL');
  if (programs.length) parts.push(`p.slug IN (${sqlList(programs)})`);
  if (!parts.length) return ' AND FALSE';
  return ` AND EXISTS (
    SELECT 1 FROM segment_definitions sd
    LEFT JOIN business_programs p ON p.id = sd.program_id
    WHERE sd.area = $1
      AND position(sd.slug in COALESCE(message, '')) > 0
      AND (${parts.join(' OR ')})
  )`;
}
