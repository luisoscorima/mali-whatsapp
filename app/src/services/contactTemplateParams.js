/**
 * Resuelve parámetros de plantilla por contacto (nombre, atributos custom).
 */

const ATTR_PREFIX = 'attr.';

async function fetchContactAttributesMap(query, contactIds) {
  if (!contactIds.length) return new Map();
  const r = await query(
    `SELECT contact_id, attr_key, attr_value FROM contact_attributes WHERE contact_id = ANY($1::int[])`,
    [contactIds]
  );
  const map = new Map();
  for (const row of r.rows) {
    if (!map.has(row.contact_id)) map.set(row.contact_id, {});
    map.get(row.contact_id)[row.attr_key] = String(row.attr_value ?? '');
  }
  return map;
}

function resolveFieldValue(source, contact, attrs) {
  const s = String(source || '').trim();
  if (!s || s === 'static') return null;
  if (s === 'contact.name') return String(contact.name || '').trim();
  if (s === 'contact.phone') return String(contact.phone || '').trim();
  if (s.startsWith(ATTR_PREFIX)) {
    const key = s.slice(ATTR_PREFIX.length);
    return String((attrs && attrs[key]) || '').trim();
  }
  return null;
}

/**
 * @param {object} staticParams - headerParams, bodyParams, buttonParams, headerMediaUrl
 * @param {object} paramMapping - mismas keys, valores 'static' | 'contact.name' | 'attr.x'
 */
function buildParamsForContact(staticParams, paramMapping, contact, attrs) {
  const out = {
    headerParams: [...(staticParams.headerParams || [])],
    bodyParams: [...(staticParams.bodyParams || [])],
    buttonParams: [...(staticParams.buttonParams || [])],
    headerMediaUrl: staticParams.headerMediaUrl,
  };
  if (!paramMapping) return out;

  function applyList(listKey) {
    const sources = paramMapping[listKey];
    if (!Array.isArray(sources)) return;
    const staticList = staticParams[listKey] || [];
    const resolved = [];
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const dynamic = resolveFieldValue(src, contact, attrs);
      if (dynamic !== null) {
        resolved.push(dynamic);
      } else {
        resolved.push(String(staticList[i] ?? '').trim());
      }
    }
    out[listKey] = resolved;
  }

  applyList('headerParams');
  applyList('bodyParams');
  applyList('buttonParams');
  return out;
}

function parseParamMappingFromBody(def, reqBody) {
  const mapping = { headerParams: [], bodyParams: [], buttonParams: [] };
  const add = (key, count, prefix) => {
    for (let i = 0; i < count; i++) {
      const field = `${prefix}_${i}`;
      const src = String(reqBody[field] || 'static').trim() || 'static';
      mapping[key].push(src);
    }
  };
  add('headerParams', def.headerTextSlotCount || 0, 'headerParamSource');
  add('bodyParams', def.bodySlotCount || 0, 'bodyParamSource');
  add('buttonParams', def.totalButtonParams || 0, 'buttonParamSource');
  const hasDynamic = [...mapping.headerParams, ...mapping.bodyParams, ...mapping.buttonParams].some(
    (s) => s && s !== 'static'
  );
  return hasDynamic ? mapping : null;
}

module.exports = {
  fetchContactAttributesMap,
  buildParamsForContact,
  parseParamMappingFromBody,
  resolveFieldValue,
};
