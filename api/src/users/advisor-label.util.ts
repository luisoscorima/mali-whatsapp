import { Prisma } from '@prisma/client';

/** Primer token de un nombre o apellido compuesto. */
export function firstNamePart(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .split(/\s+/)[0] || '';
}

/**
 * Label operativo de asesor: primer nombre + primer apellido.
 * Fallback: parte local del email (nunca el correo completo como título).
 */
export function formatAdvisorLabel(input: {
  first_name?: string | null;
  last_name?: string | null;
  email: string;
}): string {
  const fromNames = [firstNamePart(input.first_name), firstNamePart(input.last_name)]
    .filter(Boolean)
    .join(' ');
  if (fromNames) return fromNames;
  const local = String(input.email).split('@')[0]?.trim();
  if (local) return local;
  return String(input.email).trim();
}

/** Misma semántica que formatAdvisorLabel, para queries raw. */
export function advisorLabelSql(alias: string): Prisma.Sql {
  if (!/^[a-z_][a-z0-9_]*$/i.test(alias)) {
    throw new Error(`Invalid SQL alias for advisor label: ${alias}`);
  }
  const a = Prisma.raw(alias);
  return Prisma.sql`COALESCE(NULLIF(TRIM(CONCAT_WS(' ', NULLIF(SPLIT_PART(TRIM(${a}.first_name), ' ', 1), ''), NULLIF(SPLIT_PART(TRIM(${a}.last_name), ' ', 1), ''))), ''), NULLIF(SPLIT_PART(COALESCE(${a}.email, ''), '@', 1), ''))`;
}
