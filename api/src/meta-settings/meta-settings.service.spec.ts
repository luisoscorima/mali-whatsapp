import { MetaSettingsService } from './meta-settings.service';
import {
  getWhatsAppLineByPhoneNumberId,
  setMetaSettingsCache,
  setWhatsAppLineCatalog,
} from './meta-settings.store';

describe('live catalog refresh', () => {
  const originalFlag = process.env.WHATSAPP_LINE_CATALOG_ENABLED;
  const originalToken = process.env.TEST_CATALOG_TOKEN;
  const row = (active: boolean) => ({
    id: 1,
    active,
    phone_number_id: '12345',
    display_phone_number: null,
    legacy_area: null,
    program_id: null,
    program_key: null,
    is_default: true,
    business_area: { slug: 'educacion', active: true },
    waba: {
      meta_waba_id: '98765',
      active: true,
      default_credential: {
        active: true,
        secret_source: 'env',
        secret_ref: 'TEST_CATALOG_TOKEN',
        encrypted_token: null,
      },
    },
    credential_override: null,
  });
  afterEach(() => {
    setWhatsAppLineCatalog([]);
    setMetaSettingsCache([]);
    jest.useRealTimers();
  });
  afterAll(() => {
    if (originalFlag === undefined)
      delete process.env.WHATSAPP_LINE_CATALOG_ENABLED;
    else process.env.WHATSAPP_LINE_CATALOG_ENABLED = originalFlag;
    if (originalToken === undefined) delete process.env.TEST_CATALOG_TOKEN;
    else process.env.TEST_CATALOG_TOKEN = originalToken;
  });
  it('observes activation/deactivation on other replicas every 15 seconds and retains last snapshot on DB failure', async () => {
    jest.useFakeTimers();
    process.env.WHATSAPP_LINE_CATALOG_ENABLED = 'true';
    process.env.TEST_CATALOG_TOKEN = 'test-token';
    let current = row(false);
    const db = {
      app_settings: { findMany: jest.fn().mockResolvedValue([]) },
      whatsapp_lines: { findMany: jest.fn(async () => [current]) },
    };
    const service = new MetaSettingsService(db as any, {} as any);
    jest
      .spyOn(service as any, 'syncMissingDisplayPhoneNumbersOnBoot')
      .mockResolvedValue(undefined);
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    await service.onModuleInit();
    expect(getWhatsAppLineByPhoneNumberId('12345')).toBeNull();
    current = row(true);
    await jest.advanceTimersByTimeAsync(15000);
    expect(getWhatsAppLineByPhoneNumberId('12345')?.token).toBe('test-token');
    db.whatsapp_lines.findMany.mockRejectedValueOnce(
      new Error('database unavailable'),
    );
    await jest.advanceTimersByTimeAsync(15000);
    expect(getWhatsAppLineByPhoneNumberId('12345')?.token).toBe('test-token');
    current = row(false);
    await jest.advanceTimersByTimeAsync(15000);
    expect(getWhatsAppLineByPhoneNumberId('12345')).toBeNull();
    service.onModuleDestroy();
    const calls = db.whatsapp_lines.findMany.mock.calls.length;
    await jest.advanceTimersByTimeAsync(15000);
    expect(db.whatsapp_lines.findMany).toHaveBeenCalledTimes(calls);
    warn.mockRestore();
  });
});
