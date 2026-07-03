import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import {
  assertChatMediaS3Configured,
  getChatMediaS3Config,
  isChatMediaS3Configured,
} from './chat-media-config.util';

export type LocalPreview = {
  url: string;
  mime: string | null;
};

function extFromMime(mimeType: string): string {
  const m = String(mimeType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const map: Record<string, string> = {
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
  return map[m] || '.bin';
}

function normalizeMime(mimeType: string): string {
  return String(mimeType || '')
    .split(';')[0]
    .trim();
}

function publicS3ObjectUrl(bucket: string, region: string, key: string): string {
  const pathPart = key.split('/').map(encodeURIComponent).join('/');
  const cfg = getChatMediaS3Config();
  const base = String(cfg.publicUrlBase || '')
    .trim()
    .replace(/\/$/, '');
  if (base) return `${base}/${pathPart}`;
  const r = String(region || 'us-east-1').toLowerCase();
  return `https://${bucket}.s3.${r}.amazonaws.com/${pathPart}`;
}

async function saveChatMediaToS3(input: {
  buffer: Buffer;
  conversationId: number;
  mimeType: string;
  direction: 'inbound' | 'outbound';
}): Promise<LocalPreview> {
  const cfg = getChatMediaS3Config();
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const ext = extFromMime(input.mimeType);
  const prefix = input.direction === 'inbound' ? 'i' : 'c';
  const fileName = `${prefix}${input.conversationId}-${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
  const key = `${cfg.folder.replace(/\/$/, '')}/chat-media/${fileName}`;
  const mime = normalizeMime(input.mimeType) || 'application/octet-stream';

  const client = new S3Client({
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  const putInput: {
    Bucket: string;
    Key: string;
    Body: Buffer;
    ContentType: string;
    CacheControl: string;
    ACL?: 'public-read';
  } = {
    Bucket: cfg.bucket,
    Key: key,
    Body: input.buffer,
    ContentType: mime,
    CacheControl: 'public, max-age=31536000',
  };
  if (cfg.objectAcl) putInput.ACL = cfg.objectAcl;

  await client.send(new PutObjectCommand(putInput));

  return {
    url: publicS3ObjectUrl(cfg.bucket, cfg.region, key),
    mime,
  };
}

export async function saveChatMediaFromBuffer(input: {
  buffer: Buffer;
  conversationId: number;
  mimeType: string;
  direction: 'inbound' | 'outbound';
}): Promise<LocalPreview> {
  if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
    throw new Error('Buffer vacío');
  }
  assertChatMediaS3Configured();
  return saveChatMediaToS3(input);
}

export async function saveInboundChatMediaFromBuffer(input: {
  buffer: Buffer;
  conversationId: number;
  mimeType: string;
}): Promise<LocalPreview> {
  return saveChatMediaFromBuffer({ ...input, direction: 'inbound' });
}

export async function saveOutboundChatMediaFile(input: {
  buffer: Buffer;
  conversationId: number;
  mimeType: string;
}): Promise<LocalPreview> {
  return saveChatMediaFromBuffer({ ...input, direction: 'outbound' });
}

function parseRawPayload(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getLocalPreview(rawPayload: unknown): LocalPreview | null {
  const p = parseRawPayload(rawPayload);
  const preview = p?.local_preview as { url?: string; mime?: string } | undefined;
  if (!preview?.url) return null;
  const url = String(preview.url).trim();
  if (!url) return null;
  return {
    url,
    mime: preview.mime ? String(preview.mime) : null,
  };
}

export function hasDownloadableMedia(rawPayload: unknown): boolean {
  return getLocalPreview(rawPayload) != null;
}

function s3KeyFromPreviewUrl(url: string): string | null {
  if (!isChatMediaS3Configured()) return null;
  const u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) return null;

  const cfg = getChatMediaS3Config();
  const base = String(cfg.publicUrlBase || '')
    .trim()
    .replace(/\/$/, '');
  if (base && u.startsWith(`${base}/`)) {
    return decodeURIComponent(u.slice(base.length + 1));
  }

  try {
    const parsed = new URL(u);
    const bucket = cfg.bucket;
    const host = parsed.hostname.toLowerCase();
    const bucketHost = `${bucket}.s3.`;
    if (
      host === `${bucket}.s3.amazonaws.com` ||
      host.startsWith(bucketHost) ||
      (host === 's3.amazonaws.com' &&
        parsed.pathname.startsWith(`/${bucket}/`))
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

function filenameFromUrlTail(url: string): string {
  const tail = String(url || '')
    .split('/')
    .pop()
    ?.split('?')[0];
  if (!tail || !tail.includes('.')) return '';
  return tail.replace(/[^\w.\-+]/g, '_').slice(0, 120);
}

export function suggestDownloadFilename(input: {
  messageType?: string;
  mime?: string | null;
  url?: string;
  rawPayload?: unknown;
}): string {
  const p = parseRawPayload(input.rawPayload);
  const doc = p?.document as { filename?: string } | undefined;
  if (doc?.filename) {
    const name = String(doc.filename).trim();
    if (name) return name.replace(/["\r\n]/g, '_').slice(0, 120);
  }

  const fromUrl = filenameFromUrlTail(input.url || '');
  if (fromUrl) return fromUrl;

  const ext = extFromMime(input.mime || '') || '.bin';
  const mt = String(input.messageType || 'file').replace(/[^\w-]/g, '');
  return `whatsapp-${mt}${ext}`;
}

function contentDispositionAttachment(filename: string): string {
  const safe = String(filename || 'archivo')
    .replace(/["\r\n\\]/g, '_')
    .slice(0, 180);
  return `attachment; filename="${safe}"`;
}

async function pipeS3Object(
  res: Response,
  key: string,
  contentType: string,
): Promise<void> {
  const cfg = getChatMediaS3Config();
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    region: cfg.region,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  const out = await client.send(
    new GetObjectCommand({ Bucket: cfg.bucket, Key: key }),
  );
  if (contentType) {
    res.setHeader('Content-Type', contentType);
  } else if (out.ContentType) {
    res.setHeader('Content-Type', out.ContentType);
  }
  const body = out.Body as NodeJS.ReadableStream | undefined;
  if (!body) throw new Error('Cuerpo S3 vacío');
  await new Promise<void>((resolve, reject) => {
    body.on('error', reject);
    body.on('end', resolve);
    body.pipe(res);
  });
}

async function pipeHttpUrl(
  res: Response,
  url: string,
  contentType: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`No se pudo descargar URL (${response.status})`);
  }
  const ct =
    response.headers.get('content-type')?.split(';')[0].trim() ||
    contentType ||
    'application/octet-stream';
  res.setHeader('Content-Type', ct);
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(Buffer.from(value));
  }
  res.end();
}

export async function streamMessageMediaDownload(
  res: Response,
  input: {
    localPreview: LocalPreview;
    rawPayload?: unknown;
    messageType?: string;
  },
): Promise<void> {
  assertChatMediaS3Configured();

  const filename = suggestDownloadFilename({
    messageType: input.messageType,
    mime: input.localPreview.mime,
    url: input.localPreview.url,
    rawPayload: input.rawPayload,
  });
  const defaultCt = input.localPreview.mime
    ? String(input.localPreview.mime).split(';')[0].trim()
    : 'application/octet-stream';

  res.setHeader('Content-Disposition', contentDispositionAttachment(filename));

  const s3Key = s3KeyFromPreviewUrl(input.localPreview.url);
  if (s3Key) {
    try {
      await pipeS3Object(res, s3Key, defaultCt);
      return;
    } catch (err) {
      if (!/^https?:\/\//i.test(input.localPreview.url)) throw err;
    }
  }

  if (!/^https?:\/\//i.test(input.localPreview.url)) {
    throw new Error('Archivo no disponible en S3');
  }

  res.setHeader('Content-Type', defaultCt);
  await pipeHttpUrl(res, input.localPreview.url, defaultCt);
}
