/** Claves de color por segmento (UI conversaciones / panel). */
const SEGMENT_COLOR_KEYS = ['teal', 'blue', 'violet', 'amber', 'rose', 'slate', 'emerald'];

function normalizeSegmentColorKey(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  return SEGMENT_COLOR_KEYS.includes(s) ? s : 'teal';
}

module.exports = { SEGMENT_COLOR_KEYS, normalizeSegmentColorKey };
