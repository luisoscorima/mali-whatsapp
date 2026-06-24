const {
  buildAliasLabel,
  parseStoredPlaceholderAliases,
} = require('./templateBuilder');

/**
 * Orden de aparición de {{n}} en el texto (primera ocurrencia de cada índice en orden de lectura).
 */
function extractPlaceholderOrderSequential(text) {
  const s = String(text || '');
  const re = /\{\{(\d+)\}\}/g;
  const order = [];
  let m;
  while ((m = re.exec(s)) !== null) {
    order.push(parseInt(m[1], 10));
  }
  const seen = new Set();
  const out = [];
  for (const n of order) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Analiza components[] devueltos por Meta (message_templates).
 */
function parseMetaTemplateComponents(components) {
  const result = {
    headerMedia: null,
    headerTextOrder: [],
    bodyTextOrder: [],
    buttons: [],
  };

  for (const c of components || []) {
    const type = String(c.type || '').toUpperCase();
    if (type === 'HEADER') {
      const fmt = String(c.format || 'TEXT').toUpperCase();
      if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(fmt)) {
        result.headerMedia = fmt;
      } else if ((fmt === 'TEXT' || !c.format) && c.text) {
        result.headerTextOrder = extractPlaceholderOrderSequential(c.text);
      }
    }
    if (type === 'BODY' && c.text) {
      result.bodyTextOrder = extractPlaceholderOrderSequential(c.text);
    }
    if (type === 'BUTTONS' && Array.isArray(c.buttons)) {
      c.buttons.forEach((btn, idx) => {
        const bt = String(btn.type || '').toUpperCase();
        if (bt === 'URL' && btn.url) {
          const order = extractPlaceholderOrderSequential(btn.url);
          if (order.length) {
            result.buttons.push({ index: idx, paramCount: order.length, order });
          }
        }
      });
    }
  }

  return result;
}

/**
 * Asigna offset global a botones para aplanar parámetros en el formulario.
 */
function assignButtonOffsets(buttons) {
  let offset = 0;
  return buttons.map((b) => {
    const o = { ...b, offset };
    offset += b.paramCount;
    return o;
  });
}

/**
 * Definición para API/UI y para validación.
 */
function buildTemplateDefinition(row) {
  const components = Array.isArray(row.components_json) ? row.components_json : [];
  const parsed = parseMetaTemplateComponents(components);
  const buttonsWithOffset = assignButtonOffsets(parsed.buttons);
  const aliases = parseStoredPlaceholderAliases(row.placeholder_aliases_json);
  const totalButtonParams = buttonsWithOffset.reduce((a, b) => a + b.paramCount, 0);
  const headerParamDefs = parsed.headerTextOrder.map((placeholder, idx) => {
    const alias = String(aliases.headerText[idx] || '').trim();
    return {
      index: idx,
      placeholder,
      alias,
      label: buildAliasLabel(alias, placeholder, 'Texto cabecera', idx),
    };
  });
  const bodyParamDefs = parsed.bodyTextOrder.map((placeholder, idx) => {
    const alias = String(aliases.bodyText[idx] || '').trim();
    return {
      index: idx,
      placeholder,
      alias,
      label: buildAliasLabel(alias, placeholder, 'Texto cuerpo', idx),
    };
  });
  const buttonParamDefs = [];
  const buttons = buttonsWithOffset.map((btn) => {
    const aliasEntry = aliases.buttons.find((entry) => entry.index === btn.index);
    const aliasList = Array.isArray(aliasEntry?.aliases) ? aliasEntry.aliases : [];
    const paramDefs = (btn.order || []).map((placeholder, idx) => {
      const globalIndex = btn.offset + idx;
      const alias = String(aliasList[idx] || '').trim();
      const def = {
        index: globalIndex,
        buttonIndex: btn.index,
        placeholder,
        alias,
        label: buildAliasLabel(alias, placeholder, 'Botón URL', globalIndex),
      };
      buttonParamDefs.push(def);
      return def;
    });
    return {
      ...btn,
      aliases: aliasList,
      paramDefs,
    };
  });

  return {
    id: row.id,
    name: row.name,
    language: row.language,
    category: row.category || '',
    status: row.status,
    headerMedia: parsed.headerMedia,
    headerTextOrder: parsed.headerTextOrder,
    headerTextSlotCount: parsed.headerTextOrder.length,
    headerParamDefs,
    bodyTextOrder: parsed.bodyTextOrder,
    bodySlotCount: parsed.bodyTextOrder.length,
    bodyParamDefs,
    buttons,
    totalButtonParams,
    buttonParamDefs,
    placeholderAliases: aliases,
    needsHeaderMedia: Boolean(parsed.headerMedia),
    needsHeaderText: parsed.headerTextOrder.length > 0,
    needsBody: parsed.bodyTextOrder.length > 0,
  };
}

/**
 * Extrae valores del body HTTP: bodyParam_0, headerParam_0, headerMediaUrl, buttonParam_0...
 */
