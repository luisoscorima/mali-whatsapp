const VALID_ALIAS_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const PLACEHOLDER_RE = /\{\{([^{}]+)\}\}/g;
export const MEDIA_HEADER_TYPES = new Set(['image', 'video', 'document']);
export const HEADER_TEXT_MAX_LEN = 60;
export const FOOTER_MAX_LEN = 60;
export const BUTTON_TEXT_MAX_LEN = 25;
export const MAX_URL_BUTTONS = 2;
export const MAX_QUICK_REPLY_BUTTONS = 3;
export const MAX_TEMPLATE_BUTTONS = 3;

export type PlaceholderAliases = {
  headerText: string[];
  bodyText: string[];
  buttons: { index: number; aliases: string[] }[];
};

export type TemplateBuilderPayload = {
  header: {
    type: string;
    text: string;
    exampleValues: string[];
    exampleMediaUrl: string;
    exampleHandle: string;
  };
  body: {
    text: string;
    exampleValues: string[];
  };
  footer: {
    text: string;
  };
  buttons: {
    type: string;
    text: string;
    url: string;
    exampleValues: string[];
  }[];
};

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => trimString(item));
}

export function parseStoredPlaceholderAliases(
  raw: unknown,
): PlaceholderAliases {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  const src =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const buttons = Array.isArray(src.buttons)
    ? src.buttons
        .map((entry, idx) => {
          const row = entry as Record<string, unknown>;
          return {
            index: Number.isInteger(row?.index) ? (row.index as number) : idx,
            aliases: toStringArray(row?.aliases).filter(Boolean),
          };
        })
        .filter((entry) => entry.aliases.length > 0)
    : [];
  return {
    headerText: toStringArray(src.headerText).filter(Boolean),
    bodyText: toStringArray(src.bodyText).filter(Boolean),
    buttons,
  };
}

export function hasPlaceholderAliases(aliases: unknown): boolean {
  const parsed = parseStoredPlaceholderAliases(aliases);
  return Boolean(
    parsed.headerText.length ||
      parsed.bodyText.length ||
      parsed.buttons.some(
        (entry) => Array.isArray(entry.aliases) && entry.aliases.length > 0,
      ),
  );
}

export function replaceNumericPlaceholdersWithAliases(
  text: string,
  aliases: string[],
): string {
  const aliasList = Array.isArray(aliases) ? aliases : [];
  return String(text || '').replace(/\{\{(\d+)\}\}/g, (match, number) => {
    const idx = Number(number) - 1;
    const alias = aliasList[idx];
    return alias ? `{{${alias}}}` : match;
  });
}

function validateAliasToken(raw: string, fieldLabel: string): string {
  const token = trimString(raw);
  if (!token) {
    throw new Error(`${fieldLabel}: hay una variable vacía.`);
  }
  if (!VALID_ALIAS_RE.test(token)) {
    throw new Error(
      `${fieldLabel}: usa variables como {{fecha}}, {{horario}} o {{mes}} (solo letras, números y guion bajo).`,
    );
  }
  return token;
}

type NormalizePlaceholderResult = {
  text: string;
  aliases: string[];
  placeholderOrder: number[];
  placeholderCount: number;
  usesAliases: boolean;
  usesNumericPlaceholders: boolean;
};

