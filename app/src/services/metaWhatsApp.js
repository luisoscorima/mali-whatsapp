const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const config = require('../config');
const {
  getWhatsAppCredentialsForArea,
  getWabaIdOverrideForArea,
  resolveWhatsAppSendCredentials,
} = require('./metaSettingsCache');

/** MIME permitidos para adjuntos desde Conversaciones (subida a Graph + mensaje). */
const ALLOWED_MEDIA_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'video/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'application/ogg',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'application/pdf',
]);

const TEMPLATE_HEADER_MIME_LIMITS = {
  'image/jpeg': { format: 'IMAGE', maxBytes: config.MAX_MEDIA_IMAGE_BYTES },
  'image/jpg': { format: 'IMAGE', maxBytes: config.MAX_MEDIA_IMAGE_BYTES },
  'image/png': { format: 'IMAGE', maxBytes: config.MAX_MEDIA_IMAGE_BYTES },
  'video/mp4': { format: 'VIDEO', maxBytes: config.MAX_MEDIA_VIDEO_BYTES },
  'application/pdf': { format: 'DOCUMENT', maxBytes: config.MAX_MEDIA_DOCUMENT_BYTES },
};

/**
 * @returns {{ waType: 'image'|'video'|'audio'|'document', maxBytes: number }}
 */
