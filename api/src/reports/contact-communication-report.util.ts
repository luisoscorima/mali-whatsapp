import { escapeForLikePattern } from '../contacts/contacts-filter.utils';
import { Prisma } from '@prisma/client';
import { formatExportDate } from '../campaigns/campaign-format.util';
import {
  isHumanAdvisorOutboundMessage,
  readMessageSenderLabel,
} from '../conversations/chat-sender.util';
import { getReportDisplayTimeZone } from './report-date-range.util';

const PREVIEW_TRUNCATE = 120;
const SEGMENT_NONE = '__none__';

export const REPORT_HEADERS = [
  'Número',
  'Nombre',
  'Apellido',
  'Email',
  'DNI',
  '1er msj cliente',
  'Fecha 1er msj cliente',
  'Últ msj cliente',
  'Fecha últ msj cliente',
  'Asesor 1er msj',
  '1er msj asesor',
  'Fecha 1er msj asesor',
  'Asesor últ msj',
  'Últ msj asesor',
  'Fecha últ msj asesor',
  'Segmentos actuales',
  'Origen',
  'Últ comunicación por',
  'Estado de Lead',
  'Calificación del Lead',
] as const;

export type ContactCommunicationRow = {
  phone: string;
  name: string;
  last_name: string;
  email: string;
  dni: string;
  first_client_message: string;
  first_client_message_at: string | null;
  first_client_message_display: string;
  last_client_message: string;
  last_client_message_at: string | null;
  last_client_message_display: string;
  first_client_message_preview: string;
  last_client_message_preview: string;
  first_advisor_user: string;
  first_advisor_message: string;
  first_advisor_message_at: string | null;
  first_advisor_message_display: string;
  last_advisor_user: string;
  last_advisor_message: string;
  last_advisor_message_at: string | null;
  last_advisor_message_display: string;
  segments: string;
  origins: string;
  last_communication_by: string;
  last_communication_at: string | null;
  last_communication_display: string;
  lead_status: string;
  lead_score: string;
};

export type CommunicationReportFilters = {
  from: string;
  to: string;
  segment_slugs: string[];
  attr_key: string;
  attr_value: string;
};

type MessageRow = {
  conversation_id: number;
  direction: string;
  body_text: string | null;
  message_type: string;
  is_ai: boolean;
  raw_payload: unknown;
  created_at: Date;
  id: number;
  rn_abs_desc: number;
  rn_in_asc: number;
  rn_in_desc: number;
  rn_adv_asc: number;
  rn_adv_desc: number;
};

function messageText(msg: MessageRow | undefined): string {
  return String(msg?.body_text || '').trim();
}

