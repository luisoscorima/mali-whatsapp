import { Prisma } from '@prisma/client';
import type { MetricCard } from '../campaigns/campaign-analytics.util';

export type ContactDailyPoint = {
  date: string;
  count: number;
};

export type ContactSummary = {
  days: number;
  kpis: MetricCard[];
  daily_series: ContactDailyPoint[];
};

function fmt(n: number): string {
  return new Intl.NumberFormat('es-PE').format(n);
}

export async function fetchContactSummary(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  area: string,
  days: number,
): Promise<ContactSummary> {
  const safeDays = Math.min(Math.max(Math.round(days) || 30, 1), 90);
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
  const inactiveSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [counts, dailyRows] = await Promise.all([
    prisma.$queryRaw<
      {
        total_active: number;
        new_in_period: number;
        with_chat: number;
        without_chat: number;
        inactive_30d: number;
        opt_in: number;
        opt_out: number;
        without_segment: number;
      }[]
    >(Prisma.sql`
      SELECT
        COUNT(*)::int AS total_active,
        COUNT(*) FILTER (WHERE c.created_at >= ${since})::int AS new_in_period,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM conversations conv
            WHERE conv.area = c.area
              AND (conv.contact_id = c.id OR conv.phone = c.phone)
          )
        )::int AS with_chat,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM conversations conv
            WHERE conv.area = c.area
              AND (conv.contact_id = c.id OR conv.phone = c.phone)
          )
        )::int AS without_chat,
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM conversations conv
            WHERE conv.area = c.area
              AND (conv.contact_id = c.id OR conv.phone = c.phone)
          )
          AND (
            SELECT MAX(conv.last_message_at)
            FROM conversations conv
            WHERE conv.area = c.area
              AND (conv.contact_id = c.id OR conv.phone = c.phone)
          ) < ${inactiveSince}
        )::int AS inactive_30d,
        COUNT(*) FILTER (WHERE c.opt_in = true)::int AS opt_in,
        COUNT(*) FILTER (WHERE c.opt_in = false)::int AS opt_out,
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM contact_segments cs
            WHERE cs.contact_id = c.id
          )
        )::int AS without_segment
      FROM contacts c
      WHERE c.area = ${area}
        AND c.active = true
        AND c.replacement_reason IS NULL
        AND c.replaced_by_contact_id IS NULL
    `),
    prisma.$queryRaw<{ day: Date; count: number }[]>(Prisma.sql`
      SELECT date_trunc('day', c.created_at)::date AS day, COUNT(*)::int AS count
      FROM contacts c
      WHERE c.area = ${area}
        AND c.active = true
        AND c.replacement_reason IS NULL
        AND c.replaced_by_contact_id IS NULL
        AND c.created_at >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
  ]);

  const c = counts[0] ?? {
    total_active: 0,
    new_in_period: 0,
    with_chat: 0,
    without_chat: 0,
    inactive_30d: 0,
    opt_in: 0,
    opt_out: 0,
    without_segment: 0,
  };

  const kpis: MetricCard[] = [
    {
      label: 'Total activos',
      display: fmt(c.total_active),
      tone: 'ink',
      tooltip: 'Contactos activos del área (sin reemplazos)',
    },
    {
      label: `Nuevos (${safeDays}d)`,
      display: fmt(c.new_in_period),
      tone: 'sent',
      tooltip: 'Creados en el periodo seleccionado',
    },
    {
      label: 'Con chat',
      display: fmt(c.with_chat),
      tone: 'ink',
      tooltip: 'Tienen al menos una conversación vinculada',
    },
    {
      label: 'Sin interacción',
      display: fmt(c.without_chat),
      tone: 'problem',
      tooltip: 'Sin conversación vinculada',
    },
    {
      label: 'Inactivos >30d',
      display: fmt(c.inactive_30d),
      tone: 'problem',
      tooltip: 'Tuvieron chat, pero sin mensajes en los últimos 30 días',
    },
    {
      label: 'Opt-in WA',
      display: `${fmt(c.opt_in)} / ${fmt(c.opt_out)}`,
      tone: 'delivered',
      tooltip: 'Con opt-in / sin opt-in',
    },
    {
      label: 'Sin segmento',
      display: fmt(c.without_segment),
      tone: 'ink',
      tooltip: 'Click para filtrar la lista',
    },
  ];

  const dailyMap = new Map<string, number>();
  for (const row of dailyRows) {
    const key = new Date(row.day).toISOString().slice(0, 10);
    dailyMap.set(key, row.count);
  }

  const daily_series: ContactDailyPoint[] = [];
  for (let i = safeDays - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    daily_series.push({ date: key, count: dailyMap.get(key) ?? 0 });
  }

  return {
    days: safeDays,
    kpis,
    daily_series,
  };
}
