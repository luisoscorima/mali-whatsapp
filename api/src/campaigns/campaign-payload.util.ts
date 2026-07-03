export function parseCampaignPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload) return null;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload) as unknown;
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
}

export function formatCampaignSegmentDisplay(campaign: {
  segment?: string | null;
  campaign_payload?: unknown;
}): string {
  const payload = parseCampaignPayload(campaign.campaign_payload);
  const segments = payload?.segments;
  if (Array.isArray(segments) && segments.length) {
    return segments.map((s) => String(s)).join(', ');
  }
  return String(campaign.segment || '');
}
