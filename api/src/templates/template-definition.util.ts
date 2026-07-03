import { parseStoredPlaceholderAliases } from './template-builder.util';

function extractPlaceholderOrderSequential(text: string): number[] {
  const re = /\{\{(\d+)\}\}/g;
  const order: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(String(text || ''))) !== null) {
    order.push(parseInt(match[1], 10));
  }
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of order) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

function parseMetaTemplateComponents(components: unknown[]) {
  const result = {
    headerMedia: null as string | null,
    headerTextOrder: [] as number[],
    bodyTextOrder: [] as number[],
    buttons: [] as {
      index: number;
      paramCount: number;
      order: number[];
    }[],
  };

  for (const raw of components || []) {
    const c = raw as Record<string, unknown>;
    const type = String(c.type || '').toUpperCase();
    if (type === 'HEADER') {
      const fmt = String(c.format || 'TEXT').toUpperCase();
      if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(fmt)) {
        result.headerMedia = fmt;
      } else if ((fmt === 'TEXT' || !c.format) && c.text) {
        result.headerTextOrder = extractPlaceholderOrderSequential(
          String(c.text),
        );
      }
    }
    if (type === 'BODY' && c.text) {
      result.bodyTextOrder = extractPlaceholderOrderSequential(String(c.text));
    }
    if (type === 'BUTTONS' && Array.isArray(c.buttons)) {
      c.buttons.forEach((btn, idx) => {
        const b = btn as Record<string, unknown>;
        if (String(b.type || '').toUpperCase() === 'URL' && b.url) {
          const order = extractPlaceholderOrderSequential(String(b.url));
          if (order.length) {
            result.buttons.push({ index: idx, paramCount: order.length, order });
          }
        }
      });
    }
  }

  return result;
}

function assignButtonOffsets(
  buttons: { index: number; paramCount: number; order: number[] }[],
) {
  let offset = 0;
  return buttons.map((b) => {
    const row = { ...b, offset };
    offset += b.paramCount;
    return row;
  });
}

function buildAliasLabel(
  alias: string,
  placeholderNumber: number,
  fallbackBase: string,
  index: number,
): string {
  if (alias) return `Variable ${alias} ({{${placeholderNumber}}})`;
  return `${fallbackBase} (${index + 1})`;
}

export type TemplateParamDef = {
  index: number;
  placeholder: number;
  alias: string;
  label: string;
  buttonIndex?: number;
};

export type TemplateButtonDef = {
  index: number;
  paramCount: number;
  order: number[];
  offset: number;
  aliases: string[];
  paramDefs: TemplateParamDef[];
};

export type TemplateDefinition = {
  id: number;
  name: string;
  language: string;
  category: string;
  status: string;
  headerMedia: string | null;
  headerTextOrder: number[];
  headerTextSlotCount: number;
  headerParamDefs: TemplateParamDef[];
  bodyTextOrder: number[];
  bodySlotCount: number;
  bodyParamDefs: TemplateParamDef[];
  buttons: TemplateButtonDef[];
  totalButtonParams: number;
  buttonParamDefs: TemplateParamDef[];
  needsHeaderMedia: boolean;
  needsHeaderText: boolean;
  needsBody: boolean;
};

export type TemplateFormValues = {
  headerParams: string[];
  bodyParams: string[];
  buttonParams: string[];
  headerMediaUrl: string;
};

