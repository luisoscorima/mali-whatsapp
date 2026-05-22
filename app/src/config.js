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

/** URL base pública (sin barra final), ej. CloudFront o dominio propio; si está vacío se usa el host virtual de S3. */
const s3PublicUrlBase = unquoteEnv(process.env.S3_PUBLIC_URL_BASE);
/** Si el bucket no permite ACL, deja vacío y usa política de bucket con GetObject público en el prefijo chat-media. */
const s3ChatMediaAclRaw = unquoteEnv(process.env.S3_CHAT_MEDIA_ACL).toLowerCase();
const s3ChatMediaObjectAcl = s3ChatMediaAclRaw === 'public-read' ? 'public-read' : null;
/** Si S3 está configurado pero PutObject falla, guardar igual en disco (volumen Docker) para no perder la vista previa. */
const s3ChatMediaFallbackDisk =
  String(process.env.S3_CHAT_MEDIA_FALLBACK_DISK || 'true')
    .trim()
    .toLowerCase() !== 'false';

const s3ChatMedia = {
  accessKeyId: unquoteEnv(process.env.ACCESS_KEY_S3),
  secretAccessKey: unquoteEnv(process.env.SECRET_KEY_S3),
  bucket: unquoteEnv(process.env.BUCKET_NAME),
  folder: unquoteEnv(process.env.CARPETA) || 'assets-whatsapp-mali',
  region: unquoteEnv(process.env.AWS_REGION) || 'us-east-1',
  publicUrlBase: s3PublicUrlBase,
  objectAcl: s3ChatMediaObjectAcl,
  fallbackDiskOnError: s3ChatMediaFallbackDisk,
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
    ti: 'TI (dev)',
    pam: 'PAM',
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
  /** Tiempo mínimo entre envíos de campaña al mismo número (anti-spam, ms). 0 = desactivado. */
  CAMPAIGN_PHONE_MIN_GAP_MS: Number(process.env.CAMPAIGN_PHONE_MIN_GAP_MS || 5000),
  /** Programación de campaña: margen mínimo respecto a "ahora" y ventana máxima hacia el futuro. */
  CAMPAIGN_SCHEDULE_MIN_MARGIN_MS: 60 * 1000,
  CAMPAIGN_SCHEDULE_MAX_DAYS: 90,
  /** Intervalo del poller que promueve campañas scheduled → queued (ms). */
  CAMPAIGN_SCHEDULE_POLL_MS: 45 * 1000,
  /** Minutos tras completar una campaña antes del reintento automático de fallidos. */
  CAMPAIGN_AUTO_RETRY_DELAY_MINUTES: (() => {
    const n = Number(process.env.CAMPAIGN_AUTO_RETRY_DELAY_MINUTES || 10);
    if (!Number.isFinite(n) || n < 1) return 10;
    return Math.min(1440, Math.floor(n));
  })(),
  /** Intentos máximos por teléfono (incluye el envío inicial). */
  CAMPAIGN_MAX_RETRY_ATTEMPTS: (() => {
    const n = Number(process.env.CAMPAIGN_MAX_RETRY_ATTEMPTS || 2);
    if (!Number.isFinite(n) || n < 1) return 2;
    return Math.min(10, Math.floor(n));
  })(),
  /** Acciones manuales "Reintentar fallidos" permitidas por campaña. */
  CAMPAIGN_MAX_MANUAL_RETRIES: (() => {
    const n = Number(process.env.CAMPAIGN_MAX_MANUAL_RETRIES || 3);
    if (!Number.isFinite(n) || n < 0) return 3;
    return Math.min(20, Math.floor(n));
  })(),
  /** Vista previa y envío: máximo de contactos por campaña (unión de segmentos o lista explícita). */
  CAMPAIGN_RECIPIENTS_PREVIEW_MAX: Number(process.env.CAMPAIGN_RECIPIENTS_PREVIEW_MAX || 5000),
  CAMPAIGN_MAX_RECIPIENT_IDS: Number(process.env.CAMPAIGN_MAX_RECIPIENT_IDS || 5000),
  /** Costo estimado por mensaje entregado (USD) si Meta no devuelve analytics. */
  CAMPAIGN_COST_PER_MESSAGE_USD_DEFAULT: (() => {
    const n = Number(process.env.CAMPAIGN_COST_PER_MESSAGE_USD || 0.05);
    return Number.isFinite(n) && n >= 0 ? n : 0.05;
  })(),
  /** Días tras el envío para contar una respuesta a campaña. */
  CAMPAIGN_RESPONSE_WINDOW_DAYS: (() => {
    const n = Number(process.env.CAMPAIGN_RESPONSE_WINDOW_DAYS || 7);
    if (!Number.isFinite(n) || n < 1) return 7;
    return Math.min(90, Math.floor(n));
  })(),
  /** Body JSON para POST /campaigns/send con miles de IDs. */
  CAMPAIGN_JSON_BODY_LIMIT: String(process.env.CAMPAIGN_JSON_BODY_LIMIT || '2mb').trim() || '2mb',
  MAX_SESSION_TEXT_LEN: 4096,
  /** Captions en mensajes con media (WhatsApp Cloud API). */
  MAX_MEDIA_CAPTION_LEN: 1024,
  /** Límites aproximados Cloud API; validar también en servidor. */
  MAX_MEDIA_IMAGE_BYTES: 5 * 1024 * 1024,
  MAX_MEDIA_VIDEO_BYTES: 16 * 1024 * 1024,
  MAX_MEDIA_AUDIO_BYTES: 16 * 1024 * 1024,
  MAX_MEDIA_DOCUMENT_BYTES: 100 * 1024 * 1024,
  SESSION_WINDOW_MS: 24 * 60 * 60 * 1000,
  /** Zona horaria IANA para mostrar fechas/horas en el panel (BD sigue en UTC/timestamptz). */
  DISPLAY_TIMEZONE: String(process.env.DISPLAY_TIMEZONE || 'America/Lima').trim() || 'America/Lima',
  MAX_CSV_ROWS: 10000,
  MAX_CSV_BYTES: 5 * 1024 * 1024,
  /** Retención de filas en audit_logs (borrado automático de eventos más antiguos). Máx. 365. */
  AUDIT_LOG_RETENTION_DAYS: (() => {
    const n = Number(process.env.AUDIT_LOG_RETENTION_DAYS || 30);
    if (!Number.isFinite(n) || n < 1) return 30;
    return Math.min(365, Math.floor(n));
  })(),
  s3ChatMedia,
  isS3ChatMediaConfigured,
};
