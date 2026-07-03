import { extractTemplateDisplayContent } from '../templates/template-display.util';
import { buildTemplateDefinition } from '../templates/template-definition.util';
import { parseCampaignPayload } from './campaign-payload.util';

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

function parseButtonDefs(components: unknown[]) {
  const buttons: { index: number; paramCount: number; offset: number }[] = [];
  for (const raw of components) {
    const c = raw as Record<string, unknown>;
    if (String(c.type || '').toUpperCase() !== 'BUTTONS') continue;
    if (!Array.isArray(c.buttons)) continue;
    c.buttons.forEach((btn, idx) => {
      const b = btn as Record<string, unknown>;
      if (String(b.type || '').toUpperCase() === 'URL' && b.url) {
        const order = extractPlaceholderOrderSequential(String(b.url));
        if (order.length) {
          buttons.push({ index: idx, paramCount: order.length, offset: 0 });
        }
      }
    });
  }
  let offset = 0;
  return buttons.map((btn) => {
    const row = { ...btn, offset };
    offset += btn.paramCount;
    return row;
  });
}

export function formatCampaignParamSourceLabel(source: unknown): string {
  const s = String(source ?? '').trim();
  if (!s || s === 'static') return '';
  if (s === 'contact.name') return 'Nombre del contacto';
  if (s === 'contact.phone') return 'Telefono del contacto';
  if (s.startsWith('attr.')) {
    const key = s.slice('attr.'.length).trim();
    return key ? `Atributo: ${key}` : 'Atributo';
  }
  return s;
}

type ResolvedParams = {
  headerParams: string[];
  bodyParams: string[];
  buttonParams: string[];
  headerMediaUrl?: string;
};

export function buildDetailPreviewParams(
  staticParams: Record<string, unknown> | null | undefined,
  paramMapping: Record<string, unknown> | null | undefined,
): ResolvedParams {
  const base =
    staticParams && typeof staticParams === 'object' ? staticParams : {};
  if (!paramMapping || typeof paramMapping !== 'object') {
    return {
      headerParams: [...((base.headerParams as string[]) || [])],
      bodyParams: [...((base.bodyParams as string[]) || [])],
      buttonParams: [...((base.buttonParams as string[]) || [])],
      headerMediaUrl: String(base.headerMediaUrl || '').trim() || undefined,
    };
  }

  function applyList(listKey: 'headerParams' | 'bodyParams' | 'buttonParams') {
    const mapping = paramMapping as Record<string, unknown>;
    const sources = Array.isArray(mapping[listKey])
      ? (mapping[listKey] as unknown[])
      : [];
    const staticList = Array.isArray(base[listKey])
      ? (base[listKey] as unknown[])
      : [];
    const count = Math.max(sources.length, staticList.length);
    const resolved: string[] = [];
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
    headerMediaUrl: String(base.headerMediaUrl || '').trim() || undefined,
  };
}

function substituteTemplateParams(text: string, params: string[]): string {
  const order = extractPlaceholderOrderSequential(text);
  const paramMap = new Map<string, string>();
  order.forEach((placeholder, idx) => {
    paramMap.set(String(placeholder), String(params[idx] ?? ''));
  });
  return String(text || '').replace(/\{\{(\d+)\}\}/g, (match, token) => {
    return paramMap.has(token) ? paramMap.get(token)! : match;
  });
}

export type CampaignMessagePreview = {
  headerText: string;
  headerMediaType: string | null;
  headerMediaUrl: string | null;
  bodyText: string;
  footerText: string;
  buttons: { type: string; text: string; url: string }[];
};

export function buildCampaignMessagePreview(
  def: ReturnType<typeof buildTemplateDefinition>,
  componentsJson: unknown,
  resolvedParams: ResolvedParams,
): CampaignMessagePreview {
  const components = Array.isArray(componentsJson) ? componentsJson : [];
  const display = extractTemplateDisplayContent(components);
  const buttonDefs = parseButtonDefs(components);

  const headerFormat = String(display.headerFormat || '').toUpperCase();
  let headerMediaType: string | null = null;
  let headerMediaUrl: string | null = null;
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) {
    headerMediaType = headerFormat.toLowerCase();
    headerMediaUrl =
      String(resolvedParams.headerMediaUrl || '').trim() || null;
  }

  const headerText = def.needsHeaderText
    ? substituteTemplateParams(display.headerText, resolvedParams.headerParams)
    : display.headerText
      ? String(display.headerText)
      : '';

  const bodyText = substituteTemplateParams(
    display.bodyText,
    resolvedParams.bodyParams,
  );
  const footerText = display.footerText ? String(display.footerText) : '';

  const buttons = display.buttons.map((displayBtn, idx) => {
    const btnDef = buttonDefs.find((b) => b.index === idx);
    let url = String(displayBtn.url || '');
    if (btnDef && btnDef.paramCount > 0) {
      const slice = resolvedParams.buttonParams.slice(
        btnDef.offset,
        btnDef.offset + btnDef.paramCount,
      );
      url = substituteTemplateParams(displayBtn.url, slice);
    }
    return {
      type: String(displayBtn.type || 'URL').toUpperCase(),
      text: String(displayBtn.text || ''),
      url,
    };
  });

  return {
    headerText: headerText.trim(),
    headerMediaType,
    headerMediaUrl,
    bodyText: bodyText.trim(),
    footerText: footerText.trim(),
    buttons,
  };
}