function truncateForPreview(text: string, max = PREVIEW_TRUNCATE): string {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function lastCommunicationByLabel(msg: MessageRow | undefined): string {
  if (!msg) return '';
  if (msg.direction === 'inbound') return 'Cliente';
  return (
    readMessageSenderLabel(msg.raw_payload, msg.is_ai, msg.message_type) || ''
  );
}

function advisorLabel(msg: MessageRow | undefined): string {
  if (!msg) return '';
  return (
    readMessageSenderLabel(msg.raw_payload, msg.is_ai, msg.message_type) || ''
  );
}

function displayAt(msg: MessageRow | undefined): string {
  return msg ? formatExportDate(msg.created_at) || '—' : '—';
}

function isoAt(msg: MessageRow | undefined): string | null {
  return msg?.created_at?.toISOString() ?? null;
}

function buildRowFromMessages(
  contact: {
    phone: string;
    name: string;
    last_name: string;
    email: string;
    dni: string;
    segments: string;
    origins: string;
    lead_status: string;
    lead_score: string;
  },
  msgs: MessageRow[],
): ContactCommunicationRow {
  const lastAbs = msgs.find((m) => Number(m.rn_abs_desc) === 1);
  const firstClient = msgs.find((m) => Number(m.rn_in_asc) === 1);
  const lastClient = msgs.find((m) => Number(m.rn_in_desc) === 1);
  const firstAdvisor = msgs.find((m) => Number(m.rn_adv_asc) === 1);
  const lastAdvisor = msgs.find((m) => Number(m.rn_adv_desc) === 1);

  const firstClientText = messageText(firstClient);
  const lastClientText = messageText(lastClient);
  const firstAdvisorText = messageText(firstAdvisor);
  const lastAdvisorText = messageText(lastAdvisor);

  return {
    phone: contact.phone,
    name: contact.name,
    last_name: contact.last_name,
    email: contact.email,
    dni: contact.dni,
    first_client_message: firstClientText,
    first_client_message_at: isoAt(firstClient),
    first_client_message_display: displayAt(firstClient),
    last_client_message: lastClientText,
    last_client_message_at: isoAt(lastClient),
    last_client_message_display: displayAt(lastClient),
    first_client_message_preview: truncateForPreview(firstClientText),
    last_client_message_preview: truncateForPreview(lastClientText),
    first_advisor_user: advisorLabel(firstAdvisor),
    first_advisor_message: firstAdvisorText,
    first_advisor_message_at: isoAt(firstAdvisor),
    first_advisor_message_display: displayAt(firstAdvisor),
    last_advisor_user: advisorLabel(lastAdvisor),
    last_advisor_message: lastAdvisorText,
    last_advisor_message_at: isoAt(lastAdvisor),
    last_advisor_message_display: displayAt(lastAdvisor),
    segments: contact.segments,
    origins: contact.origins,
    last_communication_by: lastCommunicationByLabel(lastAbs),
    last_communication_at: isoAt(lastAbs),
    last_communication_display: displayAt(lastAbs),
    lead_status: contact.lead_status,
    lead_score: contact.lead_score,
  };
}

function lastClientMessageDateSql(): string {
  const tz = getReportDisplayTimeZone().replace(/'/g, "''");
  return `(conv.last_user_message_at AT TIME ZONE '${tz}')::date`;
}

function buildContactFilterSql(
  area: string,
  filters: CommunicationReportFilters,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`c.area = ${area}`,
    Prisma.sql`EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = conv.id)`,
    Prisma.sql`conv.last_user_message_at IS NOT NULL`,
  ];

  const dateExpr = Prisma.raw(lastClientMessageDateSql());
  conditions.push(Prisma.sql`${dateExpr} >= CAST(${filters.from} AS date)`);
  conditions.push(Prisma.sql`${dateExpr} <= CAST(${filters.to} AS date)`);

  const slugs = filters.segment_slugs.filter((s) => s && s !== SEGMENT_NONE);
  const includeNone = filters.segment_slugs.includes(SEGMENT_NONE);
  const segmentClauses: Prisma.Sql[] = [];
  if (slugs.length > 0) {
    segmentClauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM contact_segments csf
      WHERE csf.contact_id = c.id AND csf.segment_slug = ANY(${slugs}::varchar[])
    )`);
  }
  if (includeNone) {
    segmentClauses.push(Prisma.sql`NOT EXISTS (
      SELECT 1 FROM contact_segments csn WHERE csn.contact_id = c.id
    )`);
  }
  if (segmentClauses.length > 0) {
    conditions.push(Prisma.sql`(${Prisma.join(segmentClauses, ' OR ')})`);
  }

  const attrKey = String(filters.attr_key || '')
    .trim()
    .toLowerCase();
  const attrValue = String(filters.attr_value || '').trim();
  if (attrKey && attrValue) {
    const attrPat = `%${escapeForLikePattern(attrValue)}%`;
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM contact_attributes ca
      WHERE ca.contact_id = c.id
        AND ca.attr_key = ${attrKey}
        AND ca.attr_value ILIKE ${attrPat} ESCAPE '!'
    )`);
  } else if (attrKey) {
    conditions.push(Prisma.sql`EXISTS (
      SELECT 1 FROM contact_attributes ca
      WHERE ca.contact_id = c.id
        AND ca.attr_key = ${attrKey}
        AND TRIM(COALESCE(ca.attr_value, '')) <> ''
    )`);
  }

  return Prisma.join(conditions, ' AND ');
}

