import { chooseWhatsAppIdentityMatch } from './whatsapp-identity.util';

describe('WhatsApp identity matching', () => {
  it('rejects a phone owned by a different BSUID even when the incoming BSUID is new', () => {
    expect(chooseWhatsAppIdentityMatch(null, { id: 2, whatsapp_user_id: 'PE.old' }, 'PE.new'))
      .toEqual({ match: null, conflict: true });
  });

  it('can attach a BSUID to a legacy phone identity with no BSUID', () => {
    const legacy = { id: 2, whatsapp_user_id: null };
    expect(chooseWhatsAppIdentityMatch(null, legacy, 'PE.new'))
      .toEqual({ match: legacy, conflict: false });
  });
  it('prefers the BSUID and reports a phone collision without merging', () => {
    expect(chooseWhatsAppIdentityMatch({ id: 1 }, { id: 2 })).toEqual({
      match: { id: 1 }, conflict: true,
    });
    expect(chooseWhatsAppIdentityMatch(null, { id: 2 })).toEqual({
      match: { id: 2 }, conflict: false,
    });
  });
});
