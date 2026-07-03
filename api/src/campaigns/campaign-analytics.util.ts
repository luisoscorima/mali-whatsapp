import { buildCampaignCostSummary } from './campaign-pricing.util';
import {
  isErrorStatus,
  normalizeLogStatus,
} from './campaign-log-statuses.util';
import { enrichFailedLogRow } from './campaign-incident.util';

const EMPTY_METRIC = 'Aún sin datos';

export type MetricCard = {
  label: string;
  display: string;
  displayLines?: string[] | null;
  tone: string;
  tooltip?: string;
};

export type CampaignAnalytics = {
  business: MetricCard[];
  globalResult: MetricCard[];
  performance: MetricCard[];
  funnel: MetricCard[];
  incidents: MetricCard[];
  cost: {
    amountDisplay: string;
    perDeliveredDisplay: string;
    sourceLabel: string;
    hint: string;
  };
  responseWindowDays: number;
  performanceNote: string;
  incidentsNote: string;
};

export type CampaignLogRow = {
  id: number;
  phone: string;
  status: string;
  response: unknown;
  created_at: Date | string;
  whatsapp_message_id?: string | null;
  contact_name?: string;
  segment_labels?: string;
};

export type FailedLogRow = CampaignLogRow & {
  error_summary: string;
  incident_type: string;
  incident_label: string;
};

function toInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function roundPct(value: number, total: number): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return Math.round((value / total) * 100);
}

