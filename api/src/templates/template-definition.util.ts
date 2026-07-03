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

export type TemplateDefinition = {
  id: number;
  name: string;
  language: string;
  category: string;
  status: string;
  headerMedia: string | null;
  headerTextSlotCount: number;
  bodySlotCount: number;
  totalButtonParams: number;
  needsHeaderMedia: boolean;
  needsHeaderText: boolean;
  needsBody: boolean;
};

export function buildTemplateDefinition(row: {
  id: number;
  name: string;
  language: string;
  category: string | null;
  status: string;
  components_json: unknown;
  placeholder_aliases_json: unknown;
}): TemplateDefinition {
  const components = Array.isArray(row.components_json)
    ? row.components_json
    : [];
  const parsed = parseMetaTemplateComponents(components);
  const buttonsWithOffset = assignButtonOffsets(parsed.buttons);
  const totalButtonParams = buttonsWithOffset.reduce(
    (a, b) => a + b.paramCount,
    0,
  );

  return {
    id: row.id,
    name: row.name,
    language: row.language,
    category: row.category || '',
    status: row.status,
    headerMedia: parsed.headerMedia,
    headerTextSlotCount: parsed.headerTextOrder.length,
    bodySlotCount: parsed.bodyTextOrder.length,
    totalButtonParams,
    needsHeaderMedia: Boolean(parsed.headerMedia),
    needsHeaderText: parsed.headerTextOrder.length > 0,
    needsBody: parsed.bodyTextOrder.length > 0,
  };
}
