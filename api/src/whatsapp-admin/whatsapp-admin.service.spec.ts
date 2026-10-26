import { WhatsAppAdminService } from './whatsapp-admin.service';
import {
  inspectWhatsAppLine,
  inspectWhatsAppWaba,
} from '../templates/whatsapp-meta.util';
import { decryptMetaToken } from '../meta-settings/credential-vault.util';

jest.mock('../templates/whatsapp-meta.util', () => ({
  inspectWhatsAppLine: jest.fn(),
  inspectWhatsAppWaba: jest.fn(),
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
});