function formatNumberLocale(
  value: number,
  minimumFractionDigits = 2,
  maximumFractionDigits = 2,
): string {
  return new Intl.NumberFormat('es-PE', {
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(value);
}

function formatMoney(
  amount: number | null,
  currency: 'USD' | 'PEN',
  min = 2,
  max = 2,
): string {
  if (amount === null || !Number.isFinite(amount)) return EMPTY_METRIC;
  const formatted = formatNumberLocale(amount, min, max);
  return currency === 'PEN' ? `S/ ${formatted}` : `${formatted} USD`;
}

function formatDualMoney(
  usd: number | null,
  pen: number | null,
  min = 2,
  max = 2,
): string {
  const lines = formatDualMoneyLines(usd, pen, min, max);
  return lines.length ? lines.join(' · ') : EMPTY_METRIC;
}

function formatDualMoneyLines(
  usd: number | null,
  pen: number | null,
  min = 2,
  max = 2,
): string[] {
  const hasUsd = usd !== null && Number.isFinite(usd);
  const hasPen = pen !== null && Number.isFinite(pen);
  if (!hasUsd && !hasPen) return [];
  if (!hasUsd) return [formatMoney(pen, 'PEN', min, max)];
  if (!hasPen) return [formatMoney(usd, 'USD', min, max)];
  return [formatMoney(pen, 'PEN', min, max), formatMoney(usd, 'USD', min, max)];
}

function formatCountPct(
  count: number,
  pct: number | null,
  allowZero = false,
): string {
  if (pct === null || pct === undefined) {
    return allowZero && count === 0 ? '0 (0%)' : EMPTY_METRIC;
  }
  return `${count} (${pct}%)`;
}

function metricCard(
  label: string,
  display: string,
  tone: string,
  tooltip = '',
  displayLines: string[] | null = null,
): MetricCard {
  return { label, display, tone, tooltip, displayLines };
}

export function collectLatestLogsByPhone<T extends { phone?: string; id?: number }>(
  logs: T[],
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const log of logs) {
    const phone = String(log.phone || '').trim();
    const key = phone || `log:${String(log.id || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(log);
  }
  return out;
}

export function summarizeCampaignLogResponse(response: unknown): string {
  let data: Record<string, unknown> | null = null;
  if (response && typeof response === 'object') {
    data = response as Record<string, unknown>;
  } else if (typeof response === 'string' && response) {
    try {
      data = JSON.parse(response) as Record<string, unknown>;
    } catch {
      return 'Sin detalle Meta';
    }
  }
  if (!data) return 'Sin detalle Meta';

  const err = data.error as Record<string, unknown> | undefined;
  if (err && typeof err === 'object') {
    const parts: string[] = [];
    if (err.code != null && err.code !== '') parts.push(`Código ${err.code}`);
    const msg = err.message || data.message;
    if (msg) parts.push(String(msg).trim());
    if (parts.length) return parts.join(' · ');
  }

  if (data.message) return String(data.message).trim();
  return 'Sin detalle Meta';
}

export function buildFailedLogs(logs: CampaignLogRow[]): FailedLogRow[] {
  return collectLatestLogsByPhone(logs)
    .filter((log) => isErrorStatus(log.status))
    .map((log) => enrichFailedLogRow(log));
}

function collectCampaignStatusCounts(logs: CampaignLogRow[]) {
  let sentOnly = 0;
  let deliveredOnly = 0;
  let read = 0;
  for (const log of logs) {
    const status = normalizeLogStatus(log.status);
    if (status === 'read') read += 1;
    else if (status === 'delivered') deliveredOnly += 1;
    else if (status === 'sent') sentOnly += 1;
  }
  return { sentOnly, deliveredOnly, read };
}

function collectIncidentCounts(failedLogs: FailedLogRow[]) {
  let undeliverable = 0;
  let metaLimit = 0;
  let experiment = 0;
  for (const log of failedLogs) {
    const type = String(log.incident_type || '').trim().toLowerCase();
    if (type === 'meta_limit') metaLimit += 1;
    else if (type === 'experiment') experiment += 1;
    else undeliverable += 1;
  }
  return { undeliverable, metaLimit, experiment };
}

export function buildCampaignDetailAnalytics(
  campaign: {
    status?: string;
    total_recipients?: number;
    campaign_payload?: unknown;
    cost_amount?: unknown;
    cost_currency?: string | null;
    cost_source?: string | null;
    cost_is_estimated?: boolean | null;
  },
  logs: CampaignLogRow[],
  failedLogs: FailedLogRow[],
  responderMetrics?: {
    window_days?: number;
    responded_count?: number;
  },
): CampaignAnalytics {
  const campaignStatus = normalizeLogStatus(campaign.status);
  const effectiveLogs = collectLatestLogsByPhone(logs);
  const statusCounts = collectCampaignStatusCounts(effectiveLogs);
  const sentCount =
    statusCounts.sentOnly + statusCounts.deliveredOnly + statusCounts.read;
  const deliveredCount = statusCounts.deliveredOnly + statusCounts.read;
  const readCount = statusCounts.read;

  const failedCount = failedLogs.length;
  const declaredRecipients = toInt(campaign.total_recipients, 0);
  const totalRecipients = Math.max(
    declaredRecipients,
    sentCount + failedCount,
    effectiveLogs.length,
  );
  const problemsCount = Math.max(totalRecipients - sentCount, 0);
  const hasIncomplete =
    ['queued', 'processing', 'scheduled'].includes(campaignStatus) &&
    declaredRecipients > sentCount + failedCount;

  const respondedCount = toInt(responderMetrics?.responded_count, 0);
  const responseWindowDays = toInt(responderMetrics?.window_days, 7);
  const incidentCounts = collectIncidentCounts(failedLogs);
  const classifiedProblemCount =
    incidentCounts.undeliverable +
    incidentCounts.metaLimit +
    incidentCounts.experiment;
  const pendingClassificationCount = Math.max(
    problemsCount - classifiedProblemCount,
    0,
  );

  const costInfo = buildCampaignCostSummary(campaign, deliveredCount);
  const problemsDisplay = hasIncomplete
    ? EMPTY_METRIC
    : formatCountPct(problemsCount, roundPct(problemsCount, totalRecipients), true);

  return {
    business: [
      metricCard(
        'Importe gastado',
        formatDualMoney(costInfo.usdAmount, costInfo.penAmount),
        'neutral',
        'Monto total invertido en la campaña.',
        formatDualMoneyLines(costInfo.usdAmount, costInfo.penAmount),
      ),
      metricCard(
        'Costo por mensaje entregado',
        formatDualMoney(costInfo.unitUsdAmount, costInfo.unitPenAmount, 4, 4),
        'sent',
        'Importe dividido entre mensajes entregados o leídos.',
        formatDualMoneyLines(costInfo.unitUsdAmount, costInfo.unitPenAmount, 4, 4),
      ),
    ],
    cost: {
      amountDisplay: formatDualMoney(costInfo.usdAmount, costInfo.penAmount),
      perDeliveredDisplay: formatDualMoney(
        costInfo.unitUsdAmount,
        costInfo.unitPenAmount,
        4,
        4,
      ),
      sourceLabel: costInfo.sourceLabel,
      hint: costInfo.hint,
    },
    globalResult: [
      metricCard(
        'Total destinatarios',
        totalRecipients > 0 ? `${totalRecipients} (100%)` : EMPTY_METRIC,
        'neutral',
        'Destinatarios incluidos en la campaña.',
      ),
      metricCard(
        'Enviados',
        formatCountPct(sentCount, roundPct(sentCount, totalRecipients), true),
        'sent',
        'Mensajes enviados correctamente hacia Meta.',
      ),
      metricCard(
        'Problemas de entrega',
        problemsDisplay,
        'problem',
        'Destinatarios sin envío exitoso.',
      ),
    ],
    performance: [
      metricCard(
        'Enviados',
        sentCount > 0 ? `${sentCount} (100%)` : '0 (0%)',
        'sent',
        'Base de rendimiento de la campaña.',
      ),
      metricCard(
        'Entregados',
        formatCountPct(deliveredCount, roundPct(deliveredCount, sentCount), true),
        'delivered',
        'Mensajes entregados al dispositivo.',
      ),
      metricCard(
        'Leídos',
        formatCountPct(readCount, roundPct(readCount, deliveredCount)),
        'read',
        'Mensajes leídos por el usuario.',
      ),
      metricCard(
        'Respuestas únicas',
        formatCountPct(respondedCount, roundPct(respondedCount, readCount)),
        'response',
        `Cuentas que respondieron dentro de ${responseWindowDays} días tras el envío.`,
      ),
    ],
    funnel: [
      metricCard(
        'Pendientes de entrega',
        formatCountPct(
          statusCounts.sentOnly,
          roundPct(statusCounts.sentOnly, sentCount),
          true,
        ),
        'sent',
        'Enviados sin confirmación de entrega o lectura.',
      ),
      metricCard(
        'Entregados no leídos',
        formatCountPct(
          statusCounts.deliveredOnly,
          roundPct(statusCounts.deliveredOnly, sentCount),
          true,
        ),
        'delivered',
        'Entregados pero aún no leídos.',
      ),
      metricCard(
        'Leídos',
        formatCountPct(readCount, roundPct(readCount, sentCount), true),
        'read',
        'Mensajes leídos en la ventana de medición.',
      ),
    ],
    incidents: [
      metricCard(
        'Mensajes no entregables',
        formatCountPct(
          incidentCounts.undeliverable,
          roundPct(incidentCounts.undeliverable, problemsCount),
          true,
        ),
        'problem',
        'Errores permanentes o condiciones del usuario.',
      ),
      metricCard(
        'Limitaciones Meta',
        formatCountPct(
          incidentCounts.metaLimit,
          roundPct(incidentCounts.metaLimit, problemsCount),
          true,
        ),
        'problem',
        'Rate limits o restricciones del ecosistema Meta.',
      ),
      metricCard(
        'Experimentos',
        formatCountPct(
          incidentCounts.experiment,
          roundPct(incidentCounts.experiment, problemsCount),
          true,
        ),
        'neutral',
        'Números en experimento o holdout de Meta.',
      ),
    ],
    responseWindowDays,
    performanceNote:
      'Las métricas pueden demorar hasta 7 días en consolidarse.',
    incidentsNote: hasIncomplete
      ? 'La campaña aún está procesándose; las métricas pueden ser parciales.'
      : pendingClassificationCount > 0
        ? `Quedan ${pendingClassificationCount} problema(s) sin clasificación detallada.`
        : '',
  };
}

export type CampaignTotalsRow = {
  total_logs: number;
  salida_ok: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  campaign_count: number;
  total_recipients: number;
  cost_rows: {
    id: number;
    campaign_payload: unknown;
    cost_amount: unknown;
    cost_currency: string | null;
    cost_source: string | null;
    cost_is_estimated: boolean | null;
    delivered_count: number;
  }[];
};

export function buildCampaignIndexSummary(totals: CampaignTotalsRow) {
  const sentCount = toInt(totals.salida_ok, 0);
  const deliveredCount = toInt(totals.delivered_count, 0);
  const totalRecipients = Math.max(
    toInt(totals.total_recipients, 0),
    sentCount + toInt(totals.failed_count, 0),
  );
  const problemsCount = Math.max(totalRecipients - sentCount, 0);

  let totalUsd = 0;
  let totalPen = 0;
  let campaignsWithCost = 0;
  for (const row of totals.cost_rows) {
    const cost = buildCampaignCostSummary(row, row.delivered_count);
    if (cost.usdAmount === null && cost.penAmount === null) continue;
    campaignsWithCost += 1;
    totalUsd += Number(cost.usdAmount || 0);
    totalPen += Number(cost.penAmount || 0);
  }
  const hasCost = campaignsWithCost > 0;

  return {
    business: [
      metricCard(
        'Importe gastado',
        hasCost ? formatDualMoney(totalUsd, totalPen) : EMPTY_METRIC,
        'neutral',
        'Suma de costos del área.',
        hasCost ? formatDualMoneyLines(totalUsd, totalPen) : null,
      ),
      metricCard(
        'Costo por mensaje entregado',
        hasCost && deliveredCount > 0
          ? formatDualMoney(totalUsd / deliveredCount, totalPen / deliveredCount, 4, 4)
          : EMPTY_METRIC,
        'sent',
        'Importe dividido entre entregados del área.',
        hasCost && deliveredCount > 0
          ? formatDualMoneyLines(
              totalUsd / deliveredCount,
              totalPen / deliveredCount,
              4,
              4,
            )
          : null,
      ),
    ],
    results: [
      metricCard(
        'Total destinatarios',
        totalRecipients > 0 ? `${totalRecipients} (100%)` : EMPTY_METRIC,
        'neutral',
      ),
      metricCard(
        'Enviados',
        formatCountPct(sentCount, roundPct(sentCount, totalRecipients), true),
        'sent',
      ),
      metricCard(
        'Problemas de entrega',
        formatCountPct(problemsCount, roundPct(problemsCount, totalRecipients), true),
        'problem',
      ),
    ],
    hint: 'Resumen agregado del área. Costos con tarifa oficial WhatsApp.',
    campaignsCount: toInt(totals.campaign_count, 0),
  };
}
