import {
  formatWaIdentityDisplay,
  pickAdvisor,
} from './contact-communication-report.util';

describe('contact-communication-report', () => {
  it('formatea username de WhatsApp con @', () => {
    expect(formatWaIdentityDisplay('ana_mali', null)).toBe('@ana_mali');
    expect(formatWaIdentityDisplay('@ana_mali', null)).toBe('@ana_mali');
  });

  it('usa BSUID si no hay username', () => {
    expect(formatWaIdentityDisplay(null, 'PE.13491208655302741918')).toBe(
      'PE.13491208655302741918',
    );
  });

  it('no elige mensajes inbound como primer asesor', () => {
    const inbound = {
      conversation_id: 1,
      direction: 'inbound',
      body_text: 'Hola',
      message_type: 'text',
      is_ai: false,
      raw_payload: {},
      created_at: new Date('2025-01-01T10:00:00Z'),
      id: 1,
      rn_abs_asc: 1,
      rn_abs_desc: 0,
      rn_in_asc: 1,
      rn_in_desc: 0,
      rn_adv_asc: 0,
      rn_adv_desc: 0,
    };
    const outbound = {
      ...inbound,
      direction: 'outbound',
      body_text: 'Respuesta asesor',
      id: 2,
      rn_abs_asc: 0,
      rn_in_asc: 0,
      raw_payload: {
        _mali_sender: { label: 'juan', user_id: 5 },
      },
      created_at: new Date('2025-01-01T10:05:00Z'),
    };

    expect(pickAdvisor([inbound], 'first')).toBeUndefined();
    expect(pickAdvisor([inbound, outbound], 'first')).toBe(outbound);
  });
});
