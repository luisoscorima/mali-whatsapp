import { Prisma } from '@prisma/client';
import { businessReadScope } from './areas';
import { restrictedAccess } from '../business-model/business-access.context';
function col(alias: string, name: string): Prisma.Sql {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) throw new Error('Invalid SQL alias');
  return Prisma.raw(`${alias}.${name}`);
}
function values(ids: number[]): Prisma.Sql { return Prisma.join(ids.length ? ids : [-1]); }
export function conversationAccessPredicate(alias: string): Prisma.Sql {
  const access = restrictedAccess();
  return access ? Prisma.sql`${col(alias,'whatsapp_line_id')} IN (${values(access.lineIds)})` : Prisma.sql`TRUE`;
}
export function contactAccessPredicate(alias: string): Prisma.Sql {
  const access = restrictedAccess();
  if (!access) return Prisma.sql`TRUE`;
  return Prisma.sql`(
    EXISTS (SELECT 1 FROM contact_programs access_cp WHERE access_cp.contact_id=${col(alias,'id')} AND access_cp.program_id IN (${values(access.programIds)}))
    OR EXISTS (SELECT 1 FROM conversations access_c WHERE access_c.contact_id=${col(alias,'id')} AND access_c.whatsapp_line_id IN (${values(access.lineIds)}))
  )`;
}
export function contactAccessWhere(): Prisma.contactsWhereInput {
  const access = restrictedAccess();
  return access ? { business_area_id: access.businessAreaId, OR: [
    { contact_programs: { some: { program_id: { in: access.programIds } } } },
    { conversations: { some: { whatsapp_line_id: { in: access.lineIds } } } },
  ] } : {};
}
export function conversationCategoryPredicate(alias: string, slugs: string[]): Prisma.Sql {
  const selected = [...new Set(slugs.map((slug) => slug.trim().toLowerCase()).filter((slug) => /^[a-z0-9_]+$/.test(slug)))];
  if (!selected.length) return Prisma.sql`FALSE`;
  const parts: Prisma.Sql[] = [];
  if (selected.includes('general')) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM whatsapp_lines cat_l
      WHERE cat_l.id = ${col(alias, 'whatsapp_line_id')}
        AND cat_l.program_id IS NULL
        AND (cat_l.program_key IS NULL OR BTRIM(cat_l.program_key) = '')
    )`);
  }
  const programs = selected.filter((slug) => slug !== 'general');
  if (programs.length) {
    const aliases = programs.map((slug) => `educacion_${slug}`);
    parts.push(Prisma.sql`(
      ${col(alias, 'area')} IN (${Prisma.join(aliases)})
      OR EXISTS (
        SELECT 1 FROM whatsapp_lines cat_l
        LEFT JOIN business_programs cat_p ON cat_p.id = cat_l.program_id
        WHERE cat_l.id = ${col(alias, 'whatsapp_line_id')}
          AND (cat_p.slug IN (${Prisma.join(programs)}) OR cat_l.program_key IN (${Prisma.join(programs)}))
      )
    )`);
  }
  return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
}

export function inboxConversationPredicate(alias: string, area: string, categories: string[] | null): Prisma.Sql {
  if (!categories) return conversationAreaPredicate(alias, area);
  const scope = businessReadScope(area);
  return Prisma.sql`(
    ${col(alias, 'area')} IN (${Prisma.join(scope.areas)})
    AND ${conversationCategoryPredicate(alias, categories)}
    AND ${conversationAccessPredicate(alias)}
  )`;
}

export function conversationAreaPredicate(alias: string, area: string): Prisma.Sql {
  const scope = businessReadScope(area);
  const family = Prisma.sql`${col(alias,'area')} IN (${Prisma.join(scope.areas)})`;
  const program = scope.program ? Prisma.sql`(
    ${col(alias,'area')} = ${area}
    OR EXISTS (
      SELECT 1 FROM whatsapp_lines scope_l
      LEFT JOIN business_programs scope_p ON scope_p.id = scope_l.program_id
      WHERE scope_l.id = ${col(alias,'whatsapp_line_id')}
        AND (scope_p.slug = ${scope.program} OR scope_l.program_key = ${scope.program})
    )
  )` : Prisma.sql`TRUE`;
  return Prisma.sql`(${family} AND ${program} AND ${conversationAccessPredicate(alias)})`;
}
export function contactAreaPredicate(alias: string, area: string): Prisma.Sql {
  const scope = businessReadScope(area);
  const program = scope.program ? Prisma.sql`(${col(alias,'area')}=${area} OR EXISTS (
    SELECT 1 FROM contact_programs scope_cp JOIN business_programs scope_p ON scope_p.id=scope_cp.program_id
    WHERE scope_cp.contact_id=${col(alias,'id')} AND scope_p.slug=${scope.program}
  ))` : Prisma.sql`TRUE`;
  return Prisma.sql`(${col(alias,'area')} IN (${Prisma.join(scope.areas)}) AND ${program} AND ${contactAccessPredicate(alias)})`;
}
export function visibleConversationWhere(area: string, id: number): Prisma.conversationsWhereInput {
  const scope = businessReadScope(area);
  const access = restrictedAccess();
  return { id, area: { in: scope.areas },
    ...(access ? { whatsapp_line_id: { in: access.lineIds } } : {}),
    ...(scope.canonicalArea !== 'educacion' && scope.program ? { OR: [
      { area },
      { whatsapp_line: { program: { slug: scope.program } } },
      { whatsapp_line: { program_key: scope.program } },
    ] } : {}),
  };
}
