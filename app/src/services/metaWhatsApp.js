const axios = require('axios');
const config = require('../config');
const {
  getWhatsAppCredentialsForArea,
  getWabaIdOverrideForArea,
} = require('./metaSettingsCache');


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

async function fetchAllApprovedTemplates(wabaId, token) {
  const all = [];
  let after = null;
  do {
    const data = await fetchMessageTemplatesPage(wabaId, token, after);
    const list = Array.isArray(data.data) ? data.data : [];
    for (const t of list) {
      if (String(t.status || '').toUpperCase() === 'APPROVED') {
        all.push(t);
      }
    }
    after = data.paging?.cursors?.after || null;
  } while (after);
  return all;
}

async function sendTemplateWithComponents({ to, templateName, languageCode, components, area }) {
  const { token, phoneNumberId } = getWhatsAppCredentialsForArea(area);
  if (!token || !phoneNumberId) {
    throw new Error(
      'Faltan credenciales WhatsApp para esta area: define WHATSAPP_TOKEN_PAM/PHONE_NUMBER_ID_PAM y WHATSAPP_TOKEN_EDUCACION/PHONE_NUMBER_ID_EDUCACION (o WHATSAPP_TOKEN/PHONE_NUMBER_ID como respaldo)'
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

async function sendSessionTextMessage({ to, text, area }) {
  const { token, phoneNumberId } = getWhatsAppCredentialsForArea(area);
  if (!token || !phoneNumberId) {
    throw new Error(
      'Faltan credenciales WhatsApp para esta area: define WHATSAPP_TOKEN_PAM/PHONE_NUMBER_ID_PAM y WHATSAPP_TOKEN_EDUCACION/PHONE_NUMBER_ID_EDUCACION (o WHATSAPP_TOKEN/PHONE_NUMBER_ID como respaldo)'
    );
  }
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

module.exports = {
  getWhatsAppCredentialsForArea,
  getWabaIdOverrideForArea,
  resolveWabaId,
  fetchAllApprovedTemplates,
  sendTemplateWithComponents,
  sendSessionTextMessage,
  fetchWabaIdFromPhoneNumberId,
};
