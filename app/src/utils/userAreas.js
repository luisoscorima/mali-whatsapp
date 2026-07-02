const config = require('../config');

function normalizeArea(area) {
  const a = String(area || '').trim().toLowerCase();
  if (config.BUSINESS_AREAS.includes(a)) return a;
  return 'ti';
}

function isValidBusinessArea(area) {
  const a = String(area || '').trim().toLowerCase();
  return config.BUSINESS_AREAS.includes(a);
}

function parseExtraAreasFromBody(body) {
  const raw = body?.allowed_areas;
  const list = Array.isArray(raw) ? raw : raw != null && String(raw).trim() !== '' ? [raw] : [];
  const set = new Set();
  for (const item of list) {
    const a = normalizeArea(item);
    if (isValidBusinessArea(a)) set.add(a);
  }
  return Array.from(set);
}

function mergeAllowedAreas(primaryArea, extraAreas) {
  const set = new Set();
  const primary = normalizeArea(primaryArea);
  if (isValidBusinessArea(primary)) set.add(primary);
  for (const item of extraAreas || []) {
    const a = normalizeArea(item);
    if (isValidBusinessArea(a)) set.add(a);
  }
  return Array.from(set);
}

async function fetchExtraAreasForUser(query, userId) {
  const r = await query(`SELECT area FROM user_areas WHERE user_id = $1 ORDER BY area ASC`, [userId]);
  return r.rows
    .map((row) => normalizeArea(row.area))
    .filter((a) => isValidBusinessArea(a));
}

async function fetchAllowedAreasForUser(query, { userId, primaryArea, isMaster }) {
  if (isMaster) return [...config.BUSINESS_AREAS];
  const extras = await fetchExtraAreasForUser(query, userId);
  return mergeAllowedAreas(primaryArea, extras);
}

async function replaceExtraAreasForUser(query, userId, primaryArea, extraAreas) {
  const primary = normalizeArea(primaryArea);
  const extras = (extraAreas || [])
    .map((a) => normalizeArea(a))
    .filter((a) => isValidBusinessArea(a) && a !== primary);
  await query(`DELETE FROM user_areas WHERE user_id = $1`, [userId]);
  for (const area of extras) {
    await query(
      `INSERT INTO user_areas (user_id, area) VALUES ($1, $2)
       ON CONFLICT (user_id, area) DO NOTHING`,
      [userId, area]
    );
  }
}

function resolveActiveArea(sessionArea, primaryArea, allowedAreas) {
  const primary = normalizeArea(primaryArea);
  const allowed = Array.isArray(allowedAreas) && allowedAreas.length > 0 ? allowedAreas : [primary];
  const candidate = normalizeArea(sessionArea);
  if (allowed.includes(candidate)) return candidate;
  return primary;
}

function canAccessArea(user, area) {
  if (!user) return false;
  if (user.isMaster) return isValidBusinessArea(area);
  const allowed = user.allowedAreas || [user.area];
  return allowed.includes(normalizeArea(area));
}

module.exports = {
  parseExtraAreasFromBody,
  mergeAllowedAreas,
  fetchExtraAreasForUser,
  fetchAllowedAreasForUser,
  replaceExtraAreasForUser,
  resolveActiveArea,
  canAccessArea,
};
