import { formatCampaignParamSourceLabel } from './campaign-message-preview.util';
import {
  buildParamsForContact,
  type ContactTemplateFields,
  type StaticTemplateParams,
} from './contact-template-params.util';
import type { ParamMapping } from '../templates/template-definition.util';

const SAMPLE_LIMIT = 12;

export type TemplateParamGapByField = {
  source: string;
  label: string;
  count: number;
};

export type TemplateParamGapSample = {
  id: number;
  phone: string;
  name: string;
  missing: string[];
};

export type TemplateParamGapReport = {
  total: number;
  ready: number;
  missing: number;
  missingContactIds: number[];
  byField: TemplateParamGapByField[];
  sample: TemplateParamGapSample[];
};

function sourceLabel(source: string): string {
  if (source.startsWith('static:')) {
    const parts = source.split(':');
    const list = parts[1] || '';
    const idx = Number(parts[2]) + 1;
    if (list === 'headerParams') return `Cabecera ${idx} (fijo)`;
    if (list === 'bodyParams') return `Cuerpo ${idx} (fijo)`;
    if (list === 'buttonParams') return `Botón ${idx} (fijo)`;
    return source;
  }
  return formatCampaignParamSourceLabel(source) || source;
}

/** Huecos de texto (y media) en params ya resueltos; para soft-skip antes de Meta. */
export function listEmptyResolvedParamLabels(
  params: StaticTemplateParams,
  options?: { needsHeaderMedia?: boolean },
): string[] {
  const gaps: string[] = [];
  if (options?.needsHeaderMedia && !String(params.headerMediaUrl || '').trim()) {
    gaps.push('Cabecera media (URL)');
  }
  (params.headerParams || []).forEach((v, i) => {
    if (!String(v ?? '').trim()) gaps.push(`Cabecera ${i + 1}`);
  });
  (params.bodyParams || []).forEach((v, i) => {
    if (!String(v ?? '').trim()) gaps.push(`Cuerpo ${i + 1}`);
  });
  (params.buttonParams || []).forEach((v, i) => {
    if (!String(v ?? '').trim()) gaps.push(`Botón ${i + 1}`);
  });
  return gaps;
}

function missingSourcesForContact(
  staticParams: StaticTemplateParams,
  paramMapping: ParamMapping | null,
  contact: ContactTemplateFields,
  attrs?: Record<string, string>,
): string[] {
  const resolved = buildParamsForContact(
    staticParams,
    paramMapping,
    contact,
    attrs,
  );
  const missing: string[] = [];

  const checkList = (
    listKey: 'headerParams' | 'bodyParams' | 'buttonParams',
  ) => {
    const values = resolved[listKey] || [];
    const sources = paramMapping?.[listKey];
    for (let i = 0; i < values.length; i++) {
      if (String(values[i] ?? '').trim()) continue;
      const src = Array.isArray(sources)
        ? String(sources[i] || 'static').trim() || 'static'
        : 'static';
      missing.push(src === 'static' ? `static:${listKey}:${i}` : src);
    }
  };

  checkList('headerParams');
  checkList('bodyParams');
  checkList('buttonParams');
  return missing;
}

/**
 * Revisa destinatarios vs paramMapping / valores resueltos.
 * Si no hay parámetros de texto, todo está listo.
 */
export function analyzeRecipientTemplateParams(
  recipients: Array<{
    id: number;
    name: string;
    phone: string;
    email?: string | null;
    dni?: string | null;
  }>,
  staticParams: StaticTemplateParams,
  paramMapping: ParamMapping | null,
  attrsMap: Map<number, Record<string, string>>,
): TemplateParamGapReport {
  const slotCount =
    (staticParams.headerParams?.length || 0) +
    (staticParams.bodyParams?.length || 0) +
    (staticParams.buttonParams?.length || 0);

  if (slotCount === 0) {
    return {
      total: recipients.length,
      ready: recipients.length,
      missing: 0,
      missingContactIds: [],
      byField: [],
      sample: [],
    };
  }

  const fieldCounts = new Map<string, number>();
  const missingContactIds: number[] = [];
  const sample: TemplateParamGapSample[] = [];

  for (const row of recipients) {
    const missing = missingSourcesForContact(
      staticParams,
      paramMapping,
      {
        name: row.name,
        phone: row.phone,
        email: row.email,
        dni: row.dni,
      },
      attrsMap.get(row.id),
    );
    if (!missing.length) continue;

    missingContactIds.push(row.id);
    for (const src of missing) {
      fieldCounts.set(src, (fieldCounts.get(src) || 0) + 1);
    }
    if (sample.length < SAMPLE_LIMIT) {
      sample.push({
        id: row.id,
        phone: row.phone,
        name: row.name,
        missing: missing.map(sourceLabel),
      });
    }
  }

  const byField: TemplateParamGapByField[] = [...fieldCounts.entries()]
    .map(([source, count]) => ({
      source,
      label: sourceLabel(source),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const missing = missingContactIds.length;
  return {
    total: recipients.length,
    ready: recipients.length - missing,
    missing,
    missingContactIds,
    byField,
    sample,
  };
}
