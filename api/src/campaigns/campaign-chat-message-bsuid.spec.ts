import { persistCampaignChatMessage } from './campaign-chat-message.util';

describe('Campaign conversation identity', () => {
  it('persists a BSUID recipient without storing it as a phone', async () => {
    const prisma = {
      conversations: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 42 }),
        upsert: jest.fn().mockResolvedValue({ id: 42 }),
      },
      chat_messages: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    await persistCampaignChatMessage(prisma as never, {
      area: 'ti',
      campaignId: 1,
      contactId: null,
      phone: 'PE.13491208655302741918',
      waMessageId: 'wamid.1',
      preview: { bodyText: 'Hola', headerText: '' } as never,
    });
    expect(prisma.conversations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: null,
          whatsapp_user_id: 'PE.13491208655302741918',
        }),
      }),
    );
    expect(prisma.chat_messages.create).toHaveBeenCalled();
  });

  it('uses the WhatsApp line as the conversation identity when provided', async () => {
    const prisma = {
      conversations: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 43 }),
      },
      chat_messages: { create: jest.fn().mockResolvedValue({ id: 2 }) },
    };

    await persistCampaignChatMessage(prisma as never, {
      area: 'educacion',
      campaignId: 2,
      contactId: 10,
      phone: '51999999999',
      waMessageId: 'wamid.2',
      whatsappLineId: 5,
      whatsappPhoneNumberId: 'pid-ca',
      preview: { bodyText: 'Hola CA', headerText: '' } as never,
    });

    expect(prisma.conversations.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          whatsapp_line_id_phone: {
            whatsapp_line_id: 5,
            phone: '51999999999',
          },
        },
      }),
    );
    expect(prisma.conversations.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          area: 'educacion',
          whatsapp_line_id: 5,
          whatsapp_phone_number_id: 'pid-ca',
        }),
      }),
    );
  });
});
