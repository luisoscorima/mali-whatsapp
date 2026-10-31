import {
  CONTACT_ONLY_LEAD_CHANNELS,
  originCameWithInbound,
  resolveLeadChatEnrichment,
} from './lead-origin.util';

describe('originCameWithInbound', () => {
  it('treats Instant Form Meta and TikTok like widget when there is inbound', () => {
    expect(originCameWithInbound('meta_lead_form', null, true)).toBe(true);
    expect(originCameWithInbound('meta_lead_form', null, false)).toBe(false);
    expect(originCameWithInbound('tiktok', null, true)).toBe(true);
    expect(originCameWithInbound('tiktok', null, false)).toBe(false);
    expect(originCameWithInbound('widget', null, true)).toBe(true);
  });

  it('keeps CTWA / organic / links on conversation_id', () => {
    expect(originCameWithInbound('meta_ctwa', 9, false)).toBe(true);
    expect(originCameWithInbound('organic_wa', 9, false)).toBe(true);
    expect(originCameWithInbound('mali_one_link', null, true)).toBe(false);
  });

  it('never marks import/other as with inbound', () => {
    expect(CONTACT_ONLY_LEAD_CHANNELS.has('import')).toBe(true);
    expect(CONTACT_ONLY_LEAD_CHANNELS.has('tiktok')).toBe(false);
    expect(originCameWithInbound('import', 1, true)).toBe(false);
  });
});

describe('resolveLeadChatEnrichment', () => {
  it('marks TikTok as came_with_inbound when contact has inbound chat', () => {
    const byContact = new Map([[10, { id: 55, has_inbound: true }]]);
    const result = resolveLeadChatEnrichment(
      { channel: 'tiktok', contact_id: 10, conversation_id: null },
      { byId: new Map(), byContact, byPhone: new Map() },
    );
    expect(result).toEqual({
      chat_conversation_id: 55,
      came_with_inbound: true,
    });
  });
});
