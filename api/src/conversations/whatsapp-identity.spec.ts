import {
  chooseWhatsAppIdentityMatch,
  isComplementaryIdentityPair,
  pickComplementaryKeepDrop,
} from './whatsapp-identity.util';

describe('WhatsApp identity matching', () => {
  it('rejects a phone owned by a different BSUID even when the incoming BSUID is new', () => {
    expect(
      chooseWhatsAppIdentityMatch(
        null,
        { id: 2, whatsapp_user_id: 'PE.old' },
        'PE.new',
      ),
    ).toEqual({ match: null, conflict: 'hard' });
  });

  it('can attach a BSUID to a legacy phone identity with no BSUID', () => {
    const legacy = { id: 2, whatsapp_user_id: null, phone: '51999999999' };
    expect(chooseWhatsAppIdentityMatch(null, legacy, 'PE.new')).toEqual({
      match: legacy,
      conflict: 'none',
    });
  });

  it('marks complementary BSUID-only + phone-only as mergeable', () => {
    const bsuid = { id: 1, whatsapp_user_id: 'PE.x', phone: null };
    const phone = { id: 2, whatsapp_user_id: null, phone: '51977313683' };
    expect(chooseWhatsAppIdentityMatch(bsuid, phone)).toEqual({
      match: bsuid,
      conflict: 'complementary',
    });
    expect(isComplementaryIdentityPair(bsuid, phone)).toBe(true);
    expect(pickComplementaryKeepDrop(bsuid, phone)).toEqual({
      keep: bsuid,
      drop: phone,
    });
  });

  it('prefers the BSUID and reports a hard collision when both sides are filled', () => {
    expect(
      chooseWhatsAppIdentityMatch(
        { id: 1, whatsapp_user_id: 'PE.a', phone: '511' },
        { id: 2, whatsapp_user_id: 'PE.b', phone: '522' },
      ),
    ).toEqual({
      match: { id: 1, whatsapp_user_id: 'PE.a', phone: '511' },
      conflict: 'hard',
    });
    expect(chooseWhatsAppIdentityMatch(null, { id: 2, phone: '522' })).toEqual({
      match: { id: 2, phone: '522' },
      conflict: 'none',
    });
  });
});
