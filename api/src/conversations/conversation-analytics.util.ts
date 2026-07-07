import { Prisma } from '@prisma/client';
import type { MetricCard } from '../campaigns/campaign-analytics.util';
export { isWithinUserServiceWindow } from '../campaigns/campaign-conversation-window.util';

export type ConversationDailyPoint = {
  date: string;
  count: number;
};

export type ConversationAdvisorRow = {
  user_id: number;
  label: string;
  count: number;
};

export type ConversationSummary = {
  days: number;
  advisor_id: number | null;
  kpis: MetricCard[];
  daily_series: ConversationDailyPoint[];
  top_advisors: ConversationAdvisorRow[];
};

function fmt(n: number): string {
  return new Intl.NumberFormat('es-PE').format(n);
}

export async function fetchConversationSummary(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  area: string,
  days: number,
  advisorId?: number | null,
): Promise<ConversationSummary> {
  const safeDays = Math.min(Math.max(Math.round(days) || 30, 1), 90);
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
  const advisorFilter =
    advisorId != null && advisorId > 0
      ? Prisma.sql` AND c.assigned_user_id = ${advisorId}`
      : Prisma.empty;

  const [counts, dailyRows, topRows, advisorResponded] = await Promise.all([
    prisma.$queryRaw<
      {
        total_active: number;
        window_open: number;
        window_closed: number;
        unassigned: number;
        new_chats: number;
        bot_mode: number;
        human_mode: number;
        unread: number;
      }[]
    >(Prisma.sql`
      SELECT
        COUNT(*)::int AS total_active,
        COUNT(*) FILTER (
          WHERE c.last_user_message_at IS NOT NULL
            AND c.last_user_message_at >= NOW() - INTERVAL '24 hours'
        )::int AS window_open,
        COUNT(*) FILTER (
          WHERE c.last_user_message_at IS NULL
            OR c.last_user_message_at < NOW() - INTERVAL '24 hours'
        )::int AS window_closed,
        COUNT(*) FILTER (
          WHERE c.assigned_user_id IS NULL
            AND (
              LOWER(TRIM(COALESCE(c.status, ''))) = 'bot'
              OR (
                LOWER(TRIM(COALESCE(c.status, ''))) = 'human'
                AND c.automation_touched_at IS NOT NULL
              )
            )
        )::int AS unassigned,
        COUNT(*) FILTER (
          WHERE LOWER(TRIM(COALESCE(c.status, ''))) = 'human'
            AND c.assigned_user_id IS NULL
            AND c.automation_touched_at IS NULL
        )::int AS new_chats,
        COUNT(*) FILTER (
          WHERE LOWER(TRIM(COALESCE(c.status, ''))) = 'bot'
        )::int AS bot_mode,
        COUNT(*) FILTER (
          WHERE LOWER(TRIM(COALESCE(c.status, ''))) = 'human'
        )::int AS human_mode,
        COUNT(*) FILTER (WHERE c.inbox_unread = true)::int AS unread
      FROM conversations c
      WHERE c.area = ${area}
        AND c.last_message_at >= ${since}
    `),
    prisma.$queryRaw<{ day: Date; count: number }[]>(Prisma.sql`
      SELECT date_trunc('day', c.last_message_at)::date AS day, COUNT(*)::int AS count
      FROM conversations c
      WHERE c.area = ${area}
        AND c.last_message_at >= ${since}
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    prisma.$queryRaw<{ user_id: number; label: string; count: number }[]>(Prisma.sql`
      SELECT
        u.id AS user_id,
        COALESCE(
          NULLIF(SPLIT_PART(COALESCE(u.email, ''), '@', 1), ''),
          u.email
        ) AS label,
        COUNT(DISTINCT c.id)::int AS count
      FROM conversations c
      JOIN users u ON u.id = c.assigned_user_id
      JOIN chat_messages m ON m.conversation_id = c.id
        AND m.direction = 'outbound'
        AND m.created_at >= ${since}
      WHERE c.area = ${area}
        AND c.last_message_at >= ${since}
        AND c.assigned_user_id IS NOT NULL
      GROUP BY u.id, label
      ORDER BY count DESC, label ASC
      LIMIT 5
    `),
    prisma.$queryRaw<{ count: number }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT c.id)::int AS count
      FROM conversations c
      JOIN chat_messages m ON m.conversation_id = c.id
        AND m.direction = 'outbound'
        AND m.created_at >= ${since}
      WHERE c.area = ${area}
        AND c.last_message_at >= ${since}
        AND c.assigned_user_id IS NOT NULL
        ${advisorFilter}
    `),
  ]);

  const c = counts[0] ?? {
    total_active: 0,
    window_open: 0,
    window_closed: 0,
    unassigned: 0,
    new_chats: 0,
    bot_mode: 0,
    human_mode: 0,
    unread: 0,
  };

  const responded = advisorResponded[0]?.count ?? 0;

  const kpis: MetricCard[] = [
    {
      label: `Activas (${safeDays}d)`,
      display: fmt(c.total_active),
      tone: 'ink',
      tooltip: 'Conversaciones con actividad en el periodo',
    },
    {
      label: 'Ventana 24h abierta',
      display: fmt(c.window_open),
      tone: 'sent',
    },
    {
      label: 'Ventana 24h cerrada',
      display: fmt(c.window_closed),
      tone: 'problem',
    },
    {
      label: 'Sin asignar',
      display: fmt(c.unassigned),
      tone: 'ink',
    },
    {
      label: 'Nuevo',
      display: fmt(c.new_chats),
      tone: 'ink',
    },
    {
      label: 'Sin leer',
      display: fmt(c.unread),
      tone: 'ink',
    },
    {
      label: 'Modo Bot',
      display: fmt(c.bot_mode),
      tone: 'ink',
    },
    {
      label: 'Modo Asesor',
      display: fmt(c.human_mode),
      tone: 'ink',
    },
    {
      label: advisorId ? 'Respondidas (asesor)' : 'Respondidas por asesor',
      display: fmt(responded),
      tone: 'delivered',
      tooltip:
        'Asignadas con al menos un mensaje outbound del asesor en el periodo',
    },
  ];

  const dailyMap = new Map<string, number>();
  for (const row of dailyRows) {
    const key = new Date(row.day).toISOString().slice(0, 10);
    dailyMap.set(key, row.count);
  }

  const daily_series: ConversationDailyPoint[] = [];
  for (let i = safeDays - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    daily_series.push({ date: key, count: dailyMap.get(key) ?? 0 });
  }

  return {
    days: safeDays,
    advisor_id: advisorId ?? null,
    kpis,
    daily_series,
    top_advisors: topRows.map((row) => ({
      user_id: row.user_id,
      label: row.label,
      count: row.count,
    })),
  };
}
