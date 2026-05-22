const { ALLOWED_ATTR_KEYS } = require('./contactAttributes');

const FIELD_TYPES = new Set(['text', 'number', 'date']);

function normalizeAttrSlug(raw) {
  return String(raw || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 64);
}

function normalizeFieldType(raw) {
  const t = String(raw || 'text').trim().toLowerCase();
  return FIELD_TYPES.has(t) ? t : 'text';
}

async function loadAttributeDefinitionsForArea(query, area) {
  const r = await query(
    `SELECT id, segment_slug, slug, label, field_type, sort_order, required, active
     FROM contact_attribute_definitions
     WHERE area = $1 AND active = TRUE
     ORDER BY segment_slug NULLS FIRST, sort_order ASC, slug ASC`,
    [area]
  );
  return r.rows;
}

async function loadAttributeDefinitionById(query, area, id) {
  const r = await query(
    `SELECT id, segment_slug, slug, label, field_type, sort_order, required, active
     FROM contact_attribute_definitions
     WHERE id = $1 AND area = $2`,
    [id, area]
  );
  return r.rows[0] || null;
}

/**
 * Atributos aplicables a un contacto: área + los de cada segmento asignado.
 * Si el mismo slug existe en área y segmento, gana el de segmento.
 */
async function getApplicableAttributeDefinitions(query, area, segmentSlugs) {
  const all = await loadAttributeDefinitionsForArea(query, area);
  const segSet = new Set(
    (segmentSlugs || []).map((s) => String(s || '').trim()).filter(Boolean)
  );
  const bySlug = new Map();
  for (const row of all) {
    if (!row.segment_slug) {
      bySlug.set(row.slug, row);
    }
  }
  for (const row of all) {
    if (row.segment_slug && segSet.has(row.segment_slug)) {
      bySlug.set(row.slug, row);
    }
  }
  return [...bySlug.values()].sort((a, b) => {
    const ao = Number(a.sort_order) || 0;
    const bo = Number(b.sort_order) || 0;
    if (ao !== bo) return ao - bo;
    return String(a.label).localeCompare(String(b.label));
  });
}

async function loadAttributeFilterOptions(query, area) {
  const r = await query(
    `SELECT DISTINCT slug, label, segment_slug
     FROM contact_attribute_definitions
     WHERE area = $1 AND active = TRUE
     ORDER BY segment_slug NULLS FIRST, slug ASC`,
    [area]
  );
  return r.rows;
}

function parseAttributesFromBodyForDefinitions(body, definitions) {
  const allowed = new Set((definitions || []).map((d) => d.slug));
  const out = {};
  for (const [key, value] of Object.entries(body || {})) {
    if (!key.startsWith('attr_')) continue;
    const slug = key.slice(5);
    if (!ALLOWED_ATTR_KEYS.test(slug)) continue;
    if (allowed.size > 0 && !allowed.has(slug)) continue;
    out[slug] = value;
  }
  return out;
}

async function saveContactAttributesFromRequest(query, area, contactId, segmentSlugs, body) {
  const { upsertContactAttributes } = require('./contactAttributes');
  const defs = await getApplicableAttributeDefinitions(query, area, segmentSlugs);
  const attrs = parseAttributesFromBodyForDefinitions(body, defs);
  await upsertContactAttributes(query, contactId, attrs);
}

module.exports = {
  FIELD_TYPES,
  normalizeAttrSlug,
  normalizeFieldType,
  loadAttributeDefinitionsForArea,
  loadAttributeDefinitionById,
  getApplicableAttributeDefinitions,
  loadAttributeFilterOptions,
  parseAttributesFromBodyForDefinitions,
  saveContactAttributesFromRequest,
};
