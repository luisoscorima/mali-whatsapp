const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const UPLOAD_SUBDIR = 'uploads/chat-media';

function extFromMime(mimeType) {
  const m = String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const map = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'application/pdf': '.pdf',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/ogg': '.ogg',
    'application/ogg': '.ogg',
    'audio/aac': '.aac',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/m4a': '.m4a',
  };
  return map[m] || '.bin';
}

/**
 * Guarda binario en disco para el hilo del panel (entrante o saliente).
 * Prefijo `c` = outbound, `i` = inbound.
 */
async function saveChatMediaFromBuffer({ buffer, conversationId, mimeType, direction }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Buffer vacío');
  }
  const publicDir = path.join(__dirname, '..', '..', 'public', UPLOAD_SUBDIR);
  await fs.mkdir(publicDir, { recursive: true });
  const ext = extFromMime(mimeType);
  const prefix = direction === 'inbound' ? 'i' : 'c';
  const name = `${prefix}${conversationId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const absPath = path.join(publicDir, name);
  await fs.writeFile(absPath, buffer);
  const url = `/${UPLOAD_SUBDIR}/${name}`.replace(/\\/g, '/');
  return {
    url,
    mime: String(mimeType || '')
      .split(';')[0]
      .trim(),
  };
}

async function saveOutboundChatMediaFile({ buffer, conversationId, mimeType }) {
  return saveChatMediaFromBuffer({ buffer, conversationId, mimeType, direction: 'outbound' });
}

async function saveInboundChatMediaFromBuffer({ buffer, conversationId, mimeType }) {
  return saveChatMediaFromBuffer({ buffer, conversationId, mimeType, direction: 'inbound' });
}

module.exports = {
  saveChatMediaFromBuffer,
  saveOutboundChatMediaFile,
  saveInboundChatMediaFromBuffer,
  UPLOAD_SUBDIR,
};
