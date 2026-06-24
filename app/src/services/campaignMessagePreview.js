const {
  extractPlaceholderOrderSequential,
  extractTemplateDisplayContent,
} = require('./templateParser');
const { buildSendContextFromCampaign } = require('./campaignSendContext');

function formatCampaignParamSourceLabel(source) {
  const s = String(source || '').trim();
  if (!s || s === 'static') return '';
  if (s === 'contact.name') return 'Nombre del contacto';
  if (s === 'contact.phone') return 'Telefono del contacto';
  if (s.startsWith('attr.')) {
    const key = s.slice('attr.'.length).trim();
    return key ? `Atributo: ${key}` : 'Atributo';
  }
  return s;
}

/**
 * Parámetros para vista previa en detalle de campaña: valores fijos reales y
 * etiquetas entre corchetes para orígenes dinámicos.
 */
function buildDetailPreviewParams(staticParams, paramMapping) {
  const base = staticParams && typeof staticParams === 'object' ? staticParams : {};
  if (!paramMapping || typeof paramMapping !== 'object') {
    return {
      headerParams: [...(base.headerParams || [])],
      bodyParams: [...(base.bodyParams || [])],
      buttonParams: [...(base.buttonParams || [])],
      headerMediaUrl: base.headerMediaUrl,
    };
  }

  function applyList(listKey) {
    const sources = Array.isArray(paramMapping[listKey]) ? paramMapping[listKey] : [];
    const staticList = Array.isArray(base[listKey]) ? base[listKey] : [];
    const count = Math.max(sources.length, staticList.length);
    const resolved = [];
    for (let i = 0; i < count; i++) {
      const label = formatCampaignParamSourceLabel(sources[i]);
      if (label) {
        resolved.push(`[${label}]`);
        continue;
      }
      resolved.push(String(staticList[i] ?? '').trim());
    }
    return resolved;
  }

  return {
    headerParams: applyList('headerParams'),
    bodyParams: applyList('bodyParams'),
    buttonParams: applyList('buttonParams'),
    headerMediaUrl: base.headerMediaUrl,
  };
}

function substituteTemplateParams(text, params) {
  const order = extractPlaceholderOrderSequential(text);
  const paramMap = new Map();
  order.forEach((placeholder, idx) => {
    paramMap.set(String(placeholder), String(params[idx] ?? ''));
  });
  return String(text || '').replace(/\{\{(\d+)\}\}/g, (match, token) => {
    return paramMap.has(token) ? paramMap.get(token) : match;
  });
}

/**
 * Genera la vista previa personalizada de una plantilla de campaña para un contacto.
 * @param {object} def - definición de plantilla (buildTemplateDefinition)
 * @param {Array|object} componentsJson - components_json de la plantilla
 * @param {object} resolvedParams - headerParams, bodyParams, buttonParams, headerMediaUrl
 */
function buildCampaignMessagePreview(def, componentsJson, resolvedParams) {
  const components = Array.isArray(componentsJson) ? componentsJson : [];
  const display = extractTemplateDisplayContent(components);
  const params = resolvedParams || {};

  const headerFormat = String(display.headerFormat || '').toUpperCase();
  let headerMediaType = null;
  let headerMediaUrl = null;
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
    headerMediaType = headerFormat.toLowerCase();
    headerMediaUrl = String(params.headerMediaUrl || '').trim() || null;
  }

  const headerText =
    def && def.needsHeaderText
      ? substituteTemplateParams(display.headerText, params.headerParams || [])
      : display.headerText
        ? String(display.headerText)
        : '';

  const bodyText = substituteTemplateParams(display.bodyText, params.bodyParams || []);
  const footerText = display.footerText ? String(display.footerText) : '';

  const buttons = (display.buttons || []).map((displayBtn, idx) => {
    const btnDef =
      def && Array.isArray(def.buttons) ? def.buttons.find((b) => b.index === idx) : null;
    let url = String(displayBtn.url || '');
    if (btnDef && btnDef.paramCount > 0) {
      const slice = (params.buttonParams || []).slice(
        btnDef.offset,
        btnDef.offset + btnDef.paramCount
      );
      url = substituteTemplateParams(displayBtn.url, slice);
    }
    return {
      type: String(displayBtn.type || 'URL').toUpperCase(),
      text: String(displayBtn.text || ''),
      url,
    };
  });

  const preview = {
    headerText: headerText.trim(),
    headerMediaType,
    headerMediaUrl,
    bodyText: bodyText.trim(),
    footerText: footerText.trim(),
    buttons,
  };

  const bodyTextForSearch = [preview.headerText, preview.bodyText].filter(Boolean).join('\n\n');

  return { preview, bodyTextForSearch: bodyTextForSearch || preview.bodyText };
}

/** Completa URL de cabecera imagen desde campaigns.image_url si falta en preview. */
function applyCampaignImageFallback(preview, imageUrl) {
  if (!preview || preview.headerMediaType !== 'image' || preview.headerMediaUrl) {
    return preview;
  }
  const url = String(imageUrl || '').trim();
  if (!url) return preview;
  return { ...preview, headerMediaUrl: url };
}

function parseStaticParamsFromMessageText(def, messageText, imageUrl) {
  const parts = String(messageText || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  let idx = 0;
  let headerMediaUrl = String(imageUrl || '').trim();

  if (parts[0] && /^media:/i.test(parts[0])) {
    headerMediaUrl = parts[0].replace(/^media:/i, '').trim();
    idx = 1;
  }

  const headerParams = [];
  for (let i = 0; i < (def.headerTextSlotCount || 0); i++) {
    headerParams.push(parts[idx++] || '');
  }
  const bodyParams = [];
  for (let i = 0; i < (def.bodySlotCount || 0); i++) {
    bodyParams.push(parts[idx++] || '');
  }
  const buttonParams = [];
  for (let i = 0; i < (def.totalButtonParams || 0); i++) {
    buttonParams.push(parts[idx++] || '');
  }

  return { headerParams, bodyParams, buttonParams, headerMediaUrl };
}

/**
 * Vista previa editorial para detalle de campaña (valores fijos + etiquetas dinámicas).
 * @param {object} campaignRow - fila de campaigns
 * @param {object|null} templateRow - plantilla en caché si falta snapshot completo
 */
function buildCampaignDetailPreviewFromRow(campaignRow, templateRow) {
  const sendCtx = buildSendContextFromCampaign(campaignRow, templateRow);
  if (!sendCtx) {
    return { preview: null, templateId: null };
  }

  const displayParams = buildDetailPreviewParams(sendCtx.staticParams, sendCtx.paramMapping);
  let { preview } = buildCampaignMessagePreview(
    sendCtx.def,
    sendCtx.templateSnapshot.components_json,
    displayParams
  );
  preview = applyCampaignImageFallback(preview, campaignRow.image_url);

  const hasContent =
    preview &&
    (preview.headerText ||
      preview.bodyText ||
      preview.footerText ||
      preview.headerMediaUrl ||
      (preview.buttons && preview.buttons.length));
  if (!hasContent) {
    return { preview: null, templateId: null };
  }

  let templateId = Number(sendCtx.templateSnapshot.id);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    templateId = templateRow && Number.isInteger(templateRow.id) ? templateRow.id : null;
  }

  return { preview, templateId };
}

module.exports = {
  buildCampaignMessagePreview,
  buildCampaignDetailPreviewFromRow,
  buildDetailPreviewParams,
  formatCampaignParamSourceLabel,
  substituteTemplateParams,
  parseStaticParamsFromMessageText,
  applyCampaignImageFallback,
};
