import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { businessReadScope } from '../config/areas';
import {
  contactAreaPredicate,
  conversationAreaPredicate,
  educationProgramOf,
  inboxConversationPredicate,
  isEducationAreaSlug,
  lineCategoryPredicate,
  visibleConversationWhere,
} from '../config/education-scope';
import { contactAccessWhere } from '../config/business-scope';
import { restrictedAccess } from '../business-model/business-access.context';
import { UserAreasService } from '../users/user-areas.service';
import type { Prisma as PrismaTypes } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AuditEvent } from '../audit/audit-events';
import { auditActor, phoneMetaTail } from '../audit/audit-actor.util';
import { AuditLogService } from '../audit/audit-log.service';
import {
  isWithinUserServiceWindow,
  readSessionWindowMs,
} from '../campaigns/campaign-conversation-window.util';
import { persistCampaignChatMessage } from '../campaigns/campaign-chat-message.util';
import { estimateServiceReplyOverage } from '../campaigns/campaign-pricing.util';
import { conversationRecipient } from './whatsapp-recipient.util';
import { chooseWhatsAppIdentityMatch } from './whatsapp-identity.util';
import { buildCampaignMessagePreview } from '../campaigns/campaign-message-preview.util';
import {
  buildParamsForContact,
  fetchContactAttributesMap,
  formatTemplateSenderName,
  materializeTemplateSenderName,
  paramMappingUsesSource,
  USER_NAME_PARAM_SOURCE,
} from '../campaigns/contact-template-params.util';
import {
  escapeForLikePattern,
} from '../contacts/contacts-filter.utils';
import {
  MAX_BODY_PARAM_LEN,
  MAX_IMAGE_URL_LEN,
} from '../campaigns/campaign-config.util';
import {
  buildTemplateDefinition,
  buildWhatsappGraphComponents,
  parseParamMappingFromBody,
  validateTemplateFormValues,
} from '../templates/template-definition.util';
import { sendTemplateWithComponents } from '../templates/whatsapp-meta.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyCategoryGrant,
  categoryOfProgram,
  programScopeWhere,
  segmentMatchesConversationSql,
  segmentMatchesOuterLineSql,
} from '../config/category-scope';
import { FlowsService } from '../flows/flows.service';
import { MAX_SESSION_TEXT_LEN } from '../settings/business-hours.util';
import { parseAiConfigValue } from '../settings/ai-config.util';
import {
  sanitizeApiResponse,
  sanitizeMediaOutboundPayload,
} from './api-sanitize.util';
import {
  classifyConversationUpload,
  downloadWhatsAppMediaBuffer,
  MEDIA_TYPE_LABEL,
  sendSessionMediaMessage,
  sendSessionTextMessage,
  sendMessageReaction,
  uploadMediaToWhatsApp,
} from './conversation-whatsapp.util';
import {
  buildConversationExportRows,
  buildConversationXlsxBuffer,
  conversationExportFilename,
} from './conversation-export.util';
import {
  extractCampaignPreview,
  extractInteractiveButtons,
  extractStoredMediaDownloadRef,
  getLocalPreview,
  hasDownloadableMedia,
  readRoutingPhoneNumberId,
  saveChatMediaFromBuffer,
  saveOutboundChatMediaFile,
  streamMessageMediaDownload,
  withLocalPreview,
  withRoutingPhoneNumberId,
} from './chat-media.util';
import {
  isReactionMessageType,
  readMessageReaction,
  setMessageReaction,
} from './chat-reaction.util';
import {
  buildContactSegmentSql,
  parseInboxSegmentFilter,
  type InboxSegmentFilter,
  buildConversationSegmentSql,
  buildLastMessageDateRangeSql,
  buildWindowMaxFilterSql,
  parseInboxChatFilter,
  parseInboxDateParam,
  parseInboxWindowMaxFilter,
  parseSegmentQueryParam,
  inboxSearchMayScanMessages,
  resolveInboxDateFilter,
} from './inbox-query.util';
import { formatAdvisorLabel } from '../users/advisor-label.util';
import {
  formatLeadScoreLabel,
  isValidLeadScore,
} from '../leads/lead-score.util';
import type {
  EnsureConversationResult,
  InboxDetail,
  InboxListItem,
  InboxListResult,
  InboxMessage,
  InboxMessageReaction,
  InboxMessageDelivery,
  InboxOlderMessagesResult,
  InboxUnreadCountResult,
  OpenChatLine,
  ReplyResult,
  UpdateConversationModeResult,
  InboxConversationUpdates,
  ConversationAssigneesResult,
  AssignConversationResult,
  ArchiveConversationResult,
  MessageReactionResult,
  InboxTimelineEvent,
} from './conversations.types';
import {
  buildMessageReplyPreview,
  readMessageReplyTo,
  setMessageReplyTo,
  extractReplyWaMessageIdFromRawPayload,
} from './chat-reply.util';
import { readMessageDelivery } from './chat-delivery.util';
import {
  matchAuditSenderLabel,
  readMessageSenderLabel,
  setMessageSender,
} from './chat-sender.util';
import { autoAssignConversationIfUnassigned } from './conversation-assignment.util';
import {
  advisorLabelFromUserRow,
  collectUserIdsFromAuditRows,
  INBOX_TIMELINE_EVENT_TYPES,
  mapAuditRowsToTimelineEvents,
} from './inbox-timeline.util';
import { fetchConversationSummary } from './conversation-analytics.util';
import { EducationLeadWorkflowService } from '../leads/education-lead-workflow.service';

const INBOX_LIST_PAGE_SIZE = 50;
const INBOX_DETAIL_MESSAGE_PAGE_SIZE = 50;

