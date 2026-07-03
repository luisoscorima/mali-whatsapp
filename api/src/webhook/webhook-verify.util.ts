import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { getAppSecret, getVerifyToken } from '../meta-settings/meta-settings.store';

export function readVerifyToken(): string {
  return getVerifyToken();
}

export function readAppSecret(): string {
  return getAppSecret();
}

export function readRequireWebhookSignature(): boolean {
  const raw = String(process.env.REQUIRE_WEBHOOK_SIGNATURE ?? '').trim();
  if (raw) return raw.toLowerCase() === 'true';
  return String(process.env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

export function verifyWebhookSignature(req: Request): boolean {
  const appSecret = readAppSecret();
  const signature = req.get('x-hub-signature-256');
  const requireSignature = readRequireWebhookSignature();

  if (requireSignature && !appSecret) {
    return false;
  }
  if (!appSecret) {
    return true;
  }
  if (!signature) {
    return !requireSignature;
  }

  const [prefix, signatureHash] = signature.split('=');
  if (prefix !== 'sha256' || !signatureHash) {
    return false;
  }

  const raw = Buffer.isBuffer((req as Request & { rawBody?: Buffer }).rawBody)
    ? (req as Request & { rawBody: Buffer }).rawBody
    : Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');

  const expectedHash = createHmac('sha256', appSecret).update(raw).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(signatureHash), Buffer.from(expectedHash));
  } catch {
    return false;
  }
}
