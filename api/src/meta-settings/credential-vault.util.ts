import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_VERSION = 'v1';
const IV_BYTES = 12;

function decodeMasterKey(raw: unknown): Buffer {
  const value = String(raw ?? '').trim();
  if (!value) {
    throw new Error('WHATSAPP_CREDENTIALS_MASTER_KEY no configurada');
  }

  const key = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');

  if (key.length !== 32) {
    throw new Error(
      'WHATSAPP_CREDENTIALS_MASTER_KEY debe contener exactamente 32 bytes (base64 o 64 caracteres hex)',
    );
  }
  return key;
}

function masterKey(): Buffer {
  return decodeMasterKey(process.env.WHATSAPP_CREDENTIALS_MASTER_KEY);
}

/** AES-256-GCM envelope: version.iv.authTag.ciphertext (base64url). */
export function encryptMetaToken(token: string): string {
  const plaintext = String(token ?? '').trim();
  if (!plaintext) throw new Error('El token de Meta no puede estar vacío');

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    ENVELOPE_VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

export function decryptMetaToken(envelope: string): string {
  const [version, ivRaw, tagRaw, encryptedRaw, ...extra] = String(
    envelope ?? '',
  ).split('.');
  if (
    version !== ENVELOPE_VERSION ||
    !ivRaw ||
    !tagRaw ||
    !encryptedRaw ||
    extra.length
  ) {
    throw new Error('Formato de credencial cifrada no reconocido');
  }

  const iv = Buffer.from(ivRaw, 'base64url');
  const authTag = Buffer.from(tagRaw, 'base64url');
  const encrypted = Buffer.from(encryptedRaw, 'base64url');
  if (iv.length !== IV_BYTES || authTag.length !== 16 || !encrypted.length) {
    throw new Error('Credencial cifrada corrupta');
  }

  const decipher = createDecipheriv(ALGORITHM, masterKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}

export function fingerprintMetaToken(token: string): string {
  return createHash('sha256').update(String(token ?? '').trim()).digest('hex');
}

export function assertCredentialVaultConfigured(): void {
  masterKey();
}

