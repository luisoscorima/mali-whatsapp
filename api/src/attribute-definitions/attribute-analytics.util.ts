import { Prisma } from '@prisma/client';
import type { MetricCard } from '../campaigns/campaign-analytics.util';

export type AttributeSummary = {
  kpis: MetricCard[];
};

function fmt(n: number): string {
  return new Intl.NumberFormat('es-PE').format(n);
}

function pct(num: number, den: number): string {
  if (den <= 0) return '—';
  return `${Math.round((num / den) * 100)}%`;
}

export async function fetchAttributeSummary(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  area: string,
): Promise<AttributeSummary> {
  const [counts] = await Promise.all([
    prisma.$queryRaw<
      {
        defs_active: number;
        defs_required: number;
        contacts_total: number;
        contacts_with_attr: number;
        required_slots: number;
        required_filled: number;
      }[]
    >(Prisma.sql`
      SELECT
        (SELECT COUNT(*)::int FROM contact_attribute_definitions d
         WHERE d.area = ${area} AND d.active = true) AS defs_active,
        (SELECT COUNT(*)::int FROM contact_attribute_definitions d
         WHERE d.area = ${area} AND d.active = true AND d.required = true) AS defs_required,
        (SELECT COUNT(*)::int FROM contacts c
         WHERE c.area = ${area}
           AND c.active = true
           AND c.replacement_reason IS NULL
           AND c.replaced_by_contact_id IS NULL) AS contacts_total,
        (SELECT COUNT(DISTINCT ca.contact_id)::int
         FROM contact_attributes ca
         JOIN contacts c ON c.id = ca.contact_id
         WHERE c.area = ${area}
           AND c.active = true
           AND c.replacement_reason IS NULL
           AND c.replaced_by_contact_id IS NULL
           AND TRIM(COALESCE(ca.attr_value, '')) <> '') AS contacts_with_attr,
        (SELECT
           (SELECT COUNT(*)::int FROM contact_attribute_definitions d
            WHERE d.area = ${area}
              AND d.active = true
              AND d.required = true
              AND d.segment_slug IS NULL)
           *
           (SELECT COUNT(*)::int FROM contacts c
            WHERE c.area = ${area}
              AND c.active = true
              AND c.replacement_reason IS NULL
              AND c.replaced_by_contact_id IS NULL)
        ) AS required_slots,
        (SELECT COUNT(*)::int
         FROM contact_attributes ca
         JOIN contacts c ON c.id = ca.contact_id
         JOIN contact_attribute_definitions d
           ON d.area = ${area}
          AND d.slug = ca.attr_key
          AND d.active = true
          AND d.required = true
          AND d.segment_slug IS NULL
         WHERE c.area = ${area}
           AND c.active = true
           AND c.replacement_reason IS NULL
           AND c.replaced_by_contact_id IS NULL
           AND TRIM(COALESCE(ca.attr_value, '')) <> '') AS required_filled
    `),
  ]);

  const c = counts[0] ?? {
    defs_active: 0,
    defs_required: 0,
    contacts_total: 0,
    contacts_with_attr: 0,
    required_slots: 0,
    required_filled: 0,
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
      label: 'Cobertura required',
      display: pct(c.required_filled, c.required_slots),
      tone: c.required_slots > 0 && c.required_filled / c.required_slots < 0.5
        ? 'problem'
        : 'delivered',
      tooltip:
        'Valores llenos / esperados (solo atributos de área, sin scope de segmento)',
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
