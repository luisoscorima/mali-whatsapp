import { Prisma } from '@prisma/client';
import type { MetricCard } from '../campaigns/campaign-analytics.util';

export type AttributeSummary = {
  kpis: MetricCard[];
};

function fmt(n: number): string {
  return new Intl.NumberFormat('es-PE').format(n);
}

export async function fetchAttributeSummary(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  area: string,
): Promise<AttributeSummary> {
  const counts = await prisma.$queryRaw<
    {
      defs_active: number;
      defs_required: number;
      contacts_with_attr: number;
    }[]
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM contact_attribute_definitions d
       WHERE d.area = ${area} AND d.active = true) AS defs_active,
      (SELECT COUNT(*)::int FROM contact_attribute_definitions d
       WHERE d.area = ${area} AND d.active = true AND d.required = true) AS defs_required,
      (SELECT COUNT(DISTINCT ca.contact_id)::int
       FROM contact_attributes ca
       JOIN contacts c ON c.id = ca.contact_id
       WHERE c.area = ${area}
         AND c.active = true
         AND c.replacement_reason IS NULL
         AND c.replaced_by_contact_id IS NULL
         AND TRIM(COALESCE(ca.attr_value, '')) <> '') AS contacts_with_attr
  `);

  const c = counts[0] ?? {
    defs_active: 0,
    defs_required: 0,
    contacts_with_attr: 0,
  };

  const kpis: MetricCard[] = [
    {
      label: 'Activos',
      display: fmt(c.defs_active),
      tone: 'ink',
      tooltip: 'Atributos activos · click para filtrar',
    },
    {
      label: 'Obligatorios',
      display: fmt(c.defs_required),
      tone: 'sent',
      tooltip: 'Click para filtrar',
    },
    {
      label: 'Con ≥1 atributo',
      display: fmt(c.contacts_with_attr),
      tone: 'ink',
      tooltip: 'Contactos activos con al menos un valor',
    },
  ];

  return { kpis };
}