function extractFormValuesForTemplate(def, body) {
  const headerParams = [];
  for (let i = 0; i < def.headerTextSlotCount; i++) {
    headerParams.push(String(body[`headerParam_${i}`] ?? '').trim());
  }

  const bodyParams = [];
  for (let i = 0; i < def.bodySlotCount; i++) {
    bodyParams.push(String(body[`bodyParam_${i}`] ?? '').trim());
  }

  const buttonParams = [];
  for (let i = 0; i < def.totalButtonParams; i++) {
    buttonParams.push(String(body[`buttonParam_${i}`] ?? '').trim());
  }

  const headerMediaUrl = String(body.headerMediaUrl ?? '').trim();

  return { headerParams, bodyParams, buttonParams, headerMediaUrl };
}

/**
 * Construye el array `components` para Graph API messages (plantilla).
 */
function buildWhatsappGraphComponents(def, values) {
  const components = [];

  if (def.needsHeaderMedia) {
    const link = values.headerMediaUrl;
    const fmt = def.headerMedia.toLowerCase();
    let param;
    if (fmt === 'image') {
      param = { type: 'image', image: { link } };
    } else if (fmt === 'video') {
      param = { type: 'video', video: { link } };
    } else {
      param = {
        type: 'document',
        document: { link, filename: 'document.pdf' },
      };
    }
    components.push({ type: 'header', parameters: [param] });
  } else if (def.needsHeaderText) {
    components.push({
      type: 'header',
      parameters: values.headerParams.map((text) => ({ type: 'text', text })),
    });
  }

  if (def.needsBody) {
    components.push({
      type: 'body',
      parameters: values.bodyParams.map((text) => ({ type: 'text', text })),
    });
  }

  for (const btn of def.buttons) {
    const slice = values.buttonParams.slice(btn.offset, btn.offset + btn.paramCount);
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(btn.index),
      parameters: slice.map((text) => ({ type: 'text', text })),
    });
  }

  return components;
}

/**
 * Texto y metadatos legibles para vista detalle de plantilla.
 */
function extractTemplateDisplayContent(components) {
  const comps = Array.isArray(components) ? components : [];
  let headerText = '';
  let headerFormat = '';
  let bodyText = '';
  let footerText = '';
  const buttons = [];
  let bodyExamples = [];

  for (const c of comps) {
    const type = String(c.type || '').toUpperCase();
    if (type === 'HEADER') {
      headerFormat = String(c.format || 'TEXT').toUpperCase();
      headerText = c.text || '';
    }
    if (type === 'BODY') {
      bodyText = c.text || '';
      if (c.example?.body_text?.[0]) {
        bodyExamples = c.example.body_text[0];
      }
    }
    if (type === 'FOOTER') {
      footerText = c.text || '';
    }
    if (type === 'BUTTONS' && Array.isArray(c.buttons)) {
      for (const btn of c.buttons) {
        buttons.push({
          type: btn.type || '',
          text: btn.text || '',
          url: btn.url || '',
        });
      }
    }
  }

  return { headerText, headerFormat, bodyText, footerText, buttons, bodyExamples };
}

function templateStatusAllowsEdit(status) {
  const s = String(status || '').trim().toUpperCase();
  return s === 'PENDING' || s === 'REJECTED';
}

function validateTemplateFormValues(def, values, { maxBodyLen, maxUrlLen, paramMapping }) {
  function isDynamicParam(listKey, index) {
    if (!paramMapping || !Array.isArray(paramMapping[listKey])) return false;
    const source = String(paramMapping[listKey][index] || '').trim();
    return Boolean(source && source !== 'static');
  }

  if (def.needsHeaderMedia) {
    if (!values.headerMediaUrl) {
      return { ok: false, message: 'La plantilla requiere URL de imagen/video/documento en la cabecera.' };
    }
    if (values.headerMediaUrl.length > maxUrlLen) {
      return { ok: false, message: `URL demasiado larga (max ${maxUrlLen})` };
    }
  }
  for (let i = 0; i < def.headerTextSlotCount; i++) {
    if (isDynamicParam('headerParams', i)) continue;
    const v = values.headerParams[i];
    if (!v || v.length > maxBodyLen) {
      return { ok: false, message: `Texto de cabecera ${i + 1} inválido (1-${maxBodyLen} caracteres)` };
    }
  }
  for (let i = 0; i < def.bodySlotCount; i++) {
    if (isDynamicParam('bodyParams', i)) continue;
    const v = values.bodyParams[i];
    if (!v || v.length > maxBodyLen) {
      return { ok: false, message: `Texto del cuerpo ${i + 1} inválido (1-${maxBodyLen} caracteres)` };
    }
  }
  for (let i = 0; i < def.totalButtonParams; i++) {
    if (isDynamicParam('buttonParams', i)) continue;
    const v = values.buttonParams[i];
    if (!v || v.length > maxBodyLen) {
      return { ok: false, message: `Parámetro de botón ${i + 1} inválido (1-${maxBodyLen} caracteres)` };
    }
  }
  return { ok: true };
}

module.exports = {
  extractPlaceholderOrderSequential,
  parseMetaTemplateComponents,
  buildTemplateDefinition,
  extractTemplateDisplayContent,
  templateStatusAllowsEdit,
  extractFormValuesForTemplate,
  buildWhatsappGraphComponents,
  validateTemplateFormValues,
};