async function fetchContactIdsForReport(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  area: string,
  filters: CommunicationReportFilters,
  opts: { limit?: number; offset?: number },
): Promise<{
  total: number;
  contacts: {
    id: number;
    name: string;
    last_name: string;
    phone: string;
    email: string;
    dni: string;
    conversation_id: number;
    segments: string;
    origins: string;
    lead_status: string;
    lead_score: string;
  }[];
}> {
  const where = buildContactFilterSql(area, filters);

  const countRows = await prisma.$queryRaw<{ c: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS c
    FROM contacts c
    INNER JOIN conversations conv ON conv.area = c.area AND conv.phone = c.phone
    WHERE ${where}
  `);
  const total = Number(countRows[0]?.c || 0);

  let limitSql = Prisma.empty;
  if (opts.limit != null) {
    limitSql = Prisma.sql` LIMIT ${opts.limit}`;
  }
  let offsetSql = Prisma.empty;
  if (opts.offset != null) {
    offsetSql = Prisma.sql` OFFSET ${opts.offset}`;
  }

  const contacts = await prisma.$queryRaw<
    {
      id: number;
      name: string;
      last_name: string;
      phone: string;
      email: string;
      dni: string;
      conversation_id: number;
      segments: string;
      origins: string;
      lead_status: string;
      lead_score: string;
    }[]
  >(Prisma.sql`
    SELECT
      c.id,
      c.name,
      COALESCE(c.last_name, '') AS last_name,
      c.phone,
      COALESCE(c.email, '') AS email,
      COALESCE(c.dni, '') AS dni,
      conv.id AS conversation_id,
      COALESCE((
        SELECT string_agg(sd.label, ', ' ORDER BY sd.sort_order NULLS LAST, sd.label)
        FROM contact_segments cs
        JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
        WHERE cs.contact_id = c.id AND cs.area = c.area
      ), '') AS segments,
      COALESCE((
        SELECT string_agg(
          DISTINCT COALESCE(NULLIF(TRIM(co.source_label), ''), co.channel),
          ', '
        )
        FROM contact_origins co
        WHERE co.contact_id = c.id AND co.area = c.area
      ), '') AS origins,
      COALESCE(ls.label, '') AS lead_status,
      COALESCE(c.lead_score::text, '') AS lead_score
    FROM contacts c
    INNER JOIN conversations conv ON conv.area = c.area AND conv.phone = c.phone
    LEFT JOIN lead_status_definitions ls ON ls.id = c.lead_status_id
    WHERE ${where}
    ORDER BY COALESCE(NULLIF(c.name, ''), c.phone) ASC, c.id ASC
    ${limitSql}
    ${offsetSql}
  `);

  return { total, contacts };
}

async function fetchMessagesForConversations(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  conversationIds: number[],
): Promise<Map<number, MessageRow[]>> {
  if (!conversationIds.length) return new Map();

  const rows = await prisma.$queryRaw<MessageRow[]>(Prisma.sql`
    WITH ranked AS (
      SELECT
        m.conversation_id,
        m.direction,
        m.body_text,
        m.message_type,
        m.is_ai,
        m.raw_payload,
        m.created_at,
        m.id,
        ROW_NUMBER() OVER (
          PARTITION BY m.conversation_id
          ORDER BY m.created_at DESC, m.id DESC
        ) AS rn_abs_desc,
        ROW_NUMBER() OVER (
          PARTITION BY m.conversation_id
          ORDER BY CASE WHEN m.direction = 'inbound' THEN 0 ELSE 1 END,
                   m.created_at ASC, m.id ASC
        ) AS rn_in_asc_raw,
        ROW_NUMBER() OVER (
          PARTITION BY m.conversation_id
          ORDER BY CASE WHEN m.direction = 'inbound' THEN 0 ELSE 1 END,
                   m.created_at DESC, m.id DESC
        ) AS rn_in_desc_raw,
        CASE
          WHEN m.direction = 'outbound'
            AND COALESCE(m.is_ai, false) = false
            AND LOWER(COALESCE(m.message_type, '')) <> 'campaign'
            AND COALESCE(m.raw_payload->>'source', '') NOT IN ('campaign_send', 'flow', 'flow_handoff')
            AND (
              m.raw_payload->'_mali_sender'->>'label' IS NULL
              OR LOWER(TRIM(m.raw_payload->'_mali_sender'->>'label'))
                 NOT IN ('ia', 'campaña', 'automatico', 'automático', 'flujo')
            )
          THEN true
          ELSE false
        END AS is_advisor
      FROM chat_messages m
      WHERE m.conversation_id = ANY(${conversationIds}::int[])
    ),
    advisor_ranked AS (
      SELECT
        *,
        CASE WHEN direction = 'inbound' THEN rn_in_asc_raw ELSE NULL END AS rn_in_asc,
        CASE WHEN direction = 'inbound' THEN rn_in_desc_raw ELSE NULL END AS rn_in_desc,
        CASE WHEN is_advisor THEN
          ROW_NUMBER() OVER (
            PARTITION BY conversation_id, is_advisor
            ORDER BY created_at ASC, id ASC
          )
        ELSE NULL END AS rn_adv_asc,
        CASE WHEN is_advisor THEN
          ROW_NUMBER() OVER (
            PARTITION BY conversation_id, is_advisor
            ORDER BY created_at DESC, id DESC
          )
        ELSE NULL END AS rn_adv_desc
      FROM ranked
    )
    SELECT
      conversation_id, direction, body_text, message_type, is_ai, raw_payload,
      created_at, id, rn_abs_desc,
      COALESCE(rn_in_asc, 0) AS rn_in_asc,
      COALESCE(rn_in_desc, 0) AS rn_in_desc,
      COALESCE(rn_adv_asc, 0) AS rn_adv_asc,
      COALESCE(rn_adv_desc, 0) AS rn_adv_desc
    FROM advisor_ranked
    WHERE rn_abs_desc = 1
       OR (direction = 'inbound' AND (rn_in_asc = 1 OR rn_in_desc = 1))
       OR (is_advisor AND (rn_adv_asc = 1 OR rn_adv_desc = 1))
  `);

  const byConv = new Map<number, MessageRow[]>();
  for (const m of rows) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id)!.push(m);
  }
  return byConv;
}

/**
 * Post-filter advisor rows with shared util (SQL heuristic may include edge cases
 * without _mali_sender — those stay for ranking but label stays empty per product rule).
 */
function pickAdvisor(
  msgs: MessageRow[],
  which: 'first' | 'last',
): MessageRow | undefined {
  const advisors = msgs
    .filter((m) =>
      isHumanAdvisorOutboundMessage(m.raw_payload, m.is_ai, m.message_type),
    )
    .sort((a, b) => {
      const t = a.created_at.getTime() - b.created_at.getTime();
      return which === 'first' ? t : -t;
    });
  return advisors[0];
}

export async function fetchContactCommunicationReport(
  prisma: {
    $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
  },
  area: string,
  filters: CommunicationReportFilters,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ total: number; rows: ContactCommunicationRow[] }> {
  const { total, contacts } = await fetchContactIdsForReport(
    prisma,
    area,
    filters,
    opts,
  );
  const convIds = contacts.map((c) => c.conversation_id);
  const byConv = await fetchMessagesForConversations(prisma, convIds);

  const rows = contacts.map((contact) => {
    const msgs = byConv.get(contact.conversation_id) || [];
    const base = buildRowFromMessages(contact, msgs);
    const firstAdv = pickAdvisor(msgs, 'first');
    const lastAdv = pickAdvisor(msgs, 'last');
    return {
      ...base,
      first_advisor_user: advisorLabel(firstAdv),
      first_advisor_message: messageText(firstAdv),
      first_advisor_message_at: isoAt(firstAdv),
      first_advisor_message_display: displayAt(firstAdv),
      last_advisor_user: advisorLabel(lastAdv),
      last_advisor_message: messageText(lastAdv),
      last_advisor_message_at: isoAt(lastAdv),
      last_advisor_message_display: displayAt(lastAdv),
    };
  });

  return { total, rows };
}

export function reportRowToExportCells(row: ContactCommunicationRow): string[] {
  return [
    row.phone,
    row.name,
    row.last_name,
    row.email,
    row.dni,
    row.first_client_message,
    row.first_client_message_display,
    row.last_client_message,
    row.last_client_message_display,
    row.first_advisor_user,
    row.first_advisor_message,
    row.first_advisor_message_display,
    row.last_advisor_user,
    row.last_advisor_message,
    row.last_advisor_message_display,
    row.segments,
    row.origins,
    row.last_communication_by,
    row.lead_status,
    row.lead_score,
  ];
}
