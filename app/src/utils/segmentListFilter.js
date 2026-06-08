/**
 * Filtro de listas por uno o varios segmentos (unión OR), alineado con campañas.
 */

const NONE_TOKEN = '__none__';

function parseSegmentListFilter(reqQuery, slugSet) {
  const raw = reqQuery && reqQuery.segment;
  const parts = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const t = String(item || '').trim();
      if (t) parts.push(t);
    }
  } else {
    const t = String(raw ?? '').trim();
    if (t) parts.push(t);
  }
  const slugs = [];
  const seen = new Set();
  let includeNone = false;
  for (const p of parts) {
    if (p === NONE_TOKEN) {
      includeNone = true;
    } else if (slugSet && slugSet.has(p) && !seen.has(p)) {
      seen.add(p);
      slugs.push(p);
    }
  }
  return { slugs, includeNone };
}

function hasActiveSegmentFilter(filter) {
  if (!filter) return false;
  return Boolean(filter.includeNone) || (Array.isArray(filter.slugs) && filter.slugs.length > 0);
}

function appendSegmentFilterToSearchParams(sp, filter) {
  if (!filter) return;
  if (filter.includeNone) sp.append('segment', NONE_TOKEN);
  for (const slug of filter.slugs || []) {
    sp.append('segment', slug);
  }
}

function segmentFilterFromBodyField(raw) {
  const parts = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const t = String(item || '').trim();
      if (t) parts.push(t);
    }
  } else {
    const t = String(raw ?? '').trim();
    if (t) parts.push(t);
  }
  const slugs = [];
  let includeNone = false;
  for (const p of parts) {
    if (p === NONE_TOKEN) includeNone = true;
    else slugs.push(p);
  }
  return { slugs, includeNone };
}

/**
 * @param {{ slugs: string[], includeNone: boolean }} filter
 * @param {string} contactIdSql - ej. `ct.id` o `c.id`
 * @param {number} paramIndex
 * @returns {{ sql: string, params: unknown[], nextIndex: number }}
 */
function buildContactSegmentUnionSql(filter, contactIdSql, paramIndex) {
  const clauses = [];
  const params = [];
  let p = paramIndex;
  if (filter.slugs && filter.slugs.length > 0) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM contact_segments csf
        WHERE csf.contact_id = ${contactIdSql} AND csf.segment_slug = ANY($${p}::varchar[])
      )`
    );
    params.push(filter.slugs);
    p += 1;
  }
  if (filter.includeNone) {
    clauses.push(
      `NOT EXISTS (
        SELECT 1 FROM contact_segments csn
        WHERE csn.contact_id = ${contactIdSql}
      )`
    );
  }
  if (!clauses.length) {
    return { sql: '', params: [], nextIndex: paramIndex };
  }
  return { sql: ` AND (${clauses.join(' OR ')})`, params, nextIndex: p };
}

/**
 * Conversaciones: slugs por contacto vinculado; "sin segmento" = sin contacto en la conversación.
 */
function buildConversationSegmentUnionSql(filter, contactIdSql, conversationContactIdSql, paramIndex) {
  const clauses = [];
  const params = [];
  let p = paramIndex;
  if (filter.slugs && filter.slugs.length > 0) {
    clauses.push(
      `EXISTS (
        SELECT 1 FROM contact_segments cseg
        WHERE cseg.contact_id = ${contactIdSql} AND cseg.segment_slug = ANY($${p}::varchar[])
      )`
    );
    params.push(filter.slugs);
    p += 1;
  }
  if (filter.includeNone) {
    clauses.push(`${conversationContactIdSql} IS NULL`);
  }
  if (!clauses.length) {
    return { sql: '', params: [], nextIndex: paramIndex };
  }
  return { sql: ` AND (${clauses.join(' OR ')})`, params, nextIndex: p };
}

module.exports = {
  NONE_TOKEN,
  parseSegmentListFilter,
  hasActiveSegmentFilter,
  appendSegmentFilterToSearchParams,
  segmentFilterFromBodyField,
  buildContactSegmentUnionSql,
  buildConversationSegmentUnionSql,
};