function classifyConversationUpload(mimeType, sizeBytes) {
  const mime = String(mimeType || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (!mime || !ALLOWED_MEDIA_MIMES.has(mime)) {
    throw new Error(
      'Tipo de archivo no permitido. Usa JPEG/PNG, MP4, audio (MP3/OGG/AAC/M4A) o PDF.'
    );
  }
  let waType;
  let maxBytes;
  if (mime === 'image/jpeg' || mime === 'image/png') {
    waType = 'image';
    maxBytes = config.MAX_MEDIA_IMAGE_BYTES;
  } else if (mime === 'video/mp4') {
    waType = 'video';
    maxBytes = config.MAX_MEDIA_VIDEO_BYTES;
  } else if (mime === 'application/pdf') {
    waType = 'document';
    maxBytes = config.MAX_MEDIA_DOCUMENT_BYTES;
  } else {
    waType = 'audio';
    maxBytes = config.MAX_MEDIA_AUDIO_BYTES;
  }
  if (typeof sizeBytes === 'number' && sizeBytes > maxBytes) {
    throw new Error(`Archivo demasiado grande (máx. ${Math.round(maxBytes / (1024 * 1024))} MB para este tipo).`);
  }
  return { waType, maxBytes };
}

function sanitizeUploadFilename(originalName, waType) {
  let base = path.basename(String(originalName || ''));
  base = base.replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_').trim();
  if (!base) {
    base =
      waType === 'document'
        ? 'documento.pdf'
        : waType === 'image'
          ? 'imagen.jpg'
          : waType === 'video'
            ? 'video.mp4'
            : 'audio.m4a';
  }
  return base.slice(0, 200);
}

function classifyTemplateHeaderUpload(mimeType, sizeBytes) {
  const mime = String(mimeType || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  const rule = TEMPLATE_HEADER_MIME_LIMITS[mime];
  if (!rule) {
    throw new Error('Usa un archivo JPG, PNG, MP4 o PDF para la cabecera de la plantilla.');
  }
  if (typeof sizeBytes === 'number' && sizeBytes > rule.maxBytes) {
    throw new Error(
      `Archivo de cabecera demasiado grande (máx. ${Math.round(rule.maxBytes / (1024 * 1024))} MB).`
    );
  }
  return { mimeType: mime, format: rule.format, maxBytes: rule.maxBytes };
}

/**
 * Sube binario a WhatsApp Cloud API y devuelve { id } del media handle.
 */
async function uploadMediaToWhatsApp({ area, buffer, mimeType, filename, phoneNumberId }) {
  const { token, phoneNumberId: lineId } = resolveWhatsAppSendCredentials({ area, phoneNumberId });
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Archivo vacío o inválido');
  }
  const { waType } = classifyConversationUpload(mimeType, buffer.length);
  const safeName = sanitizeUploadFilename(filename, waType);

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', waType);
  form.append('file', buffer, { filename: safeName, contentType: String(mimeType).split(';')[0].trim() });

  const url = `${config.GRAPH_BASE}/${lineId}/media`;
  try {
    const { data } = await axios.post(url, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${token}`,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    if (!data?.id) {
      throw new Error('Respuesta de subida sin id de media');
    }
    return { mediaId: String(data.id), waType, safeFilename: safeName };
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.data) {
      const err = e.response.data?.error || e.response.data;
      const msg = err?.message || err?.error_user_msg || JSON.stringify(err);
      throw new Error(`Error subiendo media: ${msg}`);
    }
    throw e;
  }
}

/**
 * Sube el ejemplo de cabecera media para creación de plantillas y devuelve el `header_handle`.
 */
async function uploadTemplateHeaderHandle({ area, buffer, mimeType, filename }) {
  const { token } = getWhatsAppCredentialsForArea(area);
  if (!token) {
    throw new Error('Faltan credenciales WhatsApp para generar el header handle.');
  }
  if (!config.META_APP_ID) {
    throw new Error('Falta META_APP_ID para crear plantillas con cabecera media.');
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Archivo de ejemplo vacío o inválido.');
  }

  const { mimeType: safeMime } = classifyTemplateHeaderUpload(mimeType, buffer.length);
  const safeName = path.basename(String(filename || 'cabecera-media').trim()) || 'cabecera-media';

  let sessionId = '';
  try {
    const initRes = await axios.post(`${config.GRAPH_BASE}/${config.META_APP_ID}/uploads`, null, {
      params: {
        file_name: safeName,
        file_length: buffer.length,
        file_type: safeMime,
        access_token: token,
      },
    });
    sessionId = String(initRes.data?.id || '').trim();
    if (!sessionId) {
      throw new Error('Meta no devolvió una sesión de upload.');
    }
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.data) {
      const err = e.response.data?.error || e.response.data;
      const msg = err?.message || err?.error_user_msg || JSON.stringify(err);
      throw new Error(`Error iniciando upload de cabecera: ${msg}`);
    }
    throw e;
  }

  try {
    const uploadRes = await axios.post(`${config.GRAPH_BASE}/${sessionId}`, buffer, {
      headers: {
        Authorization: `OAuth ${token}`,
        file_offset: '0',
        'Content-Type': 'application/octet-stream',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const handle = String(uploadRes.data?.h || '').trim();
    if (!handle) {
      throw new Error('Meta no devolvió el header handle.');
    }
    return handle;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.data) {
      const err = e.response.data?.error || e.response.data;
      const msg = err?.message || err?.error_user_msg || JSON.stringify(err);
      throw new Error(`Error subiendo cabecera media: ${msg}`);
    }
    throw e;
  }
}

/**
 * Envía mensaje de sesión con media ya subida (id de Graph).
 * Para audio, WhatsApp no aplica caption en el mismo payload; usar envío de texto aparte si hace falta.
 */
async function sendSessionMediaMessage({
  to,
  area,
  waType,
  mediaId,
  caption,
  documentFilename,
  phoneNumberId,
}) {
  const { token, phoneNumberId: lineId } = resolveWhatsAppSendCredentials({ area, phoneNumberId });
  const cap =
    caption != null && String(caption).trim()
      ? String(caption).trim().slice(0, config.MAX_MEDIA_CAPTION_LEN)
      : '';

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: waType,
  };

  if (waType === 'image') {
    payload.image = { id: mediaId };
    if (cap) payload.image.caption = cap;
  } else if (waType === 'video') {
    payload.video = { id: mediaId };
    if (cap) payload.video.caption = cap;
  } else if (waType === 'audio') {
    payload.audio = { id: mediaId };
  } else if (waType === 'document') {
    const fn = documentFilename && String(documentFilename).trim() ? String(documentFilename).trim() : 'documento.pdf';
    payload.document = { id: mediaId, filename: fn.slice(0, 240) };
    if (cap) payload.document.caption = cap;
  } else {
    throw new Error('Tipo de media no soportado');
  }

  try {
    const response = await axios.post(`${config.GRAPH_BASE}/${lineId}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (e) {
    if (axios.isAxiosError(e) && e.response?.data) {
      const err = e.response.data?.error || e.response.data;
      const msg = err?.message || err?.error_user_msg || JSON.stringify(err);
      throw new Error(`Error enviando media: ${msg}`);
    }
    throw e;
  }
}

/**
 * Descarga un medio subido a WhatsApp (mensaje entrante) vía Graph API.
 * GET /{media-id} → URL temporal; GET URL con Bearer → binario.
 */
async function downloadWhatsAppMediaBuffer({ mediaId, area }) {
  const { token } = getWhatsAppCredentialsForArea(area);
  if (!token) {
    throw new Error(
      'Faltan credenciales WhatsApp para esta area: define WHATSAPP_TOKEN_* y PHONE_NUMBER_ID_*'
    );
  }
  const id = String(mediaId || '').trim();
  if (!id) {
    throw new Error('media id vacío');
  }

  const metaUrl = `${config.GRAPH_BASE}/${id}`;
  const { data: meta } = await axios.get(metaUrl, {
    params: {
      fields: 'id,mime_type,sha256,file_size,url,messaging_product',
    },
    headers: { Authorization: `Bearer ${token}` },
  });

  const downloadUrl = meta?.url;
  const mimeFromMeta = meta?.mime_type
    ? String(meta.mime_type).split(';')[0].trim()
    : 'application/octet-stream';

  if (!downloadUrl) {
    throw new Error('Meta no devolvió URL de descarga para el media');
  }

  const maxInboundBytes = 100 * 1024 * 1024;
  if (meta.file_size != null && Number(meta.file_size) > maxInboundBytes) {
    throw new Error('Archivo entrante demasiado grande para descargar en el panel');
  }

  const fileRes = await axios.get(downloadUrl, {
    responseType: 'arraybuffer',
    headers: { Authorization: `Bearer ${token}` },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });

  const buffer = Buffer.from(fileRes.data);
  if (buffer.length > maxInboundBytes) {
    throw new Error('Descarga entrante supera el tamaño máximo permitido');
  }

  return {
    buffer,
    mimeType: mimeFromMeta,
  };
}

/**
 * Resuelve el ID de WhatsApp Business Account (WABA) para listar plantillas.
 * Meta no siempre expone el campo `whatsapp_business_account` en el nodo del número;
 * en ese caso se usa el edge `/{phone-number-id}/whatsapp_business_account` o se
 * comprueba si el ID configurado ya es el WABA (message_templates cuelga del WABA).
 */
async function fetchWabaIdFromPhoneNumberId(phoneNumberId, token) {
  const idStr = String(phoneNumberId || '').trim();

  // 1) Campo en el nodo del número de teléfono
  try {
    const { data } = await axios.get(`${config.GRAPH_BASE}/${idStr}`, {
      params: { fields: 'whatsapp_business_account{id}' },
      headers: { Authorization: `Bearer ${token}` },
    });
    const id = data?.whatsapp_business_account?.id;
    if (id) return String(id);
  } catch (e) {
    if (!axios.isAxiosError(e)) throw e;
    // (#100) campo inexistente u otros 400: seguir con el edge
    if (e.response?.status !== 400) throw e;
  }

  // 2) Edge: GET /{phone-number-id}/whatsapp_business_account (evita error #100 en el campo)
  try {
    const { data } = await axios.get(`${config.GRAPH_BASE}/${idStr}/whatsapp_business_account`, {
      params: { fields: 'id,name' },
      headers: { Authorization: `Bearer ${token}` },
    });
    if (data?.id) return String(data.id);
  } catch (e) {
    if (!axios.isAxiosError(e)) throw e;
  }

  // 3) Si en .env pusieron el WABA en PHONE_NUMBER_ID, message_templates responde en ese mismo id
  try {
    await axios.get(`${config.GRAPH_BASE}/${idStr}/message_templates`, {
      params: { limit: 1 },
      headers: { Authorization: `Bearer ${token}` },
    });
    return idStr;
  } catch (e) {
    if (!axios.isAxiosError(e)) throw e;
  }

  throw new Error(
    'No se pudo obtener el WhatsApp Business Account (WABA). ' +
      'En Meta Developers, el "Phone number ID" es distinto del "WhatsApp Business Account ID". ' +
      'Prueba definiendo WABA_ID_PAM o WABA_ID_EDUCACION en .env (WhatsApp Manager > Cuenta de la API > ID de la cuenta de WhatsApp Business).'
  );
}

async function resolveWabaId(area, token, phoneNumberId) {
  const override = getWabaIdOverrideForArea(area);
  if (override) return override;
  if (!phoneNumberId) {
    throw new Error('Falta PHONE_NUMBER_ID_* para resolver WABA');
  }
  return fetchWabaIdFromPhoneNumberId(phoneNumberId, token);
}

async function fetchMessageTemplatesPage(wabaId, token, after) {
  const params = {
    fields: 'name,status,language,category,components,id',
    limit: 100,
  };
  if (after) params.after = after;
  const url = `${config.GRAPH_BASE}/${wabaId}/message_templates`;
  const { data } = await axios.get(url, {
    params,
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

async function fetchAllMessageTemplates(wabaId, token) {
  const all = [];
  let after = null;
  do {
    const data = await fetchMessageTemplatesPage(wabaId, token, after);
    const list = Array.isArray(data.data) ? data.data : [];
    all.push(...list);
    after = data.paging?.cursors?.after || null;
  } while (after);
  return all;
}

async function sendTemplateWithComponents({ to, templateName, languageCode, components, area }) {
  const { token, phoneNumberId } = getWhatsAppCredentialsForArea(area);
  if (!token || !phoneNumberId) {
    throw new Error(
      'Faltan credenciales WhatsApp para esta area: define WHATSAPP_TOKEN_TI/PAM/EDUCACION y PHONE_NUMBER_ID_* (o WHATSAPP_TOKEN/PHONE_NUMBER_ID como respaldo)'
    );
  }

  const templatePayload = {
    name: templateName,
    language: { code: languageCode },
  };
  if (Array.isArray(components) && components.length > 0) {
    templatePayload.components = components;
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: templatePayload,
  };

  const response = await axios.post(
    `${config.GRAPH_BASE}/${phoneNumberId}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

async function sendSessionTextMessage({ to, text, area, phoneNumberId }) {
  const { token, phoneNumberId: lineId } = resolveWhatsAppSendCredentials({ area, phoneNumberId });
  const safe = String(text || '').trim();
  if (!safe) {
    throw new Error('Mensaje vacio');
  }
  if (safe.length > config.MAX_SESSION_TEXT_LEN) {
    throw new Error(`Mensaje demasiado largo (max ${config.MAX_SESSION_TEXT_LEN})`);
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: safe, preview_url: false },
  };

  const response = await axios.post(
    `${config.GRAPH_BASE}/${lineId}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

/**
 * Crea plantilla en WABA (queda PENDING hasta revisión Meta).
 */
async function createMessageTemplateOnWaba({
  area,
  name,
  language,
  category,
  components,
}) {
  const { token, phoneNumberId } = getWhatsAppCredentialsForArea(area);
  if (!token || !phoneNumberId) {
    throw new Error('Faltan credenciales WhatsApp para crear plantilla');
  }
  const wabaId = await resolveWabaId(area, token, phoneNumberId);
  const payload = {
    name: String(name || '').trim(),
    language: String(language || 'es').trim(),
    category: String(category || 'MARKETING').trim().toUpperCase(),
    components: Array.isArray(components) ? components : [],
  };
  const { data } = await axios.post(`${config.GRAPH_BASE}/${wabaId}/message_templates`, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  return data;
}

module.exports = {
  getWhatsAppCredentialsForArea,
  getWabaIdOverrideForArea,
  resolveWabaId,
  fetchAllMessageTemplates,
  createMessageTemplateOnWaba,
  sendTemplateWithComponents,
  sendSessionTextMessage,
  fetchWabaIdFromPhoneNumberId,
  ALLOWED_MEDIA_MIMES,
  classifyTemplateHeaderUpload,
  classifyConversationUpload,
  uploadMediaToWhatsApp,
  uploadTemplateHeaderHandle,
  sendSessionMediaMessage,
  downloadWhatsAppMediaBuffer,
};
