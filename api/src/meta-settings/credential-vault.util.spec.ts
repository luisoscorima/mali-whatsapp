import {
  assertCredentialVaultConfigured,
  decryptMetaToken,
  encryptMetaToken,
  fingerprintMetaToken,
} from './credential-vault.util';

const ENV_KEY = 'WHATSAPP_CREDENTIALS_MASTER_KEY';

describe('credential vault', () => {
  const previous = process.env[ENV_KEY];

  beforeEach(() => {
    process.env[ENV_KEY] = Buffer.alloc(32, 7).toString('base64');
  });

  afterAll(() => {
    if (previous === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = previous;
  });

  it('encrypts with random authenticated envelopes and decrypts losslessly', () => {
    const first = encryptMetaToken('EAA-secret-token');
    const second = encryptMetaToken('EAA-secret-token');

    expect(first).not.toBe(second);
    expect(first).not.toContain('EAA-secret-token');
    expect(decryptMetaToken(first)).toBe('EAA-secret-token');
    expect(decryptMetaToken(second)).toBe('EAA-secret-token');
  });

  it('rejects tampered ciphertext', () => {
    const encrypted = encryptMetaToken('token');
    const parts = encrypted.split('.');
    parts[3] = `${parts[3]!.slice(0, -1)}A`;
    expect(() => decryptMetaToken(parts.join('.'))).toThrow();
  });

  it('requires a 32-byte master key', () => {
    process.env[ENV_KEY] = 'too-short';
    expect(() => assertCredentialVaultConfigured()).toThrow(
      'exactamente 32 bytes',
    );
  });

  it('creates deterministic fingerprints without exposing the token', () => {
    const fingerprint = fingerprintMetaToken('token');
    expect(fingerprint).toHaveLength(64);
    expect(fingerprint).toBe(fingerprintMetaToken('token'));
    expect(fingerprint).not.toContain('token');
  });
});