export function normalizeTemplateTextPlaceholders(
  text: string,
  options: {
    fieldLabel?: string;
    required?: boolean;
    maxPlaceholders?: number | null;
    maxLength?: number | null;
  } = {},
): NormalizePlaceholderResult {
  const fieldLabel = trimString(options.fieldLabel) || 'Texto';
  const required = options.required !== false;
  const maxPlaceholders = Number.isInteger(options.maxPlaceholders)
    ? options.maxPlaceholders
    : null;
  const maxLength = Number.isInteger(options.maxLength)
    ? options.maxLength
    : null;
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

  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_RE.source, 'g');
  while ((match = re.exec(value)) !== null) {
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
    throw new Error(
      `${fieldLabel}: no mezcles variables numéricas con variables nombradas.`,
    );
  }

  if (hasNumeric) {
    const order: number[] = [];
    const seen = new Set<number>();
    for (const token of tokens) {
      const num = Number(token);
      if (!Number.isInteger(num) || num <= 0) {
        throw new Error(
          `${fieldLabel}: usa placeholders consecutivos como {{1}}, {{2}}, {{3}}.`,
        );
      }
      if (!seen.has(num)) {
        seen.add(num);
        order.push(num);
      }
    }
    for (let i = 0; i < order.length; i++) {
      if (order[i] !== i + 1) {
        throw new Error(
          `${fieldLabel}: usa placeholders consecutivos desde {{1}} sin saltos ni reordenamientos.`,
        );
      }
    }
    if (maxPlaceholders != null && order.length > maxPlaceholders) {
      throw new Error(
        `${fieldLabel}: solo admite ${maxPlaceholders} variable(s).`,
      );
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

  const aliasOrder: string[] = [];
  const aliasToNumber = new Map<string, number>();
  const normalizedText = value.replace(PLACEHOLDER_RE, (_, rawToken: string) => {
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
    throw new Error(
      `${fieldLabel}: solo admite ${maxPlaceholders} variable(s).`,
    );
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

export function buildExampleValues(
  rawValues: unknown,
  placeholderAliases: string[],
  placeholderCount: number,
  fieldLabel: string,
): string[] {
  if (!placeholderCount) return [];
  const values = toStringArray(rawValues);
  const aliases = Array.isArray(placeholderAliases) ? placeholderAliases : [];
  const out: string[] = [];
  for (let i = 0; i < placeholderCount; i++) {
    const fallback = aliases[i] || `ejemplo${i + 1}`;
    const value = trimString(values[i]) || fallback;
    if (!value) {
      throw new Error(
        `${fieldLabel}: falta el ejemplo para la variable ${i + 1}.`,
      );
    }
    out.push(value);
  }
  return out;
}

function normalizeFooterText(text: string): string {
  const value = trimString(text);
  if (!value) return '';
  if (value.length > FOOTER_MAX_LEN) {
    throw new Error(
      `Pie de plantilla no puede superar ${FOOTER_MAX_LEN} caracteres.`,
    );
  }
  if (PLACEHOLDER_RE.test(value)) {
    PLACEHOLDER_RE.lastIndex = 0;
    throw new Error('El pie de plantilla no admite variables.');
  }
  PLACEHOLDER_RE.lastIndex = 0;
  return value;
}

function sanitizeStoredAliases(
  aliases: PlaceholderAliases,
): PlaceholderAliases | null {
  const out: Partial<PlaceholderAliases> = {};
  if (aliases.headerText.length) out.headerText = aliases.headerText;
  if (aliases.bodyText.length) out.bodyText = aliases.bodyText;
  if (aliases.buttons.length) out.buttons = aliases.buttons;
  return Object.keys(out).length ? (out as PlaceholderAliases) : null;
}

export function normalizeBuilderPayload(
  raw: unknown,
): TemplateBuilderPayload {
  if (!raw || typeof raw !== 'object') {
    throw new Error('La plantilla enviada no es válida.');
  }
  const parsed = raw as Record<string, unknown>;
  const header =
    parsed.header && typeof parsed.header === 'object'
      ? (parsed.header as Record<string, unknown>)
      : {};
  const body =
    parsed.body && typeof parsed.body === 'object'
      ? (parsed.body as Record<string, unknown>)
      : {};
  const footer =
    parsed.footer && typeof parsed.footer === 'object'
      ? (parsed.footer as Record<string, unknown>)
      : {};
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
    buttons: buttons.map((button) => {
      const b = button as Record<string, unknown>;
      return {
        type: trimString(b?.type || 'url').toLowerCase() || 'url',
        text: trimString(b?.text),
        url: trimString(b?.url),
        exampleValues: toStringArray(b?.exampleValues),
      };
    }),
  };
}

export function buildTemplateBuilderState(
  components: unknown,
  aliasesRaw: unknown,
): TemplateBuilderPayload {
  const aliases = parseStoredPlaceholderAliases(aliasesRaw);
  const comps = Array.isArray(components) ? components : [];
  const state: TemplateBuilderPayload = {
    header: {
      type: 'none',
      text: '',
      exampleValues: [],
      exampleMediaUrl: '',
      exampleHandle: '',
    },
    body: { text: '', exampleValues: [] },
    footer: { text: '' },
    buttons: [],
  };

  for (const comp of comps) {
    const row = comp as Record<string, unknown>;
    const type = trimString(row?.type).toUpperCase();
    if (type === 'HEADER') {
      const format = trimString(row?.format || 'TEXT').toUpperCase();
      if (format === 'TEXT') {
        state.header.type = 'text';
        state.header.text = replaceNumericPlaceholdersWithAliases(
          String(row?.text || ''),
          aliases.headerText,
        );
        const example = row?.example as { header_text?: string[] } | undefined;
        state.header.exampleValues = toStringArray(example?.header_text);
      } else if (MEDIA_HEADER_TYPES.has(format.toLowerCase())) {
        state.header.type = format.toLowerCase();
        const example = row?.example as { header_handle?: string[] } | undefined;
        const handles = Array.isArray(example?.header_handle)
          ? example.header_handle
          : [];
        state.header.exampleHandle = trimString(handles[0]);
      }
    } else if (type === 'BODY') {
      state.body.text = replaceNumericPlaceholdersWithAliases(
        String(row?.text || ''),
        aliases.bodyText,
      );
      const example = row?.example as { body_text?: string[][] } | undefined;
      state.body.exampleValues = toStringArray(example?.body_text?.[0]);
    } else if (type === 'FOOTER') {
      state.footer.text = trimString(row?.text);
    } else if (type === 'BUTTONS' && Array.isArray(row?.buttons)) {
      row.buttons.forEach((button, idx) => {
        const b = button as Record<string, unknown>;
        const btnType = trimString(b?.type).toUpperCase();
        if (btnType === 'QUICK_REPLY') {
          state.buttons.push({
            type: 'quick_reply',
            text: trimString(b?.text),
            url: '',
            exampleValues: [],
          });
          return;
        }
        if (btnType !== 'URL') return;
        const aliasEntry = aliases.buttons.find((entry) => entry.index === idx);
        state.buttons.push({
          type: 'url',
          text: trimString(b?.text),
          url: replaceNumericPlaceholdersWithAliases(
            String(b?.url || ''),
            aliasEntry?.aliases || [],
          ),
          exampleValues: toStringArray(b?.example),
        });
      });
    }
  }

  return state;
}

export type CompileTemplateResult = {
  components: Record<string, unknown>[];
  placeholderAliases: PlaceholderAliases | null;
};

export type ResolveHeaderMediaHandle = (input: {
  format: string;
  exampleMediaUrl: string;
  existingHandle: string;
}) => Promise<string>;

export async function compileTemplateBuilderPayload(
  builderPayload: TemplateBuilderPayload,
  options: { resolveHeaderMediaHandle?: ResolveHeaderMediaHandle } = {},
): Promise<CompileTemplateResult> {
  const resolveHeaderMediaHandle = options.resolveHeaderMediaHandle ?? null;
  const components: Record<string, unknown>[] = [];
  const placeholderAliases: PlaceholderAliases = {
    headerText: [],
    bodyText: [],
    buttons: [],
  };

  const headerType =
    trimString(builderPayload.header?.type || 'none').toLowerCase() || 'none';
  if (headerType === 'text') {
    const normalizedHeader = normalizeTemplateTextPlaceholders(
      builderPayload.header?.text,
      {
        fieldLabel: 'Texto de cabecera',
        required: true,
        maxPlaceholders: 1,
        maxLength: HEADER_TEXT_MAX_LEN,
      },
    );
    if (
      /^\s*\{\{\d+\}\}/.test(normalizedHeader.text) ||
      /\{\{\d+\}\}\s*$/.test(normalizedHeader.text)
    ) {
      throw new Error(
        'La cabecera de texto no puede empezar ni terminar con una variable.',
      );
    }
    const headerComponent: Record<string, unknown> = {
      type: 'HEADER',
      format: 'TEXT',
      text: normalizedHeader.text,
    };
    if (normalizedHeader.placeholderCount) {
      headerComponent.example = {
        header_text: buildExampleValues(
          builderPayload.header?.exampleValues,
          normalizedHeader.aliases,
          normalizedHeader.placeholderCount,
          'Cabecera',
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
      exampleMediaUrl: builderPayload.header?.exampleMediaUrl,
      existingHandle: builderPayload.header?.exampleHandle,
    });
    components.push({
      type: 'HEADER',
      format: headerType.toUpperCase(),
      example: { header_handle: [handle] },
    });
  } else if (headerType !== 'none') {
    throw new Error('Tipo de cabecera no soportado.');
  }

  const normalizedBody = normalizeTemplateTextPlaceholders(
    builderPayload.body?.text,
    { fieldLabel: 'Texto del cuerpo', required: true },
  );
  const bodyComponent: Record<string, unknown> = {
    type: 'BODY',
    text: normalizedBody.text,
  };
  if (normalizedBody.placeholderCount) {
    bodyComponent.example = {
      body_text: [
        buildExampleValues(
          builderPayload.body?.exampleValues,
          normalizedBody.aliases,
          normalizedBody.placeholderCount,
          'Cuerpo',
        ),
      ],
    };
  }
  components.push(bodyComponent);
  placeholderAliases.bodyText = normalizedBody.aliases;

  const footerText = normalizeFooterText(builderPayload.footer?.text);
  if (footerText) {
    components.push({ type: 'FOOTER', text: footerText });
  }

  const buttons = Array.isArray(builderPayload.buttons)
    ? builderPayload.buttons
    : [];
  if (buttons.length > MAX_TEMPLATE_BUTTONS) {
    throw new Error(
      `Solo se permiten ${MAX_TEMPLATE_BUTTONS} botones por plantilla.`,
    );
  }
  const urlCount = buttons.filter(
    (b) => trimString(b?.type || 'url').toLowerCase() === 'url',
  ).length;
  const qrCount = buttons.filter(
    (b) => trimString(b?.type || '').toLowerCase() === 'quick_reply',
  ).length;
  if (urlCount > MAX_URL_BUTTONS) {
    throw new Error(
      `Solo se permiten ${MAX_URL_BUTTONS} botones URL por plantilla.`,
    );
  }
  if (qrCount > MAX_QUICK_REPLY_BUTTONS) {
    throw new Error(
      `Solo se permiten ${MAX_QUICK_REPLY_BUTTONS} botones de respuesta rápida.`,
    );
  }
  const buttonItems: Record<string, unknown>[] = [];
  buttons.forEach((button, idx) => {
    const type = trimString(button?.type || 'url').toLowerCase();
    const text = trimString(button?.text);
    if (!text) {
      throw new Error(`Texto del botón ${idx + 1} es obligatorio.`);
    }
    if (text.length > BUTTON_TEXT_MAX_LEN) {
      throw new Error(
        `Texto del botón ${idx + 1} no puede superar ${BUTTON_TEXT_MAX_LEN} caracteres.`,
      );
    }

    if (type === 'quick_reply') {
      buttonItems.push({
        type: 'QUICK_REPLY',
        text,
      });
      return;
    }

    if (type !== 'url') {
      throw new Error(
        `El botón ${idx + 1} no es compatible. Usa URL o respuesta rápida.`,
      );
    }
    const normalizedUrl = normalizeTemplateTextPlaceholders(button?.url, {
      fieldLabel: `URL del botón ${idx + 1}`,
      required: true,
      maxPlaceholders: 1,
    });
    if (
      normalizedUrl.placeholderCount > 0 &&
      !/\{\{1\}\}$/.test(normalizedUrl.text)
    ) {
      throw new Error(
        `La URL del botón ${idx + 1} debe terminar con su variable.`,
      );
    }
    const buttonItem: Record<string, unknown> = {
      type: 'URL',
      text,
      url: normalizedUrl.text,
    };
    if (normalizedUrl.placeholderCount) {
      buttonItem.example = buildExampleValues(
        button?.exampleValues,
        normalizedUrl.aliases,
        normalizedUrl.placeholderCount,
        `Botón ${idx + 1}`,
      );
    }
    buttonItems.push(buttonItem);
    if (normalizedUrl.aliases.length) {
      placeholderAliases.buttons.push({
        index: idx,
        aliases: normalizedUrl.aliases,
      });
    }
  });
  if (buttonItems.length) {
    components.push({ type: 'BUTTONS', buttons: buttonItems });
  }

  return {
    components,
    placeholderAliases: sanitizeStoredAliases(placeholderAliases),
  };
}

export const TEMPLATE_NAME_REGEX = /^[a-z0-9_]{1,128}$/;

export function normalizeTemplateName(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 128);
}
