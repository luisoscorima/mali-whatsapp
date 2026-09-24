import { WebhookService } from './webhook.service';
import * as areaResolver from './webhook-area.util';
import type { MetaWebhookChangeValue } from './webhook.types';

describe('WebhookService BSUID inbound', () => {
  const userId = 'PE.13491208655302741918';

  it.each(['no phone', 'contact collision', 'conversation collision'])(
    'persists inbound using BSUID without mixing identities: %s', async (scenario) => {
    jest.spyOn(areaResolver, 'resolveInboundArea').mockReturnValue({
      area: 'ti',
      source: 'phone_number_id',
    });
    const prisma = {
      contacts: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockImplementation(({ where }) => Promise.resolve(
          scenario === 'contact collision' && where.phone
            ? { id: 7, phone: where.phone, whatsapp_user_id: 'PE.old' } : null,
        )),
        update: jest.fn(),
      },
      conversations: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(
          scenario === 'conversation collision' && where.area_phone
            ? { id: 8, phone: where.area_phone.phone, whatsapp_user_id: 'PE.old', contact_id: 7 } : null,
        )),
        upsert: jest.fn().mockResolvedValue({ id: 42 }),
      },
      chat_messages: {
        create: jest.fn().mockResolvedValue({ id: 123, created_at: new Date() }),
      },
      campaign_logs: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const flows = {
      handleInbound: jest.fn().mockResolvedValue({ handled: true }),
    };
    const service = new WebhookService(
      prisma as never,
      flows as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const value: MetaWebhookChangeValue = {
      metadata: { phone_number_id: 'line-1' },
      contacts: [{ user_id: userId, profile: { name: 'Ana', username: 'ana_mali' } }],
      messages: [{
        ...(scenario !== 'no phone' ? { from: '51999999999' } : {}),
        from_user_id: userId,
        id: 'wamid.123',
        type: 'text',
        text: { body: 'Hola' },
      }],
    };

    await service['persistInboundMessages'](value, {});

    expect(prisma.conversations.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          phone: null,
          contact_id: null,
          whatsapp_user_id: userId,
          wa_username: 'ana_mali',
        }),
      }),
    );
    expect(prisma.contacts.update).not.toHaveBeenCalled();
    expect(prisma.conversations.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { area_whatsapp_user_id: { area: 'ti', whatsapp_user_id: userId } } }),
    );
    expect(prisma.chat_messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body_text: 'Hola', wa_message_id: 'wamid.123' }),
      }),
    );
    expect(flows.handleInbound).toHaveBeenCalledWith(
      expect.objectContaining({ phone: userId, conversationId: 42 }),
    );
  });

  it('records a BSUID rotation without relinking a contact or conversation', async () => {
    jest.spyOn(areaResolver, 'resolveInboundArea').mockReturnValue({
      area: 'ti', source: 'phone_number_id',
    });
    const prisma = {
      whatsapp_identity_events: { upsert: jest.fn().mockResolvedValue({ id: 1 }) },
      contacts: { findFirst: jest.fn(), update: jest.fn() },
      conversations: { upsert: jest.fn() },
    };
    const service = new WebhookService(
      prisma as never, {} as never, {} as never, {} as never, {} as never,
    );
    await service['persistInboundMessages']({
      metadata: { phone_number_id: 'line-1' },
      messages: [{
        id: 'wamid.change-1', type: 'system', from_user_id: 'PE.new123',
        system: { type: 'user_changed_number', previous_user_id: userId, user_id: 'PE.new123' },
      }],
    }, {});
    expect(prisma.whatsapp_identity_events.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          event_type: 'user_changed_number', previous_user_id: userId,
          new_user_id: 'PE.new123',
        }),
      }),
    );
    expect(prisma.contacts.update).not.toHaveBeenCalled();
    expect(prisma.conversations.upsert).not.toHaveBeenCalled();
  });
});