export function parseStaticParamsFromMessageText(
  def: ReturnType<typeof buildTemplateDefinition>,
  messageText: string | null | undefined,
  imageUrl: string | null | undefined,
): ResolvedParams {
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

  const headerParams: string[] = [];
  for (let i = 0; i < (def.headerTextSlotCount || 0); i++) {
    headerParams.push(parts[idx++] || '');
  }
  const bodyParams: string[] = [];
  for (let i = 0; i < (def.bodySlotCount || 0); i++) {
    bodyParams.push(parts[idx++] || '');
  }
  const buttonParams: string[] = [];
  for (let i = 0; i < (def.totalButtonParams || 0); i++) {
    buttonParams.push(parts[idx++] || '');
  }

  return { headerParams, bodyParams, buttonParams, headerMediaUrl };
}

function applyCampaignImageFallback(
  preview: CampaignMessagePreview,
  imageUrl: string | null | undefined,
): CampaignMessagePreview {
  if (preview.headerMediaType !== 'image' || preview.headerMediaUrl) {
    return preview;
  }
  const url = String(imageUrl || '').trim();
  if (!url) return preview;
  return { ...preview, headerMediaUrl: url };
}

type TemplateRow = {
  id: number;
  name: string;
  language: string;
  category: string | null;
  components_json: unknown;
};

function buildSendContextFromCampaign(
  campaignRow: {
    template_name: string;
    message_text: string | null;
    image_url: string | null;
    campaign_payload: unknown;
  },
  templateRow: TemplateRow | null,
) {
  const payload = parseCampaignPayload(campaignRow.campaign_payload);
  let templateSnapshot = (payload?.templateSnapshot || null) as Record<
    string,
    unknown
  > | null;

  if ((!templateSnapshot || !templateSnapshot.components_json) && templateRow) {
    templateSnapshot = {
      id: templateRow.id,
      name: templateRow.name,
      language: templateRow.language,
      category: templateRow.category || '',
      components_json: templateRow.components_json,
    };
  }

  if (!templateSnapshot?.components_json) return null;

  const def = buildTemplateDefinition({
    id: Number(templateSnapshot.id) || 0,
    name: String(templateSnapshot.name || campaignRow.template_name),
    language: String(templateSnapshot.language || 'es'),
    category: String(templateSnapshot.category || ''),
    status: 'APPROVED',
    components_json: templateSnapshot.components_json,
    placeholder_aliases_json: null,
  });

  const staticParams =
    payload?.staticParams && typeof payload.staticParams === 'object'
      ? (payload.staticParams as Record<string, unknown>)
      : parseStaticParamsFromMessageText(
          def,
          campaignRow.message_text,
          campaignRow.image_url,
        );

  return {
    def,
    templateSnapshot,
    staticParams,
    paramMapping:
      payload?.paramMapping && typeof payload.paramMapping === 'object'
        ? (payload.paramMapping as Record<string, unknown>)
        : null,
  };
}

export function buildCampaignDetailPreviewFromRow(
  campaignRow: {
    template_name: string;
    message_text: string | null;
    image_url: string | null;
    campaign_payload: unknown;
  },
  templateRow: TemplateRow | null,
): { preview: CampaignMessagePreview | null; templateId: number | null } {
  const sendCtx = buildSendContextFromCampaign(campaignRow, templateRow);
  if (!sendCtx) {
    return { preview: null, templateId: null };
  }

  const displayParams = buildDetailPreviewParams(
    sendCtx.staticParams,
    sendCtx.paramMapping,
  );
  let preview = buildCampaignMessagePreview(
    sendCtx.def,
    sendCtx.templateSnapshot.components_json,
    displayParams,
  );
  preview = applyCampaignImageFallback(preview, campaignRow.image_url);

  const hasContent =
    preview.headerText ||
    preview.bodyText ||
    preview.footerText ||
    preview.headerMediaUrl ||
    preview.buttons.length > 0;
  if (!hasContent) {
    return { preview: null, templateId: null };
  }

  let templateId: number | null = Number(sendCtx.templateSnapshot.id);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    templateId = templateRow?.id ?? null;
  }

  return { preview, templateId };
}
