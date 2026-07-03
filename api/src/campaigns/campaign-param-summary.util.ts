import { formatCampaignParamSourceLabel } from './campaign-message-preview.util';
import { parseCampaignPayload } from './campaign-payload.util';

export type CampaignParamSummaryItem = {
  label: string;
  value: string;
  kind: 'static' | 'dynamic';
};

export function buildCampaignParamSummary(campaign: {
  campaign_payload: unknown;
}): CampaignParamSummaryItem[] {
  const payload = parseCampaignPayload(campaign.campaign_payload);
  if (!payload) return [];

  const staticParams =
    payload.staticParams && typeof payload.staticParams === 'object'
      ? (payload.staticParams as Record<string, unknown>)
      : {};
  const paramMapping =
    payload.paramMapping && typeof payload.paramMapping === 'object'
      ? (payload.paramMapping as Record<string, unknown>)
      : {};

  const items: CampaignParamSummaryItem[] = [];

  const headerMediaUrl = String(staticParams.headerMediaUrl || '').trim();
  if (headerMediaUrl) {
    items.push({
      label: 'Cabecera media',
      value: `Valor fijo: ${headerMediaUrl}`,
      kind: 'static',
    });
  }

  function addList(
    listKey: 'headerParams' | 'bodyParams' | 'buttonParams',
    labelPrefix: string,
  ) {
    const staticList = Array.isArray(staticParams[listKey])
      ? staticParams[listKey]
      : [];
    const sourceList = Array.isArray(paramMapping[listKey])
      ? paramMapping[listKey]
      : [];
    const count = Math.max(staticList.length, sourceList.length);
    for (let i = 0; i < count; i++) {
      const sourceLabel = formatCampaignParamSourceLabel(sourceList[i]);
      if (sourceLabel) {
        items.push({
          label: `${labelPrefix} ${i + 1}`,
          value: sourceLabel,
          kind: 'dynamic',
        });
        continue;
      }
      const fixedValue = String(staticList[i] ?? '').trim();
      if (!fixedValue) continue;
      items.push({
        label: `${labelPrefix} ${i + 1}`,
        value: `Valor fijo: ${fixedValue}`,
        kind: 'static',
      });
    }
  }

  addList('headerParams', 'Cabecera');
  addList('bodyParams', 'Cuerpo');
  addList('buttonParams', 'Boton URL');

  return items;
}

export function readCampaignExclusions(campaignPayload: unknown): {
  exclude_segment_slugs: string[];
  exclude_contact_ids: number[];
} {
  const payload = parseCampaignPayload(campaignPayload);
  const exclude_segment_slugs = Array.isArray(payload?.excludeSegmentSlugs)
    ? payload!.excludeSegmentSlugs.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const exclude_contact_ids = Array.isArray(payload?.excludeContactIds)
    ? payload!.excludeContactIds
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    : [];
  return { exclude_segment_slugs, exclude_contact_ids };
}