export function buildTemplateDefinition(row: {
  id: number;
  name: string;
  language: string;
  category: string | null;
  status: string;
  components_json: unknown;
  placeholder_aliases_json?: unknown;
}): TemplateDefinition {
  const components = Array.isArray(row.components_json)
    ? row.components_json
    : [];
  const parsed = parseMetaTemplateComponents(components);
  const buttonsWithOffset = assignButtonOffsets(parsed.buttons);
  const aliases = parseStoredPlaceholderAliases(row.placeholder_aliases_json);
  const totalButtonParams = buttonsWithOffset.reduce(
    (a, b) => a + b.paramCount,
    0,
  );

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

  const buttonParamDefs: TemplateParamDef[] = [];
  const buttons: TemplateButtonDef[] = buttonsWithOffset.map((btn) => {
    const aliasEntry = aliases.buttons.find((entry) => entry.index === btn.index);
    const aliasList = Array.isArray(aliasEntry?.aliases) ? aliasEntry.aliases : [];
    const paramDefs = (btn.order || []).map((placeholder, idx) => {
      const globalIndex = btn.offset + idx;
      const alias = String(aliasList[idx] || '').trim();
      const def: TemplateParamDef = {
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
    needsHeaderMedia: Boolean(parsed.headerMedia),
    needsHeaderText: parsed.headerTextOrder.length > 0,
    needsBody: parsed.bodyTextOrder.length > 0,
  };
}

export function extractFormValuesForTemplate(
  def: TemplateDefinition,
  body: Record<string, unknown>,
): TemplateFormValues {
  const headerParams: string[] = [];
  for (let i = 0; i < def.headerTextSlotCount; i++) {
    headerParams.push(String(body[`headerParam_${i}`] ?? '').trim());
  }

  const bodyParams: string[] = [];
  for (let i = 0; i < def.bodySlotCount; i++) {
    bodyParams.push(String(body[`bodyParam_${i}`] ?? '').trim());
  }

  const buttonParams: string[] = [];
  for (let i = 0; i < def.totalButtonParams; i++) {
    buttonParams.push(String(body[`buttonParam_${i}`] ?? '').trim());
  }

  const headerMediaUrl = String(body.headerMediaUrl ?? '').trim();

  return { headerParams, bodyParams, buttonParams, headerMediaUrl };
}

export function buildWhatsappGraphComponents(
  def: TemplateDefinition,
  values: TemplateFormValues,
): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = [];

  if (def.needsHeaderMedia) {
    const link = values.headerMediaUrl;
    const fmt = String(def.headerMedia || '').toLowerCase();
    let param: Record<string, unknown>;
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
    const slice = values.buttonParams.slice(
      btn.offset,
      btn.offset + btn.paramCount,
    );
    components.push({
      type: 'button',
      sub_type: 'url',
      index: String(btn.index),
      parameters: slice.map((text) => ({ type: 'text', text })),
    });
  }

  return components;
}

export function validateTemplateFormValues(
  def: TemplateDefinition,
  values: TemplateFormValues,
  options: {
    maxBodyLen: number;
    maxUrlLen: number;
    paramMapping?: ParamMapping | null;
  },
): { ok: true } | { ok: false; message: string } {
  function isDynamicParam(
    listKey: 'headerParams' | 'bodyParams' | 'buttonParams',
    index: number,
  ): boolean {
    if (!options.paramMapping || !Array.isArray(options.paramMapping[listKey])) {
      return false;
    }
    const source = String(options.paramMapping[listKey][index] || '').trim();
    return Boolean(source && source !== 'static');
  }

  if (def.needsHeaderMedia) {
    if (!values.headerMediaUrl) {
      return {
        ok: false,
        message:
          'La plantilla requiere URL de imagen/video/documento en la cabecera.',
      };
    }
    if (values.headerMediaUrl.length > options.maxUrlLen) {
      return {
        ok: false,
        message: `URL demasiado larga (max ${options.maxUrlLen})`,
      };
    }
  }

  for (let i = 0; i < def.headerTextSlotCount; i++) {
    if (isDynamicParam('headerParams', i)) continue;
    const v = values.headerParams[i];
    if (!v || v.length > options.maxBodyLen) {
      return {
        ok: false,
        message: `Texto de cabecera ${i + 1} inválido (1-${options.maxBodyLen} caracteres)`,
      };
    }
  }

  for (let i = 0; i < def.bodySlotCount; i++) {
    if (isDynamicParam('bodyParams', i)) continue;
    const v = values.bodyParams[i];
    if (!v || v.length > options.maxBodyLen) {
      return {
        ok: false,
        message: `Texto del cuerpo ${i + 1} inválido (1-${options.maxBodyLen} caracteres)`,
      };
    }
  }

  for (let i = 0; i < def.totalButtonParams; i++) {
    if (isDynamicParam('buttonParams', i)) continue;
    const v = values.buttonParams[i];
    if (!v || v.length > options.maxBodyLen) {
      return {
        ok: false,
        message: `Parámetro de botón ${i + 1} inválido (1-${options.maxBodyLen} caracteres)`,
      };
    }
  }

  return { ok: true };
}

export type ParamMapping = {
  headerParams: string[];
  bodyParams: string[];
  buttonParams: string[];
};

export function parseParamMappingFromBody(
  def: TemplateDefinition,
  reqBody: Record<string, unknown>,
): ParamMapping | null {
  const mapping: ParamMapping = {
    headerParams: [],
    bodyParams: [],
    buttonParams: [],
  };
  const add = (
    key: keyof ParamMapping,
    count: number,
    prefix: string,
  ) => {
    for (let i = 0; i < count; i++) {
      const field = `${prefix}_${i}`;
      const src = String(reqBody[field] || 'static').trim() || 'static';
      mapping[key].push(src);
    }
  };
  add('headerParams', def.headerTextSlotCount, 'headerParamSource');
  add('bodyParams', def.bodySlotCount, 'bodyParamSource');
  add('buttonParams', def.totalButtonParams, 'buttonParamSource');
  const hasDynamic = [
    ...mapping.headerParams,
    ...mapping.bodyParams,
    ...mapping.buttonParams,
  ].some((s) => s && s !== 'static');
  return hasDynamic ? mapping : null;
}
