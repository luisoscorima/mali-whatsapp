import type { PrismaService } from '../prisma/prisma.service';
import type { ParamMapping } from '../templates/template-definition.util';

const ATTR_PREFIX = 'attr.';

export type StaticTemplateParams = {
  headerParams: string[];
  bodyParams: string[];
  buttonParams: string[];
  headerMediaUrl: string;
};

export async function fetchContactAttributesMap(
  prisma: PrismaService,
  contactIds: number[],
): Promise<Map<number, Record<string, string>>> {
  if (!contactIds.length) return new Map();
  const rows = await prisma.contact_attributes.findMany({
    where: { contact_id: { in: contactIds } },
    select: { contact_id: true, attr_key: true, attr_value: true },
  });
  const map = new Map<number, Record<string, string>>();
  for (const row of rows) {
    if (!map.has(row.contact_id)) map.set(row.contact_id, {});
    map.get(row.contact_id)![row.attr_key] = String(row.attr_value ?? '');
  }
  return map;
}

function resolveFieldValue(
  source: string,
  contact: { name?: string | null; phone?: string | null },
  attrs?: Record<string, string>,
): string | null {
  const s = String(source || '').trim();
  if (!s || s === 'static') return null;
  if (s === 'contact.name') return String(contact.name || '').trim();
  if (s === 'contact.phone') return String(contact.phone || '').trim();
  if (s.startsWith(ATTR_PREFIX)) {
    const key = s.slice(ATTR_PREFIX.length);
    return String((attrs && attrs[key]) || '').trim();
  }
  return null;
}

export function buildParamsForContact(
  staticParams: StaticTemplateParams,
  paramMapping: ParamMapping | null,
  contact: { name?: string | null; phone?: string | null },
  attrs?: Record<string, string>,
): StaticTemplateParams {
  const out: StaticTemplateParams = {
    headerParams: [...(staticParams.headerParams || [])],
    bodyParams: [...(staticParams.bodyParams || [])],
    buttonParams: [...(staticParams.buttonParams || [])],
    headerMediaUrl: staticParams.headerMediaUrl,
  };
  if (!paramMapping) return out;

  function applyList(listKey: 'headerParams' | 'bodyParams' | 'buttonParams') {
    const sources = paramMapping![listKey];
    if (!Array.isArray(sources)) return;
    const staticList = staticParams[listKey] || [];
    const resolved: string[] = [];
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const dynamic = resolveFieldValue(src, contact, attrs);
      if (dynamic !== null) {
        resolved.push(dynamic);
      } else {
        resolved.push(String(staticList[i] ?? '').trim());
      }
    }
    out[listKey] = resolved;
  }

  applyList('headerParams');
  applyList('bodyParams');
  applyList('buttonParams');
  return out;
}

export function parseParamMappingFromBody(
  def: {
    headerTextSlotCount: number;
    bodySlotCount: number;
    totalButtonParams: number;
  },
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
