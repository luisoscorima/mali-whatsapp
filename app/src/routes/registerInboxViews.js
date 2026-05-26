const { escapeForLikePattern } = require('../utils/searchEscape');
const { fetchCampaignFailedLogs } = require('../services/campaignFailedLogs');
const { fetchCampaignRetryStats } = require('../services/campaignRetry');
const { fetchCampaignResponderMetrics } = require('../services/campaignResponders');
const { parseAiConfigValue } = require('../utils/aiConfig');
const {
  CAMPAIGN_LOG_STATUS_SQL,
  sqlInList,
  SALIDA_OK_STATUSES,
  ERROR_STATUSES,
} = require('../utils/campaignLogStatuses');
const {
  loadAttributeFilterOptions,
  loadAttributeDefinitionsForArea,
  getApplicableAttributeDefinitions,
} = require('../services/contactAttributeDefinitions');
const { syncCampaignCost } = require('../services/campaignCostSync');
const { buildCampaignCostSummary } = require('../utils/campaignPricing');

const LOG_STATUS = CAMPAIGN_LOG_STATUS_SQL;
const SALIDA_OK_IN = sqlInList(SALIDA_OK_STATUSES);
const ERROR_IN = sqlInList(ERROR_STATUSES);
const DEFAULT_PHONE_PREFIX = '51';
const EMPTY_METRIC_LABEL = 'Aún sin datos';
const COUNTRY_CALLING_CODES = new Set([
  '1', '7', '20', '27', '30', '31', '32', '33', '34', '39', '40', '41', '43', '44', '45', '46',
  '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64',
  '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98', '211', '212',
  '213', '216', '218', '220', '221', '222', '223', '224', '225', '226', '227', '228', '229', '230',
  '231', '232', '233', '234', '235', '236', '237', '238', '239', '240', '241', '242', '243', '244',
  '245', '246', '248', '249', '250', '251', '252', '253', '254', '255', '256', '257', '258', '260',
  '261', '262', '263', '264', '265', '266', '267', '268', '269', '290', '291', '297', '298', '299',
  '350', '351', '352', '353', '354', '355', '356', '357', '358', '359', '370', '371', '372', '373',
  '374', '375', '376', '377', '378', '380', '381', '382', '385', '386', '387', '389', '420', '421',
  '423', '500', '501', '502', '503', '504', '505', '506', '507', '508', '509', '590', '591', '592',
  '593', '594', '595', '596', '597', '598', '599', '670', '672', '673', '674', '675', '676', '677',
  '678', '679', '680', '681', '682', '683', '685', '686', '687', '688', '689', '690', '691', '692',
  '850', '852', '853', '855', '856', '870', '880', '886', '960', '961', '962', '963', '964', '965',
  '966', '967', '968', '970', '971', '972', '973', '974', '975', '976', '992', '993', '994', '995',
  '996', '998',
]);

