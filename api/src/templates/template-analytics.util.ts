import { Prisma } from '@prisma/client';
import type { MetricCard } from '../campaigns/campaign-analytics.util';

export type TemplateSummary = {
  kpis: MetricCard[];
};

function fmt(n: number): string {
  return new Intl.NumberFormat('es-PE').format(n);
}

export async function fetchTemplateSummary(
  prisma: {
    $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
  },
  area: string,
): Promise<TemplateSummary> {
  const counts = await prisma.$queryRaw<
    {
      approved: number;
      pending: number;
      rejected: number;
      active: number;
      inactive: number;
      used: number;
      unused: number;
    }[]
  >(Prisma.sql`
    SELECT
      COUNT(*) FILTER (
        WHERE UPPER(TRIM(t.status)) = 'APPROVED'
      )::int AS approved,
      COUNT(*) FILTER (
        WHERE UPPER(TRIM(t.status)) = 'PENDING'
      )::int AS pending,
      COUNT(*) FILTER (
        WHERE UPPER(TRIM(t.status)) = 'REJECTED'
      )::int AS rejected,
      COUNT(*) FILTER (WHERE t.active = true)::int AS active,
      COUNT(*) FILTER (WHERE t.active = false)::int AS inactive,
      COUNT(*) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM campaigns camp
          WHERE camp.area = t.area
            AND camp.template_name = t.name
        )
      )::int AS used,
      COUNT(*) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM campaigns camp
          WHERE camp.area = t.area
            AND camp.template_name = t.name
        )
      )::int AS unused
    FROM whatsapp_templates t
    WHERE t.area = ${area}
  `);

  const c = counts[0] ?? {
    approved: 0,
    pending: 0,
    rejected: 0,
    active: 0,
    inactive: 0,
    used: 0,
    unused: 0,
  };

  const kpis: MetricCard[] = [
    {
      label: 'Aprobadas',
      display: fmt(c.approved),
      tone: 'delivered',
      tooltip: 'Click para filtrar',
    },
    {
      label: 'Pendientes',
      display: fmt(c.pending),
      tone: 'ink',
      tooltip: 'Click para filtrar',
    },
    {
      label: 'Rechazadas',
      display: fmt(c.rejected),
      tone: 'problem',
      tooltip: 'Click para filtrar',
    },
    {
      label: 'Activas',
      display: `${fmt(c.active)} / ${fmt(c.inactive)}`,
      tone: 'ink',
      tooltip: 'Activas / inactivas',
    },
    {
      label: 'Usadas / Sin uso',
      display: `${fmt(c.used)} / ${fmt(c.unused)}`,
      tone: 'sent',
      tooltip: 'Con al menos una campaña (por nombre)',
    },
  ];

  return { kpis };
}