type InboxRow = {
  id: number;
  phone: string | null;
  whatsapp_user_id: string | null;
  last_message_at: Date | null;
  unread_message_count?: number | null;
  inbox_unread: boolean;
  conversation_status: string | null;
  assigned_user_id: number | null;
  assigned_user_label: string | null;
  automation_touched_at: Date | null;
  contact_lead_score: number | null;
  contact_name: string | null;
  wa_profile_name: string | null;
  wa_username: string | null;
  contact_segment_slugs: string[];
  preview: string | null;
  conversation_tags: string[];
  matched_message_id: number | null;
  contact_id: number | null;
  last_user_message_at: Date | null;
  last_outbound_message_at: Date | null;
  archived: boolean;
  line_label: string | null;
  line_display_phone: string | null;
  line_program: string | null;
};

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly flowsService: FlowsService,
    private readonly userAreas: UserAreasService,
    private readonly educationLeads: EducationLeadWorkflowService,
  ) {}

  private conversationLookup(area: string, id: number) {
    return visibleConversationWhere(area, id);
  }

  private canAssignConversations(user: AuthUser): boolean {
    return (
      user.isBootstrapAdmin || user.isMaster || user.canAssignConversations
    );
  }

  private async assignDirectTemplateSender(
    user: AuthUser,
    conversation: {
      id: number;
    },
    campaignId: number,
    templateName: string,
  ): Promise<void> {
    const sender = await this.prisma.users.findUnique({
      where: { id: user.id },
      select: { email: true, first_name: true, last_name: true },
    });
    const senderLabel = formatAdvisorLabel(
      sender ?? { email: user.email, first_name: null, last_name: null },
    );
    const assignedAt = new Date();

    const previousAssignment = await this.prisma.$transaction(async (tx) => {
      const current = await tx.conversations.findFirst({
        where: this.conversationLookup(user.area, conversation.id),
        select: {
          contact_id: true,
          assigned_user_id: true,
          assigned_user: {
            select: { email: true, first_name: true, last_name: true },
          },
        },
      });
      if (!current) throw new NotFoundException('Conversación no encontrada');

      await tx.conversations.update({
        where: { id: conversation.id },
        data: {
          assigned_user_id: user.id,
          assigned_at: assignedAt,
          updated_at: assignedAt,
        },
      });

      if (
        current.contact_id &&
        ['educacion', 'educacion_ca', 'educacion_ep'].includes(user.area)
      ) {
        const cycle = await tx.education_lead_cycles.findFirst({
          where: { contact_id: current.contact_id, area: user.area },
          orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        if (cycle) {
          await tx.education_lead_cycles.update({
            where: { id: cycle.id },
            data: {
              assigned_user_id: user.id,
              requires_review: false,
              updated_at: assignedAt,
            },
          });
        }
      }

      return {
        userId: current.assigned_user_id,
        label: current.assigned_user
          ? formatAdvisorLabel(current.assigned_user)
          : null,
      };
    });

    await this.auditLog.write({
      event_type: AuditEvent.CONVERSATION_ASSIGN,
      message: `Conversación ${conversation.id} asignada a ${senderLabel} al enviar plantilla individual`,
      actor: auditActor(user),
      meta: {
        conversation_id: conversation.id,
        from_user_id: previousAssignment.userId,
        from_user_label: previousAssignment.label,
        to_user_id: user.id,
        to_user_label: senderLabel,
        source: 'direct_template',
        campaign_id: campaignId,
        template_name: templateName,
      },
    });
  }

  private async loadAiAreaEnabled(area: string): Promise<boolean> {
    const row = await this.prisma.app_settings.findFirst({
      where: { area, key: 'ai_config' },
      select: { value: true },
    });
    const cfg = parseAiConfigValue(row?.value);
    return Boolean(cfg?.enabled);
  }

  private async loadSegmentOptions(area: string, categories: string[] | null = null) {
    const rows = await this.prisma.segment_definitions.findMany({
      where: { area: isEducationAreaSlug(area) ? 'educacion' : area, active: true, show_in_filter: true, ...programScopeWhere(categories) },
      orderBy: [{ sort_order: 'asc' }, { slug: 'asc' }],
      select: { id: true, slug: true, label: true, color_key: true, program: { select: { slug: true } } },
    });
    return rows.map(({ program, ...row }) => ({ ...row, category: program?.slug || 'general' }));
  }

  private async loadAssignableSegmentOptions(area: string) {
    const rows = await this.prisma.segment_definitions.findMany({
      where: {
        area,
        active: true,
        assignable: true,
        assignment_group: { not: null },
      },
      orderBy: [
        { assignment_group: 'asc' },
        { sort_order: 'asc' },
        { slug: 'asc' },
      ],
      select: {
        slug: true,
        label: true,
        color_key: true,
        assignment_group: true,
        program: { select: { slug: true } },
      },
    });
    return rows.map((row) => ({
      slug: row.slug,
      label: row.label,
      color_key: row.color_key,
      assignment_group: row.assignment_group,
      category: row.program?.slug || 'general',
    }));
  }

  private mapListRow(row: InboxRow): InboxListItem {
    const id = Number(row.id);
    return {
      id,
      phone: row.phone,
      whatsapp_user_id: row.whatsapp_user_id,
      recipient: row.phone || row.whatsapp_user_id || '',
      last_message_at: row.last_message_at
        ? row.last_message_at.toISOString()
        : null,
      inbox_unread: Boolean(row.inbox_unread),
      unread_message_count: row.inbox_unread ? row.unread_message_count ?? null : 0,
      conversation_status: row.conversation_status,
      assigned_user_id: row.assigned_user_id
        ? Number(row.assigned_user_id)
        : null,
      assigned_user_label: row.assigned_user_label
        ? String(row.assigned_user_label).trim()
        : null,
      automation_touched_at: row.automation_touched_at
        ? row.automation_touched_at.toISOString()
        : null,
      contact_name: String(row.contact_name ?? '').trim(),
      wa_profile_name: String(row.wa_profile_name ?? '').trim() || null,
      wa_username: String(row.wa_username ?? '').trim() || null,
      contact_lead_score: row.contact_lead_score,
      contact_segment_slugs: row.contact_segment_slugs ?? [],
      preview: String(row.preview ?? '').trim(),
      conversation_tags: row.conversation_tags ?? [],
      is_virtual: id < 0,
      contact_id: id < 0 ? -id : row.contact_id ? Number(row.contact_id) : null,
      matched_message_id: row.matched_message_id
        ? Number(row.matched_message_id)
        : null,
      user_service_window_open: isWithinUserServiceWindow(
        row.last_user_message_at,
      ),
      last_user_message_at: row.last_user_message_at
        ? row.last_user_message_at.toISOString()
        : null,
      last_outbound_message_at: row.last_outbound_message_at
        ? row.last_outbound_message_at.toISOString()
        : null,
      archived: Boolean(row.archived),
      line_label: String(row.line_label ?? '').trim() || null,
      line_display_phone: String(row.line_display_phone ?? '').trim() || null,
      line_program: String(row.line_program ?? '').trim() || null,
    };
  }

  private inboxAssignedUserLabelSql(): Prisma.Sql {
    return Prisma.sql`COALESCE(NULLIF(TRIM(CONCAT_WS(' ', NULLIF(SPLIT_PART(TRIM(au.first_name), ' ', 1), ''), NULLIF(SPLIT_PART(TRIM(au.last_name), ' ', 1), ''))), ''), NULLIF(SPLIT_PART(COALESCE(au.email, ''), '@', 1), ''))`;
  }

  private inboxContactNameSql(alias: string): Prisma.Sql {
    return Prisma.sql`NULLIF(TRIM(CONCAT(COALESCE(${Prisma.raw(alias)}.name, ''), ' ', COALESCE(${Prisma.raw(alias)}.last_name, ''))), '')`;
  }

  /**
   * Join directo por contact_id. Evita el subquery correlacionado que volvía
   * la búsqueda en O(convs × contacts). Completar huérfanos con el backfill
   * `api/scripts/backfill-conversation-contact-id.sql`.
   */
  private inboxResolvedContactJoinSql(_area?: string): Prisma.Sql {
    return Prisma.sql`LEFT JOIN contacts ct ON ct.id = c.contact_id`;
  }

  /** Búsqueda rápida: identidad. Mensajes solo con flag + umbral de longitud. */
  private buildInboxSearchSql(
    searchQ: string,
    opts?: { includeMessages?: boolean },
  ): Prisma.Sql {
    const searchPat = `%${escapeForLikePattern(searchQ)}%`;
    const usernameSearchPat = `%${escapeForLikePattern(searchQ.replace(/^@/, ''))}%`;
    const digitsOnly = searchQ.replace(/\D/g, '');
    const includeMessages = inboxSearchMayScanMessages(
      searchQ,
      Boolean(opts?.includeMessages),
    );
    const messageSql = includeMessages
      ? Prisma.sql` OR EXISTS (
          SELECT 1 FROM chat_messages m
          WHERE m.conversation_id = c.id
          AND m.body_text ILIKE ${searchPat} ESCAPE '!'
        )`
      : Prisma.empty;
    const identitySql = digitsOnly
      ? Prisma.sql`
        COALESCE(ct.name, '') ILIKE ${searchPat} ESCAPE '!'
        OR COALESCE(ct.last_name, '') ILIKE ${searchPat} ESCAPE '!'
        OR COALESCE(ct.phone, '') ILIKE ${searchPat} ESCAPE '!'
        OR COALESCE(c.phone, '') ILIKE ${searchPat} ESCAPE '!'
        OR COALESCE(c.wa_profile_name, '') ILIKE ${searchPat} ESCAPE '!'
        OR COALESCE(c.wa_username, '') ILIKE ${usernameSearchPat} ESCAPE '!'
        OR regexp_replace(COALESCE(ct.phone, ''), '\\D', '', 'g') LIKE ${`%${digitsOnly}%`}
        OR regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE ${`%${digitsOnly}%`}
      `
      : Prisma.sql`
        COALESCE(ct.name, '') ILIKE ${searchPat} ESCAPE '!'
        OR COALESCE(ct.last_name, '') ILIKE ${searchPat} ESCAPE '!'
        OR COALESCE(ct.phone, '') ILIKE ${searchPat} ESCAPE '!'
        OR COALESCE(c.phone, '') ILIKE ${searchPat} ESCAPE '!'
        OR COALESCE(c.wa_profile_name, '') ILIKE ${searchPat} ESCAPE '!'
        OR COALESCE(c.wa_username, '') ILIKE ${usernameSearchPat} ESCAPE '!'
      `;
    return Prisma.sql` AND (${identitySql}${messageSql})`;
  }

  private buildVirtualContactSearchSql(searchQ: string): Prisma.Sql {
    const contactPat = `%${escapeForLikePattern(searchQ)}%`;
    const digitsOnly = searchQ.replace(/\D/g, '');
    if (digitsOnly) {
      return Prisma.sql` AND (
        COALESCE(ct.name, '') ILIKE ${contactPat} ESCAPE '!'
        OR COALESCE(ct.last_name, '') ILIKE ${contactPat} ESCAPE '!'
        OR COALESCE(ct.phone, '') ILIKE ${contactPat} ESCAPE '!'
        OR regexp_replace(COALESCE(ct.phone, ''), '\\D', '', 'g') LIKE ${`%${digitsOnly}%`}
      )`;
    }
    return Prisma.sql` AND (
      COALESCE(ct.name, '') ILIKE ${contactPat} ESCAPE '!'
      OR COALESCE(ct.last_name, '') ILIKE ${contactPat} ESCAPE '!'
      OR COALESCE(ct.phone, '') ILIKE ${contactPat} ESCAPE '!'
    )`;
  }

  private buildChatFilterSql(
    chat: ReturnType<typeof parseInboxChatFilter>,
    userId: number,
    opts?: { searchAll?: boolean },
  ): Prisma.Sql {
    if (chat === 'archived') {
      return Prisma.sql` AND (c.archived = TRUE OR c.last_user_message_at IS NULL)`;
    }
    if (chat === 'archived_auto') {
      return Prisma.sql` AND c.last_user_message_at IS NULL`;
    }
    if (chat === 'archived_manual') {
      return Prisma.sql` AND c.archived = TRUE AND c.last_user_message_at IS NOT NULL`;
    }
    const activeInbox = Prisma.sql` AND c.archived = FALSE AND c.last_user_message_at IS NOT NULL`;
    if (chat === 'unread') {
      return Prisma.sql`${activeInbox} AND c.inbox_unread = TRUE`;
    }
    if (chat === 'bot') {
      return Prisma.sql`${activeInbox} AND LOWER(TRIM(COALESCE(c.status, ''))) = 'bot'`;
    }
    if (chat === 'human') {
      return Prisma.sql`${activeInbox} AND LOWER(TRIM(COALESCE(c.status, ''))) = 'human'`;
    }
    if (chat === 'mine') {
      return Prisma.sql`${activeInbox} AND c.assigned_user_id = ${userId}`;
    }
    if (chat === 'unassigned') {
      return Prisma.sql`${activeInbox} AND c.assigned_user_id IS NULL`;
    }
    if (chat === 'unanswered') {
      const sessionWindowMs = readSessionWindowMs();
      return Prisma.sql`${activeInbox}
        AND c.last_user_message_at > NOW() - (${sessionWindowMs}::bigint * INTERVAL '1 millisecond')
        AND NOT EXISTS (
          SELECT 1 FROM chat_messages m_out
          WHERE m_out.conversation_id = c.id
            AND m_out.direction = 'outbound'
            AND m_out.created_at >= c.last_user_message_at
        )`;
    }
    // Búsqueda en «Todos»: incluir archivados / históricos (como contactos).
    if (opts?.searchAll) {
      return Prisma.empty;
    }
    return activeInbox;
  }

  private async fetchInboxConversations(
    area: string,
    segmentFilter: InboxSegmentFilter,
    searchQ: string,
    chatFilter: ReturnType<typeof parseInboxChatFilter>,
    windowMax: ReturnType<typeof parseInboxWindowMaxFilter>,
    dateFrom: string | null,
    dateTo: string | null,
    includeUnreadOutside: boolean,
    userId: number,
    page: number,
    limit: number,
    categories: string[] | null = null,
    searchMessages = false,
    /** Filas extra para detectar “hay más” sin COUNT (p. ej. 1). */
    probeExtra = 0,
  ): Promise<InboxRow[]> {
    const segmentSql = buildConversationSegmentSql(segmentFilter);
    const includeMessages = inboxSearchMayScanMessages(searchQ, searchMessages);
    const searchSql = searchQ
      ? this.buildInboxSearchSql(searchQ, { includeMessages })
      : Prisma.empty;
    const chatSql = this.buildChatFilterSql(chatFilter, userId, {
      searchAll: Boolean(searchQ) && chatFilter === 'all',
    });
    const windowSql = buildWindowMaxFilterSql(windowMax);
    const dateSql = buildLastMessageDateRangeSql(
      dateFrom,
      dateTo,
      includeUnreadOutside,
    );
    const hasDateFilter = Boolean(dateFrom || dateTo);
    const offset = (page - 1) * limit;
    const fetchLimit = limit + Math.max(0, probeExtra);
    const searchPat =
      includeMessages && searchQ
        ? `%${escapeForLikePattern(searchQ)}%`
        : null;
    const matchedMessageSql = searchPat
      ? Prisma.sql`(
          SELECT m.id FROM chat_messages m
          WHERE m.conversation_id = c.id
          AND m.body_text ILIKE ${searchPat} ESCAPE '!'
          ORDER BY m.created_at DESC
          LIMIT 1
        )`
      : Prisma.sql`NULL::int`;

    const rows = await this.prisma.$queryRaw<InboxRow[]>(Prisma.sql`
      SELECT
        c.id,
        c.phone,
        c.whatsapp_user_id,
        c.last_message_at,
        c.last_user_message_at,
        (
          SELECT MAX(m_out.created_at)
          FROM chat_messages m_out
          WHERE m_out.conversation_id = c.id
            AND m_out.direction = 'outbound'
        ) AS last_outbound_message_at,
        c.inbox_unread,
        c.unread_message_count,
        c.archived,
        c.status AS conversation_status,
        c.assigned_user_id,
        c.automation_touched_at,
        ${this.inboxAssignedUserLabelSql()} AS assigned_user_label,
        ct.lead_score AS contact_lead_score,
        COALESCE(
          ${this.inboxContactNameSql('ct')},
          (
            SELECT ${this.inboxContactNameSql('ct_alt')}
            FROM contacts ct_alt
            WHERE ct_alt.phone = c.phone AND (ct.id IS NULL OR ct_alt.id <> ct.id)
            ORDER BY ct_alt.updated_at DESC NULLS LAST
            LIMIT 1
          )
        ) AS contact_name,
        NULLIF(TRIM(COALESCE(c.wa_profile_name, '')), '') AS wa_profile_name,
        NULLIF(TRIM(COALESCE(c.wa_username, '')), '') AS wa_username,
        COALESCE((
          SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
          FROM contact_segments cs
          JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug AND sd.program_id IS NOT DISTINCT FROM cs.program_id
          WHERE cs.contact_id = ct.id
            AND ${segmentMatchesOuterLineSql()}
        ), ARRAY[]::varchar[]) AS contact_segment_slugs,
        (SELECT LEFT(m.body_text, 160) FROM chat_messages m
         WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC
         LIMIT 1) AS preview,
        COALESCE((
          SELECT array_agg(tg.label ORDER BY tg.label)
          FROM conversation_tags tg
          WHERE tg.conversation_id = c.id
        ), ARRAY[]::varchar[]) AS conversation_tags,
        ${matchedMessageSql} AS matched_message_id,
        ct.id AS contact_id,
        NULLIF(TRIM(COALESCE(scope_line.label, '')), '') AS line_label,
        NULLIF(TRIM(COALESCE(scope_line.display_phone_number, '')), '') AS line_display_phone,
        NULLIF(TRIM(COALESCE(scope_program.slug, scope_line.program_key, '')), '') AS line_program
      FROM conversations c
      ${this.inboxResolvedContactJoinSql(area)}
      LEFT JOIN users au ON au.id = c.assigned_user_id
      LEFT JOIN whatsapp_lines scope_line ON scope_line.id = c.whatsapp_line_id
      LEFT JOIN business_programs scope_program ON scope_program.id = scope_line.program_id
      WHERE ${categories ? inboxConversationPredicate('c', area, categories) : conversationAreaPredicate('c', area)}
      ${segmentSql}
      ${searchSql}
      ${chatSql}
      ${windowSql}
      ${dateSql}
      ORDER BY c.inbox_unread DESC, c.last_message_at DESC
      LIMIT ${fetchLimit} OFFSET ${offset}
    `);

    if (
      !searchQ ||
      chatFilter !== 'all' ||
      windowMax != null ||
      hasDateFilter ||
      page !== 1 ||
      probeExtra > 0
    ) {
      return rows;
    }

    const contactSegmentSql = buildContactSegmentSql(segmentFilter);
    const contactSearchSql = this.buildVirtualContactSearchSql(searchQ);

    const virtualRows = await this.prisma.$queryRaw<InboxRow[]>(Prisma.sql`
      SELECT
        (-ct.id) AS id,
        ct.phone,
        ct.whatsapp_user_id,
        NULL::timestamptz AS last_message_at,
        NULL::timestamptz AS last_user_message_at,
        NULL::timestamptz AS last_outbound_message_at,
        FALSE AS inbox_unread,
        0::int AS unread_message_count,
        FALSE AS archived,
        NULL::text AS conversation_status,
        NULL::int AS assigned_user_id,
        NULL::timestamptz AS automation_touched_at,
        NULL::text AS assigned_user_label,
        ct.lead_score AS contact_lead_score,
        ${this.inboxContactNameSql('ct')} AS contact_name,
        NULL::text AS wa_profile_name,
        NULL::text AS wa_username,
        COALESCE((
          SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
          FROM contact_segments cs
          JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug AND sd.program_id IS NOT DISTINCT FROM cs.program_id
          WHERE cs.contact_id = ct.id
        ), ARRAY[]::varchar[]) AS contact_segment_slugs,
        ''::text AS preview,
        ARRAY[]::varchar[] AS conversation_tags,
        NULL::int AS matched_message_id,
        ct.id AS contact_id,
        NULL::text AS line_label,
        NULL::text AS line_display_phone,
        NULL::text AS line_program
      FROM contacts ct
      WHERE ${contactAreaPredicate('ct', area)}
      ${contactSegmentSql}
      ${contactSearchSql}
      AND NOT EXISTS (
        SELECT 1
        FROM conversations c
        WHERE ${categories ? inboxConversationPredicate('c', area, categories) : conversationAreaPredicate('c', area)} AND (c.contact_id = ct.id
          OR (ct.phone IS NOT NULL AND c.phone = ct.phone)
          OR (ct.whatsapp_user_id IS NOT NULL AND c.whatsapp_user_id = ct.whatsapp_user_id))
      )
      ORDER BY ct.updated_at DESC, ct.id DESC
      LIMIT 50
    `);

    return rows.concat(virtualRows);
  }

  private async countInboxConversations(
    area: string,
    segmentFilter: InboxSegmentFilter,
    searchQ: string,
    chatFilter: ReturnType<typeof parseInboxChatFilter>,
    windowMax: ReturnType<typeof parseInboxWindowMaxFilter>,
    dateFrom: string | null,
    dateTo: string | null,
    includeUnreadOutside: boolean,
    userId: number,
    categories: string[] | null = null,
    searchMessages = false,
  ): Promise<number> {
    const segmentSql = buildConversationSegmentSql(segmentFilter);
    const includeMessages = inboxSearchMayScanMessages(searchQ, searchMessages);
    const searchSql = searchQ
      ? this.buildInboxSearchSql(searchQ, { includeMessages })
      : Prisma.empty;
    const chatSql = this.buildChatFilterSql(chatFilter, userId, {
      searchAll: Boolean(searchQ) && chatFilter === 'all',
    });
    const windowSql = buildWindowMaxFilterSql(windowMax);
    const dateSql = buildLastMessageDateRangeSql(
      dateFrom,
      dateTo,
      includeUnreadOutside,
    );
    const hasDateFilter = Boolean(dateFrom || dateTo);

    const rows = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n
      FROM conversations c
      ${this.inboxResolvedContactJoinSql(area)}
      WHERE ${categories ? inboxConversationPredicate('c', area, categories) : conversationAreaPredicate('c', area)}
      ${segmentSql}
      ${searchSql}
      ${chatSql}
      ${windowSql}
      ${dateSql}
    `);
    let total = rows[0]?.n ?? 0;

    if (
      !searchQ ||
      chatFilter !== 'all' ||
      windowMax != null ||
      hasDateFilter
    ) {
      return total;
    }

    const contactSegmentSql = buildContactSegmentSql(segmentFilter);
    const contactSearchSql = this.buildVirtualContactSearchSql(searchQ);

    const virtualRows = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n
      FROM contacts ct
      WHERE ${contactAreaPredicate('ct', area)}
      ${contactSegmentSql}
      ${contactSearchSql}
      AND NOT EXISTS (
        SELECT 1
        FROM conversations c
        WHERE ${categories ? inboxConversationPredicate('c', area, categories) : conversationAreaPredicate('c', area)} AND (c.contact_id = ct.id
          OR (ct.phone IS NOT NULL AND c.phone = ct.phone)
          OR (ct.whatsapp_user_id IS NOT NULL AND c.whatsapp_user_id = ct.whatsapp_user_id))
      )
    `);
    total += virtualRows[0]?.n ?? 0;
    return total;
  }

  private async countInboxUnread(
    area: string,
    segmentFilter: InboxSegmentFilter,
    categories: string[] | null = null,
  ): Promise<number> {
    const segmentSql = buildConversationSegmentSql(segmentFilter);
    const rows = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n
      FROM conversations c
      ${this.inboxResolvedContactJoinSql(area)}
      WHERE ${categories ? inboxConversationPredicate('c', area, categories) : conversationAreaPredicate('c', area)}
        AND c.inbox_unread = TRUE
        AND c.archived = FALSE
        AND c.last_user_message_at IS NOT NULL
      ${segmentSql}
    `);
    return rows[0]?.n ?? 0;
  }

  private async countInboxArchived(
    area: string,
    segmentFilter: InboxSegmentFilter,
    categories: string[] | null = null,
  ): Promise<number> {
    const segmentSql = buildConversationSegmentSql(segmentFilter);
    const rows = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n
      FROM conversations c
      ${this.inboxResolvedContactJoinSql(area)}
      WHERE ${categories ? inboxConversationPredicate('c', area, categories) : conversationAreaPredicate('c', area)}
        AND (c.archived = TRUE OR c.last_user_message_at IS NULL)
      ${segmentSql}
    `);
    return rows[0]?.n ?? 0;
  }

  async listEducationCategories(
    user: AuthUser,
  ): Promise<Array<{ slug: string; label: string }>> {
    return this.userAreas.listEducationCategories(user);
  }

  private selectedEducationCategories(
    area: string,
    options: Array<{ slug: string }>,
    raw: string | string[] | undefined,
  ): string[] | null {
    if (!options.length) return null;
    const allowed = options.map((item) => item.slug);
    const requested = (Array.isArray(raw) ? raw : raw ? [raw] : [])
      .flatMap((value) => String(value).split(','))
      .map((value) => value.trim().toLowerCase())
      .filter((value) => allowed.includes(value));
    if (requested.length) return [...new Set(requested)];
    const program = educationProgramOf(area);
    if (program && allowed.length === 1 && allowed.includes(program)) return [program];
    return allowed;
  }

  async list(
    user: AuthUser,
    query: Record<string, string | string[] | undefined>,
  ): Promise<InboxListResult> {
    const area = user.area;
    const searchQ = String(query.q ?? '').trim();
    const searchMessagesRaw = Array.isArray(query.qm)
      ? query.qm[0]
      : query.qm;
    const searchMessages =
      searchQ.length > 0 &&
      ['1', 'true', 'yes'].includes(
        String(searchMessagesRaw ?? '')
          .trim()
          .toLowerCase(),
      );
    const chat = parseInboxChatFilter(
      Array.isArray(query.chat) ? query.chat[0] : query.chat,
    );
    const windowMax = parseInboxWindowMaxFilter(
      Array.isArray(query.window_max) ? query.window_max[0] : query.window_max,
    );
    const dateFrom = parseInboxDateParam(
      Array.isArray(query.from) ? query.from[0] : query.from,
    );
    const dateTo = parseInboxDateParam(
      Array.isArray(query.to) ? query.to[0] : query.to,
    );
    const rangeRaw = Array.isArray(query.range) ? query.range[0] : query.range;
    const dateFilter = resolveInboxDateFilter({
      searchQ,
      from: dateFrom,
      to: dateTo,
      rangeAll:
        String(rangeRaw ?? '')
          .trim()
          .toLowerCase() === 'all',
    });
    const categoryOptions = await this.listEducationCategories(user);
    const categories = this.selectedEducationCategories(area, categoryOptions, query.category);
    const segmentRaw = parseSegmentQueryParam(query.segment);
    const segmentOptions = await this.loadSegmentOptions(area, categories);
    const segmentFilter = parseInboxSegmentFilter(segmentRaw, segmentOptions, categories);
    const pageRaw = Array.isArray(query.page) ? query.page[0] : query.page;
    const page = Math.max(1, Number(pageRaw) || 1);
    const limit = INBOX_LIST_PAGE_SIZE;
    // Con búsqueda: sin COUNT exacto; pedimos limit+1 para saber si hay más.
    const skipExactCount = Boolean(searchQ);

    const [
      segments,
      assignableSegments,
      totalCountExact,
      aiAreaEnabled,
      unreadCount,
      archivedCount,
    ] = await Promise.all([
      Promise.resolve(segmentOptions),
      this.loadAssignableSegmentOptions(area),
      skipExactCount
        ? Promise.resolve(-1)
        : this.countInboxConversations(
            area,
            segmentFilter,
            searchQ,
            chat,
            windowMax,
            dateFilter.appliedFrom,
            dateFilter.appliedTo,
            dateFilter.includeUnreadOutside,
            user.id,
            categories,
            searchMessages,
          ),
      this.loadAiAreaEnabled(area),
      this.countInboxUnread(area, segmentFilter, categories),
      this.countInboxArchived(area, segmentFilter, categories),
    ]);

    let pageClamped = page;
    if (!skipExactCount) {
      const pagesExact =
        totalCountExact > 0 ? Math.ceil(totalCountExact / limit) : 0;
      pageClamped = pagesExact > 0 ? Math.min(page, pagesExact) : 1;
    }

    const listRowsRaw = await this.fetchInboxConversations(
      area,
      segmentFilter,
      searchQ,
      chat,
      windowMax,
      dateFilter.appliedFrom,
      dateFilter.appliedTo,
      dateFilter.includeUnreadOutside,
      user.id,
      pageClamped,
      limit,
      categories,
      searchMessages,
      skipExactCount ? 1 : 0,
    );

    let totalCount: number;
    let pages: number;
    let totalExact: boolean;
    let listRows = listRowsRaw;

    if (skipExactCount) {
      const hasMore = listRowsRaw.length > limit;
      listRows = hasMore ? listRowsRaw.slice(0, limit) : listRowsRaw;
      const shown = (pageClamped - 1) * limit + listRows.length;
      totalCount = hasMore ? shown + 1 : shown;
      pages = hasMore ? pageClamped + 1 : pageClamped;
      totalExact = false;
    } else {
      totalCount = totalCountExact;
      pages = totalCount > 0 ? Math.ceil(totalCount / limit) : 0;
      totalExact = true;
    }

    return {
      items: listRows.map((row) => this.mapListRow(row)),
      total_count: totalCount,
      total_exact: totalExact,
      page: pageClamped,
      pages,
      unread_count: unreadCount,
      archived_count: archivedCount,
      ai_area_enabled: aiAreaEnabled,
      can_assign_conversations: this.canAssignConversations(user),
      segments,
      assignable_segments: assignableSegments,
      categories: categoryOptions,
      filters: {
        q: searchQ,
        qm: searchMessages,
        chat,
        window_max: windowMax,
        from: dateFrom,
        to: dateTo,
        range: dateFilter.range,
        applied_from: dateFilter.appliedFrom,
        applied_to: dateFilter.appliedTo,
        segment_slugs: [...segmentFilter.slugs, ...(segmentFilter.ids ?? []).map(id => `id:${id}`)],
        include_none: segmentFilter.includeNone,
        categories: categories ?? [],
      },
    };
  }

  async getUnreadCount(user: AuthUser): Promise<InboxUnreadCountResult> {
    const unread_count = await this.countInboxUnread(user.area, {
      slugs: [],
      includeNone: false,
    });
    return { unread_count };
  }

  async getSummary(
    user: AuthUser,
    daysRaw?: string,
    advisorIdRaw?: string,
    categories: string[] | null = null,
  ) {
    const days = Number(daysRaw ?? 30) || 30;
    const requestedAdvisorId = Number(advisorIdRaw ?? 0) || null;
    // Sin flag: solo stats propias. Con flag: global del área o filtro por asesor.
    const canViewGlobal = user.canViewConversationStats;
    const advisorId = canViewGlobal
      ? requestedAdvisorId && requestedAdvisorId > 0
        ? requestedAdvisorId
        : null
      : user.id > 0
        ? user.id
        : null;

    return fetchConversationSummary(this.prisma, user.area, days, advisorId, categories);
  }

  async sendDirectTemplate(
    user: AuthUser,
    conversationId: number,
    body: Record<string, unknown>,
  ): Promise<{ campaign_id: number; message_id: string | null }> {
    const area = user.area;
    const conversation = await this.prisma.conversations.findFirst({
      where: this.conversationLookup(area, conversationId),
      include: {
        contacts: {
          select: {
            id: true,
            name: true,
            last_name: true,
            phone: true,
            email: true,
            dni: true,
          },
        },
        whatsapp_line: { select: { program_id: true, waba_id: true } },
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    if (isWithinUserServiceWindow(conversation.last_user_message_at)) {
      throw new BadRequestException(
        'La ventana de 24 h está abierta: responde con un mensaje normal.',
      );
    }

    const templateSyncId = Number(
      body.templateSyncId ?? body.template_sync_id ?? 0,
    );
    if (!Number.isInteger(templateSyncId) || templateSyncId <= 0) {
      throw new BadRequestException('Plantilla inválida');
    }

    const lineWabaId = conversation.whatsapp_line?.waba_id;
    const templateRow = await this.prisma.whatsapp_templates.findFirst({
      where: {
        id: templateSyncId,
        area,
        status: 'APPROVED',
        active: true,
        ...(lineWabaId != null ? { whatsapp_waba_id: lineWabaId } : {}),
      },
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
    if (!templateRow) {
      throw new BadRequestException('Plantilla no encontrada o no aprobada');
    }

    const def = buildTemplateDefinition(templateRow);
    const submittedStaticParams = {
      headerParams: Array.isArray(body.headerParams)
        ? (body.headerParams as string[]).map((v) => String(v).trim())
        : [],
      bodyParams: Array.isArray(body.bodyParams)
        ? (body.bodyParams as string[]).map((v) => String(v).trim())
        : [],
      buttonParams: Array.isArray(body.buttonParams)
        ? (body.buttonParams as string[]).map((v) => String(v).trim())
        : [],
      headerMediaUrl:
        typeof body.headerMediaUrl === 'string'
          ? body.headerMediaUrl.trim()
          : '',
    };
    const paramMapping = parseParamMappingFromBody(def, body);
    let senderName = '';
    if (paramMappingUsesSource(paramMapping, USER_NAME_PARAM_SOURCE)) {
      const sender = await this.prisma.users.findUnique({
        where: { id: user.id },
        select: { first_name: true, last_name: true },
      });
      senderName = formatTemplateSenderName(sender || {});
    }
    const staticParams = materializeTemplateSenderName(
      submittedStaticParams,
      paramMapping,
      senderName,
    );
    const formCheck = validateTemplateFormValues(def, staticParams, {
      maxBodyLen: MAX_BODY_PARAM_LEN,
      maxUrlLen: MAX_IMAGE_URL_LEN,
      paramMapping,
    });
    if (!formCheck.ok) {
      throw new BadRequestException(formCheck.message);
    }
    const contact = conversation.contacts;
    const attrsMap = contact
      ? await fetchContactAttributesMap(this.prisma, [contact.id], {
          programId: conversation.whatsapp_line?.program_id ?? null,
        })
      : new Map();
    const resolvedParams = paramMapping
      ? buildParamsForContact(
          staticParams,
          paramMapping,
          contact || { name: '', phone: conversation.phone },
          contact ? attrsMap.get(contact.id) : undefined,
        )
      : staticParams;
    const resolvedCheck = validateTemplateFormValues(def, resolvedParams, {
      maxBodyLen: MAX_BODY_PARAM_LEN,
      maxUrlLen: MAX_IMAGE_URL_LEN,
    });
    if (!resolvedCheck.ok) {
      throw new BadRequestException(
        `No se pudo completar la plantilla con los datos del contacto: ${resolvedCheck.message}`,
      );
    }
    const components = buildWhatsappGraphComponents(def, resolvedParams);
    const phoneNorm = conversationRecipient(conversation);
    const preview = buildCampaignMessagePreview(
      def,
      templateRow.components_json,
      resolvedParams,
    );

    const campaign = await this.prisma.campaigns.create({
      data: {
        area,
        whatsapp_line_id: conversation.whatsapp_line_id,
        segment: 'direct',
        template_name: templateRow.name,
        message_text:
          preview.bodyText || preview.headerText || templateRow.name,
        status: 'sending',
        total_recipients: 1,
        send_mode: 'direct',
        campaign_payload: {
          source: 'inbox_direct',
          conversation_id: conversationId,
          contact_id: contact?.id ?? null,
          template_sync_id: templateSyncId,
          staticParams,
          paramMapping,
        },
      },
      select: { id: true },
    });

    let messageId: string | null = null;
    let logStatus = 'failed';
    let apiResponse: unknown = null;
    let sendErrorMessage = '';

    try {
      const result = await sendTemplateWithComponents({
        to: phoneNorm,
        templateName: templateRow.name,
        languageCode: templateRow.language,
        components,
        area,
        phoneNumberId: conversation.whatsapp_phone_number_id,
      });
      messageId = result.messages?.[0]?.id ?? null;
      logStatus = messageId ? 'sent' : 'failed';
      apiResponse = result;
      if (!messageId) {
        sendErrorMessage =
          'WhatsApp no devolvió un id de mensaje. Revisa la configuración.';
      }
    } catch (error) {
      sendErrorMessage = error instanceof Error ? error.message : String(error);
      apiResponse = { error: sendErrorMessage };
    }

    await this.prisma.campaign_logs.create({
      data: {
        campaign_id: campaign.id,
        contact_id: contact?.id ?? null,
        phone: phoneNorm,
        whatsapp_message_id: messageId,
        status: logStatus,
        response: apiResponse as PrismaTypes.InputJsonValue,
      },
    });

    await this.prisma.campaigns.update({
      where: { id: campaign.id },
      data: {
        status: logStatus === 'sent' ? 'completed' : 'failed',
      },
    });

    if (logStatus === 'sent') {
      await persistCampaignChatMessage(this.prisma, {
        area,
        campaignId: campaign.id,
        templateName: templateRow.name,
        contactId: contact?.id ?? null,
        phone: phoneNorm,
        waMessageId: messageId,
        preview,
        apiResponse,
        whatsappLineId: conversation.whatsapp_line_id,
        whatsappPhoneNumberId: conversation.whatsapp_phone_number_id,
      });
      try {
        await this.assignDirectTemplateSender(
          user,
          conversation,
          campaign.id,
          templateRow.name,
        );
      } catch (error) {
        this.logger.error(
          `Plantilla individual enviada, pero no se pudo asignar conversación ${conversationId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.auditLog.write({
          level: 'error',
          event_type: 'conversation.assign_failed',
          message: `No se pudo asignar la conversación ${conversationId} después de enviar una plantilla individual`,
          actor: auditActor(user),
          meta: {
            conversation_id: conversationId,
            intended_user_id: user.id,
            campaign_id: campaign.id,
            template_name: templateRow.name,
          },
        });
      }
    } else {
      throw new BadRequestException(
        sendErrorMessage
          ? `No se pudo enviar la plantilla: ${sendErrorMessage}`
          : 'No se pudo enviar la plantilla. Revisa la configuración de WhatsApp.',
      );
    }

    return { campaign_id: campaign.id, message_id: messageId };
  }

  async getDetail(
    user: AuthUser,
    conversationId: number,
    aroundIdRaw?: string,
  ): Promise<InboxDetail> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id de conversacion invalido');
    }
    const area = user.area;
    const conversation = await this.prisma.conversations.findFirst({
      where: this.conversationLookup(area, conversationId),
      include: {
        assigned_user: {
          select: { first_name: true, last_name: true, email: true },
        },
        whatsapp_line: {
          select: {
            label: true,
            display_phone_number: true,
            program_key: true,
            program: { select: { slug: true } },
          },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversacion no encontrada');
    }
    let activeConversation = conversation;
    if (!activeConversation.assigned_user_id) {
      const assigned = await autoAssignConversationIfUnassigned(
        this.prisma,
        this.auditLog,
        area,
        conversationId,
        'auto_first_sender',
      );
      if (assigned) {
        const refreshed = await this.prisma.conversations.findFirst({
          where: this.conversationLookup(area, conversationId),
          include: {
            assigned_user: {
              select: { first_name: true, last_name: true, email: true },
            },
            whatsapp_line: {
              select: {
                label: true,
                display_phone_number: true,
                program_key: true,
                program: { select: { slug: true } },
              },
            },
          },
        });
        if (refreshed) activeConversation = refreshed;
      }
    }

    const [tags, metaAd, aiAreaEnabled] = await Promise.all([
      this.prisma.conversation_tags.findMany({
        where: { conversation_id: conversationId },
        orderBy: { label: 'asc' },
        select: { label: true },
      }),
      activeConversation.meta_ctwa_ad_id
        ? this.prisma.meta_ctwa_ads.findFirst({
            where: { id: activeConversation.meta_ctwa_ad_id, area },
            select: {
              id: true,
              meta_source_id: true,
              display_name: true,
              ad_platform: true,
              headline: true,
              body: true,
              source_url: true,
            },
          })
        : Promise.resolve(null),
      this.loadAiAreaEnabled(area),
    ]);

    await this.clearInboxUnreadOnOpen(user, conversationId, area);

    let resolvedContactId = activeConversation.contact_id
      ? Number(activeConversation.contact_id)
      : null;

    if (
      !resolvedContactId &&
      (activeConversation.phone || activeConversation.whatsapp_user_id)
    ) {
      const byUserId = activeConversation.whatsapp_user_id
        ? await this.prisma.contacts.findFirst({
            where: {
              area,
              whatsapp_user_id: activeConversation.whatsapp_user_id,
            },
            select: { id: true },
          })
        : null;
      const byPhone = activeConversation.phone
        ? await this.prisma.contacts.findFirst({
            where: { area, phone: activeConversation.phone },
            select: { id: true, whatsapp_user_id: true },
          })
        : null;
      const byIdentity = chooseWhatsAppIdentityMatch(
        byUserId,
        byPhone,
        activeConversation.whatsapp_user_id,
      ).match;
      if (byIdentity) {
        resolvedContactId = byIdentity.id;
        await this.prisma.conversations.update({
          where: { id: conversationId },
          data: { contact_id: byIdentity.id, updated_at: new Date() },
        });
      }
    }

    let contact: InboxDetail['contact'] = null;
    if (resolvedContactId) {
      const rows = await this.prisma.$queryRaw<
        {
          name: string | null;
          last_name: string | null;
          phone: string;
          email: string | null;
          dni: string | null;
          lead_score: number | null;
          lead_status_id: number | null;
          lead_status_slug: string | null;
          lead_status_label: string | null;
          segment_slugs: string[];
        }[]
      >(Prisma.sql`
        SELECT
          c.name,
          c.last_name,
          c.phone,
          c.email,
          c.dni,
          c.lead_score,
          c.lead_status_id,
          ls.slug AS lead_status_slug,
          ls.label AS lead_status_label,
          COALESCE((
            SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
            FROM contact_segments cs
            JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug AND sd.program_id IS NOT DISTINCT FROM cs.program_id
            WHERE cs.contact_id = c.id
              AND ${segmentMatchesConversationSql(conversationId)}
          ), ARRAY[]::varchar[]) AS segment_slugs
        FROM contacts c
        LEFT JOIN lead_status_definitions ls ON ls.id = c.lead_status_id
        WHERE c.id = ${resolvedContactId}
      `);
      const row = rows[0];
      contact = row
        ? {
            name: row.name,
            last_name: row.last_name,
            phone: row.phone,
            email: row.email,
            dni: row.dni,
            lead_score: row.lead_score,
            lead_status:
              row.lead_status_id != null && row.lead_status_label
                ? {
                    id: Number(row.lead_status_id),
                    slug: String(row.lead_status_slug ?? ''),
                    label: String(row.lead_status_label),
                  }
                : null,
            segment_slugs: row.segment_slugs,
          }
        : null;
    } else if (activeConversation.phone) {
      const rows = await this.prisma.$queryRaw<
        {
          name: string | null;
          last_name: string | null;
          phone: string;
          email: string | null;
          dni: string | null;
          lead_score: number | null;
          lead_status_id: number | null;
          lead_status_slug: string | null;
          lead_status_label: string | null;
          segment_slugs: string[];
        }[]
      >(Prisma.sql`
        SELECT
          c.name,
          c.last_name,
          c.phone,
          c.email,
          c.dni,
          c.lead_score,
          c.lead_status_id,
          ls.slug AS lead_status_slug,
          ls.label AS lead_status_label,
          COALESCE((
            SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
            FROM contact_segments cs
            JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug AND sd.program_id IS NOT DISTINCT FROM cs.program_id
            WHERE cs.contact_id = c.id
              AND ${segmentMatchesConversationSql(conversationId)}
          ), ARRAY[]::varchar[]) AS segment_slugs
        FROM contacts c
        LEFT JOIN lead_status_definitions ls ON ls.id = c.lead_status_id
        WHERE c.phone = ${activeConversation.phone}
        ORDER BY CASE WHEN c.area = ${area} THEN 0 ELSE 1 END, c.updated_at DESC NULLS LAST
        LIMIT 1
      `);
      const row = rows[0];
      contact = row
        ? {
            name: row.name,
            last_name: row.last_name,
            phone: row.phone,
            email: row.email,
            dni: row.dni,
            lead_score: row.lead_score,
            lead_status:
              row.lead_status_id != null && row.lead_status_label
                ? {
                    id: Number(row.lead_status_id),
                    slug: String(row.lead_status_slug ?? ''),
                    label: String(row.lead_status_label),
                  }
                : null,
            segment_slugs: row.segment_slugs,
          }
        : null;
    }

    const page = await this.loadInboxMessagePage(conversationId, {
      aroundIdRaw,
    });
    const messages = await this.enrichMessagesSenderFromAudit(
      area,
      conversationId,
      await this.mapMessageRowsWithReplyTo(conversationId, page.rows),
    );
    const events = await this.loadConversationTimelineEvents(
      area,
      conversationId,
      resolvedContactId,
      BigInt(0),
      page.eventRange,
    );

    const windowOpen = isWithinUserServiceWindow(
      activeConversation.last_user_message_at,
    );
    const status = String(activeConversation.status ?? '')
      .trim()
      .toLowerCase();
    const botModeBlock = aiAreaEnabled && status === 'bot';
    let replyBlockedReason: InboxDetail['reply_blocked_reason'] = null;
    if (!windowOpen) replyBlockedReason = '24h';
    else if (botModeBlock) replyBlockedReason = 'bot_mode';

    const assignedUserLabel = activeConversation.assigned_user
      ? formatAdvisorLabel(activeConversation.assigned_user)
      : null;

    return {
      conversation: {
        id: activeConversation.id,
        phone: activeConversation.phone,
        whatsapp_user_id: activeConversation.whatsapp_user_id,
        recipient: conversationRecipient(activeConversation),
        status: activeConversation.status,
        last_message_at:
          activeConversation.last_message_at?.toISOString() ?? null,
        last_user_message_at:
          activeConversation.last_user_message_at?.toISOString() ?? null,
        inbox_unread: false,
        archived: Boolean(activeConversation.archived),
        contact_id: resolvedContactId,
        wa_profile_name:
          String(activeConversation.wa_profile_name ?? '').trim() || null,
        wa_username:
          String(activeConversation.wa_username ?? '').trim() || null,
        meta_ctwa_ad_id: activeConversation.meta_ctwa_ad_id,
        assigned_user_id: activeConversation.assigned_user_id,
        assigned_user_label: assignedUserLabel,
        automation_touched_at:
          activeConversation.automation_touched_at?.toISOString() ?? null,
        line_label:
          String(activeConversation.whatsapp_line?.label ?? '').trim() || null,
        line_display_phone:
          String(
            activeConversation.whatsapp_line?.display_phone_number ?? '',
          ).trim() || null,
        line_program:
          activeConversation.whatsapp_line?.program?.slug ||
          activeConversation.whatsapp_line?.program_key ||
          null,
      },
      contact,
      meta_ad: metaAd,
      messages,
      events,
      tags: tags.map((row) => row.label),
      has_older_messages: page.hasOlder,
      has_newer_messages: page.hasNewer,
      can_reply: windowOpen && !botModeBlock,
      reply_blocked_reason: replyBlockedReason,
      user_service_window_open: windowOpen,
      ai_area_enabled: aiAreaEnabled,
      can_assign_conversations: this.canAssignConversations(user),
    };
  }

  /** ID is the cursor in both directions, including polling. Read one extra row. */
  private async loadInboxMessagePage(
    conversationId: number,
    opts: {
      beforeIdRaw?: string;
      afterIdRaw?: string;
      aroundIdRaw?: string;
      limitRaw?: string;
    } = {},
  ) {
    const parseId = (raw: string | undefined) => {
      if (raw == null) return undefined;
      const n = Number(raw);
      if (!Number.isSafeInteger(n) || n <= 0)
        throw new BadRequestException('Cursor de mensajes invalido');
      return n;
    };
    const beforeId = parseId(opts.beforeIdRaw);
    const afterId = parseId(opts.afterIdRaw);
    const aroundId = parseId(opts.aroundIdRaw);
    if ([beforeId, afterId, aroundId].filter((id) => id != null).length > 1) {
      throw new BadRequestException('Usa un solo cursor de mensajes');
    }
    const requestedLimit = Number(
      opts.limitRaw ?? INBOX_DETAIL_MESSAGE_PAGE_SIZE,
    );
    if (!Number.isInteger(requestedLimit) || requestedLimit <= 0) {
      throw new BadRequestException('Limite de mensajes invalido');
    }
    const limit = Math.min(INBOX_DETAIL_MESSAGE_PAGE_SIZE, requestedLimit);
    const anchorId = beforeId ?? afterId ?? aroundId;
    const anchor =
      anchorId == null
        ? null
        : await this.prisma.chat_messages.findFirst({
            where: { id: anchorId, conversation_id: conversationId },
            select: { id: true, created_at: true },
          });
    if (anchorId != null && !anchor)
      throw new NotFoundException('Mensaje no encontrado');
    const fetched = await this.prisma.chat_messages.findMany({
      where: {
        conversation_id: conversationId,
        NOT: { message_type: { equals: 'reaction', mode: 'insensitive' } },
        ...(beforeId
          ? { id: { lt: beforeId } }
          : afterId
            ? { id: { gt: afterId } }
            : aroundId
              ? { id: { lte: aroundId } }
              : {}),
      },
      orderBy: { id: afterId ? 'asc' : 'desc' },
      take: limit + 1,
      select: {
        id: true,
        direction: true,
        body_text: true,
        message_type: true,
        created_at: true,
        is_ai: true,
        raw_payload: true,
      },
    });
    const rows = fetched.slice(0, limit);
    if (!afterId) rows.reverse();
    const hasOlder = afterId ? true : fetched.length > limit;
    const hasNewer = afterId
      ? fetched.length > limit
      : beforeId
        ? true
        : aroundId != null
          ? (await this.prisma.chat_messages.findFirst({
              where: {
                conversation_id: conversationId,
                id: { gt: aroundId },
                NOT: {
                  message_type: { equals: 'reaction', mode: 'insensitive' },
                },
              },
              select: { id: true },
            })) != null
          : false;
    const times = rows.map((row) => row.created_at.getTime());
    const oldestDate = times.length
      ? new Date(Math.min(...times))
      : anchor?.created_at;
    const newestDate = times.length
      ? new Date(Math.max(...times))
      : anchor?.created_at;
    return {
      rows,
      hasOlder,
      hasNewer,
      eventRange: {
        from: afterId ? anchor?.created_at : hasOlder ? oldestDate : undefined,
        to: beforeId ? anchor?.created_at : hasNewer ? newestDate : undefined,
      },
    };
  }

  async getOlderMessages(
    user: AuthUser,
    conversationId: number,
    beforeIdRaw?: string,
    limitRaw?: string,
    afterIdRaw?: string,
  ): Promise<InboxOlderMessagesResult> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id de conversacion invalido');
    }
    if (!beforeIdRaw && !afterIdRaw)
      throw new BadRequestException('Cursor requerido');
    const conversation = await this.prisma.conversations.findFirst({
      where: this.conversationLookup(user.area, conversationId),
      select: { id: true, contact_id: true },
    });
    if (!conversation)
      throw new NotFoundException('Conversacion no encontrada');
    const page = await this.loadInboxMessagePage(conversationId, {
      beforeIdRaw,
      afterIdRaw,
      limitRaw,
    });
    const [messages, events] = await Promise.all([
      this.mapMessageRowsWithReplyTo(conversationId, page.rows).then(
        (messages) =>
          this.enrichMessagesSenderFromAudit(
            user.area,
            conversationId,
            messages,
          ),
      ),
      this.loadConversationTimelineEvents(
        user.area,
        conversationId,
        conversation.contact_id,
        BigInt(0),
        page.eventRange,
      ),
    ]);
    return {
      messages,
      events,
      has_older_messages: page.hasOlder,
      has_newer_messages: page.hasNewer,
    };
  }

  async listAssignees(user: AuthUser): Promise<ConversationAssigneesResult> {
    if (!this.canAssignConversations(user)) {
      throw new ForbiddenException('No puedes asignar conversaciones');
    }
    const area = user.area;
    const rows = await this.prisma.$queryRaw<
      {
        id: number;
        email: string;
        first_name: string | null;
        last_name: string | null;
      }[]
    >(Prisma.sql`
      SELECT DISTINCT u.id, u.email, u.first_name, u.last_name
      FROM users u
      WHERE u.is_provisioned = TRUE
        AND (
          u.area = ${area}
          OR u.is_master = TRUE
          OR EXISTS (
            SELECT 1 FROM user_areas ua
            WHERE ua.user_id = u.id AND ua.area = ${area}
          )
          OR EXISTS (
            SELECT 1
            FROM user_area_memberships m
            JOIN business_areas ba ON ba.id = m.business_area_id
            LEFT JOIN business_area_aliases al
              ON al.business_area_id = ba.id AND al.alias = ${area}
            WHERE m.user_id = u.id
              AND m.active = TRUE
              AND (ba.slug = ${area} OR al.alias = ${area})
              AND (
                m.access_mode = 'all'
                OR EXISTS (
                  SELECT 1
                  FROM user_program_grants g
                  JOIN business_programs p ON p.id = g.program_id
                  WHERE g.membership_id = m.id
                    AND p.active = TRUE
                    AND (al.program_key IS NULL OR p.slug = al.program_key)
                )
              )
          )
        )
      ORDER BY u.email ASC
    `);
    return {
      assignees: rows.map((row) => ({
        id: row.id,
        email: row.email,
        label: formatAdvisorLabel(row),
      })),
    };
  }

  async assignConversation(
    user: AuthUser,
    conversationId: number,
    assignedUserId: number | null,
  ): Promise<AssignConversationResult> {
    if (!this.canAssignConversations(user)) {
      throw new ForbiddenException('No puedes asignar conversaciones');
    }
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id invalido');
    }
    const area = user.area;
    const conversation = await this.prisma.conversations.findFirst({
      where: this.conversationLookup(area, conversationId),
      select: { id: true, assigned_user_id: true, contact_id: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversacion no encontrada');
    }

    let assigneeLabel: string | null = null;
    if (
      ['educacion', 'educacion_ca', 'educacion_ep'].includes(area) &&
      assignedUserId === null
    ) {
      throw new BadRequestException('Para reasignar, selecciona otro asesor');
    }
    if (assignedUserId != null) {
      if (!Number.isInteger(assignedUserId) || assignedUserId <= 0) {
        throw new BadRequestException('Asesor invalido');
      }
      const assignee = await this.prisma.users.findFirst({
        where: {
          id: assignedUserId,
          is_provisioned: true,
          OR: [
            { area },
            { is_master: true },
            { user_areas: { some: { area } } },
          ],
        },
        select: { id: true, email: true, first_name: true, last_name: true },
      });
      if (!assignee) {
        throw new BadRequestException('Asesor no disponible en el area');
      }
      assigneeLabel = formatAdvisorLabel(assignee);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.conversations.update({
        where: { id: conversationId },
        data: {
          assigned_user_id: assignedUserId,
          assigned_at: assignedUserId ? new Date() : null,
          updated_at: new Date(),
        },
      });
      if (
        conversation.contact_id &&
        ['educacion', 'educacion_ca', 'educacion_ep'].includes(area)
      ) {
        const cycle = await tx.education_lead_cycles.findFirst({
          where: { contact_id: conversation.contact_id, area },
          orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        if (cycle)
          await tx.education_lead_cycles.update({
            where: { id: cycle.id },
            data: {
              assigned_user_id: assignedUserId,
              requires_review: assignedUserId === null,
              updated_at: new Date(),
            },
          });
      }
    });

    await this.auditLog.write({
      event_type: AuditEvent.CONVERSATION_ASSIGN,
      message:
        assignedUserId == null
          ? `Conversación ${conversationId} sin asignar`
          : `Conversación ${conversationId} asignada a ${assigneeLabel}`,
      actor: auditActor(user),
      meta: {
        conversation_id: conversationId,
        from_user_id: conversation.assigned_user_id,
        to_user_id: assignedUserId,
        to_user_label: assigneeLabel,
      },
    });

    return {
      assigned_user_id: assignedUserId,
      assigned_user_label: assigneeLabel,
    };
  }

  async listOpenChatLines(
    user: AuthUser,
    categories: string[] | null = null,
  ): Promise<OpenChatLine[]> {
    const scope = businessReadScope(user.area);
    const access = restrictedAccess();
    const granted = applyCategoryGrant(categories);
    const lines = await this.prisma.whatsapp_lines.findMany({
      where: {
        active: true,
        business_area: { slug: scope.canonicalArea },
        ...(access
          ? { id: { in: access.lineIds.length ? access.lineIds : [-1] } }
          : {}),
        ...programScopeWhere(granted),
      },
      orderBy: [{ is_default: 'desc' }, { label: 'asc' }],
      select: {
        id: true,
        label: true,
        display_phone_number: true,
        program: { select: { slug: true, label: true } },
      },
    });
    return lines.map((line) => {
      const category = categoryOfProgram(line.program?.slug);
      return {
        id: line.id,
        label: line.label,
        phone: line.display_phone_number,
        category,
        category_label:
          category === 'general'
            ? 'General'
            : line.program?.label || category.toUpperCase(),
      };
    });
  }

  async ensureFromContact(
    user: AuthUser,
    contactId: number,
    whatsappLineId?: number | null,
  ): Promise<EnsureConversationResult> {
    if (!Number.isInteger(contactId) || contactId <= 0) {
      throw new BadRequestException('Id de contacto invalido');
    }
    const scope = businessReadScope(user.area);
    const area = scope.canonicalArea;

    const contact = await this.prisma.contacts.findFirst({
      where: {
        id: contactId,
        area: { in: scope.areas },
        ...contactAccessWhere(),
      },
      select: { id: true, phone: true, whatsapp_user_id: true },
    });
    if (!contact) {
      throw new NotFoundException('Contacto no encontrado');
    }

    const available = await this.listOpenChatLines(user, null);
    let lineId = Number(whatsappLineId) || 0;
    if (!lineId) {
      if (available.length === 1) lineId = available[0].id;
      else if (!available.length) {
        throw new BadRequestException(
          'No hay una línea activa autorizada para escribir',
        );
      } else {
        throw new BadRequestException(
          'Elige la línea desde la que escribirás',
        );
      }
    } else if (!available.some((line) => line.id === lineId)) {
      throw new BadRequestException('La línea no está disponible');
    }

    const line = await this.prisma.whatsapp_lines.findFirst({
      where: { id: lineId, active: true, business_area: { slug: area } },
      select: { id: true, phone_number_id: true, program_id: true },
    });
    if (!line) {
      throw new BadRequestException('La línea no está activa en esta área');
    }

    const existing = await this.prisma.conversations.findFirst({
      where: {
        whatsapp_line_id: line.id,
        OR: [
          { contact_id: contactId },
          ...(contact.phone ? [{ phone: contact.phone }] : []),
          ...(contact.whatsapp_user_id
            ? [{ whatsapp_user_id: contact.whatsapp_user_id }]
            : []),
        ],
      },
      orderBy: { id: 'asc' },
      select: { id: true, contact_id: true },
    });

    // Inherit assignee only from the open lead of this line's category.
    const categoryLead =
      area === 'educacion'
        ? existing
          ? await this.educationLeads.findOpenLeadForConversation(existing.id, area)
          : await this.prisma.education_lead_cycles.findFirst({
              where: {
                contact_id: contactId,
                closed_at: null,
                program_id: line.program_id ?? null,
                area: { in: scope.areas },
              },
              orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
              select: { assigned_user_id: true },
            })
        : null;
    const cycleAssignee = categoryLead?.assigned_user_id ?? null;

    if (existing) {
      if (!existing.contact_id || categoryLead) {
        await this.prisma.conversations.update({
          where: { id: existing.id },
          data: {
            contact_id: contactId,
            area,
            updated_at: new Date(),
            ...(categoryLead
              ? {
                  assigned_user_id: cycleAssignee,
                  assigned_at: cycleAssignee ? new Date() : null,
                }
              : {}),
          },
        });
      }
      return { id: existing.id };
    }

    if (!contact.phone && !contact.whatsapp_user_id) {
      throw new BadRequestException(
        'El contacto no tiene identidad de WhatsApp',
      );
    }

    const assignedUserId = cycleAssignee;

    const created = await this.prisma.conversations.create({
      data: {
        area,
        whatsapp_line_id: line.id,
        whatsapp_phone_number_id: line.phone_number_id,
        phone: contact.phone,
        whatsapp_user_id: contact.whatsapp_user_id,
        contact_id: contactId,
        status: 'human',
        ...(assignedUserId
          ? { assigned_user_id: assignedUserId, assigned_at: new Date() }
          : {}),
      },
      select: { id: true },
    });
    return { id: created.id };
  }

  private async assertCanReply(
    conversation: {
      status: string;
      last_user_message_at: Date | null;
    },
    area: string,
  ): Promise<void> {
    const aiEnabled = await this.loadAiAreaEnabled(area);
    if (!isWithinUserServiceWindow(conversation.last_user_message_at)) {
      throw new BadRequestException(
        'Ventana de 24 h cerrada: el usuario debe escribirte de nuevo o usa una plantilla desde Campañas.',
      );
    }
    const st = String(conversation.status || '')
      .trim()
      .toLowerCase();
    if (aiEnabled && st === 'bot') {
      throw new BadRequestException(
        'Este chat está en modo Bot; cambia a Asesor para responder.',
      );
    }
  }

  /**
   * Lanza un flujo activo en una conversación con ventana 24h abierta.
   * No requiere que el contacto pulse un botón.
   */
  async startFlow(
    user: AuthUser,
    conversationId: number,
    flowId: number,
  ): Promise<{ flow_id: number; flow_name: string }> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id de conversación inválido');
    }
    if (!Number.isInteger(flowId) || flowId <= 0) {
      throw new BadRequestException('Flujo inválido');
    }
    const area = user.area;
    const conversation = await this.prisma.conversations.findFirst({
      where: this.conversationLookup(area, conversationId),
      select: {
        id: true,
        phone: true,
        whatsapp_user_id: true,
        last_user_message_at: true,
        whatsapp_phone_number_id: true,
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversación no encontrada');
    }
    if (!isWithinUserServiceWindow(conversation.last_user_message_at)) {
      throw new BadRequestException(
        'Ventana de 24 h cerrada: el contacto debe escribir primero o usa una plantilla.',
      );
    }

    const result = await this.flowsService.startFlowById({
      area,
      conversationId: conversation.id,
      flowId,
      phone: conversationRecipient(conversation),
      phoneNumberId:
        String(conversation.whatsapp_phone_number_id || '').trim() || null,
    });

    await this.auditLog
      .write({
        event_type: AuditEvent.CONVERSATION_REPLY,
        message: `Flujo «${result.flow_name}» iniciado en conversación #${conversationId}`,
        actor: auditActor(user),
        meta: {
          conversation_id: conversationId,
          flow_id: result.flow_id,
          phone: conversation.phone ? phoneMetaTail(conversation.phone) : null,
          source: 'inbox_start_flow',
        },
      })
      .catch(() => undefined);

    return result;
  }

  private mapMessageRow(row: {
    id: number;
    direction: string;
    body_text: string | null;
    message_type: string;
    created_at: Date;
    is_ai: boolean;
    raw_payload?: unknown;
  }): InboxMessage {
    const preview = getLocalPreview(row.raw_payload);
    const { campaign_preview, campaign_id } = extractCampaignPreview(
      row.raw_payload,
    );
    const interactive_buttons = extractInteractiveButtons(row.raw_payload);
    const storedReaction = readMessageReaction(row.raw_payload);
    const storedReply = readMessageReplyTo(row.raw_payload);
    return {
      id: row.id,
      direction: row.direction,
      body_text: row.body_text,
      message_type: row.message_type,
      created_at: row.created_at.toISOString(),
      is_ai: row.is_ai,
      has_downloadable_media: hasDownloadableMedia(row.raw_payload),
      reaction: storedReaction
        ? { emoji: storedReaction.emoji, direction: storedReaction.direction }
        : null,
      reply_to: storedReply
        ? {
            message_id: storedReply.message_id,
            preview: storedReply.preview,
            outbound: storedReply.outbound,
          }
        : null,
      delivery:
        row.direction === 'outbound'
          ? readMessageDelivery(row.raw_payload)
          : null,
      sender_label:
        row.direction === 'outbound'
          ? readMessageSenderLabel(row.raw_payload, row.is_ai, row.message_type)
          : null,
      media_preview: preview
        ? { url: preview.url, mime: preview.mime ?? null }
        : null,
      campaign_preview,
      campaign_id,
      interactive_buttons:
        interactive_buttons.length > 0 ? interactive_buttons : undefined,
    };
  }

  private async clearInboxUnreadOnOpen(
    user: AuthUser,
    conversationId: number,
    area: string,
  ): Promise<void> {
    const clearedUnread = await this.prisma.conversations.updateMany({
      where: {
        ...this.conversationLookup(area, conversationId),
        inbox_unread: true,
      },
      data: {
        inbox_unread: false,
        outside_hours_notice_sent_at: null,
        updated_at: new Date(),
      },
    });
    if (clearedUnread.count > 0) {
      await this.auditLog.write({
        event_type: AuditEvent.CONVERSATION_OPEN,
        message: `Conversación ${conversationId} abierta`,
        actor: auditActor(user),
        meta: { conversation_id: conversationId },
      });
      return;
    }
    await this.prisma.conversations.updateMany({
      where: this.conversationLookup(area, conversationId),
      data: {
        outside_hours_notice_sent_at: null,
        updated_at: new Date(),
      },
    });
  }

  private async loadConversationTimelineEvents(
    area: string,
    conversationId: number,
    contactId: number | null,
    afterAuditId = BigInt(0),
    range: { from?: Date; to?: Date } = {},
  ): Promise<InboxTimelineEvent[]> {
    const contactEventTypes = [
      AuditEvent.CONTACT_LEAD_SCORE,
      AuditEvent.CONTACT_UPDATED,
    ];
    const rangeSql = Prisma.sql`
      ${range.from ? Prisma.sql` AND created_at >= ${range.from}` : Prisma.empty}
      ${range.to ? Prisma.sql` AND created_at <= ${range.to}` : Prisma.empty}
    `;
    const rows = contactId
      ? await this.prisma.$queryRaw<
          {
            id: bigint;
            created_at: Date;
            event_type: string;
            actor_email: string | null;
            meta: unknown;
          }[]
        >(Prisma.sql`
          SELECT id, created_at, event_type, actor_email, meta
          FROM audit_logs
          WHERE area = ${area}
            AND id > ${afterAuditId}
            ${rangeSql}
            AND event_type IN (${Prisma.join(INBOX_TIMELINE_EVENT_TYPES)})
            AND (
              (meta->>'conversation_id')::int = ${conversationId}
              OR (
                (meta->>'contact_id')::int = ${contactId}
                AND event_type IN (${Prisma.join(contactEventTypes)})
              )
            )
          ORDER BY created_at ASC, id ASC
        `)
      : await this.prisma.$queryRaw<
          {
            id: bigint;
            created_at: Date;
            event_type: string;
            actor_email: string | null;
            meta: unknown;
          }[]
        >(Prisma.sql`
          SELECT id, created_at, event_type, actor_email, meta
          FROM audit_logs
          WHERE area = ${area}
            AND id > ${afterAuditId}
            ${rangeSql}
            AND event_type IN (${Prisma.join(INBOX_TIMELINE_EVENT_TYPES)})
            AND (meta->>'conversation_id')::int = ${conversationId}
          ORDER BY created_at ASC, id ASC
        `);

    if (!rows.length) return [];

    const [segmentRows, userRows] = await Promise.all([
      this.prisma.segment_definitions.findMany({
        where: { area },
        select: { slug: true, label: true },
      }),
      this.prisma.users.findMany({
        where: { id: { in: collectUserIdsFromAuditRows(rows) } },
        select: { id: true, email: true, first_name: true, last_name: true },
      }),
    ]);

    const segmentLabelBySlug = new Map(
      segmentRows.map((row) => [row.slug, row.label]),
    );
    const userLabelById = new Map(userRows.map(advisorLabelFromUserRow));

    return mapAuditRowsToTimelineEvents(
      rows,
      userLabelById,
      segmentLabelBySlug,
    );
  }

  private async resolveLegacyReplyTos(
    conversationId: number,
    rows: { id: number; raw_payload?: unknown }[],
  ): Promise<Map<number, NonNullable<InboxMessage['reply_to']>>> {
    const pending: { messageId: number; waReplyId: string }[] = [];
    for (const row of rows) {
      if (readMessageReplyTo(row.raw_payload)) continue;
      const waId = extractReplyWaMessageIdFromRawPayload(row.raw_payload);
      if (waId) pending.push({ messageId: row.id, waReplyId: waId });
    }
    if (!pending.length) return new Map();

    const waIds = [...new Set(pending.map((item) => item.waReplyId))];
    const targets = await this.prisma.chat_messages.findMany({
      where: {
        conversation_id: conversationId,
        wa_message_id: { in: waIds },
      },
      select: {
        id: true,
        wa_message_id: true,
        direction: true,
        body_text: true,
        message_type: true,
      },
    });
    const byWa = new Map(
      targets.map((target) => [String(target.wa_message_id), target]),
    );
    const result = new Map<number, NonNullable<InboxMessage['reply_to']>>();
    for (const item of pending) {
      const target = byWa.get(item.waReplyId);
      if (!target) continue;
      result.set(item.messageId, {
        message_id: target.id,
        preview: buildMessageReplyPreview(
          target.body_text,
          target.message_type,
        ),
        outbound: target.direction === 'outbound',
      });
    }
    return result;
  }

  private async mapMessageRowsWithReplyTo(
    conversationId: number,
    rows: {
      id: number;
      direction: string;
      body_text: string | null;
      message_type: string;
      created_at: Date;
      is_ai: boolean;
      raw_payload?: unknown;
    }[],
  ): Promise<InboxMessage[]> {
    const filtered = rows.filter(
      (row) => !isReactionMessageType(row.message_type),
    );
    const legacy = await this.resolveLegacyReplyTos(conversationId, filtered);
    return filtered.map((row) => {
      const message = this.mapMessageRow(row);
      if (message.reply_to) return message;
      const legacyReply = legacy.get(row.id);
      if (legacyReply) message.reply_to = legacyReply;
      return message;
    });
  }

  private async enrichMessagesSenderFromAudit(
    area: string,
    conversationId: number,
    messages: InboxMessage[],
  ): Promise<InboxMessage[]> {
    const needsLabel = messages.some(
      (message) =>
        message.direction === 'outbound' &&
        !message.sender_label &&
        !message.is_ai &&
        message.message_type.toLowerCase() !== 'campaign',
    );
    if (!needsLabel) return messages;

    // El emparejamiento legacy solo considera auditorías a ±3 minutos.
    const times = messages.map((message) =>
      new Date(message.created_at).getTime(),
    );
    const auditFrom = new Date(Math.min(...times) - 3 * 60 * 1000);
    const auditTo = new Date(Math.max(...times) + 3 * 60 * 1000);

    const audits = await this.prisma.$queryRaw<
      { actor_email: string | null; created_at: Date; meta: unknown }[]
    >(Prisma.sql`
      SELECT actor_email, created_at, meta
      FROM audit_logs
      WHERE area = ${area}
        AND event_type = ${AuditEvent.CONVERSATION_REPLY}
        AND (meta->>'conversation_id')::int = ${conversationId}
        AND created_at >= ${auditFrom} AND created_at <= ${auditTo}
      ORDER BY created_at ASC
    `);

    if (!audits.length) return messages;

    return messages.map((message) => {
      if (
        message.sender_label ||
        message.direction !== 'outbound' ||
        message.is_ai ||
        message.message_type.toLowerCase() === 'campaign'
      ) {
        return message;
      }
      const label = matchAuditSenderLabel(message, audits);
      return label ? { ...message, sender_label: label } : message;
    });
  }

  private async loadMessageReactions(
    conversationId: number,
    visibleFromId = 0,
  ): Promise<{ id: number; reaction: InboxMessageReaction | null }[]> {
    const rows = await this.prisma.$queryRaw<
      { id: number; raw_payload: unknown }[]
    >(Prisma.sql`
      SELECT id, raw_payload
      FROM chat_messages
      WHERE conversation_id = ${conversationId}
        AND id >= ${visibleFromId}
        AND raw_payload->'_mali_reaction' IS NOT NULL
    `);
    return rows
      .map((row) => {
        const stored = readMessageReaction(row.raw_payload);
        return {
          id: Number(row.id),
          reaction: stored
            ? { emoji: stored.emoji, direction: stored.direction }
            : null,
        };
      })
      .filter((row) => row.reaction != null);
  }

  private async loadMessageDeliveries(
    conversationId: number,
    visibleFromId = 0,
  ): Promise<{ id: number; delivery: InboxMessageDelivery | null }[]> {
    const rows = await this.prisma.chat_messages.findMany({
      where: {
        conversation_id: conversationId,
        direction: 'outbound',
        id: { gte: visibleFromId },
      },
      select: { id: true, raw_payload: true },
      orderBy: { id: 'desc' },
      take: 300,
    });
    return rows.map((row) => ({
      id: row.id,
      delivery: readMessageDelivery(row.raw_payload),
    }));
  }

  private async applyMessageReaction(
    messageId: number,
    conversationId: number,
    area: string,
    emoji: string,
    direction: 'inbound' | 'outbound',
  ): Promise<InboxMessageReaction | null> {
    const target = await this.prisma.chat_messages.findFirst({
      where: {
        id: messageId,
        conversation_id: conversationId,
        conversations: this.conversationLookup(area, conversationId),
      },
      select: { raw_payload: true },
    });
    if (!target) {
      throw new NotFoundException('Mensaje no encontrado');
    }
    const nextPayload = setMessageReaction(target.raw_payload, {
      emoji,
      direction,
    });
    await this.prisma.chat_messages.update({
      where: { id: messageId },
      data: { raw_payload: nextPayload as PrismaTypes.InputJsonValue },
    });
    const stored = readMessageReaction(nextPayload);
    return stored ? { emoji: stored.emoji, direction: stored.direction } : null;
  }

  async reply(
    user: AuthUser,
    conversationId: number,
    messageText: string,
    file?: { buffer: Buffer; mimetype: string; originalname: string },
    replyToMessageId?: number,
  ): Promise<ReplyResult> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id de conversacion invalido');
    }
    const text = String(messageText || '').trim();
    if (!text && !file) {
      throw new BadRequestException('Escribe un mensaje o adjunta un archivo');
    }
    if (!file && text.length > MAX_SESSION_TEXT_LEN) {
      throw new BadRequestException(
        `Mensaje demasiado largo (max ${MAX_SESSION_TEXT_LEN})`,
      );
    }

    const area = user.area;
    const conversation = await this.prisma.conversations.findFirst({
      where: this.conversationLookup(area, conversationId),
      include: {
        assigned_user: {
          select: { first_name: true, last_name: true, email: true },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversacion no encontrada');
    }

    await this.assertCanReply(conversation, area);
    const linePhoneNumberId =
      String(conversation.whatsapp_phone_number_id || '').trim() || undefined;
    const createdMessages: InboxMessage[] = [];
    const wasUnassigned = !conversation.assigned_user_id;
    const currentLeadCycle =
      conversation.contact_id &&
      ['educacion', 'educacion_ca', 'educacion_ep'].includes(area)
        ? await this.educationLeads.findOpenLeadForConversation(
            conversationId,
            area,
          )
        : null;
    // Claim depends on the open lead, not only on conversation ownership.
    if (
      currentLeadCycle?.assigned_user_id &&
      currentLeadCycle.assigned_user_id !== user.id
    ) {
      throw new ConflictException(
        'Lead ya asignado a otro asesor; no se envió el mensaje',
      );
    }
    if (wasUnassigned && currentLeadCycle?.assigned_user_id === user.id) {
      const inherited = await this.prisma.conversations.updateMany({
        where: { id: conversationId, assigned_user_id: null },
        data: {
          assigned_user_id: currentLeadCycle.assigned_user_id,
          assigned_at: new Date(),
          updated_at: new Date(),
        },
      });
      if (inherited.count)
        await this.auditLog.write({
          event_type: AuditEvent.CONVERSATION_ASSIGN,
          message: `Conversación ${conversationId} asignada al responsable del lead`,
          actor: { area, email: 'system@mali' },
          meta: {
            conversation_id: conversationId,
            from_user_id: null,
            to_user_id: currentLeadCycle.assigned_user_id,
            source: 'lead_owner',
          },
        });
    }
    let reservedLeadId: number | null = null;
    const attentionV1 = await this.educationLeads.isAttentionV1Enabled();
    if (
      attentionV1 &&
      currentLeadCycle &&
      !currentLeadCycle.requires_review &&
      !currentLeadCycle.assigned_user_id
    ) {
      const reservation = await this.educationLeads.reserveClaim({
        leadId: currentLeadCycle.id,
        userId: user.id,
        conversationId,
        actorEmail: user.email,
      });
      if (!reservation.claimed) {
        throw new ConflictException(
          'Lead ya asignado a otro asesor; no se envió el mensaje',
        );
      }
      reservedLeadId = reservation.leadId;
    } else if (
      attentionV1 &&
      currentLeadCycle &&
      currentLeadCycle.assigned_user_id === user.id
    ) {
      reservedLeadId = currentLeadCycle.id;
      await this.educationLeads.linkConversation(
        currentLeadCycle.id,
        conversationId,
      );
    } else if (wasUnassigned && (!attentionV1 || !currentLeadCycle)) {
      // Non-education / no open lead: keep conversation auto-claim before send.
      const claimed = await this.prisma.conversations.updateMany({
        where: { id: conversationId, assigned_user_id: null },
        data: {
          assigned_user_id: user.id,
          assigned_at: new Date(),
          updated_at: new Date(),
        },
      });
      if (claimed.count) {
        await this.auditLog.write({
          event_type: AuditEvent.CONVERSATION_ASSIGN,
          message: `Conversación ${conversationId} reservada al responder`,
          actor: auditActor(user),
          meta: {
            conversation_id: conversationId,
            from_user_id: null,
            to_user_id: user.id,
            source: 'auto_reply_reserve',
          },
        });
      }
    }
    const senderProfile = await this.prisma.users.findFirst({
      where: { id: user.id },
      select: { first_name: true, last_name: true, email: true },
    });
    const actorLabel = formatAdvisorLabel(
      senderProfile ?? { email: user.email, first_name: null, last_name: null },
    );
    let replyToWaMessageId: string | null = null;
    let replyToMeta: {
      message_id: number;
      preview: string;
      outbound: boolean;
    } | null = null;
    if (
      replyToMessageId != null &&
      Number.isInteger(replyToMessageId) &&
      replyToMessageId > 0
    ) {
      const quoted = await this.prisma.chat_messages.findFirst({
        where: {
          id: replyToMessageId,
          conversation_id: conversationId,
          conversations: this.conversationLookup(area, conversationId),
        },
        select: {
          id: true,
          wa_message_id: true,
          direction: true,
          body_text: true,
          message_type: true,
        },
      });
      replyToWaMessageId = quoted?.wa_message_id
        ? String(quoted.wa_message_id).trim()
        : null;
      if (quoted) {
        replyToMeta = {
          message_id: quoted.id,
          preview: buildMessageReplyPreview(
            quoted.body_text,
            quoted.message_type,
          ),
          outbound: quoted.direction === 'outbound',
        };
      }
    }

    try {
      if (!file) {
        const apiResponse = await sendSessionTextMessage({
          to: conversationRecipient(conversation),
          text,
          area,
          phoneNumberId: linePhoneNumberId,
          replyToWaMessageId,
        });
        const msgId = apiResponse.messages?.[0]?.id || null;
        const row = await this.prisma.chat_messages.create({
          data: {
            conversation_id: conversationId,
            direction: 'outbound',
            wa_message_id: msgId,
            body_text: text.slice(0, 8000),
            message_type: 'text',
            raw_payload: withRoutingPhoneNumberId(
              setMessageSender(
                setMessageReplyTo(sanitizeApiResponse(apiResponse), replyToMeta),
                actorLabel,
                user.id,
              ),
              linePhoneNumberId,
            ) as PrismaTypes.InputJsonValue,
            is_ai: false,
          },
        });
        createdMessages.push(this.mapMessageRow(row));
      } else {
        const { waType } = classifyConversationUpload(
          file.mimetype,
          file.buffer.length,
        );
        if (waType === 'audio' && text && text.length > MAX_SESSION_TEXT_LEN) {
          throw new BadRequestException(
            `Con audio, el texto no puede superar ${MAX_SESSION_TEXT_LEN} caracteres`,
          );
        }

        const uploadResult = await uploadMediaToWhatsApp({
          area,
          buffer: file.buffer,
          mimeType: file.mimetype,
          filename: file.originalname,
          phoneNumberId: linePhoneNumberId,
        });

        if (uploadResult.waType === 'audio' && text) {
          const textResp = await sendSessionTextMessage({
            to: conversationRecipient(conversation),
            text,
            area,
            phoneNumberId: linePhoneNumberId,
          });
          const textMsgId = textResp.messages?.[0]?.id || null;
          const textRow = await this.prisma.chat_messages.create({
            data: {
              conversation_id: conversationId,
              direction: 'outbound',
              wa_message_id: textMsgId,
              body_text: text.slice(0, 8000),
              message_type: 'text',
              raw_payload: withRoutingPhoneNumberId(
                setMessageSender(
                  sanitizeApiResponse(textResp),
                  actorLabel,
                  user.id,
                ),
                linePhoneNumberId,
              ) as PrismaTypes.InputJsonValue,
              is_ai: false,
            },
          });
          createdMessages.push(this.mapMessageRow(textRow));
        }

        const captionForMedia =
          uploadResult.waType === 'audio'
            ? ''
            : text
              ? text.slice(0, 1024)
              : '';

        const sendResp = await sendSessionMediaMessage({
          to: conversationRecipient(conversation),
          area,
          waType: uploadResult.waType,
          mediaId: uploadResult.mediaId,
          caption: captionForMedia,
          documentFilename:
            uploadResult.waType === 'document'
              ? uploadResult.safeFilename
              : undefined,
          phoneNumberId: linePhoneNumberId,
        });
        const msgId = sendResp.messages?.[0]?.id || null;
        const label = MEDIA_TYPE_LABEL[uploadResult.waType] || 'Archivo';
        const bodyText = captionForMedia
          ? captionForMedia.slice(0, 8000)
          : `[${label}] ${uploadResult.safeFilename}`.slice(0, 8000);

        let localPreview: { url: string; mime: string | null } | null = null;
        try {
          localPreview = await saveOutboundChatMediaFile({
            buffer: file.buffer,
            conversationId,
            mimeType: file.mimetype,
          });
        } catch {
          localPreview = null;
        }

        const mediaRow = await this.prisma.chat_messages.create({
          data: {
            conversation_id: conversationId,
            direction: 'outbound',
            wa_message_id: msgId,
            body_text: bodyText,
            message_type: uploadResult.waType,
            raw_payload: withRoutingPhoneNumberId(
              setMessageSender(
                sanitizeMediaOutboundPayload(
                  uploadResult.mediaId,
                  sendResp,
                  localPreview,
                ),
                actorLabel,
                user.id,
              ),
              linePhoneNumberId,
            ) as PrismaTypes.InputJsonValue,
            is_ai: false,
          },
        });
        createdMessages.push(this.mapMessageRow(mediaRow));
      }

      await this.prisma.conversations.update({
        where: { id: conversationId },
        data: {
          last_message_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Claim was reserved before Meta send; only mark successful first reply now.
      if (reservedLeadId) {
        await this.educationLeads.markFirstHumanReply(reservedLeadId);
      }

      if (!file) {
        await this.auditLog.write({
          event_type: AuditEvent.CONVERSATION_REPLY,
          message: `Respuesta WhatsApp (texto) en conversación ${conversationId}`,
          actor: auditActor(user),
          meta: {
            conversation_id: conversationId,
            phone: conversation.phone,
            phone_tail: conversation.phone
              ? phoneMetaTail(conversation.phone)
              : null,
            text_preview: text.slice(0, 120),
          },
        });
      } else {
        const { waType } = classifyConversationUpload(
          file.mimetype,
          file.buffer.length,
        );
        await this.auditLog.write({
          event_type: AuditEvent.CONVERSATION_REPLY,
          message: `Respuesta WhatsApp (${waType}) en conversación ${conversationId}`,
          actor: auditActor(user),
          meta: {
            conversation_id: conversationId,
            phone: conversation.phone,
            phone_tail: conversation.phone
              ? phoneMetaTail(conversation.phone)
              : null,
            media_type: waType,
            filename: String(file.originalname || '').slice(0, 200),
            has_caption: Boolean(text),
          },
        });
      }

      return { messages: createdMessages };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      const message =
        error instanceof Error ? error.message : 'No se pudo enviar';
      if (
        message.includes('no permitido') ||
        message.includes('demasiado grande') ||
        message.includes('vacío')
      ) {
        throw new BadRequestException(message);
      }
      throw new InternalServerErrorException(`No se pudo enviar: ${message}`);
    }
  }

  async reactToMessage(
    user: AuthUser,
    conversationId: number,
    messageId: number,
    emoji: string,
  ): Promise<MessageReactionResult> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id de conversacion invalido');
    }
    if (!Number.isInteger(messageId) || messageId <= 0) {
      throw new BadRequestException('Id de mensaje invalido');
    }
    const safeEmoji = String(emoji || '').trim();
    if (!safeEmoji) {
      throw new BadRequestException('Emoji requerido');
    }

    const area = user.area;
    const conversation = await this.prisma.conversations.findFirst({
      where: this.conversationLookup(area, conversationId),
    });
    if (!conversation) {
      throw new NotFoundException('Conversacion no encontrada');
    }
    await this.assertCanReply(conversation, area);

    const row = await this.prisma.chat_messages.findFirst({
      where: {
        id: messageId,
        conversation_id: conversation.id,
        conversations: this.conversationLookup(area, conversation.id),
      },
      select: { wa_message_id: true, raw_payload: true },
    });
    if (!row) {
      throw new NotFoundException('Mensaje no encontrado');
    }
    if (!row.wa_message_id) {
      throw new BadRequestException(
        'Este mensaje no tiene ID de WhatsApp para reaccionar',
      );
    }

    const linePhoneNumberId =
      readRoutingPhoneNumberId(row.raw_payload) ||
      String(conversation.whatsapp_phone_number_id || '').trim() ||
      undefined;

    try {
      await sendMessageReaction({
        to: conversationRecipient(conversation),
        waMessageId: String(row.wa_message_id),
        emoji: safeEmoji,
        area,
        phoneNumberId: linePhoneNumberId,
      });
      await this.auditLog.write({
        event_type: AuditEvent.CONVERSATION_REPLY,
        message: `Reacción ${safeEmoji} en conversación ${conversationId}, mensaje ${messageId}`,
        actor: auditActor(user),
        meta: {
          conversation_id: conversationId,
          message_id: messageId,
          emoji: safeEmoji,
        },
      });
      const reaction = await this.applyMessageReaction(
        messageId,
        conversationId,
        area,
        safeEmoji,
        'outbound',
      );
      return {
        ok: true,
        target_message_id: messageId,
        reaction,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No se pudo reaccionar';
      throw new InternalServerErrorException(message);
    }
  }

  async updateMode(
    user: AuthUser,
    conversationId: number,
    status: 'bot' | 'human',
  ): Promise<UpdateConversationModeResult> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id invalido');
    }
    const area = user.area;
    if (status === 'bot') {
      const enabled = await this.loadAiAreaEnabled(area);
      if (!enabled) {
        throw new BadRequestException('IA desactivada para el área');
      }
    }
    const updated = await this.prisma.conversations.updateMany({
      where: this.conversationLookup(area, conversationId),
      data: { status, updated_at: new Date() },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Conversacion no encontrada');
    }
    await this.auditLog.write({
      event_type: AuditEvent.CONVERSATION_MODE,
      message: `Modo de conversación ${conversationId} → ${status}`,
      actor: auditActor(user),
      meta: { conversation_id: conversationId, new_status: status },
    });
    return { status };
  }

  async markUnread(
    user: AuthUser,
    conversationId: number,
  ): Promise<{ ok: true }> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id invalido');
    }
    const area = user.area;
    const updated = await this.prisma.conversations.updateMany({
      where: this.conversationLookup(area, conversationId),
      data: { inbox_unread: true, updated_at: new Date() },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Conversacion no encontrada');
    }
    await this.auditLog.write({
      event_type: AuditEvent.CONVERSATION_MARK_UNREAD,
      message: `Conversación ${conversationId} marcada como no leída`,
      actor: auditActor(user),
      meta: { conversation_id: conversationId },
    });
    return { ok: true };
  }

  async setArchived(
    user: AuthUser,
    conversationId: number,
    archived: boolean,
  ): Promise<ArchiveConversationResult> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id invalido');
    }
    if (typeof archived !== 'boolean') {
      throw new BadRequestException('archived debe ser boolean');
    }
    const area = user.area;
    const conversation = await this.prisma.conversations.findFirst({
      where: this.conversationLookup(area, conversationId),
      select: { id: true, last_user_message_at: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversacion no encontrada');
    }
    if (!archived && conversation.last_user_message_at == null) {
      // Sin inbound sigue en Archivados por regla automática; el flag ya es false.
      return { archived: false };
    }
    const updated = await this.prisma.conversations.updateMany({
      where: this.conversationLookup(area, conversationId),
      data: { archived, updated_at: new Date() },
    });
    if (updated.count === 0) {
      throw new NotFoundException('Conversacion no encontrada');
    }
    await this.auditLog.write({
      event_type: AuditEvent.CONVERSATION_ARCHIVE,
      message: archived
        ? `Conversación ${conversationId} archivada`
        : `Conversación ${conversationId} desarchivada`,
      actor: auditActor(user),
      meta: { conversation_id: conversationId, archived },
    });
    return { archived };
  }

  async setLeadScore(
    user: AuthUser,
    conversationId: number,
    clear: boolean,
    scoreInput?: string,
  ): Promise<{ lead_score: number | null }> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id invalido');
    }
    const area = user.area;
    let score: number | null = null;
    if (!clear) {
      const n = parseInt(String(scoreInput ?? '').trim(), 10);
      if (!isValidLeadScore(n)) {
        throw new BadRequestException(
          'Calificacion invalida (Bajo, Medio o Alto)',
        );
      }
      score = n;
    }
    const conv = await this.prisma.conversations.findFirst({
      where: this.conversationLookup(area, conversationId),
      select: { contact_id: true },
    });
    if (!conv) {
      throw new NotFoundException('Conversacion no encontrada');
    }
    if (!conv.contact_id) {
      throw new BadRequestException(
        'No hay contacto vinculado; crea o vincula el contacto para poder calificar el lead.',
      );
    }
    await this.prisma.contacts.updateMany({
      where: { id: conv.contact_id, area },
      data: { lead_score: clear ? null : score, updated_at: new Date() },
    });
    if (['educacion', 'educacion_ca', 'educacion_ep'].includes(area)) {
      const cycle = await this.prisma.education_lead_cycles.findFirst({
        where: { contact_id: conv.contact_id, area },
        orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (cycle)
        await this.prisma.education_lead_cycles.update({
          where: { id: cycle.id },
          data: { lead_score: clear ? null : score, updated_at: new Date() },
        });
    }
    await this.auditLog.write({
      event_type: AuditEvent.CONTACT_LEAD_SCORE,
      message: clear
        ? `Lead score borrado (conversación ${conversationId})`
        : `Lead score ${formatLeadScoreLabel(score)} (conversación ${conversationId})`,
      actor: auditActor(user),
      meta: {
        conversation_id: conversationId,
        contact_id: conv.contact_id,
        cleared: clear,
        score: clear ? null : score,
      },
    });
    return { lead_score: clear ? null : score };
  }

  async getUpdates(
    user: AuthUser,
    conversationId: number,
    afterMessageId: number,
    afterAuditId = BigInt(0),
    visibleFromId = 0,
  ): Promise<InboxConversationUpdates> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id de conversacion invalido');
    }
    const area = user.area;
    const conversation = await this.prisma.conversations.findFirst({
      where: this.conversationLookup(area, conversationId),
      include: {
        assigned_user: {
          select: { first_name: true, last_name: true, email: true },
        },
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversacion no encontrada');
    }

    const safeAfterId =
      Number.isInteger(afterMessageId) && afterMessageId > 0
        ? afterMessageId
        : 0;

    const visibleFrom =
      Number.isSafeInteger(visibleFromId) && visibleFromId > 0
        ? visibleFromId
        : safeAfterId;
    const firstVisible = visibleFrom
      ? await this.prisma.chat_messages.findFirst({
          where: { conversation_id: conversationId, id: visibleFrom },
          select: { created_at: true },
        })
      : null;
    const fetched = await this.prisma.chat_messages.findMany({
      where: {
        conversation_id: conversationId,
        NOT: { message_type: { equals: 'reaction', mode: 'insensitive' } },
        ...(safeAfterId > 0 ? { id: { gt: safeAfterId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: INBOX_DETAIL_MESSAGE_PAGE_SIZE + 1,
      select: {
        id: true,
        direction: true,
        body_text: true,
        message_type: true,
        created_at: true,
        is_ai: true,
        raw_payload: true,
      },
    });
    const messageRows = fetched.slice(0, INBOX_DETAIL_MESSAGE_PAGE_SIZE);
    const [messageReactions, messageDeliveries] = await Promise.all([
      this.loadMessageReactions(conversationId, visibleFrom),
      this.loadMessageDeliveries(conversationId, visibleFrom),
    ]);

    if (messageRows.length > 0) {
      await this.clearInboxUnreadOnOpen(user, conversationId, area);
    }

    const aiAreaEnabled = await this.loadAiAreaEnabled(area);
    const windowOpen = isWithinUserServiceWindow(
      conversation.last_user_message_at,
    );
    const status = String(conversation.status ?? '')
      .trim()
      .toLowerCase();
    const botModeBlock = aiAreaEnabled && status === 'bot';
    let replyBlockedReason: InboxConversationUpdates['reply_blocked_reason'] =
      null;
    if (!windowOpen) replyBlockedReason = '24h';
    else if (botModeBlock) replyBlockedReason = 'bot_mode';

    const assignedUserLabel = conversation.assigned_user
      ? formatAdvisorLabel(conversation.assigned_user)
      : null;

    const [messages, events] = await Promise.all([
      this.enrichMessagesSenderFromAudit(
        area,
        conversationId,
        await this.mapMessageRowsWithReplyTo(conversationId, messageRows),
      ),
      this.loadConversationTimelineEvents(
        area,
        conversationId,
        conversation.contact_id,
        afterAuditId,
        { from: firstVisible?.created_at ?? messageRows[0]?.created_at },
      ),
    ]);

    return {
      messages,
      has_newer_messages: fetched.length > INBOX_DETAIL_MESSAGE_PAGE_SIZE,
      message_reactions: messageReactions,
      message_deliveries: messageDeliveries,
      events,
      conversation: {
        last_message_at: conversation.last_message_at?.toISOString() ?? null,
        last_user_message_at:
          conversation.last_user_message_at?.toISOString() ?? null,
        status: conversation.status,
        inbox_unread:
          messageRows.length > 0 ? false : conversation.inbox_unread,
        archived: Boolean(conversation.archived),
        assigned_user_id: conversation.assigned_user_id,
        assigned_user_label: assignedUserLabel,
        automation_touched_at:
          conversation.automation_touched_at?.toISOString() ?? null,
      },
      can_reply: windowOpen && !botModeBlock,
      reply_blocked_reason: replyBlockedReason,
      user_service_window_open: windowOpen,
    };
  }

  async exportConversation(
    user: AuthUser,
    conversationId: number,
  ): Promise<{ buffer: Buffer; filename: string }> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id de conversacion invalido');
    }
    const area = user.area;
    const conversation = await this.prisma.conversations.findFirst({
      where: this.conversationLookup(area, conversationId),
      select: { id: true, phone: true },
    });
    if (!conversation) {
      throw new NotFoundException('Conversacion no encontrada');
    }

    const messageRows = await this.prisma.chat_messages.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
      select: {
        direction: true,
        body_text: true,
        message_type: true,
        created_at: true,
        raw_payload: true,
      },
    });

    const rows = buildConversationExportRows(messageRows);
    const buffer = buildConversationXlsxBuffer(rows);
    await this.auditLog.write({
      event_type: AuditEvent.CONVERSATION_EXPORT,
      message: `Exportación de conversación ${conversationId}`,
      actor: auditActor(user),
      meta: {
        conversation_id: conversationId,
        phone: conversation.phone,
        phone_tail: conversation.phone
          ? phoneMetaTail(conversation.phone)
          : null,
        message_count: messageRows.length,
      },
    });
    return {
      buffer,
      filename: conversationExportFilename(
        conversation.phone || 'numero-privado',
        conversation.id,
      ),
    };
  }

  async downloadMessageMedia(
    user: AuthUser,
    conversationId: number,
    messageId: number,
    res: import('express').Response,
  ): Promise<void> {
    if (
      !Number.isInteger(conversationId) ||
      conversationId <= 0 ||
      !Number.isInteger(messageId) ||
      messageId <= 0
    ) {
      throw new BadRequestException('Parámetros inválidos');
    }

    const conversation = await this.prisma.conversations.findFirst({
      where: this.conversationLookup(user.area, conversationId),
      select: {
        id: true,
        area: true,
        whatsapp_phone_number_id: true,
      },
    });
    if (!conversation) {
      throw new NotFoundException('Conversacion no encontrada');
    }

    const row = await this.prisma.chat_messages.findFirst({
      where: {
        id: messageId,
        conversation_id: conversation.id,
      },
      select: {
        direction: true,
        message_type: true,
        raw_payload: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Mensaje no encontrado');
    }

    let localPreview = getLocalPreview(row.raw_payload);
    let rawPayload: unknown = row.raw_payload;
    if (!localPreview) {
      const ref = extractStoredMediaDownloadRef(row.raw_payload);
      if (!ref) {
        throw new NotFoundException(
          'Este mensaje no tiene archivo descargable guardado',
        );
      }
      const phoneNumberId =
        ref.phoneNumberId ||
        String(conversation.whatsapp_phone_number_id || '').trim() ||
        null;
      try {
        const fetched = await downloadWhatsAppMediaBuffer({
          mediaId: ref.mediaId,
          area: conversation.area,
          phoneNumberId,
        });
        localPreview = await saveChatMediaFromBuffer({
          buffer: fetched.buffer,
          conversationId: conversation.id,
          mimeType: fetched.mimeType,
          direction: row.direction === 'outbound' ? 'outbound' : 'inbound',
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'No se pudo descargar el archivo';
        throw new BadRequestException(message);
      }
      const nextPayload = withLocalPreview(row.raw_payload, localPreview);
      await this.prisma.chat_messages.update({
        where: { id: messageId },
        data: { raw_payload: nextPayload as PrismaTypes.InputJsonValue },
      });
      rawPayload = nextPayload;
    }

    await streamMessageMediaDownload(res, {
      localPreview,
      rawPayload,
      messageType: row.message_type,
    });
    await this.auditLog.write({
      event_type: AuditEvent.CONVERSATION_MEDIA_DOWNLOAD,
      message: `Descarga de media en conversación ${conversationId}, mensaje ${messageId}`,
      actor: auditActor(user),
      meta: {
        conversation_id: conversationId,
        message_id: messageId,
        message_type: row.message_type,
      },
    });
  }

  async getServiceReplyEstimate(
    user: AuthUser,
    rawCategory?: string | string[],
  ): Promise<{
    monthLabel: string;
    lines: Array<{
      id: number;
      label: string;
      replyCount: number;
      freeAllowance: number;
      billableCount: number;
      usdAmount: number;
      penAmount: number;
    }>;
  }> {
    const { start, end, label } = limaCalendarMonth(new Date());
    const categoryOptions = await this.listEducationCategories(user);
    const categories = this.selectedEducationCategories(
      user.area,
      categoryOptions,
      rawCategory,
    );
    if (!categories) {
      const [row] = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS n
        FROM chat_messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE ${conversationAreaPredicate('c', user.area)}
          AND ${deliveredServiceReplySql('m', start, end)}
      `);
      return {
        monthLabel: label,
        lines: [{ id: 0, label: '', ...estimateServiceReplyOverage(row?.n ?? 0, start) }],
      };
    }

    const access = restrictedAccess();
    const lineIds = access ? (access.lineIds.length ? access.lineIds : [-1]) : null;
    const rows = await this.prisma.$queryRaw<ServiceReplyLineRow[]>(Prisma.sql`
      SELECT
        l.id AS id,
        l.active AS active,
        l.is_default AS is_default,
        COALESCE(NULLIF(BTRIM(p.slug), ''), NULLIF(BTRIM(l.program_key), ''), 'general') AS category,
        NULLIF(BTRIM(l.label), '') AS line_label,
        NULLIF(BTRIM(l.display_phone_number), '') AS phone,
        COUNT(m.id)::int AS n
      FROM whatsapp_lines l
      LEFT JOIN business_programs p ON p.id = l.program_id
      LEFT JOIN conversations c ON c.whatsapp_line_id = l.id
        AND ${inboxConversationPredicate('c', user.area, categories)}
      LEFT JOIN chat_messages m ON m.conversation_id = c.id
        AND ${deliveredServiceReplySql('m', start, end)}
      WHERE ${lineCategoryPredicate('l', categories)}
        AND ${lineIds ? Prisma.sql`l.id IN (${Prisma.join(lineIds)})` : Prisma.sql`TRUE`}
        AND EXISTS (
          SELECT 1 FROM business_areas line_ba
          WHERE line_ba.id = l.business_area_id
            AND line_ba.slug = 'educacion'
        )
      GROUP BY l.id, l.active, l.is_default, p.slug, l.program_key, l.label, l.display_phone_number
    `);
    const unassigned = await this.prisma.$queryRaw<{ category: string; n: number }[]>(Prisma.sql`
      SELECT
        CASE
          WHEN c.area LIKE 'educacion_%' THEN substring(c.area from 11)
          ELSE 'general'
        END AS category,
        COUNT(*)::int AS n
      FROM chat_messages m
      INNER JOIN conversations c ON c.id = m.conversation_id
      WHERE ${inboxConversationPredicate('c', user.area, categories)}
        AND c.whatsapp_line_id IS NULL
        AND ${deliveredServiceReplySql('m', start, end)}
      GROUP BY 1
    `);
    const lines = rows.map((row) => ({
      id: Number(row.id),
      active: Boolean(row.active),
      isDefault: Boolean(row.is_default),
      category: String(row.category || 'general'),
      lineLabel: row.line_label,
      phone: row.phone,
      n: Number(row.n) || 0,
    }));
    for (const bucket of unassigned) {
      const n = Number(bucket.n) || 0;
      if (n <= 0) continue;
      const category = String(bucket.category || 'general');
      const matches = lines.filter((line) => line.category === category);
      const target = matches.find((line) => line.isDefault) ?? matches[0];
      if (target) {
        target.n += n;
        continue;
      }
      lines.push({
        id: 0,
        active: true,
        isDefault: false,
        category,
        lineLabel: null,
        phone: null,
        n,
      });
    }
    const visible = lines.filter((line) => line.active || line.n > 0);
    const order = new Map(categoryOptions.map((item, index) => [item.slug, index]));
    visible.sort((left, right) => {
      const byCategory = (order.get(left.category) ?? 99) - (order.get(right.category) ?? 99);
      if (byCategory !== 0) return byCategory;
      if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
      return (left.lineLabel ?? '').localeCompare(right.lineLabel ?? '', 'es');
    });
    const siblings = new Map<string, number>();
    for (const line of visible) siblings.set(line.category, (siblings.get(line.category) ?? 0) + 1);
    return {
      monthLabel: label,
      lines: visible.map((line) => {
        const option = categoryOptions.find((item) => item.slug === line.category);
        const name = option?.label || (line.category === 'general' ? 'General' : line.category.toUpperCase());
        const extra = (line.phone || line.lineLabel || '').trim();
        const several = (siblings.get(line.category) ?? 1) > 1;
        return {
          id: line.id,
          label: several && extra ? `${name} · ${extra}` : name,
          ...estimateServiceReplyOverage(line.n, start),
        };
      }),
    };
  }
}

type ServiceReplyLineRow = {
  id: number;
  active: boolean;
  is_default: boolean;
  category: string;
  line_label: string | null;
  phone: string | null;
  n: number;
};

function deliveredServiceReplySql(messageAlias: string, start: Date, end: Date): Prisma.Sql {
  if (!/^[a-z_]+$/.test(messageAlias)) return Prisma.sql`FALSE`;
  const message = Prisma.raw(messageAlias);
  return Prisma.sql`
    ${message}.direction = 'outbound'
    AND ${message}.message_type <> 'campaign'
    AND LOWER(COALESCE(${message}.raw_payload->'delivery_status'->>'status', '')) IN ('delivered', 'read')
    AND ${message}.created_at >= ${start}
    AND ${message}.created_at < ${end}
  `;
}

const LIMA_MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

function limaCalendarMonth(now: Date): {
  start: Date;
  end: Date;
  label: string;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const start = new Date(Date.UTC(year, month - 1, 1, 5, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 5, 0, 0));
  return { start, end, label: LIMA_MONTHS[month - 1] ?? '' };
}
