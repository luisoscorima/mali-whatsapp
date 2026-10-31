import {
  CONTACT_ONLY_LEAD_CHANNELS,
  formLikeCameWithInbound,
  originCameWithInbound,
  resolveLeadChatEnrichment,
  type ConversationHint,
} from './lead-origin.util';

describe('originCameWithInbound', () => {
  it('requires user-initiated thread for Instant Form / TikTok / widget', () => {
    const after = new Date('2026-09-07T12:00:00Z');
    const origin = new Date('2026-09-07T11:33:00Z');
    expect(
      originCameWithInbound('meta_lead_form', null, true, {
        userInitiated: true,
        firstMessageAt: after,
        originFirstSeenAt: origin,
      }),
    ).toBe(true);
    expect(
      originCameWithInbound('meta_lead_form', null, true, {
        userInitiated: false,
        firstMessageAt: after,
        originFirstSeenAt: origin,
      }),
    ).toBe(false);
    expect(
      originCameWithInbound('tiktok', null, true, {
        userInitiated: true,
        firstMessageAt: new Date('2026-06-25T15:58:00Z'),
        originFirstSeenAt: origin,
      }),
    ).toBe(false);
  });

  it('keeps CTWA / organic / links on conversation_id', () => {
    expect(originCameWithInbound('meta_ctwa', 9, false)).toBe(true);
    expect(originCameWithInbound('organic_wa', 9, false)).toBe(true);
    expect(originCameWithInbound('web_button', 9, false)).toBe(true);
    expect(originCameWithInbound('mali_one_link', null, true)).toBe(false);
  });

  it('never marks import/other as with inbound', () => {
    expect(CONTACT_ONLY_LEAD_CHANNELS.has('import')).toBe(true);
    expect(originCameWithInbound('import', 1, true)).toBe(false);
  });
});

describe('formLikeCameWithInbound / Brenda case', () => {
  it('ignores reply-to-campaign chats before Instant Form', () => {
    const formAt = new Date('2026-09-07T11:33:41Z');
    const campaignThread: ConversationHint = {
      id: 7381,
      has_inbound: true,
      user_initiated: false,
      first_message_at: new Date('2026-06-25T15:31:18Z'),
    };
    expect(formLikeCameWithInbound([campaignThread], formAt)).toBe(false);
  });

  it('marks TikTok when she opens the chat after the form', () => {
    const formAt = new Date('2026-10-30T08:50:26Z');
    const herChat: ConversationHint = {
      id: 81509,
      has_inbound: true,
      user_initiated: true,
      first_message_at: new Date('2026-10-30T08:50:36Z'),
    };
    expect(formLikeCameWithInbound([herChat], formAt)).toBe(true);
  });
});

describe('resolveLeadChatEnrichment', () => {
  it('marks Instant Form as Solo contacto when only campaign replies exist', () => {
    const byContact = new Map<number, ConversationHint[]>([
      [
        3618,
        [
          {
            id: 7381,
            has_inbound: true,
            user_initiated: false,
            first_message_at: new Date('2026-06-25T15:31:18Z'),
          },
        ],
      ],
    ]);
    const result = resolveLeadChatEnrichment(
      {
        channel: 'meta_lead_form',
        contact_id: 3618,
        conversation_id: null,
        first_seen_at: '2026-09-07T11:33:41.777Z',
      },
      { byId: new Map(), byContact, byPhone: new Map() },
    );
    expect(result.came_with_inbound).toBe(false);
    expect(result.chat_conversation_id).toBe(7381);
  });

  it('marks TikTok as came_with_inbound when she starts the thread after form', () => {
    const byContact = new Map<number, ConversationHint[]>([
      [
        10,
        [
          {
            id: 55,
            has_inbound: true,
            user_initiated: true,
            first_message_at: new Date('2026-10-30T08:50:36Z'),
          },
        ],
      ],
    ]);
    const result = resolveLeadChatEnrichment(
      {
        channel: 'tiktok',
        contact_id: 10,
        conversation_id: null,
        first_seen_at: '2026-10-30T08:50:26Z',
      },
      { byId: new Map(), byContact, byPhone: new Map() },
    );
    expect(result).toEqual({
      chat_conversation_id: 55,
      came_with_inbound: true,
    });
  });
});
