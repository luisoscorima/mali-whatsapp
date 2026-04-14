const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const config = require('../config');

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

function normalizeMime(mimeType) {
  return String(mimeType || '')
    .split(';')[0]
    .trim();
}

/** URL pública del objeto (el bucket debe permitir lectura pública o usar CloudFront). */
function publicS3ObjectUrl(bucket, region, key) {
  const pathPart = key.split('/').map(encodeURIComponent).join('/');
  return `https://${bucket}.s3.${region}.amazonaws.com/${pathPart}`;
}

let s3ClientSingleton = null;
function getS3Client() {
  if (s3ClientSingleton) return s3ClientSingleton;
  const { accessKeyId, secretAccessKey, region } = config.s3ChatMedia;
  s3ClientSingleton = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3ClientSingleton;
}

async function saveChatMediaToS3({ buffer, conversationId, mimeType, direction }) {
  const { bucket, folder, region } = config.s3ChatMedia;
  const ext = extFromMime(mimeType);
  const prefix = direction === 'inbound' ? 'i' : 'c';
  const fileName = `${prefix}${conversationId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const key = `${folder.replace(/\/$/, '')}/chat-media/${fileName}`;
  const mime = normalizeMime(mimeType) || 'application/octet-stream';

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mime,
      CacheControl: 'public, max-age=31536000',
    })
  );

  return {
    url: publicS3ObjectUrl(bucket, region, key),
    mime,
  };
}

/**
 * Guarda binario para el hilo del panel (entrante o saliente).
 * Con credenciales S3 + bucket: sube a S3 y devuelve URL https.
 * Si no hay S3 configurado: disco local bajo public/uploads/chat-media (dev).
 * Prefijo `c` = outbound, `i` = inbound.
 */
async function saveChatMediaFromBuffer({ buffer, conversationId, mimeType, direction }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Buffer vacío');
  }

  if (config.isS3ChatMediaConfigured()) {
    return saveChatMediaToS3({ buffer, conversationId, mimeType, direction });
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
    mime: normalizeMime(mimeType),
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
