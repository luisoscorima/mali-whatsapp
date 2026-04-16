const rateLimit = require('express-rate-limit');
const multer = require('multer');
const config = require('../config');
const { ALLOWED_MEDIA_MIMES } = require('../services/metaWhatsApp');

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
});

const campaignLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.CAMPAIGN_RATE_LIMIT_MAX || 5),
  standardHeaders: true,
  legacyHeaders: false,
});

const conversationReplyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.CONVERSATION_REPLY_RATE_MAX || 60),
  standardHeaders: true,
  legacyHeaders: false,
});

const contactsImportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.CONTACTS_IMPORT_RATE_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
});

const templateSyncLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: Number(process.env.TEMPLATE_SYNC_RATE_MAX || 10),
  standardHeaders: true,
  legacyHeaders: false,
});

const contactsImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_CSV_BYTES },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.xlsx')) {
      return cb(null, true);
    }
    cb(new Error('Solo archivos .csv o .xlsx'));
  },
});

/** Adjuntos en respuesta de conversación (WhatsApp Cloud API). Tope global = documento. */
const conversationMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_MEDIA_DOCUMENT_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const mime = String(file.mimetype || '')
      .toLowerCase()
      .split(';')[0]
      .trim();
    if (ALLOWED_MEDIA_MIMES.has(mime)) {
      return cb(null, true);
    }
    cb(new Error('Tipo de archivo no permitido (JPEG, PNG, MP4, audio o PDF).'));
  },
});

module.exports = {
  globalLimiter,
  campaignLimiter,
  conversationReplyLimiter,
  contactsImportLimiter,
  templateSyncLimiter,
  contactsImportUpload,
  conversationMediaUpload,
};
