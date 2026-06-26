/**
 * Destinatarios de campaña por unión de segmentos (contacto en cualquiera de los slugs).
 * Soporta filtro por IDs incluidos y exclusiones por IDs o segmentos negados.
 */

const config = require('../config');

const CONVERSATION_JOIN = `
  LEFT JOIN conversations conv ON conv.area = c.area AND conv.contact_id = c.id
`;

/**
 * @param {string} sql
 * @param {unknown[]} params
 * @param {number} paramIdx
 * @param {{ contactIds?: number[], excludeContactIds?: number[], excludeSegmentSlugs?: string[], excludeOpenServiceWindow?: boolean }} options
 * @returns {{ sql: string, params: unknown[], nextIdx: number }}
 */
function appendRecipientFilters(sql, params, paramIdx, options) {
  const { contactIds, excludeContactIds, excludeSegmentSlugs, excludeOpenServiceWindow } = options;
  let nextIdx = paramIdx;

  if (contactIds != null && contactIds.length > 0) {
    sql += ` AND c.id = ANY($${nextIdx}::int[])`;
    params.push(contactIds);
    nextIdx += 1;
  }

  if (excludeContactIds != null && excludeContactIds.length > 0) {
    sql += ` AND NOT (c.id = ANY($${nextIdx}::int[]))`;
    params.push(excludeContactIds);
    nextIdx += 1;
  }

  if (excludeSegmentSlugs != null && excludeSegmentSlugs.length > 0) {
    sql += `
      AND NOT EXISTS (
        SELECT 1 FROM contact_segments cs_ex
        WHERE cs_ex.contact_id = c.id
          AND cs_ex.area = c.area
          AND cs_ex.segment_slug = ANY($${nextIdx}::varchar[])
      )`;
    params.push(excludeSegmentSlugs);
    nextIdx += 1;
  }

  if (excludeOpenServiceWindow) {
    sql += `
      AND (
        conv.last_user_message_at IS NULL
        OR conv.last_user_message_at < NOW() - ($${nextIdx}::bigint * INTERVAL '1 millisecond')
      )`;
    params.push(config.SESSION_WINDOW_MS);
    nextIdx += 1;
  }

  return { sql, params, nextIdx };
}

const RECIPIENT_BASE_WHERE = `
  WHERE c.area = $1
    AND c.opt_in = TRUE
    AND c.active = TRUE
    AND c.replacement_reason IS NULL
    AND c.replaced_by_contact_id IS NULL
    AND cs.segment_slug = ANY($2::varchar[])
`;

/**
 * @param {*} query - función query del pool
 * @param {string} area
 * @param {string[]} segmentSlugs - sin vacíos, validados contra segment_definitions
 * @param {{ contactIds?: number[], excludeContactIds?: number[], excludeSegmentSlugs?: string[], excludeOpenServiceWindow?: boolean }} [options]
 */
async function fetchRecipientsUnion(query, area, segmentSlugs, options = {}) {
  const params = [area, segmentSlugs];
  let sql = `
    SELECT DISTINCT c.id, c.name, c.phone, conv.last_user_message_at
    FROM contacts c
    INNER JOIN contact_segments cs ON cs.contact_id = c.id AND cs.area = c.area
    ${CONVERSATION_JOIN}
    ${RECIPIENT_BASE_WHERE}
  `;
  const filtered = appendRecipientFilters(sql, params, 3, options);
  sql = filtered.sql + ` ORDER BY c.id ASC`;
  const r = await query(sql, filtered.params);
  return r.rows;
}

/**
 * @param {*} query
 * @param {string} area
 * @param {string[]} segmentSlugs
 * @param {{ contactIds?: number[], excludeContactIds?: number[], excludeSegmentSlugs?: string[], excludeOpenServiceWindow?: boolean }} [options]
 */
async function countRecipientsUnion(query, area, segmentSlugs, options = {}) {
  const params = [area, segmentSlugs];
  let sql = `
    SELECT COUNT(DISTINCT c.id)::int AS n
    FROM contacts c
    INNER JOIN contact_segments cs ON cs.contact_id = c.id AND cs.area = c.area
    ${CONVERSATION_JOIN}
    ${RECIPIENT_BASE_WHERE}
  `;
  const filtered = appendRecipientFilters(sql, params, 3, options);
  const r = await query(filtered.sql, filtered.params);
  return r.rows[0]?.n ?? 0;
}

/**
 * @param {{ id: number }[]} rows
 * @param {number[]} requestedUniqueSortedIds
 */
function validateRecipientsMatchRequest(rows, requestedUniqueSortedIds) {
  if (rows.length !== requestedUniqueSortedIds.length) {
    return false;
  }
  const found = new Set(rows.map((r) => r.id));
  for (const id of requestedUniqueSortedIds) {
    if (!found.has(id)) {
      return false;
    }
  }
  return true;
}

module.exports = {
  fetchRecipientsUnion,
  countRecipientsUnion,
  validateRecipientsMatchRequest,
  appendRecipientFilters,
};
