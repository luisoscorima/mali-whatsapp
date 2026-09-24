import { persistCampaignChatMessage } from './campaign-chat-message.util';

describe('Campaign conversation identity', () => {
  it('persists a BSUID recipient without storing it as a phone', async () => {
    const prisma = {
      conversations: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 42 }),
      },
      chat_messages: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    await persistCampaignChatMessage(prisma as never, {
      area: 'ti', campaignId: 1, contactId: null,
      phone: 'PE.13491208655302741918', waMessageId: 'wamid.1',
      preview: { bodyText: 'Hola', headerText: '' } as never,
    });
    expect(prisma.conversations.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          phone: null, whatsapp_user_id: 'PE.13491208655302741918',
        }),
      }),
    );
    expect(prisma.chat_messages.create).toHaveBeenCalled();
  });
});
