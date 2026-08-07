import { Prisma } from '@prisma/client';
import type { MetricCard } from '../campaigns/campaign-analytics.util';

export type FlowSummary = {
  kpis: MetricCard[];
};

function fmt(n: number): string {
  return new Intl.NumberFormat('es-PE').format(n);
}

function pct(num: number, den: number): string {
  if (den <= 0) return '—';
  return `${Math.round((num / den) * 100)}%`;
}

export async function fetchFlowSummary(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  area: string,
): Promise<FlowSummary> {
  const counts = await prisma.$queryRaw<
    {
      flows_active: number;
      flows_draft: number;
      flows_paused: number;
      sessions_active: number;
      sessions_completed: number;
      sessions_handed_off: number;
      sessions_started: number;
      timeout_closed: number;
    }[]
  >(Prisma.sql`
    SELECT
      (SELECT COUNT(*)::int FROM flows f
       WHERE f.area = ${area} AND LOWER(TRIM(f.status)) = 'active') AS flows_active,
      (SELECT COUNT(*)::int FROM flows f
       WHERE f.area = ${area} AND LOWER(TRIM(f.status)) = 'draft') AS flows_draft,
      (SELECT COUNT(*)::int FROM flows f
       WHERE f.area = ${area} AND LOWER(TRIM(f.status)) = 'paused') AS flows_paused,
      (SELECT COUNT(*)::int FROM flow_sessions fs
       JOIN flows f ON f.id = fs.flow_id
       WHERE f.area = ${area} AND fs.status = 'active') AS sessions_active,
      (SELECT COUNT(*)::int FROM flow_sessions fs
       JOIN flows f ON f.id = fs.flow_id
       WHERE f.area = ${area} AND fs.status = 'completed') AS sessions_completed,
      (SELECT COUNT(*)::int FROM flow_sessions fs
       JOIN flows f ON f.id = fs.flow_id
       WHERE f.area = ${area} AND fs.status = 'handed_off') AS sessions_handed_off,
      (SELECT COUNT(*)::int FROM flow_sessions fs
       JOIN flows f ON f.id = fs.flow_id
       WHERE f.area = ${area}) AS sessions_started,
      (SELECT COUNT(*)::int FROM flow_session_events e
       JOIN flows f ON f.id = e.flow_id
       WHERE f.area = ${area} AND e.event_type = 'timeout_closed') AS timeout_closed
  `);

  const c = counts[0] ?? {
    flows_active: 0,
    flows_draft: 0,
    flows_paused: 0,
    sessions_active: 0,
    sessions_completed: 0,
    sessions_handed_off: 0,
    sessions_started: 0,
    timeout_closed: 0,
  };

  const kpis: MetricCard[] = [
    {
      label: 'Flujos activos',
      display: fmt(c.flows_active),
      tone: 'delivered',
    },
    {
      label: 'Draft / Pausados',
      display: `${fmt(c.flows_draft)} / ${fmt(c.flows_paused)}`,
      tone: 'ink',
    },
    {
      label: 'Sesiones activas',
      display: fmt(c.sessions_active),
      tone: 'sent',
    },
    {
      label: 'Completadas',
      display: fmt(c.sessions_completed),
      tone: 'delivered',
    },
    {
      label: 'Derivadas',
      display: fmt(c.sessions_handed_off),
      tone: 'ink',
    },
    {
      label: 'Tasa completado',
      display: pct(c.sessions_completed, c.sessions_started),
      tone: 'ink',
      tooltip: 'Completadas / sesiones iniciadas',
    },
    {
      label: 'Cierre por silencio',
      display: fmt(c.timeout_closed),
      tone: 'problem',
    },
  ];

  return { kpis };
}
