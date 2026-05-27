const VALID_ALIAS_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const PLACEHOLDER_RE = /\{\{([^{}]+)\}\}/g;
const MEDIA_HEADER_TYPES = new Set(['image', 'video', 'document']);
const HEADER_TEXT_MAX_LEN = 60;
const FOOTER_MAX_LEN = 60;
const BUTTON_TEXT_MAX_LEN = 25;
const MAX_URL_BUTTONS = 2;

function trimString(value) {
  return String(value || '').trim();
}

function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trimString(item));
}

function parseStoredPlaceholderAliases(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const src = value && typeof value === 'object' ? value : {};
  const buttons = Array.isArray(src.buttons)
    ? src.buttons
        .map((entry, idx) => ({
          index: Number.isInteger(entry?.index) ? entry.index : idx,
          aliases: toStringArray(entry?.aliases).filter(Boolean),
        }))
        .filter((entry) => entry.aliases.length > 0)
    : [];
  return {
    headerText: toStringArray(src.headerText).filter(Boolean),
    bodyText: toStringArray(src.bodyText).filter(Boolean),
    buttons,
  };
}

function hasPlaceholderAliases(aliases) {
  const parsed = parseStoredPlaceholderAliases(aliases);
  return Boolean(
    parsed.headerText.length ||
      parsed.bodyText.length ||
      parsed.buttons.some((entry) => Array.isArray(entry.aliases) && entry.aliases.length > 0)
  );
}

function replaceNumericPlaceholdersWithAliases(text, aliases) {
  const aliasList = Array.isArray(aliases) ? aliases : [];
  return String(text || '').replace(/\{\{(\d+)\}\}/g, (match, number) => {
    const idx = Number(number) - 1;
    const alias = aliasList[idx];
    return alias ? `{{${alias}}}` : match;
  });
}

function validateAliasToken(raw, fieldLabel) {
  const token = trimString(raw);
  if (!token) {
    throw new Error(`${fieldLabel}: hay una variable vacía.`);
  }
  if (!VALID_ALIAS_RE.test(token)) {
    throw new Error(
      `${fieldLabel}: usa variables como {{fecha}}, {{horario}} o {{mes}} (solo letras, números y guion bajo).`
    );
  }
  return token;
}

function normalizeTemplateTextPlaceholders(text, options = {}) {
  const fieldLabel = trimString(options.fieldLabel) || 'Texto';
  const required = options.required !== false;
  const maxPlaceholders = Number.isInteger(options.maxPlaceholders) ? options.maxPlaceholders : null;
  const maxLength = Number.isInteger(options.maxLength) ? options.maxLength : null;
  const value = trimString(text);

  if (!value) {
    if (required) {
      throw new Error(`${fieldLabel} es obligatorio.`);
    }
    return {
      text: '',
      aliases: [],
      placeholderOrder: [],
      placeholderCount: 0,
      usesAliases: false,
      usesNumericPlaceholders: false,
    };
  }

  if (maxLength && value.length > maxLength) {
    throw new Error(`${fieldLabel} no puede superar ${maxLength} caracteres.`);
  }

  const tokens = [];
  let match;
  while ((match = PLACEHOLDER_RE.exec(value)) !== null) {
    tokens.push(trimString(match[1]));
  }

  if (!tokens.length) {
    return {
      text: value,
      aliases: [],
      placeholderOrder: [],
      placeholderCount: 0,
      usesAliases: false,
      usesNumericPlaceholders: false,
    };
  }

  const numericFlags = tokens.map((token) => /^\d+$/.test(token));
  const hasNumeric = numericFlags.some(Boolean);
  const hasNamed = numericFlags.some((flag) => !flag);

  if (hasNumeric && hasNamed) {
    throw new Error(`${fieldLabel}: no mezcles variables numéricas con variables nombradas.`);
  }

  if (hasNumeric) {
    const order = [];
    const seen = new Set();
    for (const token of tokens) {
      const num = Number(token);
      if (!Number.isInteger(num) || num <= 0) {
        throw new Error(`${fieldLabel}: usa placeholders consecutivos como {{1}}, {{2}}, {{3}}.`);
      }
      if (!seen.has(num)) {
        seen.add(num);
        order.push(num);
      }
    }
    for (let i = 0; i < order.length; i++) {
      if (order[i] !== i + 1) {
        throw new Error(`${fieldLabel}: usa placeholders consecutivos desde {{1}} sin saltos ni reordenamientos.`);
      }
    }
    if (maxPlaceholders != null && order.length > maxPlaceholders) {
      throw new Error(`${fieldLabel}: solo admite ${maxPlaceholders} variable(s).`);
    }
    return {
      text: value,
      aliases: [],
      placeholderOrder: order,
      placeholderCount: order.length,
      usesAliases: false,
      usesNumericPlaceholders: true,
    };
  }

  const aliasOrder = [];
  const aliasToNumber = new Map();
  const normalizedText = value.replace(PLACEHOLDER_RE, (_, rawToken) => {
    const alias = validateAliasToken(rawToken, fieldLabel);
    let number = aliasToNumber.get(alias);
    if (!number) {
      number = aliasOrder.length + 1;
      aliasOrder.push(alias);
      aliasToNumber.set(alias, number);
    }
    return `{{${number}}}`;
  });

  if (maxPlaceholders != null && aliasOrder.length > maxPlaceholders) {
    throw new Error(`${fieldLabel}: solo admite ${maxPlaceholders} variable(s).`);
  }

  return {
    text: normalizedText,
    aliases: aliasOrder,
    placeholderOrder: aliasOrder.map((_, idx) => idx + 1),
    placeholderCount: aliasOrder.length,
    usesAliases: true,
    usesNumericPlaceholders: false,
  };
}

