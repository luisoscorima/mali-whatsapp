const { parseBusinessHoursConfig } = require('../utils/businessHours');
const { formatExportDate } = require('../utils/datetimeDisplay');

const PREVIEW_TRUNCATE = 120;

function parseRawPayload(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function messageText(msg) {
  return String(msg?.body_text || '').trim();
}

function classifyAuthor(msg, outsideHoursMessage) {
  if (!msg) return '';
  if (msg.direction === 'inbound') return 'Cliente';
  if (msg.is_ai) return 'IA';
  const raw = parseRawPayload(msg.raw_payload);
  if (msg.message_type === 'campaign' || raw?.source === 'campaign_send') return 'Sistema';
  if (raw?.source === 'outside_hours') return 'Sistema';
  const text = messageText(msg);
  if (outsideHoursMessage && text && text === outsideHoursMessage) return 'Sistema';
  return 'Agente';
}

function classifyInitiator(firstMsg) {
  if (!firstMsg) return '';
  if (firstMsg.direction === 'inbound') return 'Cliente';
  return 'Sistema';
}

function truncateForPreview(text, max = PREVIEW_TRUNCATE) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

async function loadOutsideHoursMessage(query, area) {
  const r = await query(`SELECT value FROM app_settings WHERE area = $1 AND key = 'business_hours'`, [area]);
  const cfg = parseBusinessHoursConfig(r.rows[0]?.value);
  return String(cfg?.outside_hours_message || '').trim();
}

function buildRowFromMessages(contact, msgs, outsideHoursMessage) {
  const first1 = msgs.find((m) => Number(m.rn_asc) === 1);
  const first2 = msgs.find((m) => Number(m.rn_asc) === 2);
  const lastAbs = msgs.find((m) => Number(m.rn_desc) === 1);
  const lastInbound = msgs.find((m) => m.direction === 'inbound' && Number(m.rn_dir) === 1);
  const lastOutbound = msgs.find((m) => m.direction === 'outbound' && Number(m.rn_dir) === 1);

  const message1 = messageText(first1);
  const message2 = messageText(first2);
  const lastClientMessage = messageText(lastInbound);
  const lastTeamMessage = messageText(lastOutbound);
  const lastTeamBy = classifyAuthor(lastOutbound, outsideHoursMessage);

  return {
    phone: contact.phone,
    name: contact.name,
    firstCommunicationAt: first1?.created_at || null,
    firstCommunicationDisplay: first1 ? formatExportDate(first1.created_at) || '—' : '—',
    initiatedBy: classifyInitiator(first1),
    message1,
    message2,
    message1Preview: truncateForPreview(message1),
    message2Preview: truncateForPreview(message2),
    lastCommunicationAt: lastAbs?.created_at || null,
    lastCommunicationDisplay: lastAbs ? formatExportDate(lastAbs.created_at) || '—' : '—',
    lastCommunicationBy: classifyAuthor(lastAbs, outsideHoursMessage),
    lastClientMessage,
    lastTeamMessage,
    lastTeamMessageBy: lastTeamBy,
    lastClientMessagePreview: truncateForPreview(lastClientMessage),
    lastTeamMessagePreview: lastTeamMessage
      ? `[${lastTeamBy}] ${truncateForPreview(lastTeamMessage)}`
      : '—',
  };
}

async function fetchContactIdsForReport(query, area, { limit, offset }) {
  const countR = await query(
    `SELECT COUNT(*)::int AS c
     FROM contacts c
     INNER JOIN conversations conv ON conv.area = c.area AND conv.phone = c.phone
     WHERE c.area = $1
       AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = conv.id)`,
    [area]
  );
  const total = Number(countR.rows[0]?.c || 0);

  const params = [area];
  let limitSql = '';
  if (limit != null) {
    params.push(limit);
    limitSql += ` LIMIT $${params.length}`;
  }
  if (offset != null) {
    params.push(offset);
    limitSql += ` OFFSET $${params.length}`;
  }

  const contactsR = await query(
    `SELECT c.id, c.name, c.phone, conv.id AS conversation_id
     FROM contacts c
     INNER JOIN conversations conv ON conv.area = c.area AND conv.phone = c.phone
     WHERE c.area = $1
       AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.conversation_id = conv.id)
     ORDER BY COALESCE(NULLIF(c.name, ''), c.phone) ASC, c.id ASC
     ${limitSql}`,
    params
  );

  return { total, contacts: contactsR.rows };
}

async function fetchMessagesForConversations(query, conversationIds) {
  if (!conversationIds.length) return new Map();
  const msgR = await query(
    `WITH ranked AS (
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
       WHERE m.conversation_id = ANY($1::int[])
     )
     SELECT conversation_id, direction, body_text, message_type, is_ai, raw_payload, created_at, id, rn_asc, rn_desc, rn_dir
     FROM ranked
     WHERE rn_asc <= 2 OR rn_desc = 1 OR rn_dir = 1`,
    [conversationIds]
  );

  const byConv = new Map();
  for (const m of msgR.rows) {
    if (!byConv.has(m.conversation_id)) byConv.set(m.conversation_id, []);
    byConv.get(m.conversation_id).push(m);
  }
  return byConv;
}

async function fetchContactCommunicationReport(query, area, opts = {}) {
  const { limit, offset } = opts;
  const outsideHoursMessage = await loadOutsideHoursMessage(query, area);
  const { total, contacts } = await fetchContactIdsForReport(query, area, { limit, offset });
  const convIds = contacts.map((c) => c.conversation_id);
  const byConv = await fetchMessagesForConversations(query, convIds);

  const rows = contacts.map((contact) =>
    buildRowFromMessages(contact, byConv.get(contact.conversation_id) || [], outsideHoursMessage)
  );

  return { total, rows, outsideHoursMessage };
}

const REPORT_HEADERS = [
  'Número',
  'Nombre',
  'Fecha primera comunicación',
  'Iniciada por',
  'Mensaje 1 (inicio)',
  'Mensaje 2 (inicio)',
  'Fecha última comunicación',
  'Última comunicación por',
  'Último mensaje cliente',
  'Último mensaje equipo',
  'Tipo último mensaje equipo',
];

function reportRowToExportCells(row) {
  return [
    row.phone,
    row.name,
    row.firstCommunicationDisplay,
    row.initiatedBy,
    row.message1,
    row.message2,
    row.lastCommunicationDisplay,
    row.lastCommunicationBy,
    row.lastClientMessage,
    row.lastTeamMessage,
    row.lastTeamMessageBy,
  ];
}

module.exports = {
  PREVIEW_TRUNCATE,
  fetchContactCommunicationReport,
  reportRowToExportCells,
  REPORT_HEADERS,
};
