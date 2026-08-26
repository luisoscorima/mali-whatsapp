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
import { AuditEvent } from '../audit/audit-events';
import { auditActor } from '../audit/audit-actor.util';
import { AuditLogService } from '../audit/audit-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseMonthKey } from '../shared/month-filter.util';
import {
  buildCampaignDetailAnalytics,
  buildCampaignIndexSummary,
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
  buildCampaignCostSummary,
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
  campaignLogStatusColumnSql,
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
  CampaignExcludedContact,
  CampaignListItem,
  CampaignRetryActionResult,
  CampaignSummary,
  CampaignSummaryMonthlyPoint,
  RecipientsPreviewResult,
  SendCampaignOutcome,
} from './campaigns.types';
import { formatCampaignSegmentDisplay, parseCampaignPayload } from './campaign-payload.util';
import { analyzeRecipientTemplateParams } from './campaign-param-gaps.util';
import { fetchContactAttributesMap } from './contact-template-params.util';

const SALIDA_OK_IN = sqlInList(SALIDA_OK_STATUSES);
const ERROR_IN = sqlInList(ERROR_STATUSES);
const LOG_STATUS = CAMPAIGN_LOG_STATUS_SQL;

const MONTH_LABELS = [
  'Ene',
  'Feb',
  'Mar',
  'Abr',
  'May',
  'Jun',
  'Jul',
  'Ago',
  'Sep',
  'Oct',
  'Nov',
  'Dic',
] as const;

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

type SummaryCampaignRow = {
  id: number;
  campaign_payload: unknown;
  cost_amount: unknown;
  cost_currency: string | null;
  cost_source: string | null;
  cost_is_estimated: boolean | null;
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

function effectiveCampaignDate(row: SummaryCampaignRow): Date {
  const raw = row.first_send_at ?? row.scheduled_at ?? row.created_at;
  return raw instanceof Date ? raw : new Date(raw);
}

function buildRecentMonthOptions(count = 6): { key: string; label: string }[] {
  const options: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const year = String(d.getFullYear()).slice(-2);
    options.push({ key, label: `${MONTH_LABELS[d.getMonth()]} ${year}` });
  }
  return options;
}

function aggregateSummaryRows(rows: SummaryCampaignRow[]): CampaignTotalsRow {
  let total_logs = 0;
  let salida_ok = 0;
  let delivered_count = 0;
  let read_count = 0;
  let failed_count = 0;
  let total_recipients = 0;
  const cost_rows: CampaignTotalsRow['cost_rows'] = [];

  for (const row of rows) {
    total_logs += row.log_count;
    salida_ok += row.salida_ok;
    delivered_count += row.delivered_count;
    read_count += row.read_count;
    failed_count += row.failed_count;
    total_recipients += row.total_recipients;
    cost_rows.push({
      id: row.id,
      campaign_payload: row.campaign_payload,
      cost_amount: row.cost_amount,
      cost_currency: row.cost_currency,
      cost_source: row.cost_source,
      cost_is_estimated: row.cost_is_estimated,
      delivered_count: row.delivered_count,
    });
  }

  return {
    total_logs,
    salida_ok,
    delivered_count,
    read_count,
    failed_count,
    campaign_count: rows.length,
    total_recipients,
    cost_rows,
  };
}

