import { Prisma } from '@prisma/client';
import { sqlCampaignLogIsSalidaOk } from './campaign-log-statuses.util';

const SQL_INTERACTIVE_RESPONSE_TEXT = `NULLIF(TRIM(COALESCE(
  NULLIF(TRIM(cm.body_text), '[Interactivo]'),
  NULLIF(TRIM(cm.body_text), '[Botón]'),
  NULLIF(TRIM(cm.raw_payload->'button'->>'text'), ''),
  NULLIF(TRIM(cm.raw_payload->'interactive'->'button_reply'->>'title'), '')
)), '')`;

const SQL_IS_INTERACTIVE_INBOUND = `(
  cm.message_type = 'button'
  OR (
    cm.message_type = 'interactive'
    AND COALESCE(cm.raw_payload->'interactive'->>'type', '') = 'button_reply'
  )
)`;

function readResponseWindowDays(): number {
  const n = Number(process.env.CAMPAIGN_RESPONSE_WINDOW_DAYS || 7);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 7;
}

export type CampaignResponderRow = {
  phone: string;
  contact_name: string;
  contact_email: string;
  contact_dni: string;
  segment_labels: string;
  contact_id: number | null;
  conversation_id: number | null;
  first_response_at: string;
  interactive_response_text: string;
  interactive_response_at: string | null;
};

export type CampaignResponderMetrics = {
  window_days: number;
  sent_count: number;
  responded_count: number;
  responders: CampaignResponderRow[];
  response_type_summary: { label: string; count: number }[];
};

type ResponderSqlRow = {
  phone: string;
  contact_name: string;
  contact_email: string;
  contact_dni: string;
  segment_labels: string;
  contact_id: number | null;
  conversation_id: number | null;
  first_response_at: Date;
};

type InteractiveSqlRow = ResponderSqlRow & {
  interactive_response_at: Date;
  interactive_response_text: string;
};

function mapResponderRow(row: ResponderSqlRow): CampaignResponderRow {
  return {
    phone: row.phone,
    contact_name: row.contact_name || '',
    contact_email: row.contact_email || '',
    contact_dni: row.contact_dni || '',
    segment_labels: row.segment_labels || '',
    contact_id: row.contact_id,
    conversation_id: row.conversation_id,
    first_response_at: row.first_response_at.toISOString(),
    interactive_response_text: '',
    interactive_response_at: null,
  };
}

function mergeInteractiveIntoResponders(
  responders: CampaignResponderRow[],
  interactiveResponders: InteractiveSqlRow[],
): CampaignResponderRow[] {
  const byPhone = new Map(
    interactiveResponders.map((row) => [row.phone, row]),
  );
  return responders.map((row) => {
    const interactive = byPhone.get(row.phone);
    if (!interactive) return row;
    return {
      ...row,
      interactive_response_text: interactive.interactive_response_text || '',
      interactive_response_at: interactive.interactive_response_at.toISOString(),
    };
  });
}

