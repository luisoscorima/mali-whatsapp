import {
  getWhatsAppCredentialsForArea,
  getWhatsAppLineByPhoneNumberId,
  getWhatsAppLineForArea,
  resolveWhatsAppAreaFromCatalogWaba,
  setMetaSettingsCache,
  setWhatsAppLineCatalog,
  type WhatsAppLineCatalogRow,
} from './meta-settings.store';
import { resolveInboundArea } from '../webhook/webhook-area.util';
import { resolveWhatsAppSendCredentials } from '../conversations/conversation-whatsapp.util';
import { sendTemplateWithComponents } from '../templates/whatsapp-meta.util';

const ENV_KEYS = [
  'WHATSAPP_LINE_CATALOG_ENABLED',
  'WHATSAPP_TOKEN_EDUCACION',
  'PHONE_NUMBER_ID_EDUCACION',
  'WABA_ID_EDUCACION',
  'WHATSAPP_TOKEN_EDUCACION_CA',
  'PHONE_NUMBER_ID_EDUCACION_CA',
  'WABA_ID_EDUCACION_CA',
  'WHATSAPP_TOKEN_EDUCACION_EP',
  'WHATSAPP_CREDENTIALS_MASTER_KEY',
] as const;

const previousEnv = new Map<string, string | undefined>();

function catalogRows(): WhatsAppLineCatalogRow[] {
  return [
    {
      id: 10,
      phoneNumberId: 'pid-education',
      displayPhoneNumber: '+51 900 000 001',
      legacyArea: 'educacion',
      canonicalArea: 'educacion',
      programId: null,
      programKey: null,
      isDefault: true,
      wabaId: 'shared-waba',
      credentialSource: 'env',
      credentialRef: 'WHATSAPP_TOKEN_EDUCACION',
      encryptedToken: null,
    },
    {
      id: 11,
      phoneNumberId: 'pid-ca',
      displayPhoneNumber: '+51 900 000 002',
      legacyArea: 'educacion_ca',
      canonicalArea: 'educacion',
      programId: 100,
      programKey: 'ca',
      isDefault: false,
      wabaId: 'shared-waba',
      credentialSource: 'env',
      credentialRef: 'WHATSAPP_TOKEN_EDUCACION_CA',
      encryptedToken: null,
    },
  ];
}

