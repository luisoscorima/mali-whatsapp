const rawBasePath = String(process.env.BASE_PATH || '').trim();
const basePath =
  rawBasePath === ''
    ? ''
    : (rawBasePath.startsWith('/') ? rawBasePath : `/${rawBasePath}`).replace(/\/$/, '');

function appPath(relativePath) {
  const p = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return `${basePath}${p}`;
}

const nodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const isProduction = nodeEnv === 'production';

/** Quitar comillas si vienen de .env tipo BUCKET_NAME="nombre" */
function unquoteEnv(str) {
  const s = String(str || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

const s3ChatMedia = {
  accessKeyId: unquoteEnv(process.env.ACCESS_KEY_S3),
  secretAccessKey: unquoteEnv(process.env.SECRET_KEY_S3),
  bucket: unquoteEnv(process.env.BUCKET_NAME),
  folder: unquoteEnv(process.env.CARPETA) || 'assets-whatsapp-mali',
  region: unquoteEnv(process.env.AWS_REGION) || 'us-east-1',
};

function isS3ChatMediaConfigured() {
  return Boolean(
    s3ChatMedia.accessKeyId &&
      s3ChatMedia.secretAccessKey &&
      s3ChatMedia.bucket &&
      s3ChatMedia.region
  );
}

module.exports = {
  basePath,
  appPath,
  port: Number(process.env.PORT || 3000),
  nodeEnv,
  isProduction,
  requireWebhookSignature:
    String(process.env.REQUIRE_WEBHOOK_SIGNATURE || (isProduction ? 'true' : 'false'))
      .trim()
      .toLowerCase() === 'true',
  requireAuth:
    String(process.env.REQUIRE_AUTH || (isProduction ? 'true' : 'false')).trim().toLowerCase() ===
    'true',
  sessionSecret: String(process.env.SESSION_SECRET || '').trim(),
  GRAPH_API_VERSION: 'v23.0',
  GRAPH_BASE: 'https://graph.facebook.com/v23.0',
  AREA_LABELS: {
    pam: 'Comercial (PAM)',
    educacion: 'Educación',
  },
  MALI_EMAIL_REGEX: /^[^\s@]+@mali\.pe$/i,
  DEFAULT_MASTER_EMAIL: 'loscorima@mali.pe',
  SEGMENT_SLUG_REGEX: /^[a-z0-9_]{1,50}$/,
  allowedLanguageCodeRegex: /^[a-z]{2}(?:_[A-Z]{2})?$/,
  allowedTemplateNameRegex: /^[a-z0-9_]{1,128}$/,
  e164NoPlusRegex: /^[1-9][0-9]{7,14}$/,
  MAX_NAME_LEN: 120,
  MAX_BODY_PARAM_LEN: 1024,
  MAX_TEMPLATE_BODY_VARS: 20,
  MAX_IMAGE_URL_LEN: 2048,
  MAX_BATCH_SIZE: 100,
  MAX_BATCH_DELAY_MS: 60000,
  MAX_SESSION_TEXT_LEN: 4096,
  /** Captions en mensajes con media (WhatsApp Cloud API). */
  MAX_MEDIA_CAPTION_LEN: 1024,
  /** Límites aproximados Cloud API; validar también en servidor. */
  MAX_MEDIA_IMAGE_BYTES: 5 * 1024 * 1024,
  MAX_MEDIA_VIDEO_BYTES: 16 * 1024 * 1024,
  MAX_MEDIA_AUDIO_BYTES: 16 * 1024 * 1024,
  MAX_MEDIA_DOCUMENT_BYTES: 100 * 1024 * 1024,
  SESSION_WINDOW_MS: 24 * 60 * 60 * 1000,
  MAX_CSV_ROWS: 10000,
  MAX_CSV_BYTES: 5 * 1024 * 1024,
  s3ChatMedia,
  isS3ChatMediaConfigured,
};
