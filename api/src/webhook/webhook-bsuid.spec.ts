import { whatsappRecipientField } from '../conversations/whatsapp-recipient.util';
import { sendSessionTextMessage } from '../conversations/conversation-whatsapp.util';
import { sendTemplateWithComponents } from '../templates/whatsapp-meta.util';
import {
  extractInboundProfileName,
  extractInboundSenderIdentity,
} from './webhook-inbound.util';

describe('WhatsApp BSUID identity', () => {
  const userId = 'PE.13491208655302741918';

  it('keeps the phone and BSUID together when Meta provides both', () => {
    const contacts = [{ wa_id: '51912345678', user_id: userId, profile: { name: 'Ana' } }];
    expect(extractInboundSenderIdentity({ from: '51912345678', from_user_id: userId }, contacts))
      .toEqual({ phone: '51912345678', userId, recipient: '51912345678' });
    expect(whatsappRecipientField('51912345678')).toEqual({ to: '51912345678' });
  });

  it('accepts a username user whose phone is absent and addresses replies by BSUID', () => {
    const contacts = [{ user_id: userId, profile: { username: 'ana_mali' } }];
    expect(extractInboundSenderIdentity({ from_user_id: userId }, contacts))
      .toEqual({ phone: null, userId, recipient: userId });
    expect(extractInboundProfileName(contacts, userId)).toBe('ana_mali');
    expect(whatsappRecipientField(userId)).toEqual({ recipient: userId });
  });

  it('does not turn the digits inside an alias into a phone number', () => {
    expect(extractInboundSenderIdentity({ from: userId }, undefined))
      .toEqual({ phone: null, userId, recipient: userId });
    expect(extractInboundSenderIdentity({ from: 'invalid.alias' }, undefined)).toBeNull();
  });

  it('sends a BSUID using the Cloud API recipient field', async () => {
    const originalFetch = global.fetch;
    const originalToken = process.env.WHATSAPP_TOKEN_TI;
    const originalLine = process.env.PHONE_NUMBER_ID_TI;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.reply' }] }),
    });
    global.fetch = fetchMock as typeof fetch;
    process.env.WHATSAPP_TOKEN_TI = 'test-token';
    process.env.PHONE_NUMBER_ID_TI = 'test-line';
    try {
      await sendSessionTextMessage({ to: userId, text: 'Respuesta', area: 'ti' });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body).toMatchObject({ recipient: userId, type: 'text' });
      expect(body).not.toHaveProperty('to');
    } finally {
      global.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.WHATSAPP_TOKEN_TI;
      else process.env.WHATSAPP_TOKEN_TI = originalToken;
      if (originalLine === undefined) delete process.env.PHONE_NUMBER_ID_TI;
      else process.env.PHONE_NUMBER_ID_TI = originalLine;
    }
  });

  it('sends a campaign template to a BSUID using recipient', async () => {
    const originalFetch = global.fetch;
    const originalToken = process.env.WHATSAPP_TOKEN_TI;
    const originalLine = process.env.PHONE_NUMBER_ID_TI;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.template' }] }),
    });
    global.fetch = fetchMock as typeof fetch;
    process.env.WHATSAPP_TOKEN_TI = 'test-token';
    process.env.PHONE_NUMBER_ID_TI = 'test-line';
    try {
      await sendTemplateWithComponents({
        to: userId, templateName: 'saludo', languageCode: 'es', area: 'ti',
      });
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body).toMatchObject({ recipient: userId, type: 'template' });
      expect(body).not.toHaveProperty('to');
    } finally {
      global.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.WHATSAPP_TOKEN_TI;
      else process.env.WHATSAPP_TOKEN_TI = originalToken;
      if (originalLine === undefined) delete process.env.PHONE_NUMBER_ID_TI;
      else process.env.PHONE_NUMBER_ID_TI = originalLine;
    }
  });
});
