function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Convierte marcado simple de WhatsApp (*negrita*, _cursiva_, ~tachado~) a HTML seguro.
 */
function formatWhatsAppHtml(text) {
  let s = escapeHtml(text);
  s = s.replace(/\n/g, '<br />');
  s = s.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  s = s.replace(/~([^~\n]+)~/g, '<s>$1</s>');
  return s;
}

module.exports = { escapeHtml, formatWhatsAppHtml };
