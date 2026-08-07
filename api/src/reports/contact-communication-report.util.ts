import { Prisma } from '@prisma/client';
import { formatExportDate } from '../campaigns/campaign-format.util';
import { parseBusinessHoursConfig } from '../settings/business-hours.util';

const PREVIEW_TRUNCATE = 120;

export const REPORT_HEADERS = [
  'Número',
  'Nombre',
  'Email',
  'DNI',
  'Fecha primera comunicación',
  'Iniciada por',
  'Mensaje 1 (inicio)',
  'Mensaje 2 (inicio)',
  'Fecha última comunicación',
  'Última comunicación por',
  'Último mensaje cliente',
  'Último mensaje equipo',
  'Tipo último mensaje equipo',
] as const;

export type ContactCommunicationRow = {
  phone: string;
  name: string;
  email: string;
  dni: string;
  first_communication_at: string | null;
  first_communication_display: string;
  initiated_by: string;
  message1: string;
  message2: string;
  message1_preview: string;
  message2_preview: string;
  last_communication_at: string | null;
  last_communication_display: string;
  last_communication_by: string;
  last_client_message: string;
  last_team_message: string;
  last_team_message_by: string;
  last_client_message_preview: string;
  last_team_message_preview: string;
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
  rn_asc: number;
  rn_desc: number;
  rn_dir: number;
};

