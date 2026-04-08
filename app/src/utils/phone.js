function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

module.exports = { normalizePhone };
