import { Prisma } from '@prisma/client';
import type { MetricCard } from '../campaigns/campaign-analytics.util';

export type SegmentTopRow = {
  slug: string;
  label: string;
  total: number;
};

export type SegmentSummary = {
  days: number;
  kpis: MetricCard[];
  top_segments: SegmentTopRow[];
};

function fmt(n: number): string {
  return new Intl.NumberFormat('es-PE').format(n);
}

export async function fetchSegmentSummary(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  area: string,
  days: number,
): Promise<SegmentSummary> {
  const safeDays = Math.min(Math.max(Math.round(days) || 30, 1), 90);
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

  const [counts, topRows] = await Promise.all([
    prisma.$queryRaw<
      {
        defs_active: number;
        defs_assignable: number;
        labeled_contacts: number;
        unlabeled_contacts: number;
        joins_in_period: number;
      }[]
    >(Prisma.sql`
      SELECT
        (SELECT COUNT(*)::int FROM segment_definitions sd
         WHERE sd.area = ${area} AND sd.active = true) AS defs_active,
        (SELECT COUNT(*)::int FROM segment_definitions sd
         WHERE sd.area = ${area} AND sd.active = true AND sd.assignable = true) AS defs_assignable,
        (SELECT COUNT(DISTINCT c.id)::int FROM contacts c
         WHERE c.area = ${area}
           AND c.active = true
           AND c.replacement_reason IS NULL
           AND c.replaced_by_contact_id IS NULL
           AND EXISTS (
             SELECT 1 FROM contact_segments cs WHERE cs.contact_id = c.id
           )) AS labeled_contacts,
        (SELECT COUNT(*)::int FROM contacts c
         WHERE c.area = ${area}
           AND c.active = true
           AND c.replacement_reason IS NULL
           AND c.replaced_by_contact_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM contact_segments cs WHERE cs.contact_id = c.id
           )) AS unlabeled_contacts,
        (SELECT COUNT(*)::int FROM contact_segments cs
         JOIN contacts c ON c.id = cs.contact_id
         WHERE cs.area = ${area}
           AND c.active = true
           AND c.replacement_reason IS NULL
           AND c.replaced_by_contact_id IS NULL
           AND cs.created_at >= ${since}) AS joins_in_period
    `),
    prisma.$queryRaw<{ slug: string; label: string; total: number }[]>(Prisma.sql`
      SELECT
        sd.slug,
        sd.label,
        COUNT(cs.contact_id)::int AS total
      FROM segment_definitions sd
      LEFT JOIN contact_segments cs ON cs.area = sd.area AND cs.segment_slug = sd.slug
      LEFT JOIN contacts c ON c.id = cs.contact_id
        AND c.active = true
        AND c.replacement_reason IS NULL
        AND c.replaced_by_contact_id IS NULL
      WHERE sd.area = ${area}
        AND sd.active = true
      GROUP BY sd.slug, sd.label, sd.sort_order
      ORDER BY total DESC, sd.sort_order ASC, sd.label ASC
      LIMIT 5
    `),
  ]);

  const c = counts[0] ?? {
    defs_active: 0,
    defs_assignable: 0,
    labeled_contacts: 0,
    unlabeled_contacts: 0,
    joins_in_period: 0,
  };

  const kpis: MetricCard[] = [
    {
      label: 'Activos',
      display: fmt(c.defs_active),
      tone: 'ink',
      tooltip: 'Segmentos activos · click para filtrar',
    },
    {
      label: 'Asignables',
      display: fmt(c.defs_assignable),
      tone: 'sent',
      tooltip: 'Click para filtrar',
    },
    {
      label: 'Etiquetados',
      display: fmt(c.labeled_contacts),
      tone: 'delivered',
      tooltip: 'Contactos activos con al menos un segmento',
    },
    {
      label: 'Sin segmento',
      display: fmt(c.unlabeled_contacts),
      tone: 'problem',
      tooltip: 'Contactos activos sin segmento',
    },
    {
      label: `Altas (${safeDays}d)`,
      display: fmt(c.joins_in_period),
      tone: 'ink',
      tooltip: 'Asignaciones a segmentos en el periodo',
    },
  ];

  return {
    days: safeDays,
    kpis,
    top_segments: topRows.map((row) => ({
      slug: row.slug,
      label: row.label,
      total: row.total,
    })),
  };
}
