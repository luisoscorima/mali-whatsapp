import { validateContactIdentityInput } from './contacts-validation.utils';
import { normalizeWhatsAppRecipient } from '../conversations/whatsapp-recipient.util';

describe('Contactos con identidad de WhatsApp', () => {
  const segments = new Set(['clientes']);
  const base = { name: 'Ana', last_name: '', segments: ['clientes'] };

  it('guarda un BSUID sin inventar un teléfono', () => {
    expect(validateContactIdentityInput(
      { ...base, whatsapp_user_id: 'PE.13491208655302741918' },
      segments,
    )).toEqual({
      ok: true,
      value: {
        name: 'Ana', last_name: '', segments: ['clientes'],
        phone: null, whatsapp_user_id: 'PE.13491208655302741918',
      },
    });
  });

  it('exige un teléfono o BSUID válido', () => {
    expect(validateContactIdentityInput(base, segments).ok).toBe(false);
    expect(validateContactIdentityInput(
      { ...base, whatsapp_user_id: '@ana' }, segments,
    ).ok).toBe(false);
  });

  it('conserva el BSUID de campaña y normaliza un teléfono real', () => {
    expect(normalizeWhatsAppRecipient('PE.13491208655302741918'))
      .toBe('PE.13491208655302741918');
    expect(normalizeWhatsAppRecipient('+51 912 345 678'))
      .toBe('51912345678');
  });
});
