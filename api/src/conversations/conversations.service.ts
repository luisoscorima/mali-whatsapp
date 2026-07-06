import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { AuditEvent } from '../audit/audit-events';
import { auditActor, phoneMetaTail } from '../audit/audit-actor.util';
import { AuditLogService } from '../audit/audit-log.service';
import { isWithinUserServiceWindow } from '../campaigns/campaign-conversation-window.util';
import {
  escapeForLikePattern,
  parseSegmentListFilter,
} from '../contacts/contacts-filter.utils';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_SESSION_TEXT_LEN } from '../settings/business-hours.util';
import { parseAiConfigValue } from '../settings/ai-config.util';
import {
  sanitizeApiResponse,
  sanitizeMediaOutboundPayload,
} from './api-sanitize.util';
import {
  classifyConversationUpload,
  MEDIA_TYPE_LABEL,
  sendSessionMediaMessage,
  sendSessionTextMessage,
  uploadMediaToWhatsApp,
} from './conversation-whatsapp.util';
import {
  buildConversationExportRows,
  buildConversationXlsxBuffer,
  conversationExportFilename,
} from './conversation-export.util';
import {
  getLocalPreview,
  hasDownloadableMedia,
  saveOutboundChatMediaFile,
  streamMessageMediaDownload,
} from './chat-media.util';
import {
  buildContactSegmentSql,
  buildConversationSegmentSql,
  parseInboxChatFilter,
  parseSegmentQueryParam,
} from './inbox-query.util';
import type {
  EnsureConversationResult,
  InboxDetail,
  InboxListItem,
  InboxListResult,
  InboxMessage,
  ReplyResult,
  UpdateConversationModeResult,
  InboxConversationUpdates,
} from './conversations.types';

