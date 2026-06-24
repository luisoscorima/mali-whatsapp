/**
 * Membresía contacto ↔ segmentos (tabla puente contact_segments).
 */

function parseSegmentListFromImportCell(cell) {
  const s = String(cell ?? '').trim();
  if (!s) return [];
  return [...new Set(s.split(/[;,]/).map((x) => x.trim()).filter(Boolean))];
}

async function replaceContactSegments(query, contactId, area, slugs) {
  await query(`DELETE FROM contact_segments WHERE contact_id = $1`, [contactId]);
  if (!slugs.length) return;
  const placeholders = slugs.map((_, i) => `($1, $2, $${i + 3})`).join(', ');
  await query(
    `INSERT INTO contact_segments (contact_id, area, segment_slug) VALUES ${placeholders}`,
    [contactId, area, ...slugs]
  );
}

async function appendContactSegments(query, contactId, area, slugs) {
  if (!slugs.length) return;
  const placeholders = slugs.map((_, i) => `($1, $2, $${i + 3})`).join(', ');
  await query(
    `INSERT INTO contact_segments (contact_id, area, segment_slug) VALUES ${placeholders}
     ON CONFLICT (contact_id, segment_slug) DO NOTHING`,
    [contactId, area, ...slugs]
  );
}

async function removeContactSegment(query, contactId, area, slug) {
  await query(
    `DELETE FROM contact_segments
     WHERE contact_id = $1
       AND area = $2
       AND segment_slug = $3`,
    [contactId, area, slug]
  );
}

module.exports = {
  parseSegmentListFromImportCell,
  replaceContactSegments,
  appendContactSegments,
  removeContactSegment,
};