async function fetchCampaignSalidaOkCount(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  campaignId: number,
  area: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS n
    FROM (
      SELECT DISTINCT ON (cl.phone)
        cl.phone,
        cl.status
      FROM campaign_logs cl
      JOIN campaigns c ON c.id = cl.campaign_id
      WHERE cl.campaign_id = ${campaignId}
        AND c.area = ${area}
      ORDER BY cl.phone, cl.id DESC
    ) latest_logs
    WHERE ${Prisma.raw(sqlCampaignLogIsSalidaOk('latest_logs.status'))}
  `);
  return rows[0]?.n ?? 0;
}

async function fetchCampaignResponders(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  campaignId: number,
  area: string,
  windowDays: number,
): Promise<CampaignResponderRow[]> {
  const rows = await prisma.$queryRaw<ResponderSqlRow[]>(Prisma.sql`
    WITH latest_logs AS (
      SELECT DISTINCT ON (cl.phone)
        cl.phone,
        cl.contact_id,
        cl.created_at,
        cl.status
      FROM campaign_logs cl
      JOIN campaigns c ON c.id = cl.campaign_id AND c.area = ${area}
      WHERE cl.campaign_id = ${campaignId}
      ORDER BY cl.phone, cl.id DESC
    )
    SELECT
      latest_logs.phone,
      COALESCE(ct.name, '') AS contact_name,
      COALESCE(ct.email, '') AS contact_email,
      COALESCE(ct.dni, '') AS contact_dni,
      COALESCE((
        SELECT string_agg(sd.label, ', ' ORDER BY sd.sort_order NULLS LAST, sd.label)
        FROM contact_segments cs
        JOIN segment_definitions sd ON sd.area = ${area} AND sd.slug = cs.segment_slug
        WHERE cs.contact_id = COALESCE(latest_logs.contact_id, conv.contact_id) AND cs.area = ${area}
      ), '') AS segment_labels,
      COALESCE(latest_logs.contact_id, conv.contact_id) AS contact_id,
      conv.id AS conversation_id,
      MIN(cm.created_at) AS first_response_at
    FROM latest_logs
    INNER JOIN conversations conv ON conv.area = ${area} AND conv.phone = latest_logs.phone
    INNER JOIN chat_messages cm ON cm.conversation_id = conv.id
      AND cm.direction = 'inbound'
      AND cm.created_at > latest_logs.created_at
      AND cm.created_at <= latest_logs.created_at + ${Prisma.raw(`INTERVAL '${windowDays} days'`)}
    LEFT JOIN contacts ct ON ct.id = COALESCE(latest_logs.contact_id, conv.contact_id)
    WHERE ${Prisma.raw(sqlCampaignLogIsSalidaOk('latest_logs.status'))}
    GROUP BY latest_logs.phone, ct.name, ct.email, ct.dni, latest_logs.contact_id, conv.contact_id, conv.id
    ORDER BY first_response_at DESC
  `);
  return rows.map(mapResponderRow);
}

async function fetchCampaignInteractiveResponders(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  campaignId: number,
  area: string,
  windowDays: number,
): Promise<InteractiveSqlRow[]> {
  return prisma.$queryRaw<InteractiveSqlRow[]>(Prisma.sql`
    WITH latest_logs AS (
      SELECT DISTINCT ON (cl.phone)
        cl.phone,
        cl.contact_id,
        cl.created_at,
        cl.status
      FROM campaign_logs cl
      JOIN campaigns c ON c.id = cl.campaign_id AND c.area = ${area}
      WHERE cl.campaign_id = ${campaignId}
      ORDER BY cl.phone, cl.id DESC
    )
    SELECT
      latest_logs.phone,
      COALESCE(ct.name, '') AS contact_name,
      COALESCE(ct.email, '') AS contact_email,
      COALESCE(ct.dni, '') AS contact_dni,
      COALESCE((
        SELECT string_agg(sd.label, ', ' ORDER BY sd.sort_order NULLS LAST, sd.label)
        FROM contact_segments cs
        JOIN segment_definitions sd ON sd.area = ${area} AND sd.slug = cs.segment_slug
        WHERE cs.contact_id = COALESCE(latest_logs.contact_id, conv.contact_id) AND cs.area = ${area}
      ), '') AS segment_labels,
      COALESCE(latest_logs.contact_id, conv.contact_id) AS contact_id,
      conv.id AS conversation_id,
      first_btn.created_at AS interactive_response_at,
      first_btn.response_text AS interactive_response_text,
      first_btn.created_at AS first_response_at
    FROM latest_logs
    INNER JOIN conversations conv ON conv.area = ${area} AND conv.phone = latest_logs.phone
    INNER JOIN LATERAL (
      SELECT
        cm.created_at,
        ${Prisma.raw(SQL_INTERACTIVE_RESPONSE_TEXT)} AS response_text
      FROM chat_messages cm
      WHERE cm.conversation_id = conv.id
        AND cm.direction = 'inbound'
        AND cm.created_at > latest_logs.created_at
        AND cm.created_at <= latest_logs.created_at + ${Prisma.raw(`INTERVAL '${windowDays} days'`)}
        AND ${Prisma.raw(SQL_IS_INTERACTIVE_INBOUND)}
      ORDER BY cm.created_at ASC
      LIMIT 1
    ) first_btn ON TRUE
    LEFT JOIN contacts ct ON ct.id = COALESCE(latest_logs.contact_id, conv.contact_id)
    WHERE ${Prisma.raw(sqlCampaignLogIsSalidaOk('latest_logs.status'))}
      AND first_btn.response_text IS NOT NULL
    ORDER BY first_btn.created_at DESC
  `);
}

function buildResponseTypeSummary(
  responders: CampaignResponderRow[],
  interactiveTexts: string[],
): { label: string; count: number }[] {
  const labels = [...new Set(interactiveTexts.map((t) => t.trim()).filter(Boolean))];
  if (!labels.length) return [];

  const counts = new Map(labels.map((label) => [label, 0]));
  const matchedPhones = new Set<string>();

  for (const row of responders) {
    const text = String(row.interactive_response_text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text || !counts.has(text)) continue;
    counts.set(text, (counts.get(text) || 0) + 1);
    matchedPhones.add(row.phone);
  }

  let otros = 0;
  for (const row of responders) {
    if (!matchedPhones.has(row.phone)) otros += 1;
  }

  const summary = labels.map((label) => ({
    label,
    count: counts.get(label) || 0,
  }));
  summary.push({ label: 'Otros', count: otros });
  return summary;
}

export async function fetchCampaignResponderMetrics(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  campaignId: number,
  area: string,
  quickReplyLabels: string[] = [],
): Promise<CampaignResponderMetrics> {
  const windowDays = readResponseWindowDays();
  const [sentCount, baseResponders, interactiveRows] = await Promise.all([
    fetchCampaignSalidaOkCount(prisma, campaignId, area),
    fetchCampaignResponders(prisma, campaignId, area, windowDays),
    fetchCampaignInteractiveResponders(prisma, campaignId, area, windowDays),
  ]);

  const responders = mergeInteractiveIntoResponders(
    baseResponders,
    interactiveRows,
  );

  return {
    window_days: windowDays,
    sent_count: sentCount,
    responded_count: responders.length,
    responders,
    response_type_summary: buildResponseTypeSummary(
      responders,
      quickReplyLabels.length ? quickReplyLabels : interactiveRows.map((r) => r.interactive_response_text),
    ),
  };
}

export { mergeInteractiveIntoResponders };
