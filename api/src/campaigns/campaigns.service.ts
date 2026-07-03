import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildCampaignDetailAnalytics,
  buildCampaignIndexSummary,
  buildFailedLogs,
  type CampaignLogRow,
  type CampaignTotalsRow,
} from './campaign-analytics.util';
import {
  buildCampaignFailedLogsCsv,
  buildCampaignFailedLogsExportBuffer,
  buildCampaignLogsExportBuffer,
  buildCampaignRespondersExportBuffer,
  filterCampaignCurrentLogs,
  filterCampaignFailedLogs,
  type CampaignExportLogRow,
} from './campaign-export.util';
import { exportFilenameDateStamp } from './campaign-format.util';
import { enrichFailedLogRow, type EnrichedFailedLog } from './campaign-incident.util';
import {
  estimateCategoryCost,
  getCampaignTemplateCategory,
} from './campaign-pricing.util';
import { fetchCampaignRetryStats } from './campaign-retry-stats.util';
import { fetchCampaignResponderMetrics } from './campaign-responders.util';
import {
  buildCampaignDetailPreviewFromRow,
} from './campaign-message-preview.util';
import {
  buildCampaignParamSummary,
  readCampaignExclusions,
} from './campaign-param-summary.util';
import {
  CAMPAIGN_LOG_STATUS_SQL,
  sqlCampaignLogIsError,
  sqlInList,
  SALIDA_OK_STATUSES,
  ERROR_STATUSES,
} from './campaign-log-statuses.util';
import { isWithinUserServiceWindow } from './campaign-conversation-window.util';
import {
  countRecipientsUnion,
  fetchRecipientsUnion,
  readMaxExcludeContactIds,
  readRecipientsPreviewMax,
  validateRecipientsMatchRequest,
} from './campaign-recipients.util';
import { RecipientsPreviewDto } from './dto/recipients-preview.dto';
import { validateCampaignSend } from './campaign-send-validate.util';
import {
  CampaignSenderService,
  type CampaignJobPayload,
} from './campaign-sender.service';
import { CampaignRetryService } from './campaign-retry.service';
import type {
  CampaignDetail,
  CampaignListItem,
  CampaignRetryActionResult,
  CampaignSummary,
  RecipientsPreviewResult,
  SendCampaignResult,
} from './campaigns.types';
import { formatCampaignSegmentDisplay, parseCampaignPayload } from './campaign-payload.util';

const SALIDA_OK_IN = sqlInList(SALIDA_OK_STATUSES);
const ERROR_IN = sqlInList(ERROR_STATUSES);
const LOG_STATUS = CAMPAIGN_LOG_STATUS_SQL;

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

