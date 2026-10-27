import { WhatsAppAdminService } from './whatsapp-admin.service';
import {
  inspectWhatsAppLine,
  inspectWhatsAppWaba,
  listWhatsAppWabaPhoneNumbers,
  registerWhatsAppPhoneNumber,
  subscribeWhatsAppWabaApp,
} from '../templates/whatsapp-meta.util';
import { decryptMetaToken } from '../meta-settings/credential-vault.util';

jest.mock('../templates/whatsapp-meta.util', () => ({
  inspectWhatsAppLine: jest.fn(),
  inspectWhatsAppWaba: jest.fn(),
  listWhatsAppWabaPhoneNumbers: jest.fn(),
  registerWhatsAppPhoneNumber: jest.fn(),
  subscribeWhatsAppWabaApp: jest.fn(),
}));

describe('WhatsApp administration lifecycle', () => {
  const originalKey = process.env.WHATSAPP_CREDENTIALS_MASTER_KEY;
  const originalFlag = process.env.WHATSAPP_LINE_CATALOG_ENABLED;
  let db: any;
  let refresh: jest.Mock;
  let service: WhatsAppAdminService;
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_CREDENTIALS_MASTER_KEY = '09'.repeat(32);
    process.env.WHATSAPP_LINE_CATALOG_ENABLED = 'true';
    db = {
      business_areas: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 1, slug: 'educacion', active: true }),
      },
      business_programs: { findFirst: jest.fn().mockResolvedValue(null) },
      whatsapp_wabas: {
        findUnique: jest
          .fn()
          .mockResolvedValue({
            id: 2,
            meta_waba_id: '12345',
            default_credential_id: 3,
            active: true,
          }),
        update: jest.fn().mockResolvedValue({}),
      },
      whatsapp_lines: {
        create: jest.fn().mockResolvedValue({ id: 4 }),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 4 }),
        updateMany: jest.fn(),
      },
      meta_credentials: {
        create: jest.fn().mockResolvedValue({ id: 5 }),
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
    };
    db.$transaction = jest.fn(async (op: any) =>
      typeof op === 'function' ? op(db) : Promise.all(op),
    );
    refresh = jest.fn();
    service = new WhatsAppAdminService(
      db,
      { refresh } as any,
      { write: jest.fn() } as any,
    );
    jest
      .mocked(inspectWhatsAppLine)
      .mockResolvedValue({
        id: '67890',
        displayPhoneNumber: '+51900000001',
        verifiedName: 'Test',
        qualityRating: 'GREEN',
        registrationStatus: 'connected',
      });
    jest
      .mocked(inspectWhatsAppWaba)
      .mockResolvedValue({
        id: '12345',
        name: 'Test',
        appSubscriptionStatus: 'subscribed',
        subscriptionWarning: null,
      });
  });
  afterAll(() => {
    if (originalKey === undefined)
      delete process.env.WHATSAPP_CREDENTIALS_MASTER_KEY;
    else process.env.WHATSAPP_CREDENTIALS_MASTER_KEY = originalKey;
    if (originalFlag === undefined)
      delete process.env.WHATSAPP_LINE_CATALOG_ENABLED;
    else process.env.WHATSAPP_LINE_CATALOG_ENABLED = originalFlag;
  });
  it('creates an inactive canonical line inheriting the WABA credential', async () => {
    await service.createLine({
      business_area_id: 1,
      waba_id: 2,
      phone_number_id: '67890',
      label: 'Educación 4',
    });
    expect(db.whatsapp_lines.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        business_area_id: 1,
        legacy_area: null,
        active: false,
        registration_status: 'draft',
        credential_override_id: null,
      }),
    });
    expect(db.meta_credentials.create).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('rejects a program from a different area before saving', async () => {
    await expect(
      service.createLine({
        business_area_id: 1,
        waba_id: 2,
        program_id: 99,
        phone_number_id: '67890',
        label: 'Test',
      }),
    ).rejects.toThrow('programa');
    expect(db.whatsapp_lines.create).not.toHaveBeenCalled();
  });
  it('requires validation before activation', async () => {
    db.whatsapp_lines.findUnique.mockResolvedValue({
      business_area_id: 1,
      program_id: null,
      waba: { active: true },
      credential_override: { active: true, validation_status: 'valid' },
      registration_status: 'draft',
    });
    await expect(service.activateLine(4)).rejects.toThrow('Valida la línea');
    expect(db.whatsapp_lines.update).not.toHaveBeenCalled();
  });
  it('switches defaults inside the same locked transaction', async () => {
    db.whatsapp_lines.findUnique.mockResolvedValue({
      id: 4,
      business_area_id: 1,
      program_id: null,
      active: true,
      legacy_area: null,
      _count: { conversations: 10, campaigns: 2 },
    });
    await service.updateLine(4, { is_default: true });
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(db.whatsapp_lines.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ business_area_id: 1, NOT: { id: 4 } }),
        data: expect.objectContaining({ is_default: false }),
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });
  it('does not invalidate a shared credential when one line fails Meta membership', async () => {
    db.whatsapp_lines.findUnique.mockResolvedValue({
      waba: { meta_waba_id: '12345' },
      credential_override: {
        id: 3,
        active: true,
        secret_source: 'env',
        secret_ref: 'TEST_UNUSED_TOKEN',
      },
    });
    jest
      .mocked(inspectWhatsAppLine)
      .mockRejectedValue(new Error('No pertenece al WABA'));
    await expect(service.validateLine(4)).rejects.toThrow('No pertenece');
    expect(db.meta_credentials.update).not.toHaveBeenCalled();
  });
  it('can add a token to a draft that has no effective credential, without altering shared credentials', async () => {
    db.whatsapp_lines.findUnique.mockResolvedValue({
      id: 4,
      label: 'Test',
      phone_number_id: '67890',
      waba: { meta_waba_id: '12345' },
    });
    const token = 'new-test-token-for-line';
    await service.rotateLineToken(4, { token });
    const stored = db.meta_credentials.create.mock.calls[0][0].data;
    expect(stored.encrypted_token).not.toContain(token);
    expect(decryptMetaToken(stored.encrypted_token)).toBe(token);
    expect(db.meta_credentials.update).not.toHaveBeenCalled();
    expect(db.whatsapp_lines.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ credential_override_id: 5 }),
      }),
    );
  });
  it('leaves the previous token unchanged if the new token fails Meta validation', async () => {
    db.whatsapp_lines.findUnique.mockResolvedValue({
      id: 4,
      label: 'Test',
      phone_number_id: '67890',
      waba: { meta_waba_id: '12345' },
    });
    jest
      .mocked(inspectWhatsAppLine)
      .mockRejectedValue(new Error('Invalid token'));
    await expect(
      service.rotateLineToken(4, { token: 'invalid-test-token' }),
    ).rejects.toThrow('Invalid token');
    expect(db.meta_credentials.create).not.toHaveBeenCalled();
    expect(db.whatsapp_lines.update).not.toHaveBeenCalled();
  });

  it('syncs Meta numbers as inactive drafts without activating or deleting', async () => {
    process.env.TEST_WABA_SYNC_TOKEN = 'sync-token-value-for-tests';
    db.whatsapp_wabas.findUnique.mockResolvedValue({
      id: 2,
      meta_waba_id: '12345',
      default_credential: {
        id: 3,
        active: true,
        secret_source: 'env',
        secret_ref: 'TEST_WABA_SYNC_TOKEN',
        encrypted_token: null,
      },
    });
    db.whatsapp_lines.findMany.mockResolvedValue([
      {
        id: 10,
        phone_number_id: '111',
        label: 'Vieja',
        display_phone_number: '+51111',
        quality_rating: 'GREEN',
        active: true,
        registration_status: 'validated',
        business_area_id: 1,
        credential_override: null,
      },
    ]);
    db.whatsapp_lines.findUnique.mockResolvedValue(null);
    db.whatsapp_lines.create.mockResolvedValue({
      id: 11,
      phone_number_id: '222',
      label: 'MALI Educación 4',
    });
    jest.mocked(listWhatsAppWabaPhoneNumbers).mockResolvedValue([
      {
        id: '111',
        displayPhoneNumber: '+51111',
        verifiedName: 'Vieja',
        qualityRating: 'GREEN',
        registrationStatus: 'connected',
      },
      {
        id: '222',
        displayPhoneNumber: '+51222',
        verifiedName: 'MALI Educación 4',
        qualityRating: 'UNKNOWN',
        registrationStatus: 'connected',
      },
    ]);

    const result = await service.syncWabaLines(2, { email: 'master@mali.pe' });

    expect(result.created).toHaveLength(1);
    expect(result.unchanged).toHaveLength(1);
    expect(result.missing_in_meta).toHaveLength(0);
    expect(db.whatsapp_lines.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone_number_id: '222',
        active: false,
        is_default: false,
        registration_status: 'draft',
      }),
      select: expect.any(Object),
    });
    expect(refresh).toHaveBeenCalled();
    delete process.env.TEST_WABA_SYNC_TOKEN;
  });

  it('syncs using a per-line credential when the WABA has no default token', async () => {
    process.env.TEST_LINE_SYNC_TOKEN = 'line-token-for-sync';
    db.whatsapp_wabas.findUnique.mockResolvedValue({
      id: 4,
      meta_waba_id: '958313150113818',
      default_credential: null,
    });
    db.whatsapp_lines.findMany.mockResolvedValue([
      {
        id: 4,
        phone_number_id: '1178134562043416',
        label: 'Educación general',
        display_phone_number: '+51934595514',
        quality_rating: 'GREEN',
        active: true,
        registration_status: 'validated',
        business_area_id: 1,
        credential_override: {
          id: 4,
          active: true,
          secret_source: 'env',
          secret_ref: 'TEST_LINE_SYNC_TOKEN',
          encrypted_token: null,
        },
      },
    ]);
    db.whatsapp_lines.findUnique.mockResolvedValue(null);
    db.whatsapp_lines.create.mockResolvedValue({
      id: 40,
      phone_number_id: '1473593759161176',
      label: 'MALI Educación 4',
    });
    jest.mocked(listWhatsAppWabaPhoneNumbers).mockResolvedValue([
      {
        id: '1178134562043416',
        displayPhoneNumber: '+51 934 595 514',
        verifiedName: 'MALI Educación',
        qualityRating: 'GREEN',
        registrationStatus: 'connected',
      },
      {
        id: '1473593759161176',
        displayPhoneNumber: '+51 937 008 339',
        verifiedName: 'MALI Educación 4',
        qualityRating: 'UNKNOWN',
        registrationStatus: 'connected',
      },
    ]);

    const result = await service.syncWabaLines(4, { email: 'master@mali.pe' });
    expect(result.created).toHaveLength(1);
    expect(listWhatsAppWabaPhoneNumbers).toHaveBeenCalled();
    delete process.env.TEST_LINE_SYNC_TOKEN;
  });

  it('registers a line in Cloud API with a 6-digit PIN and marks it validated', async () => {
    process.env.TEST_REGISTER_TOKEN = 'register-token-value';
    db.whatsapp_lines.findUnique.mockResolvedValue({
      id: 11,
      waba_id: 4,
      phone_number_id: '1473593759161176',
      credential_override_id: null,
      legacy_area: null,
      program_key: 'ca',
      waba: {
        meta_waba_id: '958313150113818',
        active: true,
        default_credential: null,
      },
      credential_override: null,
      business_area_id: 1,
      business_area: { slug: 'educacion' },
      program_id: 1,
    });
    db.whatsapp_lines.findFirst = jest.fn().mockResolvedValue({
      credential_override: {
        id: 5,
        active: true,
        secret_source: 'env',
        secret_ref: 'TEST_REGISTER_TOKEN',
        encrypted_token: null,
      },
    });
    jest.mocked(registerWhatsAppPhoneNumber).mockResolvedValue({ success: true });
    jest.mocked(inspectWhatsAppLine).mockResolvedValue({
      id: '1473593759161176',
      displayPhoneNumber: '+51 937 008 339',
      verifiedName: 'MALI Educación 4',
      qualityRating: 'UNKNOWN',
      registrationStatus: 'connected',
    });

    await service.registerLine(11, { pin: '123456' }, { email: 'master@mali.pe' });

    expect(registerWhatsAppPhoneNumber).toHaveBeenCalledWith(
      '1473593759161176',
      'register-token-value',
      '123456',
    );
    expect(db.whatsapp_lines.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ program_key: 'ca' }),
      }),
    );
    expect(db.whatsapp_lines.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          registration_status: 'validated',
          credential_override_id: 5,
          legacy_area: 'educacion_ca',
        }),
      }),
    );
    delete process.env.TEST_REGISTER_TOKEN;
  });

  it('subscribes the app to a WABA using a line credential fallback', async () => {
    process.env.TEST_SUBSCRIBE_TOKEN = 'subscribe-token-value';
    db.whatsapp_wabas.findUnique.mockResolvedValue({
      id: 4,
      meta_waba_id: '958313150113818',
      default_credential: null,
    });
    db.whatsapp_wabas.update = jest.fn().mockResolvedValue({});
    db.whatsapp_lines.findMany.mockResolvedValue([
      {
        credential_override: {
          id: 4,
          active: true,
          secret_source: 'env',
          secret_ref: 'TEST_SUBSCRIBE_TOKEN',
          encrypted_token: null,
        },
      },
    ]);
    jest.mocked(subscribeWhatsAppWabaApp).mockResolvedValue({ success: true });
    jest.mocked(inspectWhatsAppWaba).mockResolvedValue({
      id: '958313150113818',
      name: 'Educación',
      appSubscriptionStatus: 'subscribed',
      subscriptionWarning: null,
    });

    const result = await service.subscribeWaba(4, { email: 'master@mali.pe' });
    expect(subscribeWhatsAppWabaApp).toHaveBeenCalled();
    expect(result.inspection.appSubscriptionStatus).toBe('subscribed');
    delete process.env.TEST_SUBSCRIBE_TOKEN;
  });
});
