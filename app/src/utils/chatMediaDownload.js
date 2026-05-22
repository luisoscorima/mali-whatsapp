const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { GetObjectCommand, S3Client } = require('@aws-sdk/client-s3');
const config = require('../config');
const { UPLOAD_SUBDIR } = require('./chatMediaStorage');

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

function parseRawPayload(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getLocalPreview(rawPayload) {
  const p = parseRawPayload(rawPayload);
  if (!p?.local_preview?.url) return null;
  const url = String(p.local_preview.url).trim();
  if (!url) return null;
  return {
    url,
    mime: p.local_preview.mime ? String(p.local_preview.mime) : null,
    raw: p,
  };
}

function diskAbsolutePathFromPreviewUrl(url) {
  const u = String(url || '').trim();
  if (!u || /^https?:\/\//i.test(u)) return null;
  const normalized = u.replace(/\\/g, '/');
  const relPrefix = UPLOAD_SUBDIR.replace(/^\//, '');
  let rel = normalized.replace(/^\//, '');
  if (!rel.startsWith(`${relPrefix}/`)) return null;
  const basename = path.basename(rel);
  if (!basename || basename === '.' || basename.includes('..')) return null;
  const publicDir = path.join(__dirname, '..', '..', 'public', UPLOAD_SUBDIR);
  return path.join(publicDir, basename);
}

function s3KeyFromPreviewUrl(url) {
  if (!config.isS3ChatMediaConfigured()) return null;
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return null;

  const base = String(config.s3ChatMedia.publicUrlBase || '')
    .trim()
    .replace(/\/$/, '');
  if (base && u.startsWith(`${base}/`)) {
    return decodeURIComponent(u.slice(base.length + 1));
  }

  try {
    const parsed = new URL(u);
    const bucket = config.s3ChatMedia.bucket;
    const host = parsed.hostname.toLowerCase();
    const bucketHost = `${bucket}.s3.`;
    if (
      host === `${bucket}.s3.amazonaws.com` ||
      host.startsWith(bucketHost) ||
      (host === 's3.amazonaws.com' && parsed.pathname.startsWith(`/${bucket}/`))
    ) {
      let keyPath = parsed.pathname.replace(/^\//, '');
      if (host === 's3.amazonaws.com' && keyPath.startsWith(`${bucket}/`)) {
        keyPath = keyPath.slice(bucket.length + 1);
      }
      return decodeURIComponent(keyPath);
    }
  } catch {
    return null;
  }
  return null;
}

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
    'audio/ogg': '.ogg',
    'audio/aac': '.aac',
    'audio/mp4': '.m4a',
  };
  return map[m] || '';
}

function filenameFromUrlTail(url) {
  const tail = String(url || '')
    .split('/')
    .pop()
    ?.split('?')[0];
  if (!tail || !tail.includes('.')) return '';
  return tail.replace(/[^\w.\-+]/g, '_').slice(0, 120);
}

function suggestDownloadFilename({ messageType, mime, url, rawPayload }) {
  const p = parseRawPayload(rawPayload);
  if (p?.document?.filename) {
    const name = String(p.document.filename).trim();
    if (name) return name.replace(/["\r\n]/g, '_').slice(0, 120);
  }

  const fromUrl = filenameFromUrlTail(url);
  if (fromUrl) return fromUrl;

  const ext = extFromMime(mime) || '.bin';
  const mt = String(messageType || 'file').replace(/[^\w-]/g, '');
  return `whatsapp-${mt}${ext}`;
}

function contentDispositionAttachment(filename) {
  const safe = String(filename || 'archivo')
    .replace(/["\r\n\\]/g, '_')
    .slice(0, 180);
  return `attachment; filename="${safe}"`;
}

async function pipeS3Object(res, key, contentType) {
  const { bucket } = config.s3ChatMedia;
  const out = await getS3Client().send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  } else if (out.ContentType) {
    res.setHeader('Content-Type', out.ContentType);
  }
  return new Promise((resolve, reject) => {
    out.Body.on('error', reject);
    out.Body.on('end', resolve);
    out.Body.pipe(res);
  });
}

async function pipeHttpUrl(res, url, contentType) {
  const response = await axios.get(url, { responseType: 'stream', timeout: 60000 });
  const ct = response.headers['content-type'] || contentType || 'application/octet-stream';
  res.setHeader('Content-Type', ct.split(';')[0].trim());
  return new Promise((resolve, reject) => {
    response.data.on('error', reject);
    response.data.on('end', resolve);
    response.data.pipe(res);
  });
}

/**
 * Sirve el archivo de local_preview con Content-Disposition: attachment.
 * @returns {Promise<void>}
 */
async function streamMessageMediaDownload(res, { localPreview, rawPayload, messageType }) {
  const filename = suggestDownloadFilename({
    messageType,
    mime: localPreview.mime,
    url: localPreview.url,
    rawPayload,
  });
  const defaultCt = localPreview.mime
    ? String(localPreview.mime).split(';')[0].trim()
    : 'application/octet-stream';

  res.setHeader('Content-Disposition', contentDispositionAttachment(filename));

  const diskPath = diskAbsolutePathFromPreviewUrl(localPreview.url);
  if (diskPath) {
    await fs.promises.access(diskPath, fs.constants.R_OK);
    res.setHeader('Content-Type', defaultCt);
    return new Promise((resolve, reject) => {
      const stream = fs.createReadStream(diskPath);
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(res);
    });
  }

  const s3Key = s3KeyFromPreviewUrl(localPreview.url);
  if (s3Key) {
    try {
      return await pipeS3Object(res, s3Key, defaultCt);
    } catch (err) {
      if (!/^https?:\/\//i.test(localPreview.url)) {
        throw err;
      }
    }
  }

  if (!/^https?:\/\//i.test(localPreview.url)) {
    throw new Error('Archivo no disponible en el servidor');
  }

  res.setHeader('Content-Type', defaultCt);
  return pipeHttpUrl(res, localPreview.url, defaultCt);
}

module.exports = {
  getLocalPreview,
  streamMessageMediaDownload,
  suggestDownloadFilename,
};
