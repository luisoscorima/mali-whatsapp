import type { Prisma } from '@prisma/client';
import { normalizeArea } from '../config/areas';
import { normalizePhone } from '../contacts/contacts-validation.utils';
import { isWhatsAppBsuid } from '../conversations/whatsapp-recipient.util';
import { setMessageSender } from '../conversations/chat-sender.util';
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

  const bodyText =
    input.preview.bodyText.trim() ||
    input.preview.headerText.trim() ||
    'Campaña enviada';

  const exact = userId
    ? await prisma.conversations.findUnique({
        where: { area_whatsapp_user_id: { area, whatsapp_user_id: userId } },
        select: { id: true, phone: true, whatsapp_user_id: true, contact_id: true },
      })
    : await prisma.conversations.findUnique({
        where: { area_phone: { area, phone: phone! } },
        select: { id: true, phone: true, whatsapp_user_id: true, contact_id: true },
      });
  const existing = exact ?? (input.contactId ? await prisma.conversations.findFirst({
    where: { area, contact_id: input.contactId,
      ...(userId ? { whatsapp_user_id: null } : { phone: null }) },
    select: { id: true, phone: true, whatsapp_user_id: true, contact_id: true },
  }) : null);
  const conversation = await prisma.conversations.upsert({
    where: existing
      ? { id: existing.id }
      : userId
        ? { area_whatsapp_user_id: { area, whatsapp_user_id: userId } }
        : { area_phone: { area, phone: phone! } },
    create: {
      area,
      phone,
      whatsapp_user_id: userId,
      contact_id: input.contactId,
      last_message_at: at,
      status: 'bot',
    },
    update: isHistorical
      ? {
          ...(input.contactId && !existing?.contact_id ? { contact_id: input.contactId } : {}),
          ...(userId && !existing?.whatsapp_user_id ? { whatsapp_user_id: userId } : {}),
          ...(phone && !existing?.phone ? { phone } : {}),
        }
      : {
          ...(input.contactId && !existing?.contact_id ? { contact_id: input.contactId } : {}),
          ...(userId && !existing?.whatsapp_user_id ? { whatsapp_user_id: userId } : {}),
          ...(phone && !existing?.phone ? { phone } : {}),
          last_message_at: at,
          updated_at: new Date(),
        },
    select: { id: true },
  });

  const rawPayload = setMessageSender(
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
