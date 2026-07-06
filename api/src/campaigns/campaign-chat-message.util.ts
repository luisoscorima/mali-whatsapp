import type { Prisma } from '@prisma/client';
import { normalizeArea } from '../config/areas';
import { normalizePhone } from '../contacts/contacts-validation.utils';
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
  },
): Promise<void> {
  const area = normalizeArea(input.area);
  const phone = normalizePhone(input.phone);
  if (!phone) return;

  const bodyText =
    input.preview.bodyText.trim() ||
    input.preview.headerText.trim() ||
    'Campaña enviada';

  const conversation = await prisma.conversations.upsert({
    where: { area_phone: { area, phone } },
    create: {
      area,
      phone,
      contact_id: input.contactId,
      last_message_at: new Date(),
      status: 'bot',
    },
    update: {
      ...(input.contactId ? { contact_id: input.contactId } : {}),
      last_message_at: new Date(),
      updated_at: new Date(),
    },
    select: { id: true },
  });

  const rawPayload = {
    source: 'campaign_send',
    campaign_id: input.campaignId,
    ...(input.templateName
      ? { template_name: String(input.templateName).slice(0, 200) }
      : {}),
    preview: input.preview,
    ...(input.apiResponse ? { api_response: input.apiResponse } : {}),
  } as Prisma.InputJsonValue;

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