function buildExampleValues(rawValues, placeholderAliases, placeholderCount, fieldLabel) {
  if (!placeholderCount) return [];
  const values = toStringArray(rawValues);
  const aliases = Array.isArray(placeholderAliases) ? placeholderAliases : [];
  const out = [];
  for (let i = 0; i < placeholderCount; i++) {
    const fallback = aliases[i] || `ejemplo${i + 1}`;
    const value = trimString(values[i]) || fallback;
    if (!value) {
      throw new Error(`${fieldLabel}: falta el ejemplo para la variable ${i + 1}.`);
    }
    out.push(value);
  }
  return out;
}

function normalizeFooterText(text) {
  const value = trimString(text);
  if (!value) return '';
  if (value.length > FOOTER_MAX_LEN) {
    throw new Error(`Pie de plantilla no puede superar ${FOOTER_MAX_LEN} caracteres.`);
  }
  if (PLACEHOLDER_RE.test(value)) {
    PLACEHOLDER_RE.lastIndex = 0;
    throw new Error('El pie de plantilla no admite variables.');
  }
  PLACEHOLDER_RE.lastIndex = 0;
  return value;
}

function sanitizeStoredAliases(aliases) {
  const parsed = parseStoredPlaceholderAliases(aliases);
  const out = {};
  if (parsed.headerText.length) out.headerText = parsed.headerText;
  if (parsed.bodyText.length) out.bodyText = parsed.bodyText;
  if (parsed.buttons.length) out.buttons = parsed.buttons;
  return Object.keys(out).length ? out : null;
}

function parseTemplateBuilderPayload(reqBody) {
  const raw = trimString(reqBody && reqBody.builderPayloadJson);
  if (!raw) {
    throw new Error('No se pudo leer la plantilla. Recarga la página e inténtalo de nuevo.');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('La plantilla enviada no es válida.');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('La plantilla enviada no es válida.');
  }
  const header = parsed.header && typeof parsed.header === 'object' ? parsed.header : {};
  const body = parsed.body && typeof parsed.body === 'object' ? parsed.body : {};
  const footer = parsed.footer && typeof parsed.footer === 'object' ? parsed.footer : {};
  const buttons = Array.isArray(parsed.buttons) ? parsed.buttons : [];
  return {
    header: {
      type: trimString(header.type || 'none').toLowerCase() || 'none',
      text: trimString(header.text),
      exampleValues: toStringArray(header.exampleValues),
      exampleMediaUrl: trimString(header.exampleMediaUrl),
      exampleHandle: trimString(header.exampleHandle),
    },
    body: {
      text: trimString(body.text),
      exampleValues: toStringArray(body.exampleValues),
    },
    footer: {
      text: trimString(footer.text),
    },
    buttons: buttons.map((button) => ({
      type: trimString(button?.type || 'url').toLowerCase() || 'url',
      text: trimString(button?.text),
      url: trimString(button?.url),
      exampleValues: toStringArray(button?.exampleValues),
    })),
  };
}

