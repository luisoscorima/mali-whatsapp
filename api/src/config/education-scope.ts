import { Prisma } from '@prisma/client';

export const EDUCATION_AREA_SLUGS = [
  'educacion',
  'educacion_ca',
  'educacion_ep',
] as const;

export type EducationProgram = 'ca' | 'ep';

export function isEducationAreaSlug(area: unknown): boolean {
  const value = String(area ?? '')
    .trim()
    .toLowerCase();
  return (EDUCATION_AREA_SLUGS as readonly string[]).includes(value);
}

export function educationProgramOf(area: unknown): EducationProgram | null {
  const value = String(area ?? '')
    .trim()
    .toLowerCase();
  if (value === 'educacion_ca' || value === 'ca') return 'ca';
  if (value === 'educacion_ep' || value === 'ep') return 'ep';
  return null;
}

/** Lectura de Educación: las tres áreas históricas, y el programa si el alias lo trae. */
export function educationReadScope(area: unknown): {
  areas: string[];
  program: EducationProgram | null;
} {
  const selected = String(area ?? 'all')
    .trim()
    .toLowerCase();
  if (
    selected !== 'all' &&
    selected !== 'educacion' &&
    !isEducationAreaSlug(selected) &&
    selected !== 'ca' &&
    selected !== 'ep'
  ) {
    return { areas: [selected], program: null };
  }
  return {
    areas: [...EDUCATION_AREA_SLUGS],
    program: educationProgramOf(selected),
  };
}

function column(alias: string, name: string): Prisma.Sql {
  return Prisma.raw(`${alias}.${name}`);
}

export function conversationAreaPredicate(
  alias: string,
  area: string,
): Prisma.Sql {
  const areaColumn = column(alias, 'area');
  if (!isEducationAreaSlug(area)) {
    return Prisma.sql`${areaColumn} = ${area}`;
  }
  const family = Prisma.sql`${areaColumn} IN ('educacion', 'educacion_ca', 'educacion_ep')`;
  const program = educationProgramOf(area);
  if (!program) return family;
  const legacy = program === 'ca' ? 'educacion_ca' : 'educacion_ep';
  return Prisma.sql`(
    ${family}
    AND (
      ${areaColumn} = ${legacy}
      OR EXISTS (
        SELECT 1
        FROM whatsapp_lines scope_line
        LEFT JOIN business_programs scope_program
          ON scope_program.id = scope_line.program_id
        WHERE scope_line.id = ${column(alias, 'whatsapp_line_id')}
          AND (
            scope_line.program_key = ${program}
            OR scope_program.slug = ${program}
          )
      )
      OR EXISTS (
        SELECT 1
        FROM contact_programs scope_membership
        JOIN business_programs scope_program
          ON scope_program.id = scope_membership.program_id
        WHERE scope_membership.contact_id = ${column(alias, 'contact_id')}
          AND scope_program.slug = ${program}
      )
    )
  )`;
}

export function contactAreaPredicate(alias: string, area: string): Prisma.Sql {
  const areaColumn = column(alias, 'area');
  if (!isEducationAreaSlug(area)) {
    return Prisma.sql`${areaColumn} = ${area}`;
  }
  const family = Prisma.sql`${areaColumn} IN ('educacion', 'educacion_ca', 'educacion_ep')`;
  const program = educationProgramOf(area);
  if (!program) return family;
  const legacy = program === 'ca' ? 'educacion_ca' : 'educacion_ep';
  return Prisma.sql`(
    ${family}
    AND (
      ${areaColumn} = ${legacy}
      OR EXISTS (
        SELECT 1
        FROM contact_programs scope_membership
        JOIN business_programs scope_program
          ON scope_program.id = scope_membership.program_id
        WHERE scope_membership.contact_id = ${column(alias, 'id')}
          AND scope_program.slug = ${program}
      )
    )
  )`;
}

export function visibleConversationWhere(
  area: string,
  id: number,
): Prisma.conversationsWhereInput {
  if (!isEducationAreaSlug(area)) return { id, area };
  const program = educationProgramOf(area);
  const family = {
    id,
    area: { in: [...EDUCATION_AREA_SLUGS] },
  };
  if (!program) return family;
  const legacy = program === 'ca' ? 'educacion_ca' : 'educacion_ep';
  return {
    ...family,
    OR: [
      { area: legacy },
      { whatsapp_line: { program_key: program } },
      { whatsapp_line: { program: { slug: program } } },
      {
        contacts: {
          contact_programs: { some: { program: { slug: program } } },
        },
      },
    ],
  };
}
