import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { AREA_LABELS } from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';
import { formatExportDate } from '../campaigns/campaign-format.util';
import { userCanAccessSettingsModule } from '../settings/settings-modules.util';
import {
  auditLogExportFilename,
  buildAuditLogXlsxBuffer,
  type AuditLogExportRow,
} from './audit-log-export.util';
import {
  AUDIT_EVENT_GROUP_OPTIONS,
  AUDIT_LEVEL_OPTIONS,
  auditLogQueryOptsForUser,
  buildAuditLogWhere,
  collectAuditPhoneLookups,
  getAuditDisplayTimeZone,
  readAuditRetentionDays,
  resolveAuditPhone,
  summarizeMetaForAuditRow,
} from './audit-log-query.util';
import {
  buildContactCommunicationXlsxBuffer,
  contactCommunicationExportFilename,
} from './contact-communication-export.util';
import { fetchContactCommunicationReport } from './contact-communication-report.util';
import type { AuditLogListResult, CommunicationReportResult } from './reports.types';

const AUDIT_PAGE_SIZE = 50;
const REPORT_PAGE_SIZE = 50;
const AUDIT_EXPORT_MAX = 25000;

type AuditDbRow = AuditLogExportRow & { id: bigint | number };

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private assertAuditAccess(user: AuthUser): void {
    if (!userCanAccessSettingsModule(user, 'bitacora')) {
      throw new ForbiddenException('No tienes acceso a la bitácora');
    }
  }

  private assertReportsAccess(user: AuthUser): void {
    if (!userCanAccessSettingsModule(user, 'reporteria')) {
      throw new ForbiddenException('No tienes acceso a reportería');
    }
  }

  getAuditFilterOptions() {
    return {
      level_options: AUDIT_LEVEL_OPTIONS,
      event_options: AUDIT_EVENT_GROUP_OPTIONS,
    };
  }

  async listAuditLogs(
    user: AuthUser,
    query: Record<string, string | undefined>,
  ): Promise<AuditLogListResult> {
    this.assertAuditAccess(user);
    return this.listAuditLogsWithOpts(query, auditLogQueryOptsForUser(user));
  }

  async listAuditLogsForAdmin(
    query: Record<string, string | undefined>,
  ): Promise<AuditLogListResult> {
    return this.listAuditLogsWithOpts(query, {
      areaScope: null,
      excludeMasterActors: false,
    });
  }

  private async listAuditLogsWithOpts(
    query: Record<string, string | undefined>,
    opts: import('./audit-log-query.util').AuditLogQueryOpts,
  ): Promise<AuditLogListResult> {
    const { whereSql, params, filters } = buildAuditLogWhere(query, opts);
    const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);

    const countRows = await this.prisma.$queryRawUnsafe<{ c: number }[]>(
      `SELECT COUNT(*)::int AS c FROM audit_logs ${whereSql}`,
      ...params,
    );
    const total = Number(countRows[0]?.c || 0);
    const totalPages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
    const pageClamped = Math.min(page, totalPages);
    const offset = (pageClamped - 1) * AUDIT_PAGE_SIZE;

    const listParams = [...params, AUDIT_PAGE_SIZE, offset];
    const limIdx = params.length + 1;
    const offIdx = params.length + 2;

    const rows = await this.prisma.$queryRawUnsafe<AuditDbRow[]>(
      `SELECT id, created_at, level, event_type, message, actor_user_id, actor_email, area, client_ip, request_id, meta
       FROM audit_logs ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      ...listParams,
    );

    const { contactPhones, conversationPhones } = await this.loadAuditPhoneMaps(rows);

    const areaScope = opts.areaScope;
    const areaLabel = areaScope
      ? AREA_LABELS[areaScope as keyof typeof AREA_LABELS] || areaScope
      : null;

    return {
      rows: rows.map((row) => ({
        id: String(row.id),
        created_at: new Date(row.created_at).toISOString(),
        created_display: formatExportDate(row.created_at) || '—',
        level: row.level,
        event_type: row.event_type,
        message: row.message,
        actor_user_id: row.actor_user_id,
        actor_email: row.actor_email,
        area: row.area,
        client_ip: row.client_ip,
        request_id: row.request_id,
        phone: resolveAuditPhone(row.meta, contactPhones, conversationPhones),
        meta_summary: summarizeMetaForAuditRow(row.meta),
      })),
      filters,
      pagination: {
        page: pageClamped,
        total_pages: totalPages,
        total,
      },
      display_timezone: getAuditDisplayTimeZone(),
      retention_days: readAuditRetentionDays(),
      area_scoped: Boolean(areaScope),
      area_label: areaLabel,
    };
  }

  async exportAuditLogs(
    user: AuthUser,
    query: Record<string, string | undefined>,
  ): Promise<{ buffer: Buffer; filename: string }> {
    this.assertAuditAccess(user);
    return this.exportAuditLogsWithOpts(
      query,
      auditLogQueryOptsForUser(user),
      'bitacora-ajustes',
    );
  }

  async exportAuditLogsForAdmin(
    query: Record<string, string | undefined>,
  ): Promise<{ buffer: Buffer; filename: string }> {
    return this.exportAuditLogsWithOpts(query, {
      areaScope: null,
      excludeMasterActors: false,
    }, 'bitacora-admin');
  }

  private async exportAuditLogsWithOpts(
    query: Record<string, string | undefined>,
    opts: import('./audit-log-query.util').AuditLogQueryOpts,
    filenamePrefix: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const { whereSql, params } = buildAuditLogWhere(query, opts);
    const exportParams = [...params, AUDIT_EXPORT_MAX];
    const limIdx = params.length + 1;

    const rows = await this.prisma.$queryRawUnsafe<AuditDbRow[]>(
      `SELECT created_at, level, event_type, message, actor_user_id, actor_email, area, client_ip, request_id, meta
       FROM audit_logs ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limIdx}`,
      ...exportParams,
    );

    const { contactPhones, conversationPhones } = await this.loadAuditPhoneMaps(rows);
    const enrichedRows = rows.map((row) => ({
      ...row,
      phone: resolveAuditPhone(row.meta, contactPhones, conversationPhones),
    }));

    return {
      buffer: buildAuditLogXlsxBuffer(enrichedRows),
      filename: auditLogExportFilename(filenamePrefix),
    };
  }

  private async loadAuditPhoneMaps(rows: { meta: unknown }[]): Promise<{
    contactPhones: Map<number, string>;
    conversationPhones: Map<number, string>;
  }> {
    const { contactIds, conversationIds } = collectAuditPhoneLookups(rows);
    const contactPhones = new Map<number, string>();
    const conversationPhones = new Map<number, string>();

    if (contactIds.length > 0) {
      const contacts = await this.prisma.contacts.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, phone: true },
      });
      for (const contact of contacts) {
        contactPhones.set(contact.id, contact.phone);
      }
    }

    if (conversationIds.length > 0) {
      const conversations = await this.prisma.conversations.findMany({
        where: { id: { in: conversationIds } },
        select: { id: true, phone: true },
      });
      for (const conversation of conversations) {
        conversationPhones.set(conversation.id, conversation.phone);
      }
    }

    return { contactPhones, conversationPhones };
  }

  async listCommunications(
    user: AuthUser,
    query: Record<string, string | undefined>,
  ): Promise<CommunicationReportResult> {
    this.assertReportsAccess(user);
    const area = user.area;
    const page = Math.max(1, parseInt(String(query.page || '1'), 10) || 1);
    const { total, rows } = await fetchContactCommunicationReport(
      this.prisma,
      area,
      {
        limit: REPORT_PAGE_SIZE,
        offset: (page - 1) * REPORT_PAGE_SIZE,
      },
    );
    const totalPages = Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE));
    const pageClamped = Math.min(page, totalPages);

    return {
      rows,
      pagination: {
        page: pageClamped,
        total_pages: totalPages,
        total,
      },
      area_label: AREA_LABELS[area] || area,
    };
  }

  async exportCommunications(
    user: AuthUser,
  ): Promise<{ buffer: Buffer; filename: string }> {
    this.assertReportsAccess(user);
    const area = user.area;
    const { rows } = await fetchContactCommunicationReport(this.prisma, area, {});
    return {
      buffer: buildContactCommunicationXlsxBuffer(rows),
      filename: contactCommunicationExportFilename(area),
    };
  }
}
