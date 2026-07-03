import { parseCampaignPayload } from './campaign-payload.util';

const CATEGORY_PRICING = {
  authentication: { usd: 0.02, pen: 0.0665 },
  marketing: { usd: 0.0703, pen: 0.2339 },
  utility: { usd: 0.02, pen: 0.0665 },
  service: { usd: 0, pen: 0 },
} as const;

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
): {
  usdAmount: number;
  penAmount: number;
} | null {
  const delivered = Math.max(0, Math.round(Number(deliveredCount) || 0));
  const pricing =
    CATEGORY_PRICING[
      normalizeTemplateCategory(category) as keyof typeof CATEGORY_PRICING
    ];
  if (!pricing) return null;
  return {
    usdAmount: delivered * pricing.usd,
    penAmount: delivered * pricing.pen,
  };
}

function getFallbackPenPerUsdRate(): number {
  const ratios = Object.values(CATEGORY_PRICING)
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
): number {
  if (fromCurrency === toCurrency || amount === 0) return amount;
  const pricing =
    CATEGORY_PRICING[
      normalizeTemplateCategory(category) as keyof typeof CATEGORY_PRICING
    ];
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
  },
  deliveredCount: number,
): CampaignCostSummary {
  const delivered = Math.max(0, Math.round(Number(deliveredCount) || 0));
  const category = getCampaignTemplateCategory(campaign);
  const pricing =
    CATEGORY_PRICING[
      category as keyof typeof CATEGORY_PRICING
    ];

  if (pricing) {
    return {
      usdAmount: delivered * pricing.usd,
      penAmount: delivered * pricing.pen,
      unitUsdAmount: pricing.usd,
      unitPenAmount: pricing.pen,
      sourceLabel: 'Tarifa oficial WhatsApp API',
      hint: `Calculado con tarifa ${getTemplateCategoryLabel(category)} sobre mensajes entregados.`,
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
      : convertCurrencyAmount(stored, 'PEN', 'USD', category);
  const penAmount =
    currency === 'PEN'
      ? stored
      : convertCurrencyAmount(stored, 'USD', 'PEN', category);

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
