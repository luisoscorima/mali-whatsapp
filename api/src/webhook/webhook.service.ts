import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import type { BusinessArea } from '../config/areas';
import { sanitizeApiResponse } from '../conversations/api-sanitize.util';
import { downloadWhatsAppMediaBuffer, sendSessionTextMessage } from '../conversations/conversation-whatsapp.util';
import { saveInboundChatMediaFromBuffer } from '../conversations/chat-media.util';
import {
  E164_NO_PLUS_REGEX,
  normalizePhone,
} from '../contacts/contacts-validation.utils';
import { PrismaService } from '../prisma/prisma.service';
import {
  isBusinessHoursConfigOperational,
  isWithinBusinessHours,
  parseBusinessHoursConfig,
} from '../settings/business-hours.util';
import { parseAiConfigValue } from '../settings/ai-config.util';
import { getWhatsAppCredentialsForArea } from '../templates/whatsapp-meta.util';
import { processInboundReferral } from './meta-ctwa-referral.util';
import { resolveInboundArea } from './webhook-area.util';
import {
  extractInboundMessagePreview,
  extractInboundMediaRef,
  resolveInboundLinePhoneNumberId,
} from './webhook-inbound.util';
import {
  extractInboundReaction,
  setMessageReaction,
} from '../conversations/chat-reaction.util';
import {
  getAiResponse,
  TRANSFER_TO_HUMAN_NOTICE,
  UNAVAILABLE_REPLY_MESSAGE,
} from './ai-response.util';
import type {
  MetaWebhookBody,
  MetaWebhookChangeValue,
} from './webhook.types';
import {
  readVerifyToken,
  verifyWebhookSignature,
} from './webhook-verify.util';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  handleVerification(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
    res: Response,
  ): void {
    const expected = readVerifyToken();
    this.logger.log(
      `Webhook GET verificacion (mode=${mode || 'n/a'}, hasExpected=${Boolean(expected)})`,
    );
    if (mode === 'subscribe' && expected && token === expected && challenge) {
      res.status(200).send(challenge);
      return;
    }
    res.sendStatus(403);
  }

  async handlePost(req: Request, body: MetaWebhookBody): Promise<void> {
    this.logger.log(
      `Webhook POST (object=${body?.object || 'n/a'}, entries=${body?.entry?.length ?? 0})`,
    );

    if (!verifyWebhookSignature(req)) {
      this.logger.warn('Webhook POST: firma invalida o APP_SECRET ausente');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const webhookDebug =
      String(process.env.WEBHOOK_DEBUG || '').trim().toLowerCase() === 'true';
    const entries = body.entry ?? [];

    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        if (change.field === 'message_template_status_update') {
          await this.handleTemplateStatusUpdate(change.value, entry.id);
          continue;
        }

        const value = change.value ?? {};
        if (webhookDebug) {
          this.logger.log(
            `Webhook DEBUG field=${change.field || 'n/a'} messages=${value.messages?.length ?? 0} statuses=${value.statuses?.length ?? 0}`,
          );
        }

        const inboundCount = Array.isArray(value.messages) ? value.messages.length : 0;
        if (inboundCount > 0) {
          this.logger.log(
            `Webhook inbound: ${inboundCount} mensaje(s), phone_number_id=${value.metadata?.phone_number_id ?? 'n/a'}`,
          );
        }

        await this.persistInboundMessages(value, {
          wabaEntryId: entry.id,
          field: change.field,
        });

        for (const status of value.statuses ?? []) {
          await this.applyDeliveryStatus(status);
        }
      }
    }

    this.logger.log(`Webhook POST procesado (${entries.length} entries)`);
  }

  private async handleTemplateStatusUpdate(
    value: MetaWebhookChangeValue | undefined,
    wabaEntryId: string | undefined,
  ): Promise<void> {
    const templateName = String(
      value?.message_template_name || value?.name || '',
    ).trim();
    const templateLanguage = String(
      value?.message_template_language || value?.language || '',
    ).trim();
    const event = String(value?.event || value?.message_template_status || '')
      .trim()
      .toUpperCase();
    const reason = value?.reason || value?.rejection_reason || null;
    if (!templateName || !event) return;

    const { area } = resolveInboundArea(value, wabaEntryId);
    if (!area) {
      this.logger.warn(
        `Webhook plantilla: no se pudo resolver area (${templateName})`,
      );
      return;
    }

    await this.prisma.whatsapp_templates.updateMany({
      where: {
        area,
        name: templateName,
        ...(templateLanguage ? { language: templateLanguage } : {}),
      },
      data: {
        status: event,
        rejection_reason: reason ? String(reason) : null,
        synced_at: new Date(),
      },
    });
  }

  private async applyDeliveryStatus(status: Record<string, unknown>): Promise<void> {
    const messageId = String(status.id || '').trim();
    const mappedStatus = String(status.status || '').trim().toLowerCase();
    if (!messageId || !mappedStatus) return;

    const statusJson = JSON.stringify(status);
    await this.prisma.$executeRaw`
      UPDATE campaign_logs
      SET status = ${mappedStatus},
          response = COALESCE(response, '{}'::jsonb) || ${statusJson}::jsonb
      WHERE whatsapp_message_id = ${messageId}
    `;
    await this.prisma.$executeRaw`
      UPDATE chat_messages
      SET raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object('delivery_status', ${statusJson}::jsonb)
      WHERE wa_message_id = ${messageId}
    `;
  }

  private async resolveAreaFromSenderPhones(
    senderPhones: string[],
  ): Promise<BusinessArea | null> {
    const phones = Array.from(
      new Set(senderPhones.map((p) => String(p || '').trim()).filter(Boolean)),
    );
    if (phones.length === 0) return null;

    const [contacts, conversations, campaigns] = await Promise.all([
      this.prisma.contacts.findMany({
        where: { phone: { in: phones } },
        select: { area: true },
        distinct: ['area'],
      }),
      this.prisma.conversations.findMany({
        where: { phone: { in: phones } },
        select: { area: true },
        distinct: ['area'],
      }),
      this.prisma.campaign_logs.findMany({
        where: { phone: { in: phones } },
        select: { campaigns: { select: { area: true } } },
      }),
    ]);

    const areas = new Set<string>();
    for (const row of contacts) areas.add(row.area);
    for (const row of conversations) areas.add(row.area);
    for (const row of campaigns) {
      if (row.campaigns?.area) areas.add(row.campaigns.area);
    }
    areas.delete('');
    if (areas.size === 1) return Array.from(areas)[0] as BusinessArea;
    return null;
  }

  private async persistAndSendOutbound(input: {
    area: BusinessArea;
    conversationId: number;
    phone: string;
    text: string;
    isAi: boolean;
    phoneNumberId?: string | null;
    outboundSource?: string;
  }): Promise<boolean> {
    const toSend = String(input.text || '').slice(0, 4096);
    if (!toSend) return false;
    try {
      let lineId = String(input.phoneNumberId || '').trim() || null;
      if (!lineId) {
        const conv = await this.prisma.conversations.findUnique({
          where: { id: input.conversationId },
          select: { whatsapp_phone_number_id: true },
        });
        lineId = String(conv?.whatsapp_phone_number_id || '').trim() || null;
      }
      const apiResponse = await sendSessionTextMessage({
        to: input.phone,
        text: toSend,
        area: input.area,
        phoneNumberId: lineId,
      });
      const msgId = apiResponse.messages?.[0]?.id || null;
      const payload = sanitizeApiResponse(apiResponse) as Prisma.InputJsonValue;
      if (input.outboundSource) {
        (payload as Record<string, unknown>).source = input.outboundSource;
      }
      await this.prisma.chat_messages.create({
        data: {
          conversation_id: input.conversationId,
          direction: 'outbound',
          wa_message_id: msgId,
          body_text: toSend,
          message_type: 'text',
          raw_payload: payload,
          is_ai: input.isAi,
        },
      });
      await this.prisma.conversations.update({
        where: { id: input.conversationId },
        data: { last_message_at: new Date(), updated_at: new Date() },
      });
      return true;
    } catch (error) {
      this.logger.warn(
        `persistAndSendOutbound fallo: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }

  private async maybeOutsideHoursReply(input: {
    area: BusinessArea;
    conversationId: number;
    phone: string;
    phoneNumberId: string | null;
  }): Promise<boolean> {
    const settingsRow = await this.prisma.app_settings.findFirst({
      where: { area: input.area, key: 'business_hours' },
      select: { value: true },
    });
    const bhCfg = parseBusinessHoursConfig(settingsRow?.value);
    if (!isBusinessHoursConfigOperational(bhCfg)) return false;
    if (isWithinBusinessHours(bhCfg, new Date())) return false;

    const conv = await this.prisma.conversations.findUnique({
      where: { id: input.conversationId },
      select: { outside_hours_notice_sent_at: true },
    });
    if (!conv || conv.outside_hours_notice_sent_at != null) return true;

    const sent = await this.persistAndSendOutbound({
      area: input.area,
      conversationId: input.conversationId,
      phone: input.phone,
      text: bhCfg!.outside_hours_message,
      isAi: false,
      phoneNumberId: input.phoneNumberId,
      outboundSource: 'outside_hours',
    });
    if (sent) {
      await this.prisma.conversations.update({
        where: { id: input.conversationId },
        data: {
          outside_hours_notice_sent_at: new Date(),
          updated_at: new Date(),
        },
      });
    }
    return true;
  }

  private async tryStoreInboundMedia(input: {
    chatMessageId: number;
    msg: Record<string, unknown>;
    area: BusinessArea;
    conversationId: number;
  }): Promise<void> {
    const ref = extractInboundMediaRef(input.msg);
    if (!ref) return;

    try {
      const { buffer, mimeType } = await downloadWhatsAppMediaBuffer({
        mediaId: ref.mediaId,
        area: input.area,
      });
      const localPreview = await saveInboundChatMediaFromBuffer({
        buffer,
        conversationId: input.conversationId,
        mimeType,
      });
      await this.prisma.$executeRaw`
        UPDATE chat_messages
        SET raw_payload = COALESCE(raw_payload, '{}'::jsonb) || ${JSON.stringify({ local_preview: localPreview })}::jsonb
        WHERE id = ${input.chatMessageId}
      `;
    } catch (error) {
      this.logger.warn(
        `Webhook inbound: no se pudo guardar media (${error instanceof Error ? error.message : error})`,
      );
    }
  }

  private async maybeAutoReplyWithAi(input: {
    area: BusinessArea;
    conversationId: number;
    messageType: string;
    phone: string;
    chatMessageId: number;
    userText: string;
    phoneNumberId: string | null;
  }): Promise<void> {
    if (String(input.messageType || '').trim() !== 'text') return;
    if (!String(process.env.GROQ_API_KEY || '').trim()) return;

    const conv = await this.prisma.conversations.findUnique({
      where: { id: input.conversationId },
      select: { status: true },
    });
    if (!conv || String(conv.status || '').trim() !== 'bot') return;

    const settingsRow = await this.prisma.app_settings.findFirst({
      where: { area: input.area, key: 'ai_config' },
      select: { value: true },
    });
    const aiCfg = parseAiConfigValue(settingsRow?.value);
    if (!aiCfg?.enabled) return;

    const userText = String(input.userText ?? '').trim();
    if (!userText || userText === '(vacío)') return;

    const histRows = await this.prisma.chat_messages.findMany({
      where: {
        conversation_id: input.conversationId,
        id: { not: input.chatMessageId },
      },
      orderBy: { created_at: 'desc' },
      take: 4,
      select: { direction: true, body_text: true },
    });

    const history = histRows.reverse().map((row) => ({
      role: (String(row.direction) === 'inbound' ? 'user' : 'model') as
        | 'user'
        | 'model',
      text: String(row.body_text || '').slice(0, 8000),
    }));

    const replyText = await getAiResponse(
      userText,
      history,
      aiCfg,
      input.area,
    );

    const iaFallo =
      replyText == null || replyText === UNAVAILABLE_REPLY_MESSAGE;
    if (iaFallo) {
      await this.prisma.conversations.update({
        where: { id: input.conversationId },
        data: {
          status: 'human',
          automation_touched_at: new Date(),
          updated_at: new Date(),
        },
      });
      await this.persistAndSendOutbound({
        area: input.area,
        conversationId: input.conversationId,
        phone: input.phone,
        text: UNAVAILABLE_REPLY_MESSAGE,
        isAi: false,
        phoneNumberId: input.phoneNumberId,
      });
      return;
    }

    const transferKw = String(aiCfg.transfer_keyword || '[TRANSFERIR]').trim();
    if (transferKw && replyText.includes(transferKw)) {
      await this.persistAndSendOutbound({
        area: input.area,
        conversationId: input.conversationId,
        phone: input.phone,
        text: TRANSFER_TO_HUMAN_NOTICE,
        isAi: true,
        phoneNumberId: input.phoneNumberId,
      });
      await this.prisma.conversations.update({
        where: { id: input.conversationId },
        data: {
          status: 'human',
          automation_touched_at: new Date(),
          updated_at: new Date(),
        },
      });
      return;
    }

    await this.persistAndSendOutbound({
      area: input.area,
      conversationId: input.conversationId,
      phone: input.phone,
      text: replyText,
      isAi: true,
      phoneNumberId: input.phoneNumberId,
    });
    await this.prisma.conversations.update({
      where: { id: input.conversationId },
      data: { automation_touched_at: new Date(), updated_at: new Date() },
    });
  }

  private async persistInboundMessages(
    value: MetaWebhookChangeValue,
    context: { wabaEntryId?: string; field?: string },
  ): Promise<void> {
    const messages = Array.isArray(value.messages) ? value.messages : [];
    if (messages.length === 0) return;

    let { area, source } = resolveInboundArea(value, context.wabaEntryId);
    const senderPhones = messages.map((m) =>
      normalizePhone((m as { from?: string }).from),
    );
    const areaByPhone = await this.resolveAreaFromSenderPhones(senderPhones);

    if (!area && areaByPhone) {
      area = areaByPhone;
      source = 'sender_phone_db';
    } else if (area && areaByPhone && area !== areaByPhone) {
      this.logger.warn(
        `Webhook inbound: telefono en otra area BD (${areaByPhone}); se usa phone_number_id (${area})`,
      );
    }

    if (!area) {
      this.logger.warn(
        'Webhook: no se pudo resolver area para mensajes entrantes',
      );
      return;
    }

    if (source !== 'phone_number_id') {
      this.logger.log(`Webhook inbound: area=${area} via ${source}`);
    }

    let saved = 0;
    for (const msg of messages) {
      const record = msg as Record<string, unknown>;
      const from = normalizePhone(record.from);
      const waId = String(record.id || '').trim();
      if (!from || !E164_NO_PLUS_REGEX.test(from)) continue;

      let contactId: number | null = null;
      const contactInArea = await this.prisma.contacts.findFirst({
        where: { area, phone: from },
        select: { id: true },
      });
      contactId = contactInArea?.id ?? null;
      if (!contactId) {
        const anyContact = await this.prisma.contacts.findFirst({
          where: { phone: from },
          orderBy: { updated_at: 'desc' },
          select: { id: true },
        });
        contactId = anyContact?.id ?? null;
      }

      const { messageType, bodyText } = extractInboundMessagePreview(record);
      const linePhoneNumberId = resolveInboundLinePhoneNumberId(
        value,
        area,
        (slug) => getWhatsAppCredentialsForArea(slug).phoneNumberId,
      );

      const conversation = await this.prisma.conversations.upsert({
        where: { area_phone: { area, phone: from } },
        create: {
          area,
          phone: from,
          contact_id: contactId,
          last_user_message_at: new Date(),
          last_message_at: new Date(),
          inbox_unread: true,
          whatsapp_phone_number_id: linePhoneNumberId,
          status: 'bot',
        },
        update: {
          ...(contactId ? { contact_id: contactId } : {}),
          last_user_message_at: new Date(),
          last_message_at: new Date(),
          inbox_unread: true,
          whatsapp_phone_number_id: linePhoneNumberId,
          updated_at: new Date(),
        },
        select: { id: true },
      });

      if (messageType === 'reaction') {
        await this.applyInboundReaction(area, conversation.id, record);
        continue;
      }

      try {
        await processInboundReferral(this.prisma, {
          area,
          conversationId: conversation.id,
          contactId,
          phone: from,
          msg: record,
        });
      } catch (error) {
        this.logger.warn(
          `Meta ad referral failed: ${error instanceof Error ? error.message : error}`,
        );
      }

      const inboundPayload = {
        ...record,
        _mali_routing: {
          phone_number_id: linePhoneNumberId,
          routing_source: source,
          known_db_area:
            areaByPhone && areaByPhone !== area ? areaByPhone : null,
        },
      };

      try {
        const chatMessage = await this.prisma.chat_messages.create({
          data: {
            conversation_id: conversation.id,
            direction: 'inbound',
            wa_message_id: waId || null,
            body_text: bodyText.slice(0, 8000),
            message_type: messageType,
            raw_payload: inboundPayload as Prisma.InputJsonValue,
            is_ai: false,
          },
        });
        saved += 1;

        await this.tryStoreInboundMedia({
          chatMessageId: chatMessage.id,
          msg: record,
          area,
          conversationId: conversation.id,
        });

        const skipAi = await this.maybeOutsideHoursReply({
          area,
          conversationId: conversation.id,
          phone: from,
          phoneNumberId: linePhoneNumberId,
        });
        if (!skipAi) {
          await this.maybeAutoReplyWithAi({
            area,
            conversationId: conversation.id,
            messageType,
            phone: from,
            chatMessageId: chatMessage.id,
            userText: bodyText,
            phoneNumberId: linePhoneNumberId,
          });
        }
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          (error as { code?: string }).code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }

    if (saved > 0) {
      this.logger.log(`Webhook inbound guardado: area=${area}, saved=${saved}`);
    } else if (messages.length > 0) {
      this.logger.warn(
        `Webhook inbound: ningun mensaje insertado (area=${area}, count=${messages.length})`,
      );
    }
  }

  private async applyInboundReaction(
    area: string,
    conversationId: number,
    record: Record<string, unknown>,
  ): Promise<void> {
    const parsed = extractInboundReaction(record);
    if (!parsed) return;

    const target = await this.prisma.chat_messages.findFirst({
      where: {
        wa_message_id: parsed.targetWaMessageId,
        conversation_id: conversationId,
        conversations: { area },
      },
      select: { id: true, raw_payload: true },
    });
    if (!target) return;

    const nextPayload = setMessageReaction(target.raw_payload, {
      emoji: parsed.emoji,
      direction: 'inbound',
    });
    await this.prisma.chat_messages.update({
      where: { id: target.id },
      data: { raw_payload: nextPayload as Prisma.InputJsonValue },
    });
  }
}