function inferPrefillPhoneParts(fullDigits, forcedPrefix = '', forcedLocal = '') {
  const digits = String(fullDigits || '').replace(/\D/g, '');
  const prefixForced = String(forcedPrefix || '').replace(/\D/g, '');
  const localForced = String(forcedLocal || '').replace(/\D/g, '');

  if (prefixForced) {
    let local = localForced || digits;
    if (!local && digits.startsWith(prefixForced) && digits.length > prefixForced.length) {
      local = digits.slice(prefixForced.length);
    }
    if (local.startsWith(prefixForced) && local.length > prefixForced.length) {
      local = local.slice(prefixForced.length);
    }
    return { prefix: prefixForced.slice(0, 4), local: local.slice(0, 20) };
  }

  if (localForced) {
    if (digits.startsWith(DEFAULT_PHONE_PREFIX) && localForced.length === 9 && localForced.startsWith('9')) {
      return { prefix: DEFAULT_PHONE_PREFIX, local: localForced.slice(0, 20) };
    }
    return { prefix: DEFAULT_PHONE_PREFIX, local: localForced.slice(0, 20) };
  }

  if (!digits) {
    return { prefix: DEFAULT_PHONE_PREFIX, local: '' };
  }

  for (let len = 3; len >= 1; len -= 1) {
    const cc = digits.slice(0, len);
    const local = digits.slice(len);
    if (!COUNTRY_CALLING_CODES.has(cc)) continue;
    if (local.length < 6 || local.length > 12) continue;
    return { prefix: cc, local: local.slice(0, 20) };
  }

  if (
    digits.startsWith(DEFAULT_PHONE_PREFIX) &&
    digits.length > DEFAULT_PHONE_PREFIX.length
  ) {
    return {
      prefix: DEFAULT_PHONE_PREFIX,
      local: digits.slice(DEFAULT_PHONE_PREFIX.length, DEFAULT_PHONE_PREFIX.length + 20),
    };
  }

  return { prefix: DEFAULT_PHONE_PREFIX, local: digits.slice(0, 20) };
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeCampaignLogStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function roundPct(value, total) {
  const num = Number(value);
  const den = Number(total);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return Math.round((num / den) * 100);
}

function formatNumberLocale(value, minimumFractionDigits = 2, maximumFractionDigits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat('es-PE', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(n);
}

function formatMoneyDisplay(amount, currency = 'USD', minimumFractionDigits = 2, maximumFractionDigits = 2) {
  const n = toNumberOrNull(amount);
  if (n === null) return EMPTY_METRIC_LABEL;
  const normalizedCurrency = String(currency || 'USD').trim().toUpperCase() || 'USD';
  const formatted = formatNumberLocale(n, minimumFractionDigits, maximumFractionDigits);
  if (normalizedCurrency === 'PEN') {
    return `S/ ${formatted || n.toFixed(maximumFractionDigits)}`;
  }
  return `${formatted || n.toFixed(maximumFractionDigits)} ${normalizedCurrency}`;
}

function formatDualMoneyDisplay(usdAmount, penAmount, options = {}) {
  const lines = formatDualMoneyLines(usdAmount, penAmount, options);
  if (lines.length === 0) return EMPTY_METRIC_LABEL;
  return lines.join(' · ');
}

function formatDualMoneyLines(usdAmount, penAmount, options = {}) {
  const minimumFractionDigits = options.minimumFractionDigits ?? 2;
  const maximumFractionDigits = options.maximumFractionDigits ?? 2;
  const hasUsd = toNumberOrNull(usdAmount) !== null;
  const hasPen = toNumberOrNull(penAmount) !== null;
  if (!hasUsd && !hasPen) return [];
  if (!hasUsd) return [formatMoneyDisplay(penAmount, 'PEN', minimumFractionDigits, maximumFractionDigits)];
  if (!hasPen) return [formatMoneyDisplay(usdAmount, 'USD', minimumFractionDigits, maximumFractionDigits)];
  return [
    formatMoneyDisplay(penAmount, 'PEN', minimumFractionDigits, maximumFractionDigits),
    formatMoneyDisplay(usdAmount, 'USD', minimumFractionDigits, maximumFractionDigits),
  ];
}

function formatCountPctDisplay(count, pct, options = {}) {
  const value = toInt(count, 0);
  if (pct === null || pct === undefined) {
    if (options.allowZeroFallback && value === 0) return '0 (0%)';
    return EMPTY_METRIC_LABEL;
  }
  return `${value} (${toInt(pct, 0)}%)`;
}

function collectLatestCampaignLogsByPhone(logs) {
  const latestLogs = [];
  const seenPhones = new Set();
  for (const log of Array.isArray(logs) ? logs : []) {
    const phone = String(log?.phone || '').trim();
    const key = phone || `log:${String(log?.id || '')}`;
    if (seenPhones.has(key)) continue;
    seenPhones.add(key);
    latestLogs.push(log);
  }
  return latestLogs;
}

function collectCampaignStatusCounts(logs) {
  const counts = {
    sentOnly: 0,
    deliveredOnly: 0,
    read: 0,
    errors: 0,
    other: 0,
  };
  for (const log of Array.isArray(logs) ? logs : []) {
    const status = normalizeCampaignLogStatus(log?.status);
    if (status === 'sent') counts.sentOnly += 1;
    else if (status === 'delivered') counts.deliveredOnly += 1;
    else if (status === 'read') counts.read += 1;
    else if (status === 'error' || status === 'failed' || status === 'undelivered') counts.errors += 1;
    else counts.other += 1;
  }
  return counts;
}

function collectIncidentCounts(failedLogs) {
  const counts = {
    undeliverable: 0,
    metaLimit: 0,
    experiment: 0,
  };
  for (const log of Array.isArray(failedLogs) ? failedLogs : []) {
    const type = String(log?.incident_type || '').trim().toLowerCase();
    if (type === 'meta_limit') counts.metaLimit += 1;
    else if (type === 'experiment') counts.experiment += 1;
    else counts.undeliverable += 1;
  }
  return counts;
}

function buildMetricCard({ label, display, displayLines = null, tone = '', tooltip = '', action = null }) {
  return {
    label,
    display,
    displayLines,
    tone,
    tooltip,
    action,
  };
}

function buildLogsMetricAction(filter, title, note = '') {
  return {
    type: 'logs',
    filter,
    title,
    note,
  };
}

function buildIncidentsMetricAction(filter, title, note = '') {
  return {
    type: 'incidents',
    filter,
    title,
    note,
  };
}

function buildCampaignDetailAnalytics(campaign, logs, failedLogs, responderMetrics, config) {
  const campaignStatus = normalizeCampaignLogStatus(campaign?.status);
  const effectiveLogs = collectLatestCampaignLogsByPhone(logs);
  const statusCounts = collectCampaignStatusCounts(effectiveLogs);
  const sentCount = statusCounts.sentOnly + statusCounts.deliveredOnly + statusCounts.read;
  const deliveredCount = statusCounts.deliveredOnly + statusCounts.read;
  const readCount = statusCounts.read;
  const failedCount = Array.isArray(failedLogs) ? failedLogs.length : 0;
  const declaredRecipients = toInt(campaign?.total_recipients, 0);
  const totalRecipients = Math.max(declaredRecipients, sentCount + failedCount, effectiveLogs.length);
  const problemsCount = Math.max(totalRecipients - sentCount, 0);
  const hasIncompleteSendAccounting =
    (campaignStatus === 'queued' || campaignStatus === 'processing' || campaignStatus === 'scheduled') &&
    declaredRecipients > sentCount + failedCount;
  const respondedCount = toInt(responderMetrics?.respondedCount, 0);
  const responseWindowDays = toInt(
    responderMetrics?.windowDays,
    toInt(config?.CAMPAIGN_RESPONSE_WINDOW_DAYS, 7)
  );
  const incidentCounts = collectIncidentCounts(failedLogs);
  const classifiedProblemCount =
    incidentCounts.undeliverable + incidentCounts.metaLimit + incidentCounts.experiment;
  const pendingClassificationCount = Math.max(problemsCount - classifiedProblemCount, 0);
  const costInfo = buildCampaignCostSummary(campaign, deliveredCount);

  const problemsDisplay = hasIncompleteSendAccounting
    ? EMPTY_METRIC_LABEL
    : formatCountPctDisplay(problemsCount, roundPct(problemsCount, totalRecipients), { allowZeroFallback: true });

  return {
    effectiveRecipientCount: effectiveLogs.length,
    responseWindowDays,
    performanceNote: 'Las métricas pueden demorar hasta 7 días en consolidarse.',
    business: [
      buildMetricCard({
        label: 'Importe gastado',
        display: formatDualMoneyDisplay(costInfo.usdAmount, costInfo.penAmount, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        displayLines: formatDualMoneyLines(costInfo.usdAmount, costInfo.penAmount, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
        tone: 'neutral',
        tooltip: 'Monto total invertido en la campaña.',
      }),
      buildMetricCard({
        label: 'Costo por mensaje entregado',
        display: formatDualMoneyDisplay(costInfo.unitUsdAmount, costInfo.unitPenAmount, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        }),
        displayLines: formatDualMoneyLines(costInfo.unitUsdAmount, costInfo.unitPenAmount, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        }),
        tone: 'sent',
        tooltip: 'Importe gastado dividido entre mensajes entregados o leídos, que son los mensajes cobrables.',
      }),
    ],
    cost: {
      amountDisplay: formatDualMoneyDisplay(costInfo.usdAmount, costInfo.penAmount, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      perDeliveredDisplay: formatDualMoneyDisplay(costInfo.unitUsdAmount, costInfo.unitPenAmount, {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      }),
      amountLines: formatDualMoneyLines(costInfo.usdAmount, costInfo.penAmount, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
      perDeliveredLines: formatDualMoneyLines(costInfo.unitUsdAmount, costInfo.unitPenAmount, {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
      }),
      sourceLabel: costInfo.sourceLabel,
      currency: 'MIXED',
      hint: `${costInfo.hint} No incluye pauta Ads.`,
    },
    globalResult: [
      buildMetricCard({
        label: 'Total destinatarios',
        display: totalRecipients > 0 ? `${totalRecipients} (100%)` : EMPTY_METRIC_LABEL,
        tone: 'neutral',
        tooltip: 'Número único de destinatarios incluidos en la campaña.',
        action: buildLogsMetricAction(
          'all_current',
          'Registro actual · Total destinatarios',
          hasIncompleteSendAccounting
            ? 'La campaña está programada o en proceso; pueden existir destinatarios aún sin traza en el registro actual.'
            : ''
        ),
      }),
      buildMetricCard({
        label: 'Enviados',
        display: formatCountPctDisplay(sentCount, roundPct(sentCount, totalRecipients), { allowZeroFallback: true }),
        tone: 'sent',
        tooltip:
          'Número de mensajes que tu negocio envió a los clientes y salieron correctamente hacia los destinatarios.',
        action: buildLogsMetricAction('sent_all', 'Registro actual · Enviados'),
      }),
      buildMetricCard({
        label: 'Problemas de entrega',
        display: problemsDisplay,
        tone: 'problem',
        tooltip:
          'Mensajes que no pudieron enviarse o entregarse debido a errores técnicos, limitaciones de Meta o condiciones del usuario.',
        action: buildIncidentsMetricAction(
          'all',
          'Incidencias activas · Problemas de entrega',
          hasIncompleteSendAccounting ? 'La campaña aún está programada o en proceso; este detalle puede seguir creciendo.' : ''
        ),
      }),
    ],
    performance: [
      buildMetricCard({
        label: 'Enviados',
        display: sentCount > 0 ? `${sentCount} (100%)` : '0 (0%)',
        tone: 'sent',
        tooltip:
          'Número de mensajes que tu negocio envió a los clientes y salieron correctamente hacia los destinatarios. Las métricas de rendimiento se registran en los 7 días posteriores al envío de un mensaje.',
        action: buildLogsMetricAction('sent_all', 'Registro actual · Enviados'),
      }),
      buildMetricCard({
        label: 'Entregados',
        display: formatCountPctDisplay(deliveredCount, roundPct(deliveredCount, sentCount), { allowZeroFallback: true }),
        tone: 'delivered',
        tooltip:
          'Número de mensajes entregados en un plazo de 7 días desde el envío. Algunos mensajes pueden no entregarse si el dispositivo del cliente está fuera de servicio.',
        action: buildLogsMetricAction('delivered_all', 'Registro actual · Entregados'),
      }),
      buildMetricCard({
        label: 'Leídos',
        display: formatCountPctDisplay(readCount, roundPct(readCount, deliveredCount)),
        tone: 'read',
        tooltip:
          'Número de mensajes enviados, entregados y leídos dentro de los 7 días posteriores al envío.',
        action: buildLogsMetricAction('read_only', 'Registro actual · Leídos'),
      }),
      buildMetricCard({
        label: 'Respuestas únicas',
        display: formatCountPctDisplay(respondedCount, roundPct(respondedCount, readCount)),
        tone: 'response',
        tooltip:
          'Número de cuentas que respondieron a cualquier mensaje de plantilla dentro de los 7 días posteriores al envío.',
        action: {
          id: 'campaign-responders-open',
          dialogId: 'campaign-responders-dialog',
          title: 'Ver teléfonos que respondieron',
        },
      }),
    ],
    funnel: [
      buildMetricCard({
        label: 'Pendientes de entrega',
        display: formatCountPctDisplay(statusCounts.sentOnly, roundPct(statusCounts.sentOnly, sentCount), { allowZeroFallback: true }),
        tone: 'sent',
        tooltip: 'Mensajes enviados que aún no fueron confirmados como entregados o leídos.',
        action: buildLogsMetricAction('sent_only', 'Registro actual · Pendientes de entrega'),
      }),
      buildMetricCard({
        label: 'Entregados no leídos',
        display: formatCountPctDisplay(
          statusCounts.deliveredOnly,
          roundPct(statusCounts.deliveredOnly, sentCount),
          { allowZeroFallback: true }
        ),
        tone: 'delivered',
        tooltip: 'Mensajes entregados correctamente pero aún no leídos por el usuario.',
        action: buildLogsMetricAction('delivered_only', 'Registro actual · Entregados no leídos'),
      }),
      buildMetricCard({
        label: 'Leídos',
        display: formatCountPctDisplay(readCount, roundPct(readCount, sentCount), { allowZeroFallback: true }),
        tone: 'read',
        tooltip: 'Mensajes leídos por el usuario dentro de la ventana de medición.',
        action: buildLogsMetricAction('read_only', 'Registro actual · Leídos'),
      }),
    ],
    incidents: [
      buildMetricCard({
        label: 'Mensajes no entregables',
        display: formatCountPctDisplay(
          incidentCounts.undeliverable,
          roundPct(incidentCounts.undeliverable, problemsCount),
          { allowZeroFallback: true }
        ),
        tone: 'problem',
        tooltip: 'Mensajes no entregados por condiciones del usuario, del dispositivo o errores permanentes.',
        action: buildIncidentsMetricAction('undeliverable', 'Incidencias activas · Mensajes no entregables'),
      }),
      buildMetricCard({
        label: 'Limitaciones Meta',
        display: formatCountPctDisplay(incidentCounts.metaLimit, roundPct(incidentCounts.metaLimit, problemsCount), {
          allowZeroFallback: true,
        }),
        tone: 'meta-limit',
        tooltip:
          'Meta decidió no enviar o limitar el mensaje por restricciones del ecosistema, rate limits o baja probabilidad de interacción.',
        action: buildIncidentsMetricAction('meta_limit', 'Incidencias activas · Limitaciones Meta'),
      }),
      buildMetricCard({
        label: 'Experimentos',
        display: formatCountPctDisplay(incidentCounts.experiment, roundPct(incidentCounts.experiment, problemsCount), {
          allowZeroFallback: true,
        }),
        tone: 'response',
        tooltip: 'Mensajes no enviados porque el número participa en un experimento de Meta.',
        action: buildIncidentsMetricAction('experiment', 'Incidencias activas · Experimentos'),
      }),
    ],
    incidentsNote:
      hasIncompleteSendAccounting
        ? 'La campaña aún está procesándose; las incidencias se muestran de forma parcial.'
        : pendingClassificationCount > 0
          ? `Quedan ${pendingClassificationCount} problema(s) sin clasificación detallada todavía.`
          : '',
  };
}

function buildCampaignIndexSummary(campaignTotals) {
  const sentCount = toInt(campaignTotals?.salida_ok, 0);
  const deliveredCount = toInt(campaignTotals?.delivered_count, 0);
  const totalRecipients = Math.max(toInt(campaignTotals?.total_recipients, 0), sentCount + toInt(campaignTotals?.failed_count, 0));
  const problemsCount = Math.max(totalRecipients - sentCount, 0);
  const costRows = Array.isArray(campaignTotals?.cost_rows) ? campaignTotals.cost_rows : [];
  const summarizedCosts = costRows.reduce(
    (acc, row) => {
      const costInfo = buildCampaignCostSummary(row, row.delivered_count);
      if (costInfo.usdAmount === null && costInfo.penAmount === null) return acc;
      acc.campaignsWithCost += 1;
      acc.totalUsd += Number(costInfo.usdAmount || 0);
      acc.totalPen += Number(costInfo.penAmount || 0);
      return acc;
    },
    { campaignsWithCost: 0, totalUsd: 0, totalPen: 0 }
  );
  const hasCostData = summarizedCosts.campaignsWithCost > 0;
  const costPerDeliveredUsd = hasCostData && deliveredCount > 0 ? summarizedCosts.totalUsd / deliveredCount : null;
  const costPerDeliveredPen = hasCostData && deliveredCount > 0 ? summarizedCosts.totalPen / deliveredCount : null;

  return {
    business: [
      buildMetricCard({
        label: 'Importe gastado',
        display: hasCostData
          ? formatDualMoneyDisplay(summarizedCosts.totalUsd, summarizedCosts.totalPen, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
          : EMPTY_METRIC_LABEL,
        displayLines: hasCostData
          ? formatDualMoneyLines(summarizedCosts.totalUsd, summarizedCosts.totalPen, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
          : null,
        tone: 'neutral',
        tooltip: 'Suma de costos calculados por campaña usando la categoría de plantilla y mensajes entregados.',
      }),
      buildMetricCard({
        label: 'Costo por mensaje entregado',
        display: formatDualMoneyDisplay(costPerDeliveredUsd, costPerDeliveredPen, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        }),
        displayLines: formatDualMoneyLines(costPerDeliveredUsd, costPerDeliveredPen, {
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        }),
        tone: 'sent',
        tooltip: 'Importe gastado dividido entre mensajes entregados o leídos en las campañas del área.',
      }),
    ],
    results: [
      buildMetricCard({
        label: 'Total destinatarios',
        display: totalRecipients > 0 ? `${totalRecipients} (100%)` : EMPTY_METRIC_LABEL,
        tone: 'neutral',
        tooltip: 'Suma de destinatarios declarados en las campañas del área.',
      }),
      buildMetricCard({
        label: 'Enviados',
        display: formatCountPctDisplay(sentCount, roundPct(sentCount, totalRecipients), { allowZeroFallback: true }),
        tone: 'sent',
        tooltip: 'Mensajes enviados correctamente hacia Meta, agregados sobre las campañas del área.',
      }),
      buildMetricCard({
        label: 'Problemas de entrega',
        display: formatCountPctDisplay(problemsCount, roundPct(problemsCount, totalRecipients), { allowZeroFallback: true }),
        tone: 'problem',
        tooltip: 'Destinatarios de campañas del área que no registran envío exitoso.',
      }),
    ],
    hint:
      'Resumen agregado del área. Los costos se calculan con la tarifa oficial de WhatsApp por categoría y se muestran en soles y dólares. Para ver entregados, leídos, respuestas únicas, embudo Meta e incidencias por campaña, entra al detalle de una campaña.',
    campaignsCount: toInt(campaignTotals?.campaign_count, 0),
  };
}

function registerInboxViews(app, ctx) {
  const { query, config, loadSegments, loadSyncedTemplates, resolveAppBaseUrl, appPath } = ctx;
  const { loadContactAttributes } = require('../services/contactAttributes');

  function contactFiltersFromQuery(req) {
    return {
      contactSegmentFilter: String(req.query.segment || '').trim(),
      contactSearchQ: String(req.query.q || '').trim(),
      showReplaced: String(req.query.show_replaced || '').trim() === '1',
      contactAttrKey: String(req.query.attr_key || '').trim(),
      contactAttrValue: String(req.query.attr_value || '').trim(),
    };
  }

  async function loadContactAttributeViewData(area, segmentSlugs = null) {
    const normalizedArea = String(area || '').trim();
    const [attributeFilterOptions, attributeDefinitionsAll] = await Promise.all([
      loadAttributeFilterOptions(query, normalizedArea),
      loadAttributeDefinitionsForArea(query, normalizedArea),
    ]);
    let attributeFieldDefinitions = attributeDefinitionsAll;
    let attributeGateBySegment = false;
    if (segmentSlugs && segmentSlugs.length > 0) {
      attributeFieldDefinitions = await getApplicableAttributeDefinitions(
        query,
        normalizedArea,
        segmentSlugs
      );
    } else if (segmentSlugs !== null) {
      attributeGateBySegment = true;
    }
    return {
      attributeFilterOptions,
      attributeDefinitionsAll,
      attributeFieldDefinitions,
      attributeGateBySegment,
    };
  }

  async function loadContactsList(
    area,
    segmentsList,
    segmentFilterRaw,
    searchQRaw,
    showReplacedRaw,
    attrKeyRaw = '',
    attrValueRaw = ''
  ) {
    const slugSet = new Set(segmentsList.map((s) => s.value));
    const rawSeg = String(segmentFilterRaw || '').trim();
    const seg = rawSeg && slugSet.has(rawSeg) ? rawSeg : '';
    const showReplaced = String(showReplacedRaw || '').trim() === '1';
    const params = [area];
    let wh = 'WHERE c.area = $1';
    let p = 2;
    if (!showReplaced) {
      wh += ' AND c.replacement_reason IS NULL AND c.replaced_by_contact_id IS NULL';
    }
    if (seg) {
      wh += ` AND EXISTS (SELECT 1 FROM contact_segments csf WHERE csf.contact_id = c.id AND csf.segment_slug = $${p})`;
      params.push(seg);
      p += 1;
    }
    const searchQ = String(searchQRaw || '').trim();
    const qDigits = searchQ.replace(/\D/g, '');
    if (searchQ) {
      const searchPat = `%${escapeForLikePattern(searchQ)}%`;
      wh += ` AND (COALESCE(c.name, '') ILIKE $${p} ESCAPE '!' OR COALESCE(c.phone, '') ILIKE $${p} ESCAPE '!'`;
      params.push(searchPat);
      p += 1;
      if (qDigits) {
        wh += ` OR regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE $${p}`;
        params.push(`%${qDigits}%`);
        p += 1;
      }
      wh += ')';
    }
    const ak = String(attrKeyRaw || '').trim().toLowerCase();
    const av = String(attrValueRaw || '').trim();
    if (ak && av) {
      wh += ` AND EXISTS (
        SELECT 1 FROM contact_attributes ca
        WHERE ca.contact_id = c.id AND ca.attr_key = $${p} AND ca.attr_value ILIKE $${p + 1} ESCAPE '!'
      )`;
      params.push(ak, `%${escapeForLikePattern(av)}%`);
      p += 2;
    }
    const r = await query(
      `SELECT
         c.id,
         c.name,
         c.phone,
         c.opt_in,
         c.active,
         c.replaced_by_contact_id,
         c.replaced_at,
         c.replacement_reason,
         c.created_at,
         COALESCE((
           SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
           FROM contact_segments cs
           JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
           WHERE cs.contact_id = c.id
         ), ARRAY[]::varchar[]) AS segment_slugs
       FROM contacts c
       ${wh}
       ORDER BY c.id DESC
       LIMIT 400`,
      params
    );
    return r.rows;
  }

  function contactListQueryString(segmentFilter, searchQ, showReplaced, attrKey, attrValue) {
    const sp = new URLSearchParams();
    if (segmentFilter) sp.set('segment', segmentFilter);
    if (searchQ) sp.set('q', searchQ);
    if (showReplaced) sp.set('show_replaced', '1');
    if (attrKey) sp.set('attr_key', attrKey);
    if (attrValue) sp.set('attr_value', attrValue);
    const s = sp.toString();
    return s ? `?${s}` : '';
  }

  async function loadCampaignsRecent(area, limit = 200) {
    const r = await query(
      `WITH latest_logs AS (
         SELECT DISTINCT ON (cl.campaign_id, cl.phone)
           cl.campaign_id,
           cl.phone,
           cl.status,
           cl.created_at
         FROM campaign_logs cl
         JOIN campaigns cx ON cx.id = cl.campaign_id
         WHERE cx.area = $1
         ORDER BY cl.campaign_id, cl.phone, cl.id DESC
       )
       SELECT
        c.id,
        c.segment,
        c.campaign_payload,
        c.template_name,
        c.message_text,
        c.image_url,
        c.status,
        c.total_recipients,
        c.created_at,
        c.scheduled_at,
        MIN(cl.created_at) AS first_send_at,
        COALESCE(COUNT(cl.phone), 0)::int AS log_count,
        COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${SALIDA_OK_IN} THEN 1 ELSE 0 END), 0)::int AS salida_ok,
        COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
        COALESCE(SUM(CASE WHEN ${LOG_STATUS} = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
        COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${ERROR_IN} THEN 1 ELSE 0 END), 0)::int AS failed_count
       FROM campaigns c
       LEFT JOIN latest_logs cl ON cl.campaign_id = c.id
       WHERE c.area = $1
       GROUP BY c.id
       ORDER BY c.id DESC
       LIMIT $2`,
      [area, limit]
    );
    return r.rows;
  }

  async function loadCampaignTotals(area) {
    const [logTotals, campaignTotals, campaignCostRows] = await Promise.all([
      query(
        `WITH latest_logs AS (
           SELECT DISTINCT ON (cl.campaign_id, cl.phone)
             cl.campaign_id,
             cl.phone,
             cl.status
           FROM campaign_logs cl
           JOIN campaigns cx ON cx.id = cl.campaign_id
           WHERE cx.area = $1
           ORDER BY cl.campaign_id, cl.phone, cl.id DESC
         )
         SELECT
           COUNT(cl.phone)::int AS total_logs,
           COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${SALIDA_OK_IN} THEN 1 ELSE 0 END), 0)::int AS salida_ok,
           COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
           COALESCE(SUM(CASE WHEN ${LOG_STATUS} = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
           COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${ERROR_IN} THEN 1 ELSE 0 END), 0)::int AS failed_count
         FROM latest_logs cl`,
        [area]
      ),
      query(
        `SELECT
           COUNT(*)::int AS campaign_count,
           COALESCE(SUM(total_recipients), 0)::int AS total_recipients
         FROM campaigns
         WHERE area = $1`,
        [area]
      ),
      query(
        `WITH latest_logs AS (
           SELECT DISTINCT ON (cl.campaign_id, cl.phone)
             cl.campaign_id,
             cl.phone,
             cl.status
           FROM campaign_logs cl
           JOIN campaigns cx ON cx.id = cl.campaign_id
           WHERE cx.area = $1
           ORDER BY cl.campaign_id, cl.phone, cl.id DESC
         )
         SELECT
           c.id,
           c.campaign_payload,
           c.cost_amount,
           c.cost_currency,
           c.cost_source,
           c.cost_is_estimated,
           COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count
         FROM campaigns c
         LEFT JOIN latest_logs cl ON cl.campaign_id = c.id
         WHERE c.area = $1
         GROUP BY c.id
         ORDER BY c.id DESC`,
        [area]
      ),
    ]);
    const logRow = logTotals.rows[0] || {
      total_logs: 0,
      salida_ok: 0,
      delivered_count: 0,
      read_count: 0,
      failed_count: 0,
    };
    const campaignRow = campaignTotals.rows[0] || {
      campaign_count: 0,
      total_recipients: 0,
    };
    return {
      ...logRow,
      ...campaignRow,
      cost_rows: campaignCostRows.rows,
    };
  }

  async function loadCampaignDetail(area, campaignId) {
    const [campaignResult, logsResult, failedLogs, responderMetrics, retryStats] = await Promise.all([
      query(`SELECT * FROM campaigns WHERE id = $1 AND area = $2`, [campaignId, area]),
      query(
        `SELECT id, phone, whatsapp_message_id, status, response, created_at, attempt, retryable, last_retry_at
         FROM campaign_logs
         WHERE campaign_id = $1
         ORDER BY id DESC`,
        [campaignId]
      ),
      fetchCampaignFailedLogs(query, campaignId),
      fetchCampaignResponderMetrics(query, campaignId, area),
      fetchCampaignRetryStats(query, campaignId),
    ]);
    if (campaignResult.rowCount === 0) return null;
    const campaign = campaignResult.rows[0];
    const analytics = buildCampaignDetailAnalytics(campaign, logsResult.rows, failedLogs, responderMetrics, config);
    return {
      campaign,
      logs: logsResult.rows,
      failedLogs,
      responderMetrics,
      retryStats,
      analytics,
    };
  }

  function commonLocals(req, res) {
    return {
      basePath: config.basePath,
      appBaseUrl: resolveAppBaseUrl(),
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      showAdminNav: res.locals.showAdminNav,
    };
  }

  /* --- Campañas (envío) --- */
  app.get('/campaigns/new', async (req, res) => {
    const area = req.user.area;
    const [segmentsList, campaigns, syncedTemplates] = await Promise.all([
      loadSegments(area),
      loadCampaignsRecent(area, 200),
      loadSyncedTemplates(area),
    ]);
    res.render('campaigns-new', {
      ...commonLocals(req, res),
      activeNav: 'campaigns',
      pageTitle: 'Nueva campaña · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      campaigns,
      syncedTemplates,
      templatesSynced: String(req.query.templates_synced || '') === '1',
      templatesSyncError: req.query.templates_sync_err || null,
      extraHeadScripts: [`${config.basePath || ''}/js/campaign-template.js`],
    });
  });

  app.get('/campaigns/:id', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).send('Id de campana invalido');
    }
    const area = req.user.area;
    const campaignStatusResult = await query(`SELECT status FROM campaigns WHERE id = $1 AND area = $2`, [campaignId, area]);
    if (campaignStatusResult.rowCount === 0) {
      return res.status(404).send('Campaña no encontrada');
    }
    const campaignStatus = String(campaignStatusResult.rows[0]?.status || '').trim().toLowerCase();
    if (campaignStatus === 'completed' || campaignStatus === 'failed') {
      await syncCampaignCost(query, { campaignId, area });
    }
    const detail = await loadCampaignDetail(area, campaignId);
    if (!detail) {
      return res.status(404).send('Campaña no encontrada');
    }
    const campaigns = await loadCampaignsRecent(area, 200);
    res.render('campaign-detail', {
      ...commonLocals(req, res),
      activeNav: 'campaigns',
      pageTitle: `Campaña #${campaignId} · MALI WhatsApp`,
      layoutModifier: 'conversations-inbox--detail',
      campaign: detail.campaign,
      logs: detail.logs,
      failedLogs: detail.failedLogs,
      responderMetrics: detail.responderMetrics,
      retryStats: detail.retryStats,
      analytics: detail.analytics,
      campaigns,
      listBasePath: '/campaigns',
      sidebarTitle: 'Campañas',
      showNewLink: true,
      selectedCampaignId: campaignId,
    });
  });

  app.get('/campaigns', async (req, res) => {
    const area = req.user.area;
    const [campaigns, campaignTotals] = await Promise.all([loadCampaignsRecent(area, 200), loadCampaignTotals(area)]);
    const campaignSummary = buildCampaignIndexSummary(campaignTotals);
    res.render('campaigns-index', {
      ...commonLocals(req, res),
      activeNav: 'campaigns',
      pageTitle: 'Campañas · MALI WhatsApp',
      layoutModifier: '',
      campaigns,
      campaignTotals,
      campaignSummary,
      templatesSynced: String(req.query.templates_synced || '') === '1',
    });
  });

  /* Redirecciones antiguas (historial unificado en Campañas) */
  app.get('/history', (req, res) => {
    res.redirect(302, appPath('/campaigns'));
  });
  app.get('/history/:id', (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.redirect(302, appPath('/campaigns'));
    }
    res.redirect(302, appPath(`/campaigns/${campaignId}`));
  });

  /* --- Contactos --- */
  app.get('/contacts/new', async (req, res) => {
    const area = req.user.area;
    const {
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
    } = contactFiltersFromQuery(req);
    const prefillName = String(req.query.prefill_name || '').trim().slice(0, 150);
    const prefillPhone = String(req.query.prefill_phone || '').replace(/\D/g, '');
    const prefillPrefixRaw = String(req.query.prefill_prefix || '').replace(/\D/g, '');
    const prefillLocalRaw = String(req.query.prefill_local || '').replace(/\D/g, '');
    const inferred = inferPrefillPhoneParts(prefillPhone, prefillPrefixRaw, prefillLocalRaw);
    const prefillPhonePrefix = inferred.prefix;
    const prefillPhoneLocal = inferred.local;
    const segmentsList = await loadSegments(area);
    const [contactsRows, attrView] = await Promise.all([
      loadContactsList(
        area,
        segmentsList,
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      loadContactAttributeViewData(area, []),
    ]);
    res.render('contacts-page', {
      ...commonLocals(req, res),
      ...attrView,
      activeNav: 'contacts',
      pageTitle: 'Nuevo contacto · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      contacts: contactsRows,
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
      contactListQuery: contactListQueryString(
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      view: 'new',
      selectedContactId: null,
      contact: null,
      prefillName,
      prefillPhonePrefix,
      prefillPhoneLocal,
      csvImport: null,
      maxCsvRows: config.MAX_CSV_ROWS,
      contactUpdated: String(req.query.contact_updated || '') === '1',
      contactDeleted: String(req.query.contact_deleted || '') === '1',
    });
  });

  app.get('/contacts/import', async (req, res) => {
    const area = req.user.area;
    const {
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
    } = contactFiltersFromQuery(req);
    const segmentsList = await loadSegments(area);
    const [contactsRows, attrView] = await Promise.all([
      loadContactsList(
        area,
        segmentsList,
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      loadContactAttributeViewData(area, null),
    ]);
    res.render('contacts-page', {
      ...commonLocals(req, res),
      ...attrView,
      activeNav: 'contacts',
      pageTitle: 'Importar Excel · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      contacts: contactsRows,
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
      contactListQuery: contactListQueryString(
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      view: 'import',
      selectedContactId: null,
      contact: null,
      csvImport:
        String(req.query.contacts_import || '') === '1'
          ? {
              ok: req.query.ok !== undefined ? Number(req.query.ok) : null,
              bad: req.query.bad !== undefined ? Number(req.query.bad) : null,
              dup: req.query.dup !== undefined ? Number(req.query.dup) : 0,
              dupRows: req.query.dup_rows !== undefined ? Number(req.query.dup_rows) : 0,
              dupExamples: String(req.query.dup_examples || '')
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
                .slice(0, 3),
              err: req.query.err || null,
            }
          : null,
      maxCsvRows: config.MAX_CSV_ROWS,
      contactUpdated: false,
      contactDeleted: false,
    });
  });

  app.get('/contacts/:id', async (req, res) => {
    const contactId = Number(req.params.id);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return res.status(400).send('Id de contacto invalido');
    }
    const area = req.user.area;
    const {
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
    } = contactFiltersFromQuery(req);
    const segmentsList = await loadSegments(area);
    const [contactsRows, one, contactAttributes] = await Promise.all([
      loadContactsList(
        area,
        segmentsList,
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      query(
        `SELECT
           c.id,
           c.name,
           c.phone,
           c.opt_in,
           c.active,
           c.replaced_by_contact_id,
           c.replaced_at,
           c.replacement_reason,
           c.created_at,
           COALESCE((
             SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
             FROM contact_segments cs
             JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
             WHERE cs.contact_id = c.id
           ), ARRAY[]::varchar[]) AS segment_slugs
         FROM contacts c
         WHERE c.id = $1 AND c.area = $2`,
        [contactId, area]
      ),
      loadContactAttributes(query, contactId),
    ]);
    if (one.rowCount === 0) {
      return res.status(404).send('Contacto no encontrado');
    }
    const attrView = await loadContactAttributeViewData(
      area,
      one.rows[0].segment_slugs || []
    );
    res.render('contacts-page', {
      ...commonLocals(req, res),
      ...attrView,
      activeNav: 'contacts',
      pageTitle: `${one.rows[0].name || one.rows[0].phone} · Contactos · MALI WhatsApp`,
      layoutModifier: 'conversations-inbox--detail',
      segments: segmentsList,
      contacts: contactsRows,
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
      contactListQuery: contactListQueryString(
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      view: 'edit',
      selectedContactId: contactId,
      contact: one.rows[0],
      contactAttributes: contactAttributes || {},
      csvImport: null,
      maxCsvRows: config.MAX_CSV_ROWS,
      contactUpdated: String(req.query.contact_updated || '') === '1',
      contactDeleted: String(req.query.contact_deleted || '') === '1',
    });
  });

  app.get('/contacts', async (req, res) => {
    const area = req.user.area;
    const {
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
    } = contactFiltersFromQuery(req);
    const segmentsList = await loadSegments(area);
    const [contactsRows, attrView] = await Promise.all([
      loadContactsList(
        area,
        segmentsList,
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      loadContactAttributeViewData(area, null),
    ]);
    res.render('contacts-page', {
      ...commonLocals(req, res),
      ...attrView,
      activeNav: 'contacts',
      pageTitle: 'Contactos · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      contacts: contactsRows,
      contactSegmentFilter,
      contactSearchQ,
      showReplaced,
      contactAttrKey,
      contactAttrValue,
      contactListQuery: contactListQueryString(
        contactSegmentFilter,
        contactSearchQ,
        showReplaced,
        contactAttrKey,
        contactAttrValue
      ),
      view: 'list',
      selectedContactId: null,
      contact: null,
      csvImport:
        String(req.query.contacts_import || '') === '1'
          ? {
              ok: req.query.ok !== undefined ? Number(req.query.ok) : null,
              bad: req.query.bad !== undefined ? Number(req.query.bad) : null,
              dup: req.query.dup !== undefined ? Number(req.query.dup) : 0,
              dupRows: req.query.dup_rows !== undefined ? Number(req.query.dup_rows) : 0,
              dupExamples: String(req.query.dup_examples || '')
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
                .slice(0, 3),
              err: req.query.err || null,
            }
          : null,
      maxCsvRows: config.MAX_CSV_ROWS,
      contactUpdated: String(req.query.contact_updated || '') === '1',
      contactDeleted: String(req.query.contact_deleted || '') === '1',
    });
  });

  /* --- Segmentos --- */
  app.get('/segments/new', async (req, res) => {
    const area = req.user.area;
    const segmentsList = await loadSegments(area);
    res.render('segments-page', {
      ...commonLocals(req, res),
      activeNav: 'segments',
      pageTitle: 'Añadir segmento · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      view: 'new',
      selectedSegmentId: null,
      selectedSegment: null,
      segmentsSaved: String(req.query.segments_saved || '') === '1',
    });
  });

  app.get('/segments/:id', async (req, res) => {
    const segId = Number(req.params.id);
    if (!Number.isInteger(segId) || segId <= 0) {
      return res.status(400).send('Id de segmento invalido');
    }
    const area = req.user.area;
    const segmentsList = await loadSegments(area);
    const sel = segmentsList.find((s) => s.id === segId);
    if (!sel) {
      return res.status(404).send('Segmento no encontrado');
    }
    res.render('segments-page', {
      ...commonLocals(req, res),
      activeNav: 'segments',
      pageTitle: `${sel.label} · Segmentos · MALI WhatsApp`,
      layoutModifier: 'conversations-inbox--detail',
      segments: segmentsList,
      view: 'detail',
      selectedSegmentId: segId,
      selectedSegment: sel,
      segmentsSaved: String(req.query.segments_saved || '') === '1',
    });
  });

  app.get('/segments', async (req, res) => {
    const area = req.user.area;
    const segmentsList = await loadSegments(area);
    res.render('segments-page', {
      ...commonLocals(req, res),
      activeNav: 'segments',
      pageTitle: 'Segmentos · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      view: 'list',
      selectedSegmentId: null,
      selectedSegment: null,
      segmentsSaved: String(req.query.segments_saved || '') === '1',
    });
  });

  /* --- Ajustes --- */
  app.get('/settings', async (req, res) => {
    let aiAreaEnabled = false;
    let aiPrompt = '';
    let aiTransferKeyword = '[TRANSFERIR]';
    const u = req.user;
    const settingsShowAiMaster = Boolean(u && u.isMaster);
    const settingsShowAiPromptEditor = Boolean(
      u && (u.isMaster || u.canEditAiPrompt)
    );
    if (u && settingsShowAiPromptEditor) {
      const r = await query(`SELECT value FROM app_settings WHERE area = $1 AND key = 'ai_config'`, [
        u.area,
      ]);
      const cfg = parseAiConfigValue(r.rows[0]?.value);
      aiAreaEnabled = Boolean(cfg && cfg.enabled);
      if (cfg) {
        aiPrompt = cfg.prompt || '';
        aiTransferKeyword = cfg.transfer_keyword || '[TRANSFERIR]';
      }
    }
    res.render('settings-page', {
      ...commonLocals(req, res),
      activeNav: 'settings',
      pageTitle: 'Ajustes · MALI WhatsApp',
      layoutModifier: '',
      aiAreaEnabled,
      masterArea: u && u.area ? u.area : '',
      aiPrompt,
      aiTransferKeyword,
      settingsShowAiMaster,
      settingsShowAiPromptEditor,
    });
  });
}

module.exports = { registerInboxViews };
