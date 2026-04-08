const crypto = require('crypto');
const config = require('../config');

function verifyWebhookSignature(req) {
  const appSecret = process.env.APP_SECRET;
  const signature = req.get('x-hub-signature-256');

  if (config.requireWebhookSignature && !appSecret) {
    return false;
  }

  if (!appSecret) {
    return true;
  }

  if (!signature) {
    return !config.requireWebhookSignature;
  }

  const [prefix, signatureHash] = signature.split('=');
  if (prefix !== 'sha256' || !signatureHash) {
    return false;
  }

  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHash), Buffer.from(expectedHash));
  } catch {
    return false;
  }
}

module.exports = { verifyWebhookSignature };
