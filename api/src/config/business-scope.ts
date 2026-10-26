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
export function conversationAreaPredicate(alias: string, area: string): Prisma.Sql {
  const scope = businessReadScope(area);
  const family = Prisma.sql`${col(alias,'area')} IN (${Prisma.join(scope.areas)})`;
  const program = scope.program ? Prisma.sql`(
    ${col(alias,'area')} = ${area}
    OR EXISTS (SELECT 1 FROM whatsapp_lines scope_l JOIN business_programs scope_p ON scope_p.id=scope_l.program_id WHERE scope_l.id=${col(alias,'whatsapp_line_id')} AND scope_p.slug=${scope.program})
    OR EXISTS (SELECT 1 FROM contact_programs scope_cp JOIN business_programs scope_p ON scope_p.id=scope_cp.program_id WHERE scope_cp.contact_id=${col(alias,'contact_id')} AND scope_p.slug=${scope.program})
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
    ...(scope.program ? { OR: [
      { area }, { whatsapp_line: { program: { slug: scope.program } } },
      { contacts: { contact_programs: { some: { program: { slug: scope.program } } } } },
    ] } : {}),
  };
}