describe('WhatsApp line catalog compatibility store', () => {
  beforeAll(() => {
    for (const key of ENV_KEYS) previousEnv.set(key, process.env[key]);
  });

  beforeEach(() => {
    setMetaSettingsCache([]);
    setWhatsAppLineCatalog([]);
    process.env.WHATSAPP_LINE_CATALOG_ENABLED = 'true';
    process.env.WHATSAPP_TOKEN_EDUCACION = 'token-t1';
    process.env.PHONE_NUMBER_ID_EDUCACION = 'legacy-pid-education';
    process.env.WABA_ID_EDUCACION = 'legacy-waba';
    process.env.WHATSAPP_TOKEN_EDUCACION_CA = 'token-t2';
    process.env.PHONE_NUMBER_ID_EDUCACION_CA = 'legacy-pid-ca';
    process.env.WABA_ID_EDUCACION_CA = 'legacy-waba-ca';
  });

  afterAll(() => {
    setMetaSettingsCache([]);
    setWhatsAppLineCatalog([]);
    for (const key of ENV_KEYS) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('resolves each legacy Education alias to its own line token', () => {
    setWhatsAppLineCatalog(catalogRows());

    expect(getWhatsAppCredentialsForArea('educacion')).toMatchObject({
      area: 'educacion',
      phoneNumberId: 'pid-education',
      token: 'token-t1',
    });
    expect(getWhatsAppCredentialsForArea('educacion_ca')).toMatchObject({
      area: 'educacion',
      phoneNumberId: 'pid-ca',
      token: 'token-t2',
    });
    expect(getWhatsAppLineByPhoneNumberId('pid-ca')).toMatchObject({
      id: 11,
      area: 'educacion',
      canonicalArea: 'educacion',
      programKey: 'ca',
      token: 'token-t2',
    });
    expect(getWhatsAppLineForArea('educacion_ca')).toMatchObject({ id: 11 });
  });

  it('changes the canonical default without changing the historical CA sender', () => {
    const rows = catalogRows();
    rows[0].isDefault = false;
    rows.push({
      ...rows[0],
      id: 12,
      legacyArea: null,
      phoneNumberId: 'pid-new',
      isDefault: true,
    });
    setWhatsAppLineCatalog(rows);
    expect(getWhatsAppCredentialsForArea('educacion').phoneNumberId).toBe(
      'pid-new',
    );
    expect(getWhatsAppCredentialsForArea('educacion_ca').phoneNumberId).toBe(
      'pid-ca',
    );
    expect(
      resolveWhatsAppSendCredentials({
        area: 'educacion',
        phoneNumberId: 'pid-ca',
      }).token,
    ).toBe('token-t2');
  });

  it('never resurrects a disabled line through environment or WABA fallbacks', async () => {
    const rows = catalogRows();
    rows[1].active = false;
    rows[1].phoneNumberId = 'legacy-pid-ca';
    setWhatsAppLineCatalog(rows);
    expect(getWhatsAppCredentialsForArea('educacion_ca').token).toBe('');
    expect(
      resolveInboundArea(
        { metadata: { phone_number_id: 'legacy-pid-ca' } },
        'shared-waba',
      ).area,
    ).toBeNull();
    expect(() =>
      resolveWhatsAppSendCredentials({
        area: 'educacion',
        phoneNumberId: 'legacy-pid-ca',
      }),
    ).toThrow('inactiva');
    await expect(
      sendTemplateWithComponents({
        area: 'educacion',
        phoneNumberId: 'legacy-pid-ca',
        to: '51900000001',
        templateName: 'test',
        languageCode: 'es',
      }),
    ).rejects.toThrow('inactiva');
  });

  it('does not route an unknown PID into the only active area in its WABA', () => {
    setWhatsAppLineCatalog([catalogRows()[0]]);
    expect(
      resolveInboundArea(
        { metadata: { phone_number_id: 'unknown-pid' } },
        'shared-waba',
      ).area,
    ).toBeNull();
  });

  it('routes synced Education lines to canonical area; category stays on program_key', () => {
    setWhatsAppLineCatalog([
      {
        id: 28,
        phoneNumberId: 'pid-edu-5',
        displayPhoneNumber: '+51 924 970 373',
        legacyArea: null,
        canonicalArea: 'educacion',
        programId: 2,
        programKey: 'ep',
        isDefault: false,
        wabaId: 'shared-waba',
        credentialSource: 'env',
        credentialRef: 'WHATSAPP_TOKEN_EDUCACION_EP',
        encryptedToken: null,
      },
    ]);
    process.env.WHATSAPP_TOKEN_EDUCACION_EP = 'token-ep5';
    expect(getWhatsAppLineByPhoneNumberId('pid-edu-5')).toMatchObject({
      area: 'educacion',
      programKey: 'ep',
      token: 'token-ep5',
    });
    expect(
      resolveInboundArea(
        { metadata: { phone_number_id: 'pid-edu-5' } },
        'shared-waba',
      ).area,
    ).toBe('educacion');
  });

  it('loads a newly activated line from a replacement snapshot without changing env', () => {
    const rows = catalogRows();
    const added = {
      ...rows[0],
      id: 12,
      phoneNumberId: 'pid-new',
      legacyArea: null,
      isDefault: false,
      active: false,
    };
    setWhatsAppLineCatalog([...rows, added]);
    expect(getWhatsAppLineByPhoneNumberId('pid-new')).toBeNull();
    setWhatsAppLineCatalog([...rows, { ...added, active: true }]);
    expect(
      resolveInboundArea(
        { metadata: { phone_number_id: 'pid-new' } },
        'shared-waba',
      ).area,
    ).toBe('educacion');
    expect(
      resolveWhatsAppSendCredentials({
        area: 'educacion',
        phoneNumberId: 'pid-new',
      }).phoneNumberId,
    ).toBe('pid-new');
  });

  it('resolves a shared Education WABA to the canonical area', () => {
    setWhatsAppLineCatalog(catalogRows());
    // General + CA lines share WABA; both map to educacion → área única.
    expect(resolveWhatsAppAreaFromCatalogWaba('shared-waba')).toBe('educacion');
    expect(resolveInboundArea({}, 'shared-waba')).toEqual({
      area: 'educacion',
      source: 'waba_entry_id',
    });
  });

  it('routes inbound by PID before considering its shared WABA', () => {
    setWhatsAppLineCatalog(catalogRows());
    expect(
      resolveInboundArea(
        { metadata: { phone_number_id: 'pid-ca' } },
        'shared-waba',
      ),
    ).toEqual({ area: 'educacion', source: 'phone_number_id' });
  });

  it('keeps the legacy environment fallback when the feature flag is off', () => {
    setWhatsAppLineCatalog(catalogRows());
    process.env.WHATSAPP_LINE_CATALOG_ENABLED = 'false';

    expect(getWhatsAppLineByPhoneNumberId('pid-ca')).toBeNull();
    expect(getWhatsAppLineForArea('educacion_ca')).toBeNull();
    expect(getWhatsAppCredentialsForArea('educacion_ca')).toMatchObject({
      area: 'educacion_ca',
      phoneNumberId: 'legacy-pid-ca',
      token: 'token-t2',
    });
  });

  it('resolves a transitional token referenced from app_settings', () => {
    setMetaSettingsCache([
      {
        area: 'educacion_ca',
        key: 'meta.whatsapp_token',
        value: 'database-token',
      },
    ]);
    const rows = catalogRows();
    rows[1] = {
      ...rows[1],
      credentialSource: 'app_settings',
      credentialRef: 'educacion_ca:meta.whatsapp_token',
    };
    setWhatsAppLineCatalog(rows);

    expect(getWhatsAppLineByPhoneNumberId('pid-ca')?.token).toBe(
      'database-token',
    );
  });

  it('resolves an encrypted database token without exposing it in the catalog', () => {
    process.env.WHATSAPP_CREDENTIALS_MASTER_KEY = Buffer.alloc(32, 9).toString(
      'base64',
    );
    const { encryptMetaToken } =
      require('./credential-vault.util') as typeof import('./credential-vault.util');
    const rows = catalogRows();
    rows[1] = {
      ...rows[1],
      credentialSource: 'encrypted_db',
      credentialRef: null,
      encryptedToken: encryptMetaToken('database-encrypted-token'),
    };
    setWhatsAppLineCatalog(rows);

    expect(getWhatsAppLineByPhoneNumberId('pid-ca')?.token).toBe(
      'database-encrypted-token',
    );
  });
});