type ListRow = {
  id: number;
  segment: string;
  campaign_payload: unknown;
  template_name: string;
  message_text: string;
  status: string;
  total_recipients: number;
  created_at: Date;
  scheduled_at: Date | null;
  first_send_at: Date | null;
  log_count: number;
  salida_ok: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
};

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaignSender: CampaignSenderService,
    private readonly campaignRetry: CampaignRetryService,
  ) {}

  private async getSegmentSlugSet(area: AuthUser['area']): Promise<Set<string>> {
    const rows = await this.prisma.segment_definitions.findMany({
      where: { area },
      select: { slug: true },
    });
    return new Set(rows.map((row) => row.slug));
  }

  async previewRecipients(
    area: AuthUser['area'],
    dto: RecipientsPreviewDto,
  ): Promise<RecipientsPreviewResult> {
    const segmentSet = await this.getSegmentSlugSet(area);
    const segments = [
      ...new Set(
        dto.segments.map((s) => String(s).trim()).filter(Boolean),
      ),
    ];
    if (!segments.length) {
      throw new BadRequestException('Indica al menos un segmento');
    }
    for (const slug of segments) {
      if (!segmentSet.has(slug)) {
        throw new BadRequestException('Segmento inválido');
      }
    }

    const recipientOptions: {
      excludeSegmentSlugs?: string[];
      excludeContactIds?: number[];
      excludeOpenServiceWindow?: boolean;
    } = {};

    if (dto.excludeSegmentSlugs?.length) {
      const excludeSlugs = [
        ...new Set(
          dto.excludeSegmentSlugs.map((s) => String(s).trim()).filter(Boolean),
        ),
      ];
      for (const slug of excludeSlugs) {
        if (!segmentSet.has(slug)) {
          throw new BadRequestException('Segmento de exclusión inválido');
        }
      }
      if (excludeSlugs.length) {
        recipientOptions.excludeSegmentSlugs = excludeSlugs;
      }
    }

    const excludeIds = Array.isArray(dto.excludeContactIds)
      ? [
          ...new Set(
            dto.excludeContactIds
              .map((x) => Number(x))
              .filter((n) => Number.isInteger(n) && n > 0),
          ),
        ].sort((a, b) => a - b)
      : [];

    const maxExclude = readMaxExcludeContactIds();
    if (excludeIds.length > maxExclude) {
      throw new BadRequestException(
        `Demasiados contactos a excluir (máximo ${maxExclude})`,
      );
    }
    if (excludeIds.length) {
      recipientOptions.excludeContactIds = excludeIds;
    }

    const excludeOpenServiceWindow = dto.excludeOpenServiceWindow === true;
    if (excludeOpenServiceWindow) {
      recipientOptions.excludeOpenServiceWindow = true;
    }

    const maxN = readRecipientsPreviewMax();
    const total = await countRecipientsUnion(
      this.prisma,
      area,
      segments,
      recipientOptions,
    );
    if (total > maxN) {
      throw new BadRequestException(
        `Hay demasiados contactos (${total}). Máximo ${maxN}; reduce los segmentos.`,
      );
    }

    const rows = await fetchRecipientsUnion(
      this.prisma,
      area,
      segments,
      recipientOptions,
    );

    return {
      contacts: rows.map((row) => ({
        id: row.id,
        name: row.name,
        phone: row.phone,
        service_window_open: isWithinUserServiceWindow(row.last_user_message_at),
      })),
      total: rows.length,
      exclude_open_service_window: excludeOpenServiceWindow,
    };
  }

  async list(area: AuthUser['area']): Promise<CampaignListItem[]> {
    const rows = await this.prisma.$queryRaw<ListRow[]>(Prisma.sql`
      WITH latest_logs AS (
        SELECT DISTINCT ON (cl.campaign_id, cl.phone)
          cl.campaign_id,
          cl.phone,
          cl.status,
          cl.created_at
        FROM campaign_logs cl
        JOIN campaigns cx ON cx.id = cl.campaign_id
        WHERE cx.area = ${area}
        ORDER BY cl.campaign_id, cl.phone, cl.id DESC
      )
      SELECT
        c.id,
        c.segment,
        c.campaign_payload,
        c.template_name,
        c.message_text,
        c.status,
        c.total_recipients,
        c.created_at,
        c.scheduled_at,
        MIN(cl.created_at) AS first_send_at,
        COALESCE(COUNT(cl.phone), 0)::int AS log_count,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(LOG_STATUS)} IN ${Prisma.raw(SALIDA_OK_IN)} THEN 1 ELSE 0 END), 0)::int AS salida_ok,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(LOG_STATUS)} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(LOG_STATUS)} = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(LOG_STATUS)} IN ${Prisma.raw(ERROR_IN)} THEN 1 ELSE 0 END), 0)::int AS failed_count
      FROM campaigns c
      LEFT JOIN latest_logs cl ON cl.campaign_id = c.id
      WHERE c.area = ${area}
      GROUP BY c.id
      ORDER BY c.id DESC
      LIMIT 200
    `);

    return rows.map((row) => {
      const denom =
        row.total_recipients > 0 ? row.total_recipients : row.log_count;
      const sentPercent =
        denom > 0 ? Math.round((row.salida_ok * 100) / denom) : null;
      return {
        id: row.id,
        segment: row.segment,
        segment_display: formatCampaignSegmentDisplay(row),
        template_name: row.template_name,
        message_text: row.message_text,
        status: row.status,
        total_recipients: row.total_recipients,
        created_at: row.created_at.toISOString(),
        scheduled_at: toIso(row.scheduled_at),
        first_send_at: toIso(row.first_send_at),
        log_count: row.log_count,
        salida_ok: row.salida_ok,
        delivered_count: row.delivered_count,
        read_count: row.read_count,
        failed_count: row.failed_count,
        sent_percent: sentPercent,
        sent_ratio: denom > 0 ? `${row.salida_ok}/${denom}` : '—',
      };
    });
  }

  async getSummary(area: AuthUser['area']): Promise<CampaignSummary> {
    const logTotals = await this.prisma.$queryRaw<
      {
        total_logs: number;
        salida_ok: number;
        delivered_count: number;
        read_count: number;
        failed_count: number;
      }[]
    >(Prisma.sql`
      WITH latest_logs AS (
        SELECT DISTINCT ON (cl.campaign_id, cl.phone)
          cl.campaign_id,
          cl.phone,
          cl.status
        FROM campaign_logs cl
        JOIN campaigns cx ON cx.id = cl.campaign_id
        WHERE cx.area = ${area}
        ORDER BY cl.campaign_id, cl.phone, cl.id DESC
      )
      SELECT
        COUNT(cl.phone)::int AS total_logs,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(LOG_STATUS)} IN ${Prisma.raw(SALIDA_OK_IN)} THEN 1 ELSE 0 END), 0)::int AS salida_ok,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(LOG_STATUS)} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(LOG_STATUS)} = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(LOG_STATUS)} IN ${Prisma.raw(ERROR_IN)} THEN 1 ELSE 0 END), 0)::int AS failed_count
      FROM latest_logs cl
    `);

    const campaignTotals = await this.prisma.$queryRaw<
      { campaign_count: number; total_recipients: number }[]
    >(Prisma.sql`
      SELECT
        COUNT(*)::int AS campaign_count,
        COALESCE(SUM(total_recipients), 0)::int AS total_recipients
      FROM campaigns
      WHERE area = ${area}
    `);

    const costRows = await this.prisma.$queryRaw<
      CampaignTotalsRow['cost_rows']
    >(Prisma.sql`
      WITH latest_logs AS (
        SELECT DISTINCT ON (cl.campaign_id, cl.phone)
          cl.campaign_id,
          cl.phone,
          cl.status
        FROM campaign_logs cl
        JOIN campaigns cx ON cx.id = cl.campaign_id
        WHERE cx.area = ${area}
        ORDER BY cl.campaign_id, cl.phone, cl.id DESC
      )
      SELECT
        c.id,
        c.campaign_payload,
        c.cost_amount,
        c.cost_currency,
        c.cost_source,
        c.cost_is_estimated,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(LOG_STATUS)} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count
      FROM campaigns c
      LEFT JOIN latest_logs cl ON cl.campaign_id = c.id
      WHERE c.area = ${area}
      GROUP BY c.id
      ORDER BY c.id DESC
    `);

    const totals: CampaignTotalsRow = {
      ...(logTotals[0] || {
        total_logs: 0,
        salida_ok: 0,
        delivered_count: 0,
        read_count: 0,
        failed_count: 0,
      }),
      ...(campaignTotals[0] || { campaign_count: 0, total_recipients: 0 }),
      cost_rows: costRows,
    };

    return buildCampaignIndexSummary(totals);
  }

  async getById(
    area: AuthUser['area'],
    id: number,
  ): Promise<CampaignDetail> {
    const campaign = await this.prisma.campaigns.findFirst({
      where: { id, area },
    });
    if (!campaign) {
      throw new NotFoundException('Campaña no encontrada');
    }

    const logs = await this.prisma.$queryRaw<CampaignLogRow[]>(Prisma.sql`
      SELECT cl.id, cl.phone, cl.whatsapp_message_id, cl.status, cl.response, cl.created_at,
             COALESCE(ct.name, '') AS contact_name,
             COALESCE((
               SELECT string_agg(sd.label, ', ' ORDER BY sd.sort_order NULLS LAST, sd.label)
               FROM contact_segments cs
               JOIN segment_definitions sd ON sd.area = ${area} AND sd.slug = cs.segment_slug
               WHERE cs.contact_id = ct.id AND cs.area = ${area}
             ), '') AS segment_labels
      FROM campaign_logs cl
      LEFT JOIN contacts ct ON ct.area = ${area} AND (
        ct.id = cl.contact_id
        OR (cl.contact_id IS NULL AND ct.phone = cl.phone)
      )
      WHERE cl.campaign_id = ${id}
      ORDER BY cl.id DESC
      LIMIT 500
    `);

    const normalizedLogs = logs.map((log) => ({
      ...log,
      created_at:
        log.created_at instanceof Date
          ? log.created_at.toISOString()
          : String(log.created_at),
    }));

    const failedLogs = buildFailedLogs(normalizedLogs).map((log) => ({
      ...log,
      created_at: String(log.created_at),
    }));

    const responderMetrics = await fetchCampaignResponderMetrics(
      this.prisma,
      id,
      area,
    );

    const analytics = buildCampaignDetailAnalytics(
      campaign,
      normalizedLogs,
      failedLogs,
      responderMetrics,
    );

    const retryStats = await fetchCampaignRetryStats(this.prisma, id);

    const templateRow = await this.resolveTemplateRowForPreview(
      area,
      campaign,
    );
    const { preview: messagePreview, templateId } =
      buildCampaignDetailPreviewFromRow(campaign, templateRow);
    const paramSummary = buildCampaignParamSummary(campaign);
    const exclusions = readCampaignExclusions(campaign.campaign_payload);

    let firstSendAt: string | null = null;
    for (const log of normalizedLogs) {
      const t = new Date(String(log.created_at)).getTime();
      if (Number.isNaN(t)) continue;
      if (!firstSendAt || t < new Date(firstSendAt).getTime()) {
        firstSendAt = String(log.created_at);
      }
    }

    return {
      id: campaign.id,
      segment: campaign.segment,
      segment_display: formatCampaignSegmentDisplay(campaign),
      template_name: campaign.template_name,
      message_text: campaign.message_text,
      image_url: campaign.image_url,
      status: campaign.status,
      total_recipients: campaign.total_recipients,
      created_at: campaign.created_at.toISOString(),
      scheduled_at: toIso(campaign.scheduled_at),
      cost_amount: campaign.cost_amount?.toString() ?? null,
      cost_currency: campaign.cost_currency,
      cost_source: campaign.cost_source,
      cost_is_estimated: campaign.cost_is_estimated,
      cost_synced_at: toIso(campaign.cost_synced_at),
      campaign_payload: campaign.campaign_payload,
      analytics,
      failed_logs: failedLogs,
      logs: normalizedLogs,
      retry_stats: retryStats,
      responder_metrics: responderMetrics,
      template_id: templateId,
      message_preview: messagePreview,
      param_summary: paramSummary,
      exclude_segment_slugs: exclusions.exclude_segment_slugs,
      exclude_contact_ids: exclusions.exclude_contact_ids,
      first_send_at: firstSendAt,
    };
  }

  private async resolveTemplateRowForPreview(
    area: AuthUser['area'],
    campaign: {
      template_name: string;
      campaign_payload: unknown;
    },
  ): Promise<{
    id: number;
    name: string;
    language: string;
    category: string | null;
    components_json: unknown;
  } | null> {
    const payload = parseCampaignPayload(campaign.campaign_payload);
    const snapshot = (payload?.templateSnapshot || null) as Record<
      string,
      unknown
    > | null;
    const templateName = String(campaign.template_name || '').trim();
    const snapshotId = Number(snapshot?.id);

    if (snapshot?.components_json) {
      if (Number.isInteger(snapshotId) && snapshotId > 0) {
        return {
          id: snapshotId,
          name: String(snapshot.name || templateName),
          language: String(snapshot.language || 'es'),
          category: String(snapshot.category || ''),
          components_json: snapshot.components_json,
        };
      }
    }

    if (!templateName) return null;

    const row = await this.prisma.whatsapp_templates.findFirst({
      where: { area, name: templateName },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        name: true,
        language: true,
        category: true,
        components_json: true,
      },
    });
    return row;
  }

  private async assertCampaignInArea(
    area: AuthUser['area'],
    id: number,
  ): Promise<void> {
    const campaign = await this.prisma.campaigns.findFirst({
      where: { id, area },
      select: { id: true },
    });
    if (!campaign) {
      throw new NotFoundException('Campaña no encontrada');
    }
  }

  private async fetchFailedLogsForExport(
    area: AuthUser['area'],
    campaignId: number,
  ): Promise<EnrichedFailedLog[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: number;
        phone: string;
        status: string;
        response: unknown;
        created_at: Date;
        contact_name: string;
        segment_labels: string;
      }[]
    >(Prisma.sql`
      SELECT latest_logs.id, latest_logs.phone, latest_logs.status, latest_logs.response,
             latest_logs.created_at,
             COALESCE(ct.name, '') AS contact_name,
             COALESCE((
               SELECT string_agg(sd.label, ', ' ORDER BY sd.sort_order NULLS LAST, sd.label)
               FROM contact_segments cs
               JOIN segment_definitions sd ON sd.area = ${area} AND sd.slug = cs.segment_slug
               WHERE cs.contact_id = ct.id AND cs.area = ${area}
             ), '') AS segment_labels
      FROM (
        SELECT DISTINCT ON (phone)
          id, phone, contact_id, status, response, created_at
        FROM campaign_logs
        WHERE campaign_id = ${campaignId}
        ORDER BY phone, id DESC
      ) latest_logs
      LEFT JOIN contacts ct ON ct.area = ${area} AND (
        ct.id = latest_logs.contact_id
        OR (latest_logs.contact_id IS NULL AND ct.phone = latest_logs.phone)
      )
      WHERE ${Prisma.raw(sqlCampaignLogIsError('latest_logs.status'))}
      ORDER BY latest_logs.id DESC
    `);

    return rows.map((row) =>
      enrichFailedLogRow({
        ...row,
        created_at: row.created_at.toISOString(),
      }),
    );
  }

  private async fetchLogsForExport(
    area: AuthUser['area'],
    campaignId: number,
  ): Promise<CampaignExportLogRow[]> {
    const rows = await this.prisma.$queryRaw<
      {
        id: number;
        phone: string;
        whatsapp_message_id: string | null;
        status: string;
        response: unknown;
        created_at: Date;
        contact_name: string;
        segment_labels: string;
      }[]
    >(Prisma.sql`
      SELECT cl.id, cl.phone, cl.whatsapp_message_id, cl.status, cl.response, cl.created_at,
             COALESCE(ct.name, '') AS contact_name,
             COALESCE((
               SELECT string_agg(sd.label, ', ' ORDER BY sd.sort_order NULLS LAST, sd.label)
               FROM contact_segments cs
               JOIN segment_definitions sd ON sd.area = ${area} AND sd.slug = cs.segment_slug
               WHERE cs.contact_id = ct.id AND cs.area = ${area}
             ), '') AS segment_labels
      FROM campaign_logs cl
      LEFT JOIN contacts ct ON ct.area = ${area} AND (
        ct.id = cl.contact_id
        OR (cl.contact_id IS NULL AND ct.phone = cl.phone)
      )
      WHERE cl.campaign_id = ${campaignId}
      ORDER BY cl.id DESC
    `);

    return rows.map((row) => ({
      ...row,
      created_at: row.created_at.toISOString(),
    }));
  }

  async exportFailedCsv(
    area: AuthUser['area'],
    id: number,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertCampaignInArea(area, id);
    const failedLogs = await this.fetchFailedLogsForExport(area, id);
    const csv = buildCampaignFailedLogsCsv(failedLogs);
    const stamp = new Date().toISOString().slice(0, 10);
    return {
      buffer: Buffer.from(`\uFEFF${csv}`, 'utf8'),
      filename: `campana-${id}-fallidos-${stamp}.csv`,
    };
  }

  async exportLogsXlsx(
    area: AuthUser['area'],
    id: number,
    filter: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertCampaignInArea(area, id);
    const logs = await this.fetchLogsForExport(area, id);
    const exportRows = filter
      ? filterCampaignCurrentLogs(logs, filter)
      : filterCampaignCurrentLogs(logs, 'all_current');
    const buffer = buildCampaignLogsExportBuffer(exportRows);
    const stamp = exportFilenameDateStamp();
    return {
      buffer,
      filename: `campana-${id}-registro-${stamp}.xlsx`,
    };
  }

  async exportIncidentsXlsx(
    area: AuthUser['area'],
    id: number,
    filter: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertCampaignInArea(area, id);
    const failedLogs = await this.fetchFailedLogsForExport(area, id);
    const exportRows = filter
      ? filterCampaignFailedLogs(failedLogs, filter)
      : failedLogs;
    const buffer = buildCampaignFailedLogsExportBuffer(exportRows);
    const stamp = exportFilenameDateStamp();
    return {
      buffer,
      filename: `campana-${id}-incidencias-${stamp}.xlsx`,
    };
  }

  async exportRespondersXlsx(
    area: AuthUser['area'],
    id: number,
  ): Promise<{ buffer: Buffer; filename: string }> {
    await this.assertCampaignInArea(area, id);
    const metrics = await fetchCampaignResponderMetrics(this.prisma, id, area);
    const buffer = buildCampaignRespondersExportBuffer(metrics.responders);
    const stamp = exportFilenameDateStamp();
    return {
      buffer,
      filename: `campana-${id}-respuestas-${stamp}.xlsx`,
    };
  }

  async syncCost(
    area: AuthUser['area'],
    id: number,
  ): Promise<{
    amount: number;
    currency: string;
    source: string;
    isEstimated: boolean;
    deliveredCount: number;
  }> {
    const campaign = await this.prisma.campaigns.findFirst({
      where: { id, area },
    });
    if (!campaign) {
      throw new NotFoundException('Campaña no encontrada');
    }

    const deliveredRows = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n
      FROM (
        SELECT DISTINCT ON (phone)
          phone,
          status
        FROM campaign_logs
        WHERE campaign_id = ${id}
        ORDER BY phone, id DESC
      ) latest_logs
      WHERE LOWER(TRIM(COALESCE(latest_logs.status, ''))) IN ('delivered', 'read')
    `);
    const deliveredCount = deliveredRows[0]?.n ?? 0;
    const category = getCampaignTemplateCategory(campaign);

    let amount: number | null = null;
    let currency = 'USD';
    let source = 'estimated';
    let isEstimated = true;

    const categoryEstimate = estimateCategoryCost(deliveredCount, category);
    if (categoryEstimate) {
      amount = categoryEstimate.usdAmount;
      currency = 'USD';
      source = 'category_rate';
      isEstimated = false;
    } else {
      const setting = await this.prisma.app_settings.findFirst({
        where: { area, key: 'campaign_cost_per_message_usd' },
      });
      const defaultRate = Number(process.env.CAMPAIGN_COST_PER_MESSAGE_USD || 0.05);
      const rate = setting?.value != null ? Number(setting.value) : defaultRate;
      const safeRate = Number.isFinite(rate) && rate >= 0 ? rate : defaultRate;
      amount = deliveredCount * safeRate;
      source = 'estimated_delivered';
      isEstimated = true;
    }

    await this.prisma.campaigns.update({
      where: { id },
      data: {
        cost_amount: amount,
        cost_currency: currency,
        cost_synced_at: new Date(),
        cost_source: source,
        cost_is_estimated: isEstimated,
      },
    });

    return {
      amount: amount ?? 0,
      currency,
      source,
      isEstimated,
      deliveredCount,
    };
  }

  async sendCampaign(
    area: AuthUser['area'],
    body: Record<string, unknown>,
  ): Promise<SendCampaignResult> {
    const segmentSet = await this.getSegmentSlugSet(area);
    const templateSyncId = parseInt(String(body.templateSyncId || '').trim(), 10);

    let templateRow: {
      id: number;
      name: string;
      language: string;
      category: string | null;
      status: string;
      components_json: unknown;
      placeholder_aliases_json: unknown;
    } | null = null;

    if (Number.isInteger(templateSyncId) && templateSyncId > 0) {
      templateRow = await this.prisma.whatsapp_templates.findFirst({
        where: { id: templateSyncId, area },
        select: {
          id: true,
          name: true,
          language: true,
          category: true,
          status: true,
          components_json: true,
          placeholder_aliases_json: true,
        },
      });
    }

    const validation = validateCampaignSend(body, segmentSet, templateRow);
    if (!validation.ok) {
      throw new BadRequestException(validation.message);
    }

    const {
      segment,
      segments,
      recipientContactIds,
      excludeContactIds,
      excludeSegmentSlugs,
      excludeOpenServiceWindow,
      audienceMode,
      templateRow: tRow,
      values,
      messageText,
      imageUrl,
      batchSize,
      batchDelayMs,
      isScheduled,
      scheduledAt,
      paramMapping,
    } = validation.value;

    const uniqueExcludeIds = excludeContactIds || [];
    const recipientOptions: {
      excludeContactIds?: number[];
      excludeSegmentSlugs?: string[];
      excludeOpenServiceWindow?: boolean;
      contactIds?: number[];
    } = {};

    if (uniqueExcludeIds.length > 0) {
      recipientOptions.excludeContactIds = uniqueExcludeIds;
    }
    if (excludeSegmentSlugs.length > 0) {
      recipientOptions.excludeSegmentSlugs = excludeSegmentSlugs;
    }
    if (excludeOpenServiceWindow) {
      recipientOptions.excludeOpenServiceWindow = true;
    }

    let recipients;
    if (
      audienceMode === 'multi' &&
      recipientContactIds &&
      recipientContactIds.length > 0
    ) {
      recipients = await fetchRecipientsUnion(this.prisma, area, segments, {
        ...recipientOptions,
        contactIds: recipientContactIds,
      });
      if (!validateRecipientsMatchRequest(recipients, recipientContactIds)) {
        const msg = excludeOpenServiceWindow
          ? 'Destinatarios inválidos, fuera de los segmentos o con ventana de 24 h activa (excluidos por el filtro)'
          : 'Destinatarios inválidos o no pertenecen a los segmentos seleccionados';
        throw new BadRequestException(msg);
      }
    } else {
      recipients = await fetchRecipientsUnion(
        this.prisma,
        area,
        segments,
        recipientOptions,
      );
    }

    if (!recipients.length) {
      throw new BadRequestException('No hay destinatarios con los filtros actuales');
    }

    const templateSnapshot = {
      id: tRow.id,
      name: tRow.name,
      language: tRow.language,
      category: tRow.category,
      components_json: tRow.components_json,
    };

    const staticParams = {
      headerParams: values.headerParams,
      bodyParams: values.bodyParams,
      buttonParams: values.buttonParams,
      headerMediaUrl: values.headerMediaUrl,
    };

    const campaignPayload: CampaignJobPayload = {
      area,
      segments,
      templateSnapshot,
      staticParams,
      paramMapping,
      batchSize,
      batchDelayMs,
    };

    if (
      audienceMode === 'multi' &&
      recipientContactIds &&
      recipientContactIds.length > 0
    ) {
      campaignPayload.recipientContactIds = recipientContactIds;
    } else {
      campaignPayload.segment = segments[0];
    }
    if (excludeContactIds.length > 0) {
      campaignPayload.excludeContactIds = excludeContactIds;
    }
    if (excludeSegmentSlugs.length > 0) {
      campaignPayload.excludeSegmentSlugs = excludeSegmentSlugs;
    }
    if (excludeOpenServiceWindow) {
      campaignPayload.excludeOpenServiceWindow = true;
    }
    if (uniqueExcludeIds.length > 0) {
      campaignPayload.excludeContactIdsMerged = uniqueExcludeIds;
    }

    const campaignStatus = isScheduled ? 'scheduled' : 'queued';

    const campaign = await this.prisma.campaigns.create({
      data: {
        area,
        segment,
        template_name: tRow.name,
        message_text: messageText,
        image_url: imageUrl,
        status: campaignStatus,
        total_recipients: recipients.length,
        campaign_payload: campaignPayload as object,
        scheduled_at: isScheduled && scheduledAt ? scheduledAt : null,
      },
      select: { id: true },
    });

    if (!isScheduled) {
      this.campaignSender.enqueueSendJob(campaign.id, campaignPayload);
    }

    return {
      campaignId: campaign.id,
      redirect: `/campaigns/${campaign.id}`,
      status: campaignStatus,
      totalRecipients: recipients.length,
      isScheduled,
    };
  }

  async retryFailed(
    area: AuthUser['area'],
    id: number,
  ): Promise<CampaignRetryActionResult> {
    const campaign = await this.prisma.campaigns.findFirst({
      where: { id, area },
      select: { id: true, status: true, manual_retry_count: true },
    });
    if (!campaign) {
      throw new NotFoundException('Campaña no encontrada');
    }
    if (campaign.status === 'processing' || campaign.status === 'queued') {
      throw new ConflictException('La campaña aún está en envío');
    }

    const maxManualRetries = (() => {
      const n = Number(process.env.CAMPAIGN_MAX_MANUAL_RETRIES || 3);
      return Number.isFinite(n) && n > 0 ? n : 3;
    })();

    if (Number(campaign.manual_retry_count || 0) >= maxManualRetries) {
      throw new HttpException(
        `Límite de reintentos manuales alcanzado (${maxManualRetries})`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const result = await this.campaignRetry.runCampaignRetryJob(id, 'manual');

    return {
      retried: result.retried,
      recovered: result.recovered,
      stillFailed: result.stillFailed,
      skipped: Boolean(result.skipped),
      error: result.error,
    };
  }
}
