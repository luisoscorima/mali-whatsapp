import { BUSINESS_AREAS, type BusinessArea } from '../config/areas';
import {
  getConfiguredWhatsAppCatalogLines,
  getWabaIdOverrideForArea,
  getWhatsAppCredentialsForArea,
  getWhatsAppLineByPhoneNumberId,
  resolveWhatsAppAreaFromCatalogWaba,
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
  const catalogLine = getWhatsAppLineByPhoneNumberId(id);
  if (catalogLine) return catalogLine.area;
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
    const catalogArea = resolveWhatsAppAreaFromCatalogWaba(waba);
    if (catalogArea) {
      return { area: catalogArea, source: 'waba_entry_id' };
    }
    const matchingAreas = BUSINESS_AREAS.filter(
      (slug) => String(getWabaIdOverrideForArea(slug) || '').trim() === waba,
    );
    if (matchingAreas.length === 1) {
      return { area: matchingAreas[0], source: 'waba_entry_id' };
    }
  }

  const catalogLines = getConfiguredWhatsAppCatalogLines();
  const lines = catalogLines.length
    ? catalogLines.map((line) => ({
        slug: line.area,
        phoneNumberId: line.phoneNumberId,
      }))
    : BUSINESS_AREAS.map((area) => ({
        slug: area,
        phoneNumberId: getWhatsAppCredentialsForArea(area).phoneNumberId,
      })).filter((x) => !!x.phoneNumberId);
  if (lines.length === 1) {
    return { area: lines[0].slug, source: 'single_configured_line' };
  }

  return { area: null, source: null };
}