type InboxRow = {
  id: number;
  phone: string;
  last_message_at: Date | null;
  inbox_unread: boolean;
  conversation_status: string | null;
  contact_lead_score: number | null;
  contact_name: string | null;
  contact_segment_slugs: string[];
  preview: string | null;
  conversation_tags: string[];
};

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async getSegmentSlugSet(area: string): Promise<Set<string>> {
    const rows = await this.prisma.segment_definitions.findMany({
      where: { area },
      select: { slug: true },
    });
    return new Set(rows.map((row) => row.slug));
  }

  private async loadAiAreaEnabled(area: string): Promise<boolean> {
    const row = await this.prisma.app_settings.findFirst({
      where: { area, key: 'ai_config' },
      select: { value: true },
    });
    const cfg = parseAiConfigValue(row?.value);
    return Boolean(cfg?.enabled);
  }

  private async loadSegmentOptions(area: string) {
    return this.prisma.segment_definitions.findMany({
      where: { area },
      orderBy: [{ sort_order: 'asc' }, { slug: 'asc' }],
      select: { slug: true, label: true, color_key: true },
    });
  }

  private mapListRow(row: InboxRow): InboxListItem {
    const id = Number(row.id);
    return {
      id,
      phone: row.phone,
      last_message_at: row.last_message_at
        ? row.last_message_at.toISOString()
        : null,
      inbox_unread: Boolean(row.inbox_unread),
      conversation_status: row.conversation_status,
      contact_name: String(row.contact_name ?? '').trim(),
      contact_lead_score: row.contact_lead_score,
      contact_segment_slugs: row.contact_segment_slugs ?? [],
      preview: String(row.preview ?? '').trim(),
      conversation_tags: row.conversation_tags ?? [],
      is_virtual: id < 0,
      contact_id: id < 0 ? -id : null,
    };
  }

  private buildInboxSearchSql(searchQ: string): Prisma.Sql {
    const searchPat = `%${escapeForLikePattern(searchQ)}%`;
    const digitsOnly = searchQ.replace(/\D/g, '');
    if (digitsOnly) {
      const digitsPat = `%${digitsOnly}%`;
      return Prisma.sql` AND (
        EXISTS (
          SELECT 1 FROM chat_messages m
          WHERE m.conversation_id = c.id
          AND m.body_text ILIKE ${searchPat} ESCAPE '!'
        )
        OR COALESCE(ct.name, '') ILIKE ${searchPat} ESCAPE '!'
        OR COALESCE(ct.phone, '') ILIKE ${searchPat} ESCAPE '!'
        OR COALESCE(c.phone, '') ILIKE ${searchPat} ESCAPE '!'
        OR regexp_replace(COALESCE(ct.phone, ''), '\\D', '', 'g') LIKE ${digitsPat}
        OR regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE ${digitsPat}
      )`;
    }
    return Prisma.sql` AND (
      EXISTS (
        SELECT 1 FROM chat_messages m
        WHERE m.conversation_id = c.id
        AND m.body_text ILIKE ${searchPat} ESCAPE '!'
      )
      OR COALESCE(ct.name, '') ILIKE ${searchPat} ESCAPE '!'
      OR COALESCE(ct.phone, '') ILIKE ${searchPat} ESCAPE '!'
      OR COALESCE(c.phone, '') ILIKE ${searchPat} ESCAPE '!'
    )`;
  }

  private buildChatFilterSql(chat: ReturnType<typeof parseInboxChatFilter>): Prisma.Sql {
    if (chat === 'unread') return Prisma.sql` AND c.inbox_unread = TRUE`;
    if (chat === 'bot') {
      return Prisma.sql` AND LOWER(TRIM(COALESCE(c.status, ''))) = 'bot'`;
    }
    if (chat === 'human') {
      return Prisma.sql` AND LOWER(TRIM(COALESCE(c.status, ''))) = 'human'`;
    }
    return Prisma.empty;
  }

  private async fetchInboxConversations(
    area: string,
    segmentFilter: ReturnType<typeof parseSegmentListFilter>,
    searchQ: string,
    chatFilter: ReturnType<typeof parseInboxChatFilter>,
  ): Promise<InboxRow[]> {
    const segmentSql = buildConversationSegmentSql(segmentFilter);
    const searchSql = searchQ ? this.buildInboxSearchSql(searchQ) : Prisma.empty;
    const chatSql = this.buildChatFilterSql(chatFilter);

    const rows = await this.prisma.$queryRaw<InboxRow[]>(Prisma.sql`
      SELECT
        c.id,
        c.phone,
        c.last_message_at,
        c.inbox_unread,
        c.status AS conversation_status,
        ct.lead_score AS contact_lead_score,
        COALESCE(
          ct.name,
          (
            SELECT ct_alt.name
            FROM contacts ct_alt
            WHERE ct_alt.phone = c.phone AND (ct.id IS NULL OR ct_alt.id <> ct.id)
            ORDER BY ct_alt.updated_at DESC NULLS LAST
            LIMIT 1
          )
        ) AS contact_name,
        COALESCE((
          SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
          FROM contact_segments cs
          JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
          WHERE cs.contact_id = ct.id
        ), ARRAY[]::varchar[]) AS contact_segment_slugs,
        (SELECT m.body_text FROM chat_messages m
         WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC
         LIMIT 1) AS preview,
        COALESCE((
          SELECT array_agg(tg.label ORDER BY tg.label)
          FROM conversation_tags tg
          WHERE tg.conversation_id = c.id
        ), ARRAY[]::varchar[]) AS conversation_tags
      FROM conversations c
      LEFT JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.area = ${area}
      ${segmentSql}
      ${searchSql}
      ${chatSql}
      ORDER BY c.last_message_at DESC
      LIMIT 200
    `);

    if (!searchQ || chatFilter !== 'all') {
      return rows;
    }

    const contactSegmentSql = buildContactSegmentSql(segmentFilter);
    const contactPat = `%${escapeForLikePattern(searchQ)}%`;
    const contactDigits = searchQ.replace(/\D/g, '');
    const contactSearchSql = contactDigits
      ? Prisma.sql` AND (
          COALESCE(ct.name, '') ILIKE ${contactPat} ESCAPE '!'
          OR COALESCE(ct.phone, '') ILIKE ${contactPat} ESCAPE '!'
          OR regexp_replace(COALESCE(ct.phone, ''), '\\D', '', 'g') LIKE ${`%${contactDigits}%`}
        )`
      : Prisma.sql` AND (
          COALESCE(ct.name, '') ILIKE ${contactPat} ESCAPE '!'
          OR COALESCE(ct.phone, '') ILIKE ${contactPat} ESCAPE '!'
        )`;

    const virtualRows = await this.prisma.$queryRaw<InboxRow[]>(Prisma.sql`
      SELECT
        (-ct.id) AS id,
        ct.phone,
        NULL::timestamptz AS last_message_at,
        FALSE AS inbox_unread,
        NULL::text AS conversation_status,
        ct.lead_score AS contact_lead_score,
        ct.name AS contact_name,
        COALESCE((
          SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
          FROM contact_segments cs
          JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
          WHERE cs.contact_id = ct.id
        ), ARRAY[]::varchar[]) AS contact_segment_slugs,
        ''::text AS preview,
        ARRAY[]::varchar[] AS conversation_tags
      FROM contacts ct
      WHERE ct.area = ${area}
      ${contactSegmentSql}
      ${contactSearchSql}
      AND NOT EXISTS (
        SELECT 1
        FROM conversations c
        WHERE c.area = ${area} AND (c.contact_id = ct.id OR c.phone = ct.phone)
      )
      ORDER BY ct.updated_at DESC, ct.id DESC
      LIMIT 50
    `);

    return rows.concat(virtualRows);
  }

  private async countInboxUnread(
    area: string,
    segmentFilter: ReturnType<typeof parseSegmentListFilter>,
  ): Promise<number> {
    const segmentSql = buildConversationSegmentSql(segmentFilter);
    const rows = await this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS n
      FROM conversations c
      LEFT JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.area = ${area} AND c.inbox_unread = TRUE
      ${segmentSql}
    `);
    return rows[0]?.n ?? 0;
  }

  async list(
    user: AuthUser,
    query: Record<string, string | string[] | undefined>,
  ): Promise<InboxListResult> {
    const area = user.area;
    const searchQ = String(query.q ?? '').trim();
    const chat = parseInboxChatFilter(
      Array.isArray(query.chat) ? query.chat[0] : query.chat,
    );
    const segmentRaw = parseSegmentQueryParam(query.segment);
    const slugSet = await this.getSegmentSlugSet(area);
    const segmentFilter = parseSegmentListFilter(segmentRaw, slugSet);

    const [segments, listRows, aiAreaEnabled, unreadCount] = await Promise.all([
      this.loadSegmentOptions(area),
      this.fetchInboxConversations(area, segmentFilter, searchQ, chat),
      this.loadAiAreaEnabled(area),
      this.countInboxUnread(area, segmentFilter),
    ]);

    return {
      items: listRows.map((row) => this.mapListRow(row)),
      unread_count: unreadCount,
      ai_area_enabled: aiAreaEnabled,
      segments,
      filters: {
        q: searchQ,
        chat,
        segment_slugs: segmentFilter.slugs,
        include_none: segmentFilter.includeNone,
      },
    };
  }

  async getDetail(user: AuthUser, conversationId: number): Promise<InboxDetail> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id de conversacion invalido');
    }
    const area = user.area;

    const conversation = await this.prisma.conversations.findFirst({
      where: { id: conversationId, area },
    });
    if (!conversation) {
      throw new NotFoundException('Conversacion no encontrada');
    }

    const [tags, metaAd, aiAreaEnabled] = await Promise.all([
      this.prisma.conversation_tags.findMany({
        where: { conversation_id: conversationId },
        orderBy: { label: 'asc' },
        select: { label: true },
      }),
      conversation.meta_ctwa_ad_id
        ? this.prisma.meta_ctwa_ads.findFirst({
            where: { id: conversation.meta_ctwa_ad_id, area },
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

    await this.prisma.conversations.updateMany({
      where: { id: conversationId, area },
      data: {
        inbox_unread: false,
        outside_hours_notice_sent_at: null,
        updated_at: new Date(),
      },
    });

    let contact: InboxDetail['contact'] = null;
    if (conversation.contact_id) {
      const rows = await this.prisma.$queryRaw<
        {
          name: string | null;
          phone: string;
          lead_score: number | null;
          segment_slugs: string[];
        }[]
      >(Prisma.sql`
        SELECT
          c.name,
          c.phone,
          c.lead_score,
          COALESCE((
            SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
            FROM contact_segments cs
            JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
            WHERE cs.contact_id = c.id
          ), ARRAY[]::varchar[]) AS segment_slugs
        FROM contacts c
        WHERE c.id = ${conversation.contact_id}
      `);
      contact = rows[0] ?? null;
    } else if (conversation.phone) {
      const rows = await this.prisma.$queryRaw<
        {
          name: string | null;
          phone: string;
          lead_score: number | null;
          segment_slugs: string[];
        }[]
      >(Prisma.sql`
        SELECT
          c.name,
          c.phone,
          c.lead_score,
          COALESCE((
            SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
            FROM contact_segments cs
            JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
            WHERE cs.contact_id = c.id
          ), ARRAY[]::varchar[]) AS segment_slugs
        FROM contacts c
        WHERE c.phone = ${conversation.phone}
        ORDER BY CASE WHEN c.area = ${area} THEN 0 ELSE 1 END, c.updated_at DESC NULLS LAST
        LIMIT 1
      `);
      contact = rows[0] ?? null;
    }

    const messageRows = await this.prisma.chat_messages.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'asc' },
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

    const messages: InboxMessage[] = messageRows.map((row) =>
      this.mapMessageRow(row),
    );

    const windowOpen = isWithinUserServiceWindow(
      conversation.last_user_message_at,
    );
    const status = String(conversation.status ?? '').trim().toLowerCase();
    const botModeBlock = aiAreaEnabled && status === 'bot';
    let replyBlockedReason: InboxDetail['reply_blocked_reason'] = null;
    if (!windowOpen) replyBlockedReason = '24h';
    else if (botModeBlock) replyBlockedReason = 'bot_mode';

    return {
      conversation: {
        id: conversation.id,
        phone: conversation.phone,
        status: conversation.status,
        last_message_at: conversation.last_message_at?.toISOString() ?? null,
        last_user_message_at:
          conversation.last_user_message_at?.toISOString() ?? null,
        inbox_unread: false,
        contact_id: conversation.contact_id,
        meta_ctwa_ad_id: conversation.meta_ctwa_ad_id,
      },
      contact,
      meta_ad: metaAd,
      messages,
      tags: tags.map((row) => row.label),
      can_reply: windowOpen && !botModeBlock,
      reply_blocked_reason: replyBlockedReason,
      user_service_window_open: windowOpen,
      ai_area_enabled: aiAreaEnabled,
    };
  }

  async ensureFromContact(
    user: AuthUser,
    contactId: number,
  ): Promise<EnsureConversationResult> {
    if (!Number.isInteger(contactId) || contactId <= 0) {
      throw new BadRequestException('Id de contacto invalido');
    }
    const area = user.area;

    const contact = await this.prisma.contacts.findFirst({
      where: { id: contactId, area },
      select: { id: true, phone: true },
    });
    if (!contact) {
      throw new NotFoundException('Contacto no encontrado');
    }

    const existing = await this.prisma.conversations.findFirst({
      where: {
        area,
        OR: [{ contact_id: contactId }, { phone: contact.phone }],
      },
      orderBy: { id: 'asc' },
      select: { id: true, contact_id: true },
    });

    if (existing) {
      if (!existing.contact_id) {
        await this.prisma.conversations.update({
          where: { id: existing.id },
          data: { contact_id: contactId, updated_at: new Date() },
        });
      }
      return { id: existing.id };
    }

    const created = await this.prisma.conversations.create({
      data: {
        area,
        phone: contact.phone,
        contact_id: contactId,
        status: 'human',
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
    const st = String(conversation.status || '').trim().toLowerCase();
    if (aiEnabled && st === 'bot') {
      throw new BadRequestException(
        'Este chat está en modo Bot; cambia a Asesor para responder.',
      );
    }
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
    return {
      id: row.id,
      direction: row.direction,
      body_text: row.body_text,
      message_type: row.message_type,
      created_at: row.created_at.toISOString(),
      is_ai: row.is_ai,
      has_downloadable_media: hasDownloadableMedia(row.raw_payload),
    };
  }

  async reply(
    user: AuthUser,
    conversationId: number,
    messageText: string,
    file?: { buffer: Buffer; mimetype: string; originalname: string },
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
      where: { id: conversationId, area },
    });
    if (!conversation) {
      throw new NotFoundException('Conversacion no encontrada');
    }

    await this.assertCanReply(conversation, area);
    const linePhoneNumberId =
      String(conversation.whatsapp_phone_number_id || '').trim() || undefined;
    const createdMessages: InboxMessage[] = [];

    try {
      if (!file) {
        const apiResponse = await sendSessionTextMessage({
          to: conversation.phone,
          text,
          area,
          phoneNumberId: linePhoneNumberId,
        });
        const msgId = apiResponse.messages?.[0]?.id || null;
        const row = await this.prisma.chat_messages.create({
          data: {
            conversation_id: conversationId,
            direction: 'outbound',
            wa_message_id: msgId,
            body_text: text.slice(0, 8000),
            message_type: 'text',
            raw_payload: sanitizeApiResponse(apiResponse) as PrismaTypes.InputJsonValue,
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
            to: conversation.phone,
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
              raw_payload: sanitizeApiResponse(textResp) as PrismaTypes.InputJsonValue,
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
          to: conversation.phone,
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
            raw_payload: sanitizeMediaOutboundPayload(
              uploadResult.mediaId,
              sendResp,
              localPreview,
            ) as PrismaTypes.InputJsonValue,
            is_ai: false,
          },
        });
        createdMessages.push(this.mapMessageRow(mediaRow));
      }

      await this.prisma.conversations.update({
        where: { id: conversationId },
        data: { last_message_at: new Date(), updated_at: new Date() },
      });

      if (!file) {
        await this.auditLog.write({
          event_type: AuditEvent.CONVERSATION_REPLY,
          message: `Respuesta WhatsApp (texto) en conversación ${conversationId}`,
          actor: auditActor(user),
          meta: {
            conversation_id: conversationId,
            phone_tail: phoneMetaTail(conversation.phone),
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
            phone_tail: phoneMetaTail(conversation.phone),
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
      where: { id: conversationId, area },
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

  async markUnread(user: AuthUser, conversationId: number): Promise<{ ok: true }> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id invalido');
    }
    const area = user.area;
    const updated = await this.prisma.conversations.updateMany({
      where: { id: conversationId, area },
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
      if (!Number.isInteger(n) || n < 1 || n > 5) {
        throw new BadRequestException('Calificacion invalida (1 a 5)');
      }
      score = n;
    }
    const conv = await this.prisma.conversations.findFirst({
      where: { id: conversationId, area },
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
    await this.auditLog.write({
      event_type: AuditEvent.CONTACT_LEAD_SCORE,
      message: clear
        ? `Lead score borrado (conversación ${conversationId})`
        : `Lead score ${score}/5 (conversación ${conversationId})`,
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
  ): Promise<InboxConversationUpdates> {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new BadRequestException('Id de conversacion invalido');
    }
    const area = user.area;
    const conversation = await this.prisma.conversations.findFirst({
      where: { id: conversationId, area },
    });
    if (!conversation) {
      throw new NotFoundException('Conversacion no encontrada');
    }

    const safeAfterId =
      Number.isInteger(afterMessageId) && afterMessageId > 0 ? afterMessageId : 0;

    const messageRows = await this.prisma.chat_messages.findMany({
      where: {
        conversation_id: conversationId,
        ...(safeAfterId > 0 ? { id: { gt: safeAfterId } } : {}),
      },
      orderBy: { created_at: 'asc' },
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

    if (messageRows.length > 0) {
      await this.prisma.conversations.updateMany({
        where: { id: conversationId, area },
        data: {
          inbox_unread: false,
          outside_hours_notice_sent_at: null,
          updated_at: new Date(),
        },
      });
    }

    const aiAreaEnabled = await this.loadAiAreaEnabled(area);
    const windowOpen = isWithinUserServiceWindow(
      conversation.last_user_message_at,
    );
    const status = String(conversation.status ?? '').trim().toLowerCase();
    const botModeBlock = aiAreaEnabled && status === 'bot';
    let replyBlockedReason: InboxConversationUpdates['reply_blocked_reason'] =
      null;
    if (!windowOpen) replyBlockedReason = '24h';
    else if (botModeBlock) replyBlockedReason = 'bot_mode';

    return {
      messages: messageRows.map((row) => this.mapMessageRow(row)),
      conversation: {
        last_message_at: conversation.last_message_at?.toISOString() ?? null,
        last_user_message_at:
          conversation.last_user_message_at?.toISOString() ?? null,
        status: conversation.status,
        inbox_unread: messageRows.length > 0 ? false : conversation.inbox_unread,
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
      where: { id: conversationId, area },
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
        phone_tail: phoneMetaTail(conversation.phone),
        message_count: messageRows.length,
      },
    });
    return {
      buffer,
      filename: conversationExportFilename(conversation.phone, conversation.id),
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

    const row = await this.prisma.chat_messages.findFirst({
      where: {
        id: messageId,
        conversation_id: conversationId,
        conversations: { area: user.area },
      },
      select: {
        message_type: true,
        raw_payload: true,
      },
    });
    if (!row) {
      throw new NotFoundException('Mensaje no encontrado');
    }

    const localPreview = getLocalPreview(row.raw_payload);
    if (!localPreview) {
      throw new NotFoundException(
        'Este mensaje no tiene archivo descargable guardado',
      );
    }

    await streamMessageMediaDownload(res, {
      localPreview,
      rawPayload: row.raw_payload,
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
}
