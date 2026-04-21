/**
 * Membresía contacto ↔ segmentos (tabla puente contact_segments).
 */

function parseSegmentListFromBody(body) {
  const raw = body?.segments;
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((s) => String(s || '').trim()).filter(Boolean))];
  }
  if (raw != null && raw !== '') {
    return [String(raw).trim()].filter(Boolean);
  }
  const legacy = String(body?.segment || '').trim();
  if (!legacy) return [];
  if (legacy.includes(';')) {
    return [...new Set(legacy.split(';').map((s) => s.trim()).filter(Boolean))];
  }
  return [legacy];
}

function parseSegmentListFromImportCell(cell) {
  const s = String(cell ?? '').trim();
  if (!s) return [];
  return [...new Set(s.split(/[;,]/).map((x) => x.trim()).filter(Boolean))];
}

/**
 * @param {string[]} slugs
 * @param {Set<string>} segmentSet
 * @param {{ min?: number, max?: number }} opts
 */
function validateSegmentMembership(slugs, segmentSet, opts = {}) {
  const min = opts.min ?? 0;
  const max = opts.max ?? 50;
  const uniq = [...new Set(slugs.map((x) => String(x || '').trim()).filter(Boolean))];
  if (uniq.length < min) {
    return { ok: false, message: min === 0 ? 'Segmentos invalidos' : 'Selecciona al menos un segmento' };
  }
  if (uniq.length > max) {
    return { ok: false, message: `Como maximo ${max} segmentos` };
  }
  for (const slug of uniq) {
    if (!segmentSet.has(slug)) {
      return { ok: false, message: `Segmento invalido: ${slug}` };
    }
  }
  return { ok: true, value: uniq };
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

module.exports = {
  parseSegmentListFromBody,
  parseSegmentListFromImportCell,
  validateSegmentMembership,
  replaceContactSegments,
  appendContactSegments,
};
