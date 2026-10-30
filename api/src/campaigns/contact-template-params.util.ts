import type { PrismaService } from '../prisma/prisma.service';
import type { ParamMapping } from '../templates/template-definition.util';
import { firstNamePart } from '../users/advisor-label.util';

const ATTR_PREFIX = 'attr.';
export const USER_NAME_PARAM_SOURCE = 'user.name';

export type StaticTemplateParams = {
  headerParams: string[];
  bodyParams: string[];
  buttonParams: string[];
  headerMediaUrl: string;
};

/** Generales (program_id null) + atributos de la categoría de la línea. */
export async function fetchContactAttributesMap(
  prisma: PrismaService,
  contactIds: number[],
  options?: { programId?: number | null },
): Promise<Map<number, Record<string, string>>> {
  if (!contactIds.length) return new Map();
  const programId = options?.programId;
  const rows = await prisma.contact_attributes.findMany({
    where: {
      contact_id: { in: contactIds },
      ...(options
        ? {
            OR:
              programId == null
                ? [{ program_id: null }]
                : [{ program_id: null }, { program_id: programId }],
          }
        : {}),
    },
    select: {
      contact_id: true,
      attr_key: true,
      attr_value: true,
      program_id: true,
    },
  });
  // Generales primero; la categoría de la línea sobrescribe la misma clave.
  rows.sort(
    (a, b) => Number(a.program_id != null) - Number(b.program_id != null),
  );
  const map = new Map<number, Record<string, string>>();
  for (const row of rows) {
    if (!map.has(row.contact_id)) map.set(row.contact_id, {});
    map.get(row.contact_id)![row.attr_key] = String(row.attr_value ?? '');
  }
  return map;
}

export type ContactTemplateFields = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  dni?: string | null;
};

type TemplateSenderProfile = {
  first_name?: string | null;
  last_name?: string | null;
};

/** Primer nombre + primer apellido del usuario que crea el envío. */
export function formatTemplateSenderName(
  profile: TemplateSenderProfile,
): string {
  return [
    firstNamePart(profile.first_name),
    firstNamePart(profile.last_name),
  ]
    .filter(Boolean)
    .join(' ');
}

export function paramMappingUsesSource(
  paramMapping: ParamMapping | null,
  source: string,
): boolean {
  if (!paramMapping) return false;
  return [
    ...paramMapping.headerParams,
    ...paramMapping.bodyParams,
    ...paramMapping.buttonParams,
  ].some((value) => String(value || '').trim() === source);
}

/**
 * Congela "Nombre de quien envía" como valor fijo al crear el envío. Así las
 * campañas programadas y sus reintentos conservan al usuario que las creó.
 */
export function materializeTemplateSenderName(
  staticParams: StaticTemplateParams,
  paramMapping: ParamMapping | null,
  senderName: string,
): StaticTemplateParams {
  const out: StaticTemplateParams = {
    headerParams: [...staticParams.headerParams],
    bodyParams: [...staticParams.bodyParams],
    buttonParams: [...staticParams.buttonParams],
    headerMediaUrl: staticParams.headerMediaUrl,
  };
  if (!paramMapping) return out;

  function applyList(listKey: 'headerParams' | 'bodyParams' | 'buttonParams') {
    paramMapping![listKey].forEach((source, index) => {
      if (source === USER_NAME_PARAM_SOURCE) out[listKey][index] = senderName;
    });
  }

  applyList('headerParams');
  applyList('bodyParams');
  applyList('buttonParams');
  return out;
}

function resolveFieldValue(
  source: string,
  contact: ContactTemplateFields,
  attrs?: Record<string, string>,
): string | null {
  const s = String(source || '').trim();
  if (!s || s === 'static') return null;
  if (s === 'contact.name') return String(contact.name || '').trim();
  if (s === 'contact.phone') return String(contact.phone || '').trim();
  if (s === 'contact.email') {
    const native = String(contact.email || '').trim();
    if (native) return native;
    return String((attrs && (attrs.email || attrs.correo)) || '').trim();
  }
  if (s === 'contact.dni') {
    const native = String(contact.dni || '').trim();
    if (native) return native;
    return String((attrs && attrs.dni) || '').trim();
  }
  if (s.startsWith(ATTR_PREFIX)) {
    const key = s.slice(ATTR_PREFIX.length);
    return String((attrs && attrs[key]) || '').trim();
  }
  return null;
}

export function buildParamsForContact(
  staticParams: StaticTemplateParams,
  paramMapping: ParamMapping | null,
  contact: ContactTemplateFields,
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