function buildMonthlySeries(
  rows: SummaryCampaignRow[],
): CampaignSummaryMonthlyPoint[] {
  const months = buildRecentMonthOptions(6);
  const ranges = months.map((m) => ({
    ...m,
    range: parseMonthKey(m.key)!,
  }));

  return ranges.map(({ key, label, range }) => {
    const inMonth = rows.filter((row) => {
      const d = effectiveCampaignDate(row);
      return d >= range.start && d < range.end;
    });
    let costUsd = 0;
    for (const row of inMonth) {
      const cost = buildCampaignCostSummary(row, row.delivered_count);
      costUsd += Number(cost.usdAmount || 0);
    }
    return {
      monthKey: key,
      label,
      campaignsCount: inMonth.length,
      costUsd: Math.round(costUsd * 100) / 100,
    };
  });
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
  send_mode: string;
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
    private readonly auditLog: AuditLogService,
  ) {}

  private async getSegmentSlugSet(area: AuthUser['area']): Promise<Set<string>> {
    const rows = await this.prisma.segment_definitions.findMany({
      where: { area, active: true },
      select: { slug: true },
    });
    return new Set(rows.map((row) => row.slug));
  }

  private async loadExcludedContacts(
    area: AuthUser['area'],
    ids: number[],
  ): Promise<CampaignExcludedContact[]> {
    if (!ids.length) return [];
    const rows = await this.prisma.contacts.findMany({
      where: { area, id: { in: ids } },
      select: { id: true, name: true, last_name: true, phone: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => {
      const row = byId.get(id);
      if (!row) {
        return { id, name: '', last_name: '', phone: '' };
      }
      return {
        id: row.id,
        name: row.name,
        last_name: row.last_name,
        phone: row.phone,
      };
    });
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

  async list(area: AuthUser['area'], month?: string): Promise<CampaignListItem[]> {
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
        c.send_mode,
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

    const range = parseMonthKey(month);
    const mapped = rows.map((row) => {
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
        send_mode: String(row.send_mode ?? 'mass'),
      };
    });
    if (!range) return mapped;
    return mapped.filter((item) => {
      const ts =
        item.first_send_at ?? item.scheduled_at ?? item.created_at;
      const d = new Date(ts);
      return d >= range.start && d < range.end;
    });
  }

  async getSummary(
    area: AuthUser['area'],
    month?: string,
  ): Promise<CampaignSummary> {
    const rows = await this.prisma.$queryRaw<SummaryCampaignRow[]>(Prisma.sql`
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
        c.campaign_payload,
        c.cost_amount,
        c.cost_currency,
        c.cost_source,
        c.cost_is_estimated,
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
    `);

    const range = parseMonthKey(month);
    const filtered = range
      ? rows.filter((row) => {
          const d = effectiveCampaignDate(row);
          return d >= range.start && d < range.end;
        })
      : rows;

    const summary: CampaignSummary = buildCampaignIndexSummary(
      aggregateSummaryRows(filtered),
    );
    if (!range) {
      summary.monthlySeries = buildMonthlySeries(rows);
    }
    return summary;
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
      SELECT cl.id, cl.phone, cl.contact_id, cl.whatsapp_message_id, cl.status, cl.response, cl.created_at,
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

    const statusSql = campaignLogStatusColumnSql('latest_logs.status');
    const [statusTotals] = await this.prisma.$queryRaw<
      {
        log_count: number;
        sent_only: number;
        delivered_only: number;
        read_count: number;
        failed_count: number;
        first_send_at: Date | null;
      }[]
    >(Prisma.sql`
      WITH latest_logs AS (
        SELECT DISTINCT ON (phone)
          status, created_at
        FROM campaign_logs
        WHERE campaign_id = ${id}
        ORDER BY phone, id DESC
      )
      SELECT
        COALESCE(COUNT(*), 0)::int AS log_count,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(statusSql)} = 'sent' THEN 1 ELSE 0 END), 0)::int AS sent_only,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(statusSql)} = 'delivered' THEN 1 ELSE 0 END), 0)::int AS delivered_only,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(statusSql)} = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
        COALESCE(SUM(CASE WHEN ${Prisma.raw(statusSql)} IN ${Prisma.raw(ERROR_IN)} THEN 1 ELSE 0 END), 0)::int AS failed_count,
        MIN(created_at) AS first_send_at
      FROM latest_logs
    `);

    const normalizedLogs = logs.map((log) => ({
      ...log,
      created_at:
        log.created_at instanceof Date
          ? log.created_at.toISOString()
          : String(log.created_at),
    }));

    const failedLogs = (await this.fetchFailedLogsForExport(area, id)).map(
      (log) => ({
        ...log,
        created_at: String(log.created_at),
      }),
    );

    const responderMetrics = await fetchCampaignResponderMetrics(
      this.prisma,
      id,
      area,
    );

    const analytics = buildCampaignDetailAnalytics(
      campaign,
      {
        sentOnly: statusTotals?.sent_only ?? 0,
        deliveredOnly: statusTotals?.delivered_only ?? 0,
        read: statusTotals?.read_count ?? 0,
        failed: statusTotals?.failed_count ?? 0,
        logCount: statusTotals?.log_count ?? 0,
      },
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
    const excludeContacts = await this.loadExcludedContacts(
      area,
      exclusions.exclude_contact_ids,
    );

    const firstSendAt = toIso(statusTotals?.first_send_at ?? null);

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
      exclude_contacts: excludeContacts,
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
        placeholder_aliases_json: true,
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
        contact_email: string;
        contact_dni: string;
        segment_labels: string;
      }[]
    >(Prisma.sql`
      SELECT latest_logs.id, latest_logs.phone, latest_logs.status, latest_logs.response,
             latest_logs.created_at,
             COALESCE(ct.name, '') AS contact_name,
             COALESCE(ct.email, '') AS contact_email,
             COALESCE(ct.dni, '') AS contact_dni,
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
        contact_email: string;
        contact_dni: string;
        segment_labels: string;
      }[]
    >(Prisma.sql`
      SELECT cl.id, cl.phone, cl.whatsapp_message_id, cl.status, cl.response, cl.created_at,
             COALESCE(ct.name, '') AS contact_name,
             COALESCE(ct.email, '') AS contact_email,
             COALESCE(ct.dni, '') AS contact_dni,
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
    user: AuthUser,
    body: Record<string, unknown>,
  ): Promise<SendCampaignOutcome> {
    const area = user.area;
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

    const staticParams = {
      headerParams: values.headerParams,
      bodyParams: values.bodyParams,
      buttonParams: values.buttonParams,
      headerMediaUrl: values.headerMediaUrl,
    };

    const excludeMissingParams = body.excludeMissingParams === true;
    const slotCount =
      staticParams.headerParams.length +
      staticParams.bodyParams.length +
      staticParams.buttonParams.length;

    if (slotCount > 0) {
      const attrsMap = paramMapping
        ? await fetchContactAttributesMap(
            this.prisma,
            recipients.map((r) => r.id),
          )
        : new Map<number, Record<string, string>>();
      const gapReport = analyzeRecipientTemplateParams(
        recipients,
        staticParams,
        paramMapping,
        attrsMap,
      );

      if (gapReport.missing > 0 && !excludeMissingParams) {
        return {
          kind: 'missing_params',
          code: 'MISSING_TEMPLATE_PARAMS',
          ...gapReport,
        };
      }

      if (gapReport.missing > 0 && excludeMissingParams) {
        const skip = new Set(gapReport.missingContactIds);
        recipients = recipients.filter((r) => !skip.has(r.id));
        if (!recipients.length) {
          throw new BadRequestException(
            'Ningún destinatario tiene completos los datos de la plantilla',
          );
        }
      }
    }

    const templateSnapshot = {
      id: tRow.id,
      name: tRow.name,
      language: tRow.language,
      category: tRow.category,
      components_json: tRow.components_json,
      placeholder_aliases_json: tRow.placeholder_aliases_json,
    };

    const campaignPayload: CampaignJobPayload = {
      area,
      segments,
      templateSnapshot,
      staticParams,
      paramMapping,
      batchSize,
      batchDelayMs,
      // Fija la audiencia final (p. ej. tras excluir faltantes de params).
      recipientContactIds: recipients.map((r) => r.id),
    };

    if (
      !(
        audienceMode === 'multi' &&
        recipientContactIds &&
        recipientContactIds.length > 0
      )
    ) {
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

    await this.auditLog.write({
      event_type: AuditEvent.CAMPAIGN_CREATED,
      message: isScheduled
        ? `Campaña programada #${campaign.id} (${tRow.name}, ${recipients.length} destinatarios)`
        : `Campaña en cola #${campaign.id} (${tRow.name}, ${recipients.length} destinatarios)`,
      actor: auditActor(user),
      meta: {
        campaign_id: campaign.id,
        status: campaignStatus,
        template_name: tRow.name,
        segments,
        audience_mode: audienceMode,
        total_recipients: recipients.length,
        is_scheduled: isScheduled,
        scheduled_at:
          isScheduled && scheduledAt ? scheduledAt.toISOString() : null,
      },
    });

    return {
      kind: 'sent',
      campaignId: campaign.id,
      redirect: `/campaigns/${campaign.id}`,
      status: campaignStatus,
      totalRecipients: recipients.length,
      isScheduled,
    };
  }

  async retryFailed(
    user: AuthUser,
    id: number,
  ): Promise<CampaignRetryActionResult> {
    const area = user.area;
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

    await this.auditLog.write({
      event_type: AuditEvent.CAMPAIGN_RETRY_MANUAL,
      message: `Reintento manual campaña #${id}: ${result.retried} teléfonos, ${result.recovered} recuperados`,
      actor: auditActor(user),
      meta: {
        campaign_id: id,
        retried: result.retried,
        recovered: result.recovered,
        still_failed: result.stillFailed,
      },
    });

    return {
      retried: result.retried,
      recovered: result.recovered,
      stillFailed: result.stillFailed,
      skipped: Boolean(result.skipped),
      error: result.error,
    };
  }
}