function parseRawPayload(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function messageText(msg: MessageRow | undefined): string {
  return String(msg?.body_text || '').trim();
}

function classifyAuthor(
  msg: MessageRow | undefined,
  outsideHoursMessage: string,
): string {
  if (!msg) return '';
  if (msg.direction === 'inbound') return 'Cliente';
  if (msg.is_ai) return 'IA';
  const raw = parseRawPayload(msg.raw_payload);
  if (msg.message_type === 'campaign' || raw?.source === 'campaign_send') {
    return 'Sistema';
  }
  if (raw?.source === 'outside_hours') return 'Sistema';
  const text = messageText(msg);
  if (outsideHoursMessage && text && text === outsideHoursMessage) {
    return 'Sistema';
  }
  return 'Agente';
}

function classifyInitiator(firstMsg: MessageRow | undefined): string {
  if (!firstMsg) return '';
  if (firstMsg.direction === 'inbound') return 'Cliente';
  return 'Sistema';
}

function truncateForPreview(text: string, max = PREVIEW_TRUNCATE): string {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function buildRowFromMessages(
  contact: { phone: string; name: string; email: string; dni: string },
  msgs: MessageRow[],
  outsideHoursMessage: string,
): ContactCommunicationRow {
  const first1 = msgs.find((m) => Number(m.rn_asc) === 1);
  const first2 = msgs.find((m) => Number(m.rn_asc) === 2);
  const lastAbs = msgs.find((m) => Number(m.rn_desc) === 1);
  const lastInbound = msgs.find(
    (m) => m.direction === 'inbound' && Number(m.rn_dir) === 1,
  );
  const lastOutbound = msgs.find(
    (m) => m.direction === 'outbound' && Number(m.rn_dir) === 1,
  );

  const message1 = messageText(first1);
  const message2 = messageText(first2);
  const lastClientMessage = messageText(lastInbound);
  const lastTeamMessage = messageText(lastOutbound);
  const lastTeamBy = classifyAuthor(lastOutbound, outsideHoursMessage);

  return {
    phone: contact.phone,
    name: contact.name,
    email: contact.email,
    dni: contact.dni,
    first_communication_at: first1?.created_at?.toISOString() ?? null,
    first_communication_display: first1
      ? formatExportDate(first1.created_at) || '—'
      : '—',
    initiated_by: classifyInitiator(first1),
    message1,
    message2,
    message1_preview: truncateForPreview(message1),
    message2_preview: truncateForPreview(message2),
    last_communication_at: lastAbs?.created_at?.toISOString() ?? null,
    last_communication_display: lastAbs
      ? formatExportDate(lastAbs.created_at) || '—'
      : '—',
    last_communication_by: classifyAuthor(lastAbs, outsideHoursMessage),
    last_client_message: lastClientMessage,
    last_team_message: lastTeamMessage,
    last_team_message_by: lastTeamBy,
    last_client_message_preview: truncateForPreview(lastClientMessage),
    last_team_message_preview: lastTeamMessage
      ? `[${lastTeamBy}] ${truncateForPreview(lastTeamMessage)}`
      : '—',
  };
}

async function loadOutsideHoursMessage(
  prisma: { app_settings: { findUnique: (args: unknown) => Promise<{ value: string } | null> } },
  area: string,
): Promise<string> {
  const row = await prisma.app_settings.findUnique({
    where: { area_key: { area, key: 'business_hours' } },
    select: { value: true },
  });
  const cfg = parseBusinessHoursConfig(row?.value);
  return String(cfg?.outside_hours_message || '').trim();
}

async function fetchContactIdsForReport(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  area: string,
  opts: { limit?: number; offset?: number },
): Promise<{
  total: number;
  contacts: {
    id: number;
    name: string;
    phone: string;
    email: string;
    dni: string;
    conversation_id: number;
  }[];
}> {
  const countRows = await prisma.$queryRaw<{ c: number }[]>(Prisma.sql`
    SELECT COUNT(*)::int AS c
    FROM contacts c
    INNER JOIN conversations conv ON conv.area = c.area AND conv.phone = c.phone
    WHERE c.area = ${area}
      AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = conv.id)
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
      phone: string;
      email: string;
      dni: string;
      conversation_id: number;
    }[]
  >(Prisma.sql`
    SELECT
      c.id,
      c.name,
      c.phone,
      COALESCE(c.email, '') AS email,
      COALESCE(c.dni, '') AS dni,
      conv.id AS conversation_id
    FROM contacts c
    INNER JOIN conversations conv ON conv.area = c.area AND conv.phone = c.phone
    WHERE c.area = ${area}
      AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = conv.id)
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
        ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at ASC, m.id ASC) AS rn_asc,
        ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at DESC, m.id DESC) AS rn_desc,
        ROW_NUMBER() OVER (PARTITION BY m.conversation_id, m.direction ORDER BY m.created_at DESC, m.id DESC) AS rn_dir
      FROM chat_messages m
      WHERE m.conversation_id = ANY(${conversationIds}::int[])
    )
    SELECT conversation_id, direction, body_text, message_type, is_ai, raw_payload, created_at, id, rn_asc, rn_desc, rn_dir
    FROM ranked
    WHERE rn_asc <= 2 OR rn_desc = 1 OR rn_dir = 1
  `);

  const byConv = new Map<number, MessageRow[]>();
  for (const m of rows) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id)!.push(m);
  }
  return byConv;
}

export async function fetchContactCommunicationReport(
  prisma: {
    app_settings: { findUnique: (args: unknown) => Promise<{ value: string } | null> };
    $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
  },
  area: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ total: number; rows: ContactCommunicationRow[] }> {
  const outsideHoursMessage = await loadOutsideHoursMessage(prisma, area);
  const { total, contacts } = await fetchContactIdsForReport(prisma, area, opts);
  const convIds = contacts.map((c) => c.conversation_id);
  const byConv = await fetchMessagesForConversations(prisma, convIds);

  const rows = contacts.map((contact) =>
    buildRowFromMessages(
      contact,
      byConv.get(contact.conversation_id) || [],
      outsideHoursMessage,
    ),
  );

  return { total, rows };
}

export function reportRowToExportCells(row: ContactCommunicationRow): string[] {
  return [
    row.phone,
    row.name,
    row.email,
    row.dni,
    row.first_communication_display,
    row.initiated_by,
    row.message1,
    row.message2,
    row.last_communication_display,
    row.last_communication_by,
    row.last_client_message,
    row.last_team_message,
    row.last_team_message_by,
  ];
}
