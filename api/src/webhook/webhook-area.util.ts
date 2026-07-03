import { BUSINESS_AREAS, type BusinessArea } from '../config/areas';
import {
  getWabaIdOverrideForArea,
  getWhatsAppCredentialsForArea,
} from '../templates/whatsapp-meta.util';
import type { MetaWebhookChangeValue } from './webhook.types';

export type InboundAreaResolution = {
  area: BusinessArea | null;
  source: string | null;
};

export function resolveAreaFromPhoneNumberId(
  phoneNumberId: string | null | undefined,
): BusinessArea | null {
  const id = String(phoneNumberId || '').trim();
  const lines = BUSINESS_AREAS.map((area) => ({
    area,
    pid: getWhatsAppCredentialsForArea(area).phoneNumberId,
  })).filter((x) => String(x.pid || '').trim());
  const matching = lines.filter((x) => x.pid === id);
  if (matching.length === 1) return matching[0].area;
  return null;
}

export function resolveInboundArea(
  value: MetaWebhookChangeValue | undefined,
  wabaEntryId: string | undefined,
): InboundAreaResolution {
  const metaPid = String(value?.metadata?.phone_number_id ?? '').trim();
  let area = resolveAreaFromPhoneNumberId(metaPid);
  if (area) return { area, source: 'phone_number_id' };

  const waba = String(wabaEntryId ?? '').trim();
  if (waba) {
    for (const slug of BUSINESS_AREAS) {
      const w = String(getWabaIdOverrideForArea(slug) || '').trim();
      if (w && w === waba) return { area: slug, source: 'waba_entry_id' };
    }
  }

  const lines = BUSINESS_AREAS.map((area) => ({
    slug: area,
    phoneNumberId: getWhatsAppCredentialsForArea(area).phoneNumberId,
  })).filter((x) => !!x.phoneNumberId);
  if (lines.length === 1) {
    return { area: lines[0].slug, source: 'single_configured_line' };
  }

  return { area: null, source: null };
}
