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
            result.buttons.push({ index: idx, paramCount: order.length });
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
  const totalButtonParams = buttonsWithOffset.reduce((a, b) => a + b.paramCount, 0);

  return {
    id: row.id,
    name: row.name,
    language: row.language,
    category: row.category || '',
    status: row.status,
    headerMedia: parsed.headerMedia,
    headerTextOrder: parsed.headerTextOrder,
    headerTextSlotCount: parsed.headerTextOrder.length,
    bodyTextOrder: parsed.bodyTextOrder,
    bodySlotCount: parsed.bodyTextOrder.length,
    buttons: buttonsWithOffset,
    totalButtonParams,
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

function validateTemplateFormValues(def, values, { maxBodyLen, maxUrlLen }) {
  if (def.needsHeaderMedia) {
    if (!values.headerMediaUrl) {
      return { ok: false, message: 'La plantilla requiere URL de imagen/video/documento en la cabecera.' };
    }
    if (values.headerMediaUrl.length > maxUrlLen) {
      return { ok: false, message: `URL demasiado larga (max ${maxUrlLen})` };
    }
  }
  for (let i = 0; i < def.headerTextSlotCount; i++) {
    const v = values.headerParams[i];
    if (!v || v.length > maxBodyLen) {
      return { ok: false, message: `Texto de cabecera ${i + 1} inválido (1-${maxBodyLen} caracteres)` };
    }
  }
  for (let i = 0; i < def.bodySlotCount; i++) {
    const v = values.bodyParams[i];
    if (!v || v.length > maxBodyLen) {
      return { ok: false, message: `Texto del cuerpo ${i + 1} inválido (1-${maxBodyLen} caracteres)` };
    }
  }
  for (let i = 0; i < def.totalButtonParams; i++) {
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
  extractFormValuesForTemplate,
  buildWhatsappGraphComponents,
  validateTemplateFormValues,
};
