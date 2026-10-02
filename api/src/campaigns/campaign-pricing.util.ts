import { parseCampaignPayload } from './campaign-payload.util';

/** 1 oct 2026 00:00 America/Lima (UTC-5, sin horario de verano). */
const PERU_RATE_CUTOFF_MS = Date.parse('2026-10-01T05:00:00.000Z');

export const SERVICE_REPLY_FREE_ALLOWANCE = 1000;

type CategoryRate = { usd: number; pen: number };
type CategoryRateTable = Record<
  'authentication' | 'marketing' | 'utility' | 'service',
  CategoryRate
>;

/** Fila Perú de la tarjeta vigente hasta el 30 sep 2026. */
const RATES_BEFORE_OCT_2026: CategoryRateTable = {
  authentication: { usd: 0.02, pen: 0.0665 },
  marketing: { usd: 0.0703, pen: 0.2339 },
  utility: { usd: 0.02, pen: 0.0665 },
  service: { usd: 0, pen: 0 },
};

/**
 * Fila Perú de la tarjeta oficial del 1 oct 2026 (tarifa de lista).
 * USD y PEN salen de cada CSV; no se convierten entre sí.
 */
const RATES_FROM_OCT_2026: CategoryRateTable = {
  authentication: { usd: 0.03, pen: 0.0998 },
  marketing: { usd: 0.0703, pen: 0.2339 },
  utility: { usd: 0.03, pen: 0.0998 },
  service: { usd: 0.03, pen: 0.0998 },
};

function ratesFor(at?: Date | string | null): CategoryRateTable {
  if (at == null || at === '') return RATES_FROM_OCT_2026;
  const ms = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (!Number.isFinite(ms) || ms >= PERU_RATE_CUTOFF_MS) return RATES_FROM_OCT_2026;
  return RATES_BEFORE_OCT_2026;
}

function rateForCategory(
  category: string,
  at?: Date | string | null,
): CategoryRate | null {
  const table = ratesFor(at);
  const key = normalizeTemplateCategory(category) as keyof CategoryRateTable;
  return table[key] ?? null;
}

const CATEGORY_LABELS: Record<string, string> = {
  authentication: 'Autenticación',
  marketing: 'Marketing',
  utility: 'Utilidad',
  service: 'Servicio',
};

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeTemplateCategory(value: unknown): string {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return '';
  if (raw === 'auth' || raw === 'authentication') return 'authentication';
  if (raw === 'marketing') return 'marketing';
  if (raw === 'utility') return 'utility';
  if (raw === 'service') return 'service';
  return raw;
}

export function getTemplateCategoryLabel(category: string): string {
  return CATEGORY_LABELS[normalizeTemplateCategory(category)] || category || 'Sin categoría';
}

function normalizeCurrency(value: unknown): 'USD' | 'PEN' {
  return String(value ?? 'USD').trim().toUpperCase() === 'PEN' ? 'PEN' : 'USD';
}

export function getCampaignTemplateCategory(campaign: {
  campaign_payload?: unknown;
}): string {
  const payload = parseCampaignPayload(campaign.campaign_payload);
  const fromSnapshot = (payload as { templateSnapshot?: { category?: string } })
    ?.templateSnapshot?.category;
  return normalizeTemplateCategory(fromSnapshot || '');
}

export function estimateCategoryCost(
  deliveredCount: number,
  category: string,
  at?: Date | string | null,
): {
  usdAmount: number;
  penAmount: number;
} | null {
  const delivered = Math.max(0, Math.round(Number(deliveredCount) || 0));
  const pricing = rateForCategory(category, at);
  if (!pricing) return null;
  return {
    usdAmount: delivered * pricing.usd,
    penAmount: delivered * pricing.pen,
  };
}

