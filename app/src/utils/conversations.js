const config = require('../config');

function isWithinUserServiceWindow(lastUserMessageAt) {
  if (!lastUserMessageAt) return false;
  const t = new Date(lastUserMessageAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= config.SESSION_WINDOW_MS;
}

module.exports = { isWithinUserServiceWindow };
