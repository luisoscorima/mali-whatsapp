/**
 * Listas de exclusión reutilizables por área.
 */

async function loadExclusionLists(query, area) {
  const r = await query(
    `SELECT el.id, el.name, el.created_at,
            COUNT(elm.contact_id)::int AS member_count
     FROM exclusion_lists el
     LEFT JOIN exclusion_list_members elm ON elm.list_id = el.id
     WHERE el.area = $1
     GROUP BY el.id
     ORDER BY el.name ASC`,
    [area]
  );
  return r.rows;
}

async function resolveContactIdsFromExclusionLists(query, area, listIds) {
  if (!Array.isArray(listIds) || listIds.length === 0) return [];
  const ids = [...new Set(listIds.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return [];
  const r = await query(
    `SELECT DISTINCT elm.contact_id AS id
     FROM exclusion_list_members elm
     INNER JOIN exclusion_lists el ON el.id = elm.list_id AND el.area = $1
     WHERE elm.list_id = ANY($2::int[])`,
    [area, ids]
  );
  return r.rows.map((row) => row.id);
}

/**
 * Une IDs directos + miembros de listas de exclusión. Valida tope máximo.
 * @returns {{ ok: true, ids: number[] } | { ok: false, message: string }}
 */
async function mergeCampaignExcludeContactIds(
  query,
  area,
  { excludeContactIds = [], excludeListIds = [] },
  maxIds
) {
  const merged = [...(excludeContactIds || [])];
  if (Array.isArray(excludeListIds) && excludeListIds.length > 0) {
    const fromLists = await resolveContactIdsFromExclusionLists(query, area, excludeListIds);
    merged.push(...fromLists);
  }
  const ids = [...new Set(merged.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0))].sort(
    (a, b) => a - b
  );
  if (ids.length > maxIds) {
    return { ok: false, message: `Demasiados contactos a excluir (máximo ${maxIds})` };
  }
  return { ok: true, ids };
}

async function getExclusionListWithMembers(query, area, listId) {
  const listR = await query(
    `SELECT id, name, created_at FROM exclusion_lists WHERE id = $1 AND area = $2`,
    [listId, area]
  );
  if (listR.rowCount === 0) return null;
  const membersR = await query(
    `SELECT c.id, c.name, c.phone
     FROM exclusion_list_members elm
     INNER JOIN contacts c ON c.id = elm.contact_id
     WHERE elm.list_id = $1
     ORDER BY c.name ASC`,
    [listId]
  );
  return { list: listR.rows[0], members: membersR.rows };
}

module.exports = {
  loadExclusionLists,
  resolveContactIdsFromExclusionLists,
  mergeCampaignExcludeContactIds,
  getExclusionListWithMembers,
};