export function estimateServiceReplyOverage(
  replyCount: number,
  at?: Date | string | null,
): {
  replyCount: number;
  freeAllowance: number;
  billableCount: number;
  usdAmount: number;
  penAmount: number;
} {
  const replies = Math.max(0, Math.round(Number(replyCount) || 0));
  const billable = Math.max(0, replies - SERVICE_REPLY_FREE_ALLOWANCE);
  const pricing = rateForCategory('service', at);
  return {
    replyCount: replies,
    freeAllowance: SERVICE_REPLY_FREE_ALLOWANCE,
    billableCount: billable,
    usdAmount: billable * (pricing?.usd ?? 0),
    penAmount: billable * (pricing?.pen ?? 0),
  };
}

function getFallbackPenPerUsdRate(): number {
  const ratios = Object.values(RATES_FROM_OCT_2026)
    .filter((p) => p.usd > 0 && p.pen > 0)
    .map((p) => p.pen / p.usd);
  if (!ratios.length) return 1;
  return ratios.reduce((sum, v) => sum + v, 0) / ratios.length;
}

function convertCurrencyAmount(
  amount: number,
  fromCurrency: 'USD' | 'PEN',
  toCurrency: 'USD' | 'PEN',
  category: string,
  at?: Date | string | null,
): number {
  if (fromCurrency === toCurrency || amount === 0) return amount;
  const pricing = rateForCategory(category, at);
  if (pricing) {
    const sourceRate = fromCurrency === 'USD' ? pricing.usd : pricing.pen;
    const targetRate = toCurrency === 'USD' ? pricing.usd : pricing.pen;
    if (sourceRate > 0) return amount * (targetRate / sourceRate);
  }
  const penPerUsd = getFallbackPenPerUsdRate();
  return fromCurrency === 'USD' ? amount * penPerUsd : amount / penPerUsd;
}

export type CampaignCostSummary = {
  usdAmount: number | null;
  penAmount: number | null;
  unitUsdAmount: number | null;
  unitPenAmount: number | null;
  sourceLabel: string;
  hint: string;
};

export function buildCampaignCostSummary(
  campaign: {
    campaign_payload?: unknown;
    cost_amount?: unknown;
    cost_currency?: string | null;
    cost_source?: string | null;
    cost_is_estimated?: boolean | null;
    priced_at?: Date | string | null;
  },
  deliveredCount: number,
): CampaignCostSummary {
  const delivered = Math.max(0, Math.round(Number(deliveredCount) || 0));
  const category = getCampaignTemplateCategory(campaign);
  const pricing = rateForCategory(category, campaign.priced_at);

  if (pricing) {
    return {
      usdAmount: delivered * pricing.usd,
      penAmount: delivered * pricing.pen,
      unitUsdAmount: pricing.usd,
      unitPenAmount: pricing.pen,
      sourceLabel: 'Estimado de lista (Perú)',
      hint: `Estimado con la tarifa de lista de ${getTemplateCategoryLabel(category)} en Perú sobre mensajes entregados.`,
    };
  }

  const stored = toFiniteNumber(campaign.cost_amount);
  if (stored === null) {
    return {
      usdAmount: null,
      penAmount: null,
      unitUsdAmount: null,
      unitPenAmount: null,
      sourceLabel: 'Sin costo',
      hint: 'Aún no hay información suficiente para calcular el costo.',
    };
  }

  const currency = normalizeCurrency(campaign.cost_currency);
  const usdAmount =
    currency === 'USD'
      ? stored
      : convertCurrencyAmount(stored, 'PEN', 'USD', category, campaign.priced_at);
  const penAmount =
    currency === 'PEN'
      ? stored
      : convertCurrencyAmount(stored, 'USD', 'PEN', category, campaign.priced_at);

  return {
    usdAmount,
    penAmount,
    unitUsdAmount: delivered > 0 && usdAmount !== null ? usdAmount / delivered : null,
    unitPenAmount: delivered > 0 && penAmount !== null ? penAmount / delivered : null,
    sourceLabel: campaign.cost_is_estimated ? 'Estimado' : 'Meta WABA',
    hint: campaign.cost_is_estimated
      ? 'Valor guardado; la categoría no tiene tarifa configurada.'
      : 'Costo reportado por Meta.',
  };
}
