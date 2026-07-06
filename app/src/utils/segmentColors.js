/** Claves de color por segmento (UI conversaciones / panel). */
const SEGMENT_COLOR_KEYS = [
  'teal',
  'emerald',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'fuchsia',
  'rose',
  'pink',
  'red',
  'orange',
  'amber',
  'lime',
  'slate',
];

function normalizeSegmentColorKey(raw) {
  const s = String(raw || '')
    .trim()
    .toLowerCase();
  return SEGMENT_COLOR_KEYS.includes(s) ? s : 'teal';
}

module.exports = { SEGMENT_COLOR_KEYS, normalizeSegmentColorKey };
