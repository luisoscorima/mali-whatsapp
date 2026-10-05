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
    const leads = {
      recordEducationOrganicOrigin: jest.fn().mockResolvedValue(undefined),
    };
    const service = new WebhookService(
      prisma as never,
      flows as never,
      {} as never,
      leads as never,
      { getCatalog: jest.fn().mockResolvedValue([]) } as never,
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
    expect(leads.recordEducationOrganicOrigin).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: null,
        whatsappUserId: userId,
        conversationId: 42,
      }),
    );
  });

  it('merges complementary phone-only contact into BSUID contact and keeps the phone', async () => {
    jest.spyOn(areaResolver, 'resolveInboundArea').mockReturnValue({
      area: 'ti',
      source: 'phone_number_id',
    });
    const phoneOnly = {
      id: 20,
      phone: '51999999999',
      whatsapp_user_id: null,
      email: null,
      dni: null,
      last_name: '',
      lead_status_id: null,
      lead_score: null,
    };
    const bsuidOnly = {
      id: 21,
      phone: null,
      whatsapp_user_id: userId,
      email: null,
      dni: null,
      last_name: '',
      lead_status_id: null,
      lead_score: null,
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        // Merge util runs against tx; stub minimal surface so merge completes.
        const tx = {
          contacts: {
            update: jest.fn().mockResolvedValue({}),
          },
          contact_origins: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          education_lead_entries: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          campaign_logs: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          meta_ctwa_ad_leads: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            findMany: jest.fn().mockResolvedValue([]),
          },
          meta_leadgen_leads: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          tiktok_leads: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
          contact_segments: { findMany: jest.fn().mockResolvedValue([]) },
          contact_attributes: { findMany: jest.fn().mockResolvedValue([]) },
          education_lead_cycles: {
            findFirst: jest.fn().mockResolvedValue(null),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
          conversations: {
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        };
        return fn(tx);
      }),
      contacts: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockImplementation(({ where }) => {
          if (where.whatsapp_user_id) return Promise.resolve(bsuidOnly);
          if (where.phone) return Promise.resolve(phoneOnly);
          return Promise.resolve(null);
        }),
        update: jest.fn(),
      },
      conversations: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 99 }),
      },
      chat_messages: {
        create: jest.fn().mockResolvedValue({ id: 1, created_at: new Date() }),
      },
      campaign_logs: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const flows = { handleInbound: jest.fn().mockResolvedValue({ handled: true }) };
    const leads = {
      recordEducationOrganicOrigin: jest.fn().mockResolvedValue(undefined),
    };
    const service = new WebhookService(
      prisma as never,
      flows as never,
      {} as never,
      leads as never,
      { getCatalog: jest.fn().mockResolvedValue([]) } as never,
    );

    await service['persistInboundMessages'](
      {
        metadata: { phone_number_id: 'line-1' },
        contacts: [{ user_id: userId, profile: { name: 'Ana' } }],
        messages: [
          {
            from: '51999999999',
            from_user_id: userId,
            id: 'wamid.merge',
            type: 'text',
            text: { body: 'Hola' },
          },
        ],
      },
      {},
    );

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.conversations.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          phone: '51999999999',
          contact_id: 21,
          whatsapp_user_id: userId,
        }),
      }),
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

  it('attributes a MALI ONE link using BSUID when the phone is private', async () => {
    const leads = { upsertOrigin: jest.fn().mockResolvedValue({
      origin_id: 8, contact_id: 15, created: true,
    }) };
    const catalog = {
      getCatalog: jest.fn().mockResolvedValue([{
        slug: 'teatro-joven',
        text: 'Hola, deseo información sobre el curso de teatro',
        text_normalized: 'hola, deseo informacion sobre el curso de teatro',
        tags: ['Teatro'],
        phone: '51999999999',
        curso: null,
        programa: null,
        sede: null,
      }]),
    };
    const service = new WebhookService(
      {} as never, {} as never, {} as never, leads as never, catalog as never,
    );

    await service['maybeAttributeMaliOneLinkOrigin']({
      area: 'educacion_ca',
      conversationId: 42,
      phone: null,
      whatsappUserId: userId,
      bodyText: 'Hola, deseo información sobre el curso de teatro',
      waProfileName: 'Ana',
    });

    expect(leads.upsertOrigin).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'mali_one_link',
      external_id: 'teatro-joven:42',
      phone: null,
      whatsapp_user_id: userId,
      contact: expect.objectContaining({
        phone: null,
        whatsapp_user_id: userId,
      }),
    }));
  });

  it('attributes a Click-to-WhatsApp referral using BSUID and links its contact', async () => {
    jest.spyOn(areaResolver, 'resolveInboundArea').mockReturnValue({
      area: 'educacion_ca', source: 'phone_number_id',
    });
    const prisma = {
      contacts: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      conversations: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 42 }),
        update: jest.fn().mockResolvedValue({ id: 42 }),
      },
      chat_messages: {
        create: jest.fn().mockResolvedValue({ id: 123, created_at: new Date() }),
      },
      campaign_logs: { findMany: jest.fn().mockResolvedValue([]) },
      meta_ctwa_ads: {
        upsert: jest.fn().mockResolvedValue({
          id: 3, ad_platform: 'facebook', meta_source_id: 'ad-123',
        }),
        update: jest.fn().mockResolvedValue({ id: 3 }),
      },
      meta_ctwa_ad_leads: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const flows = { handleInbound: jest.fn().mockResolvedValue({ handled: true }) };
    const leads = {
      upsertOrigin: jest.fn().mockResolvedValue({
        origin_id: 8, contact_id: 15, created: true,
      }),
      recordEducationOrganicOrigin: jest.fn().mockResolvedValue(undefined),
    };
    const service = new WebhookService(
      prisma as never, flows as never, {} as never, leads as never, {} as never,
    );

    await service['persistInboundMessages']({
      metadata: { phone_number_id: 'line-1' },
      contacts: [{
        user_id: userId,
        profile: { name: 'Ana', username: 'ana_mali' },
      }],
      messages: [{
        from_user_id: userId,
        id: 'wamid.ctwa-1',
        type: 'text',
        text: { body: 'Hola' },
        referral: {
          source_id: 'ad-123',
          source_url: 'https://facebook.com/example',
        },
      }],
    }, {});

    expect(leads.upsertOrigin).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'meta_ctwa',
      phone: null,
      whatsapp_user_id: userId,
      contact: expect.objectContaining({ whatsapp_user_id: userId }),
    }));
    expect(prisma.meta_ctwa_ad_leads.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({
          phone: null,
          whatsapp_user_id: userId,
        })],
      }),
    );
    expect(prisma.meta_ctwa_ad_leads.updateMany).toHaveBeenCalledWith({
      where: { conversation_id: 42, contact_id: null },
      data: { contact_id: 15 },
    });
  });
});
