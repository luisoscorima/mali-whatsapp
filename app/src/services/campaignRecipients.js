/**
 * Destinatarios de campaña por unión de segmentos (contacto en cualquiera de los slugs).
 */

/**
 * @param {*} query - función query del pool
 * @param {string} area
 * @param {string[]} segmentSlugs - sin vacíos, validados contra segment_definitions
 * @param {{ contactIds?: number[] }} [options]
 */
async function fetchRecipientsUnion(query, area, segmentSlugs, options = {}) {
  const { contactIds } = options;
  const params = [area, segmentSlugs];
  let sql = `
    SELECT DISTINCT c.id, c.name, c.phone
    FROM contacts c
    INNER JOIN contact_segments cs ON cs.contact_id = c.id AND cs.area = c.area
    WHERE c.area = $1
      AND c.opt_in = TRUE
      AND c.active = TRUE
      AND c.replacement_reason IS NULL
      AND c.replaced_by_contact_id IS NULL
      AND cs.segment_slug = ANY($2::varchar[])
  `;
  if (contactIds != null && contactIds.length > 0) {
    sql += ` AND c.id = ANY($3::int[])`;
    params.push(contactIds);
  }
  sql += ` ORDER BY c.id ASC`;
  const r = await query(sql, params);
  return r.rows;
}

/**
 * @param {*} query
 * @param {string} area
 * @param {string[]} segmentSlugs
 */
async function countRecipientsUnion(query, area, segmentSlugs) {
  const r = await query(
    `SELECT COUNT(DISTINCT c.id)::int AS n
     FROM contacts c
     INNER JOIN contact_segments cs ON cs.contact_id = c.id AND cs.area = c.area
     WHERE c.area = $1
       AND c.opt_in = TRUE
       AND c.active = TRUE
       AND c.replacement_reason IS NULL
       AND c.replaced_by_contact_id IS NULL
       AND cs.segment_slug = ANY($2::varchar[])`,
    [area, segmentSlugs]
  );
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
};
