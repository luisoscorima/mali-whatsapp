const XLSX = require('xlsx');
const config = require('../config');
const { sqlContactSegmentLabels } = require('./campaignExportContactMeta');
const { safeFilenamePart } = require('./conversationExport');
const { exportFilenameDateStamp } = require('./datetimeDisplay');

const BASE_HEADERS = ['Nombre', 'Teléfono', 'Segmentos'];

async function loadSegmentContactsForExport(query, area, segmentSlug) {
  const r = await query(
    `SELECT
       c.id,
       c.name,
       c.phone,
       ${sqlContactSegmentLabels('c.id', '$1')} AS segment_labels
     FROM contacts c
     WHERE c.area = $1
       AND c.replacement_reason IS NULL
       AND c.replaced_by_contact_id IS NULL
       AND EXISTS (
         SELECT 1
         FROM contact_segments csf
         WHERE csf.contact_id = c.id
           AND csf.area = c.area
           AND csf.segment_slug = $2
       )
     ORDER BY COALESCE(NULLIF(c.name, ''), c.phone) ASC, c.id DESC
     LIMIT $3`,
    [area, segmentSlug, config.MAX_CSV_ROWS + 1]
  );
  return r.rows;
}

async function loadContactAttributesBatch(query, contactIds) {
  if (!contactIds.length) return new Map();
  const r = await query(
    `SELECT contact_id, attr_key, attr_value
     FROM contact_attributes
     WHERE contact_id = ANY($1::int[])
     ORDER BY contact_id, attr_key`,
    [contactIds]
  );
  const map = new Map();
  for (const row of r.rows) {
    if (!map.has(row.contact_id)) map.set(row.contact_id, {});
    map.get(row.contact_id)[row.attr_key] = row.attr_value;
  }
  return map;
}

function collectAttributeKeys(attrMap, contactIds) {
  const keys = new Set();
  for (const id of contactIds) {
    const attrs = attrMap.get(id);
    if (!attrs) continue;
    for (const k of Object.keys(attrs)) keys.add(k);
  }
  return [...keys].sort();
}

function buildSegmentContactsExportBuffer(contacts, attrMap, { includeAttributes = true } = {}) {
  const contactIds = contacts.map((c) => c.id);
  const attrKeys = includeAttributes ? collectAttributeKeys(attrMap, contactIds) : [];
  const headers = [...BASE_HEADERS, ...attrKeys];
  const aoa = [
    headers,
    ...contacts.map((c) => {
      const row = [String(c.name || ''), String(c.phone || ''), String(c.segment_labels || '')];
      if (includeAttributes) {
        const attrs = attrMap.get(c.id) || {};
        for (const k of attrKeys) row.push(String(attrs[k] ?? ''));
      }
      return row;
    }),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 36 }, ...attrKeys.map(() => ({ wch: 20 }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contactos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function segmentExportFilename(slug) {
  const stamp = exportFilenameDateStamp();
  return `segmento-${safeFilenamePart(slug)}-${stamp}.xlsx`;
}

module.exports = {
  loadSegmentContactsForExport,
  loadContactAttributesBatch,
  buildSegmentContactsExportBuffer,
  segmentExportFilename,
};
