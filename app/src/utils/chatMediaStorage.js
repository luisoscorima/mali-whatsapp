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

/** URL pública del objeto (lectura: política de bucket, ACL o CloudFront vía S3_PUBLIC_URL_BASE). */
function publicS3ObjectUrl(bucket, region, key) {
  const pathPart = key.split('/').map(encodeURIComponent).join('/');
  const base = String(config.s3ChatMedia.publicUrlBase || '').trim().replace(/\/$/, '');
  if (base) {
    return `${base}/${pathPart}`;
  }
  const r = String(region || 'us-east-1').toLowerCase();
  // Estilo virtual-hosted (regional). us-east-1 también responde en s3.amazonaws.com; regional evita confusiones.
  return `https://${bucket}.s3.${r}.amazonaws.com/${pathPart}`;
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
  const { bucket, folder, region, objectAcl } = config.s3ChatMedia;
  const ext = extFromMime(mimeType);
  const prefix = direction === 'inbound' ? 'i' : 'c';
  const fileName = `${prefix}${conversationId}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
  const key = `${folder.replace(/\/$/, '')}/chat-media/${fileName}`;
  const mime = normalizeMime(mimeType) || 'application/octet-stream';

  const putInput = {
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: mime,
    CacheControl: 'public, max-age=31536000',
  };
  if (objectAcl) {
    putInput.ACL = objectAcl;
  }

  try {
    await getS3Client().send(new PutObjectCommand(putInput));
  } catch (err) {
    const name = err?.name || err?.Code || 'S3Error';
    const msg = err?.message || String(err);
    console.warn(
      JSON.stringify({
        level: 'warn',
        message: 'PutObject S3 chat-media falló',
        bucket,
        region,
        key,
        error: msg,
        code: name,
      })
    );
    throw err;
  }

  return {
    url: publicS3ObjectUrl(bucket, region, key),
    mime,
  };
}

/** Disco local bajo public/uploads/chat-media (prefijo c = saliente, i = entrante). */
async function saveChatMediaToDisk({ buffer, conversationId, mimeType, direction }) {
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

/**
 * Guarda vista previa del adjunto: S3 si hay credenciales; si Put falla y S3_CHAT_MEDIA_FALLBACK_DISK
 * no es false, guarda en disco. Sin S3: solo disco.
 */
async function saveChatMediaFromBuffer({ buffer, conversationId, mimeType, direction }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Buffer vacío');
  }

  if (config.isS3ChatMediaConfigured()) {
    try {
      return await saveChatMediaToS3({ buffer, conversationId, mimeType, direction });
    } catch (err) {
      if (!config.s3ChatMedia.fallbackDiskOnError) {
        throw err;
      }
      console.warn(
        JSON.stringify({
          level: 'warn',
          message: 'S3 no disponible o rechazó PutObject; vista previa en disco local',
          fallbackDisk: true,
          error: err?.message || String(err),
        })
      );
    }
  }

  return saveChatMediaToDisk({ buffer, conversationId, mimeType, direction });
}

async function saveOutboundChatMediaFile({ buffer, conversationId, mimeType }) {
  return saveChatMediaFromBuffer({ buffer, conversationId, mimeType, direction: 'outbound' });
}

async function saveInboundChatMediaFromBuffer({ buffer, conversationId, mimeType }) {
  return saveChatMediaFromBuffer({ buffer, conversationId, mimeType, direction: 'inbound' });
}

module.exports = {
  saveChatMediaFromBuffer,
  saveChatMediaToDisk,
  saveOutboundChatMediaFile,
  saveInboundChatMediaFromBuffer,
  UPLOAD_SUBDIR,
};