function buildAliasLabel(alias, placeholderNumber, fallbackBase, index) {
  if (alias) return `Variable ${alias} ({{${placeholderNumber}}})`;
  return `${fallbackBase} (${index + 1})`;
}

function buildTemplateBuilderState(components, aliasesRaw) {
  const aliases = parseStoredPlaceholderAliases(aliasesRaw);
  const comps = Array.isArray(components) ? components : [];
  const state = {
    header: {
      type: 'none',
      text: '',
      exampleValues: [],
      exampleMediaUrl: '',
      exampleHandle: '',
    },
    body: {
      text: '',
      exampleValues: [],
    },
    footer: {
      text: '',
    },
    buttons: [],
  };

  for (const comp of comps) {
    const type = trimString(comp?.type).toUpperCase();
    if (type === 'HEADER') {
      const format = trimString(comp?.format || 'TEXT').toUpperCase();
      if (format === 'TEXT') {
        state.header.type = 'text';
        state.header.text = replaceNumericPlaceholdersWithAliases(comp?.text || '', aliases.headerText);
        state.header.exampleValues = toStringArray(comp?.example?.header_text);
      } else if (MEDIA_HEADER_TYPES.has(format.toLowerCase())) {
        state.header.type = format.toLowerCase();
        const handles = Array.isArray(comp?.example?.header_handle) ? comp.example.header_handle : [];
        state.header.exampleHandle = trimString(handles[0]);
      }
    } else if (type === 'BODY') {
      state.body.text = replaceNumericPlaceholdersWithAliases(comp?.text || '', aliases.bodyText);
      state.body.exampleValues = toStringArray(comp?.example?.body_text?.[0]);
    } else if (type === 'FOOTER') {
      state.footer.text = trimString(comp?.text);
    } else if (type === 'BUTTONS' && Array.isArray(comp?.buttons)) {
      comp.buttons.forEach((button, idx) => {
        if (trimString(button?.type).toUpperCase() !== 'URL') return;
        const aliasEntry = aliases.buttons.find((entry) => entry.index === idx);
        state.buttons.push({
          type: 'url',
          text: trimString(button?.text),
          url: replaceNumericPlaceholdersWithAliases(button?.url || '', aliasEntry?.aliases || []),
          exampleValues: toStringArray(button?.example),
        });
      });
    }
  }

  return state;
}

