const ALLOWED_ATTR_KEYS = /^[a-z0-9_]{1,64}$/;

async function loadContactAttributes(query, contactId) {
  const r = await query(
    `SELECT attr_key, attr_value FROM contact_attributes WHERE contact_id = $1 ORDER BY attr_key`,
    [contactId]
  );
  const map = {};
  for (const row of r.rows) {
    map[row.attr_key] = row.attr_value;
  }
  return map;
}

async function upsertContactAttributes(query, contactId, attributes) {
  if (!attributes || typeof attributes !== 'object') return;
  for (const [key, value] of Object.entries(attributes)) {
    const k = String(key || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_');
    if (!ALLOWED_ATTR_KEYS.test(k)) continue;
    const v = String(value ?? '').trim().slice(0, 500);
    await query(
      `INSERT INTO contact_attributes (contact_id, attr_key, attr_value, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (contact_id, attr_key)
       DO UPDATE SET attr_value = EXCLUDED.attr_value, updated_at = NOW()`,
      [contactId, k, v]
    );
  }
}

async function deleteContactAttribute(query, contactId, attrKey) {
  await query(`DELETE FROM contact_attributes WHERE contact_id = $1 AND attr_key = $2`, [
    contactId,
    attrKey,
  ]);
}

module.exports = {
  loadContactAttributes,
  upsertContactAttributes,
  deleteContactAttribute,
  ALLOWED_ATTR_KEYS,
};
