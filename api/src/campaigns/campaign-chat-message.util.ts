import type { Prisma } from '@prisma/client';
import { normalizeArea } from '../config/areas';
import { normalizePhone } from '../contacts/contacts-validation.utils';
import { isWhatsAppBsuid } from '../conversations/whatsapp-recipient.util';
import { setMessageSender } from '../conversations/chat-sender.util';
import { withRoutingPhoneNumberId } from '../conversations/chat-media.util';
import type { PrismaService } from '../prisma/prisma.service';
import type { CampaignMessagePreview } from './campaign-message-preview.util';

export async function persistCampaignChatMessage(
  prisma: PrismaService,
  input: {
    area: string;
    campaignId: number;
    templateName?: string | null;
    contactId: number | null;
    phone: string;
    waMessageId: string | null;
    preview: CampaignMessagePreview;
    apiResponse?: unknown;
    whatsappLineId?: number | null;
    whatsappPhoneNumberId?: string | null;
    /** Fecha real del envío (backfill histórico). */
    sentAt?: Date;
  },
): Promise<void> {
  const area = normalizeArea(input.area);
  const userId = isWhatsAppBsuid(input.phone) ? input.phone.trim() : null;
  const phone = userId ? null : normalizePhone(input.phone);
  if (!phone && !userId) return;

  const at = input.sentAt ?? new Date();
  const isHistorical = Boolean(input.sentAt);
  const whatsappLineId =
    Number.isInteger(input.whatsappLineId) && Number(input.whatsappLineId) > 0
      ? Number(input.whatsappLineId)
      : null;
  const whatsappPhoneNumberId =
    String(input.whatsappPhoneNumberId || '').trim() || null;

  const bodyText =
    input.preview.bodyText.trim() ||
    input.preview.headerText.trim() ||
    'Campaña enviada';

  const exact = whatsappLineId
    ? userId
      ? await prisma.conversations.findUnique({
          where: {
            whatsapp_line_id_whatsapp_user_id: {
              whatsapp_line_id: whatsappLineId,
              whatsapp_user_id: userId,
            },
          },
          select: {
            id: true,
            phone: true,
            whatsapp_user_id: true,
            contact_id: true,
          },
        })
      : await prisma.conversations.findUnique({
          where: {
            whatsapp_line_id_phone: {
              whatsapp_line_id: whatsappLineId,
              phone: phone!,
            },
          },
          select: {
            id: true,
            phone: true,
            whatsapp_user_id: true,
            contact_id: true,
          },
        })
    : userId
      ? await prisma.conversations.findFirst({
          where: { area, whatsapp_user_id: userId },
          orderBy: { id: 'desc' },
          select: {
            id: true,
            phone: true,
            whatsapp_user_id: true,
            contact_id: true,
          },
        })
      : await prisma.conversations.findFirst({
          where: { area, phone: phone! },
          orderBy: { id: 'desc' },
          select: {
            id: true,
            phone: true,
            whatsapp_user_id: true,
            contact_id: true,
          },
        });
  const existing =
    exact ??
    (input.contactId
      ? await prisma.conversations.findFirst({
          where: {
            ...(whatsappLineId
              ? { whatsapp_line_id: whatsappLineId }
              : { area }),
            contact_id: input.contactId,
            ...(userId ? { whatsapp_user_id: null } : { phone: null }),
          },
          select: {
            id: true,
            phone: true,
            whatsapp_user_id: true,
            contact_id: true,
          },
        })
      : null);
  const createData = {
    area,
    whatsapp_line_id: whatsappLineId,
    whatsapp_phone_number_id: whatsappPhoneNumberId,
    phone,
    whatsapp_user_id: userId,
    contact_id: input.contactId,
    last_message_at: at,
    status: 'bot',
  };
  const updateData = isHistorical
    ? {
          ...(input.contactId && !existing?.contact_id
            ? { contact_id: input.contactId }
            : {}),
          ...(userId && !existing?.whatsapp_user_id
            ? { whatsapp_user_id: userId }
            : {}),
          ...(phone && !existing?.phone ? { phone } : {}),
          ...(whatsappLineId ? { whatsapp_line_id: whatsappLineId } : {}),
          ...(whatsappPhoneNumberId
            ? { whatsapp_phone_number_id: whatsappPhoneNumberId }
            : {}),
      }
    : {
          ...(input.contactId && !existing?.contact_id
            ? { contact_id: input.contactId }
            : {}),
          ...(userId && !existing?.whatsapp_user_id
            ? { whatsapp_user_id: userId }
            : {}),
          ...(phone && !existing?.phone ? { phone } : {}),
          ...(whatsappLineId ? { whatsapp_line_id: whatsappLineId } : {}),
          ...(whatsappPhoneNumberId
            ? { whatsapp_phone_number_id: whatsappPhoneNumberId }
            : {}),
          last_message_at: at,
          updated_at: new Date(),
      };
  const conversation = existing
    ? await prisma.conversations.update({
        where: { id: existing.id },
        data: updateData,
        select: { id: true },
      })
    : whatsappLineId
      ? await prisma.conversations.upsert({
          where: userId
            ? {
                whatsapp_line_id_whatsapp_user_id: {
                  whatsapp_line_id: whatsappLineId,
                  whatsapp_user_id: userId,
                },
              }
            : {
                whatsapp_line_id_phone: {
                  whatsapp_line_id: whatsappLineId,
                  phone: phone!,
                },
              },
          create: createData,
          update: updateData,
          select: { id: true },
        })
      : await prisma.conversations.create({
          data: createData,
          select: { id: true },
        });

  const rawPayload = withRoutingPhoneNumberId(
    setMessageSender(
      {
        source: 'campaign_send',
        campaign_id: input.campaignId,
        ...(input.templateName
          ? { template_name: String(input.templateName).slice(0, 200) }
          : {}),
        preview: input.preview,
        ...(input.apiResponse ? { api_response: input.apiResponse } : {}),
      },
      'Campaña',
    ),
    whatsappPhoneNumberId,
  ) as Prisma.InputJsonValue;

  try {
    await prisma.chat_messages.create({
      data: {
        conversation_id: conversation.id,
        direction: 'outbound',
        wa_message_id: input.waMessageId,
        body_text: bodyText.slice(0, 8000),
        message_type: 'campaign',
        is_ai: false,
        raw_payload: rawPayload,
        created_at: at,
      },
    });
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002' &&
      input.waMessageId
    ) {
      return;
    }
    throw error;
  }
}