async function compileTemplateBuilderPayload(builderPayload, options = {}) {
  const payload = builderPayload && typeof builderPayload === 'object' ? builderPayload : {};
  const resolveHeaderMediaHandle =
    typeof options.resolveHeaderMediaHandle === 'function' ? options.resolveHeaderMediaHandle : null;

  const components = [];
  const placeholderAliases = {
    headerText: [],
    bodyText: [],
    buttons: [],
  };

  const headerType = trimString(payload.header?.type || 'none').toLowerCase() || 'none';
  if (headerType === 'text') {
    const normalizedHeader = normalizeTemplateTextPlaceholders(payload.header?.text, {
      fieldLabel: 'Texto de cabecera',
      required: true,
      maxPlaceholders: 1,
      maxLength: HEADER_TEXT_MAX_LEN,
    });
    if (/^\s*\{\{\d+\}\}/.test(normalizedHeader.text) || /\{\{\d+\}\}\s*$/.test(normalizedHeader.text)) {
      throw new Error('La cabecera de texto no puede empezar ni terminar con una variable.');
    }
    const headerComponent = {
      type: 'HEADER',
      format: 'TEXT',
      text: normalizedHeader.text,
    };
    if (normalizedHeader.placeholderCount) {
      headerComponent.example = {
        header_text: buildExampleValues(
          payload.header?.exampleValues,
          normalizedHeader.aliases,
          normalizedHeader.placeholderCount,
          'Cabecera'
        ),
      };
    }
    components.push(headerComponent);
    placeholderAliases.headerText = normalizedHeader.aliases;
  } else if (MEDIA_HEADER_TYPES.has(headerType)) {
    if (!resolveHeaderMediaHandle) {
      throw new Error('No hay soporte configurado para cabeceras media.');
    }
    const handle = await resolveHeaderMediaHandle({
      format: headerType,
      exampleMediaUrl: payload.header?.exampleMediaUrl,
      existingHandle: payload.header?.exampleHandle,
    });
    components.push({
      type: 'HEADER',
      format: headerType.toUpperCase(),
      example: {
        header_handle: [handle],
      },
    });
  } else if (headerType !== 'none') {
    throw new Error('Tipo de cabecera no soportado.');
  }

  const normalizedBody = normalizeTemplateTextPlaceholders(payload.body?.text, {
    fieldLabel: 'Texto del cuerpo',
    required: true,
  });
  const bodyComponent = {
    type: 'BODY',
    text: normalizedBody.text,
  };
  if (normalizedBody.placeholderCount) {
    bodyComponent.example = {
      body_text: [
        buildExampleValues(
          payload.body?.exampleValues,
          normalizedBody.aliases,
          normalizedBody.placeholderCount,
          'Cuerpo'
        ),
      ],
    };
  }
  components.push(bodyComponent);
  placeholderAliases.bodyText = normalizedBody.aliases;

  const footerText = normalizeFooterText(payload.footer?.text);
  if (footerText) {
    components.push({
      type: 'FOOTER',
      text: footerText,
    });
  }

  const buttons = Array.isArray(payload.buttons) ? payload.buttons : [];
  if (buttons.length > MAX_URL_BUTTONS) {
    throw new Error(`Solo se permiten ${MAX_URL_BUTTONS} botones URL por plantilla.`);
  }
  const buttonItems = [];
  buttons.forEach((button, idx) => {
    const type = trimString(button?.type || 'url').toLowerCase();
    if (type !== 'url') {
      throw new Error(`El botón ${idx + 1} no es compatible. Solo se permiten botones URL.`);
    }
    const text = trimString(button?.text);
    if (!text) {
      throw new Error(`Texto del botón ${idx + 1} es obligatorio.`);
    }
    if (text.length > BUTTON_TEXT_MAX_LEN) {
      throw new Error(`Texto del botón ${idx + 1} no puede superar ${BUTTON_TEXT_MAX_LEN} caracteres.`);
    }
    const normalizedUrl = normalizeTemplateTextPlaceholders(button?.url, {
      fieldLabel: `URL del botón ${idx + 1}`,
      required: true,
      maxPlaceholders: 1,
    });
    if (normalizedUrl.placeholderCount > 0 && !/\{\{1\}\}$/.test(normalizedUrl.text)) {
      throw new Error(`La URL del botón ${idx + 1} debe terminar con su variable.`);
    }
    const buttonItem = {
      type: 'URL',
      text,
      url: normalizedUrl.text,
    };
    if (normalizedUrl.placeholderCount) {
      buttonItem.example = buildExampleValues(
        button?.exampleValues,
        normalizedUrl.aliases,
        normalizedUrl.placeholderCount,
        `Botón ${idx + 1}`
      );
    }
    buttonItems.push(buttonItem);
    if (normalizedUrl.aliases.length) {
      placeholderAliases.buttons.push({ index: idx, aliases: normalizedUrl.aliases });
    }
  });
  if (buttonItems.length) {
    components.push({
      type: 'BUTTONS',
      buttons: buttonItems,
    });
  }

  return {
    components,
    placeholderAliases: sanitizeStoredAliases(placeholderAliases),
  };
}

function escapeTemplatePreviewHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightTemplatePreviewHtml(text) {
  return escapeTemplatePreviewHtml(text)
    .replace(/\{\{[^{}]+\}\}/g, (match) => `<span class="template-live-preview__token">${match}</span>`)
    .replace(/\n/g, '<br />');
}

function summarizeTemplatePreviewUrl(url) {
  const rendered = String(url || '');
  if (rendered.length <= 44) return escapeTemplatePreviewHtml(rendered);
  return escapeTemplatePreviewHtml(`${rendered.slice(0, 41)}...`);
}

module.exports = {
  HEADER_TEXT_MAX_LEN,
  FOOTER_MAX_LEN,
  BUTTON_TEXT_MAX_LEN,
  MAX_URL_BUTTONS,
  MEDIA_HEADER_TYPES,
  buildAliasLabel,
  buildExampleValues,
  buildTemplateBuilderState,
  compileTemplateBuilderPayload,
  highlightTemplatePreviewHtml,
  hasPlaceholderAliases,
  summarizeTemplatePreviewUrl,
  normalizeTemplateTextPlaceholders,
  parseStoredPlaceholderAliases,
  parseTemplateBuilderPayload,
  replaceNumericPlaceholdersWithAliases,
  sanitizeStoredAliases,
};
