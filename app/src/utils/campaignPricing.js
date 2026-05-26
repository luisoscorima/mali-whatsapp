const CATEGORY_PRICING = Object.freeze({
  authentication: Object.freeze({ usd: 0.02, pen: 0.0665 }),
  marketing: Object.freeze({ usd: 0.0703, pen: 0.2339 }),
  utility: Object.freeze({ usd: 0.02, pen: 0.0665 }),
  service: Object.freeze({ usd: 0, pen: 0 }),
});

const CATEGORY_LABELS = Object.freeze({
  authentication: 'Autenticación',
  marketing: 'Marketing',
  utility: 'Utilidad',
  service: 'Servicio',
});

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeTemplateCategory(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  if (raw === 'auth') return 'authentication';
  if (raw === 'authentication') return 'authentication';
  if (raw === 'marketing') return 'marketing';
  if (raw === 'utility') return 'utility';
  if (raw === 'service') return 'service';
  return raw;
}

function getTemplateCategoryLabel(category) {
  const normalized = normalizeTemplateCategory(category);
  return CATEGORY_LABELS[normalized] || normalized || 'Sin categoría';
}

function normalizeCurrency(value) {
  return String(value || 'USD').trim().toUpperCase() === 'PEN' ? 'PEN' : 'USD';
}

function parseCampaignPayload(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return typeof payload === 'object' ? payload : null;
}

function getCampaignTemplateCategory(campaign) {
  const payload = parseCampaignPayload(campaign?.campaign_payload);
  return normalizeTemplateCategory(
    payload?.templateSnapshot?.category || campaign?.template_category || campaign?.category || ''
  );
}

function getTemplateCategoryPricing(category) {
  const normalized = normalizeTemplateCategory(category);
  return CATEGORY_PRICING[normalized] || null;
}

function getFallbackPenPerUsdRate() {
  const ratios = Object.values(CATEGORY_PRICING)
    .filter((pricing) => pricing.usd > 0 && pricing.pen > 0)
    .map((pricing) => pricing.pen / pricing.usd);
  if (ratios.length === 0) return 1;
  const total = ratios.reduce((sum, value) => sum + value, 0);
  return total / ratios.length;
}

function convertCurrencyAmount(amount, { fromCurrency = 'USD', toCurrency = 'USD', category = '' } = {}) {
  const n = toFiniteNumber(amount);
  if (n === null) return null;
  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  if (from === to || n === 0) return n;

  const pricing = getTemplateCategoryPricing(category);
  if (pricing) {
    const sourceRate = from === 'USD' ? pricing.usd : pricing.pen;
    const targetRate = to === 'USD' ? pricing.usd : pricing.pen;
    if (sourceRate > 0 && targetRate >= 0) {
      return n * (targetRate / sourceRate);
    }
  }

  const penPerUsd = getFallbackPenPerUsdRate();
  return from === 'USD' ? n * penPerUsd : n / penPerUsd;
}

function getDualCurrencyAmounts({ amount, currency = 'USD', category = '' } = {}) {
  const n = toFiniteNumber(amount);
  if (n === null) {
    return {
      amount: null,
      currency: normalizeCurrency(currency),
      usdAmount: null,
      penAmount: null,
    };
  }
  const normalizedCurrency = normalizeCurrency(currency);
  return {
    amount: n,
    currency: normalizedCurrency,
    usdAmount:
      normalizedCurrency === 'USD'
        ? n
        : convertCurrencyAmount(n, { fromCurrency: 'PEN', toCurrency: 'USD', category }),
    penAmount:
      normalizedCurrency === 'PEN'
        ? n
        : convertCurrencyAmount(n, { fromCurrency: 'USD', toCurrency: 'PEN', category }),
  };
}

function estimateCategoryCost(deliveredCount, category) {
  const delivered = Math.max(0, Math.round(Number(deliveredCount) || 0));
  const pricing = getTemplateCategoryPricing(category);
  if (!pricing) return null;
  return {
    category: normalizeTemplateCategory(category),
    deliveredCount: delivered,
    unitUsdAmount: pricing.usd,
    unitPenAmount: pricing.pen,
    usdAmount: delivered * pricing.usd,
    penAmount: delivered * pricing.pen,
  };
}

function buildCampaignCostSummary(campaign, deliveredCount) {
  const delivered = Math.max(0, Math.round(Number(deliveredCount) || 0));
  const category = getCampaignTemplateCategory(campaign);
  const estimated = estimateCategoryCost(delivered, category);
  if (estimated) {
    return {
      amount: estimated.usdAmount,
      currency: 'USD',
      usdAmount: estimated.usdAmount,
      penAmount: estimated.penAmount,
      unitUsdAmount: estimated.unitUsdAmount,
      unitPenAmount: estimated.unitPenAmount,
      deliveredCount: delivered,
      category,
      categoryLabel: getTemplateCategoryLabel(category),
      sourceLabel: 'Tarifa oficial WhatsApp API',
      sourceKey: 'category_rate',
      hint: `Calculado con la tarifa oficial de ${getTemplateCategoryLabel(category)} sobre mensajes entregados.`,
      isEstimated: false,
    };
  }

  const storedAmount = toFiniteNumber(campaign?.cost_amount);
  const storedCurrency = normalizeCurrency(campaign?.cost_currency);
  if (storedAmount === null) {
    return {
      amount: null,
      currency: storedCurrency,
      usdAmount: null,
      penAmount: null,
      unitUsdAmount: null,
      unitPenAmount: null,
      deliveredCount: delivered,
      category,
      categoryLabel: getTemplateCategoryLabel(category),
      sourceLabel: 'Sin costo',
      sourceKey: 'none',
      hint: 'Aún no hay información suficiente para calcular el costo.',
      isEstimated: false,
    };
  }

  const converted = getDualCurrencyAmounts({ amount: storedAmount, currency: storedCurrency, category });
  return {
    ...converted,
    unitUsdAmount: delivered > 0 && converted.usdAmount !== null ? converted.usdAmount / delivered : null,
    unitPenAmount: delivered > 0 && converted.penAmount !== null ? converted.penAmount / delivered : null,
    deliveredCount: delivered,
    category,
    categoryLabel: getTemplateCategoryLabel(category),
    sourceKey: String(campaign?.cost_source || '').trim() || (campaign?.cost_is_estimated ? 'estimated' : 'meta_waba'),
    sourceLabel: campaign?.cost_is_estimated
      ? 'Estimado'
      : String(campaign?.cost_source || '').trim() === 'category_rate'
        ? 'Tarifa oficial WhatsApp API'
        : 'Meta WABA',
    hint: campaign?.cost_is_estimated
      ? 'Se muestra el valor guardado previamente porque la categoría de la plantilla no tiene tarifa configurada.'
      : String(campaign?.cost_source || '').trim() === 'category_rate'
        ? 'Costo calculado con la tarifa oficial de WhatsApp API; convertido para mostrar ambas monedas.'
        : 'Costo reportado por Meta; convertido para mostrar ambas monedas.',
    isEstimated: Boolean(campaign?.cost_is_estimated),
  };
}

module.exports = {
  CATEGORY_PRICING,
  buildCampaignCostSummary,
  convertCurrencyAmount,
  estimateCategoryCost,
  getCampaignTemplateCategory,
  getDualCurrencyAmounts,
  getTemplateCategoryLabel,
  getTemplateCategoryPricing,
  normalizeCurrency,
  normalizeTemplateCategory,
  parseCampaignPayload,
  toFiniteNumber,
};
