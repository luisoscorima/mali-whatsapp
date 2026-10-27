import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import type { AuthUser } from '../auth/auth.types';
import {
  buildLastMessageDateRangeSql,
  parseInboxDateParam,
} from './inbox-query.util';

describe('bounded conversation history', () => {
  const rows = Array.from({ length: 123 }, (_, i) => ({
    id: i + 1,
    conversation_id: 7,
    direction: 'inbound',
    body_text: `Message ${i + 1}`,
    message_type: 'text',
    is_ai: false,
    raw_payload: null,
    // Dates deliberately tie and disagree with ID order.
    created_at: new Date(Date.UTC(2026, 9, 21, 12, i % 20)),
  }));
  const matches = (row: (typeof rows)[number], where: any) =>
    row.conversation_id === where.conversation_id &&
    (typeof where.id !== 'number' || row.id === where.id) &&
    (where.id?.lt == null || row.id < where.id.lt) &&
    (where.id?.lte == null || row.id <= where.id.lte) &&
    (where.id?.gt == null || row.id > where.id.gt) &&
    (!where.NOT || row.message_type.toLowerCase() !== 'reaction');

  function setup() {
    const prisma = {
      conversations: {
        findFirst: jest.fn().mockResolvedValue({ id: 7, contact_id: 1 }),
      },
      chat_messages: {
        findFirst: jest.fn(
          async ({ where }) => rows.find((row) => matches(row, where)) ?? null,
        ),
        findMany: jest.fn(async ({ where, orderBy, take }) => {
          expect(take).toBeLessThanOrEqual(51);
          return rows
            .filter((row) => matches(row, where))
            .sort((a, b) => (orderBy.id === 'asc' ? a.id - b.id : b.id - a.id))
            .slice(0, take);
        }),
      },
    };
    const service = new ConversationsService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'loadConversationTimelineEvents')
      .mockResolvedValue([]);
    jest
      .spyOn(service as any, 'enrichMessagesSenderFromAudit')
      .mockImplementation(async (_a, _c, messages) => messages);
    return { service, prisma };
  }

  it('loads only the latest 50 and reports more history', async () => {
    const { service } = setup();
    const page = await service['loadInboxMessagePage'](7);
    expect(page.rows.map((r) => r.id)).toEqual(
      rows.slice(-50).map((r) => r.id),
    );
    expect(page.hasOlder).toBe(true);
    expect(page.hasNewer).toBe(false);
    expect(page.eventRange.from).toBeInstanceOf(Date);
  });

  it('walks backwards without gaps or duplicates even with tied/unordered dates', async () => {
    const { service } = setup();
    let page = await service['loadInboxMessagePage'](7);
    let ids = page.rows.map((r) => r.id);
    while (page.hasOlder) {
      page = await service['loadInboxMessagePage'](7, {
        beforeIdRaw: String(page.rows[0].id),
      });
      ids = [...page.rows.map((r) => r.id), ...ids];
    }
    expect(ids).toEqual(rows.map((r) => r.id));
    expect(page.eventRange.from).toBeUndefined();
  });

  it('opens a search hit directly and can walk forward to the latest message', async () => {
    const { service, prisma } = setup();
    let page = await service['loadInboxMessagePage'](7, { aroundIdRaw: '20' });
    expect(page.rows.at(-1)?.id).toBe(20);
    expect(prisma.chat_messages.findMany).toHaveBeenCalledTimes(1);
    expect(page.hasNewer).toBe(true);
    let ids = page.rows.map((r) => r.id);
    while (page.hasNewer) {
      page = await service['loadInboxMessagePage'](7, {
        afterIdRaw: String(page.rows.at(-1)!.id),
      });
      ids.push(...page.rows.map((r) => r.id));
    }
    expect(ids).toEqual(rows.map((r) => r.id));
  });

  it('excludes legacy reaction rows before applying the page limit', async () => {
    const { service } = setup();
    rows[122].message_type = 'REACTION';
    try {
      const page = await service['loadInboxMessagePage'](7);
      expect(page.rows).toHaveLength(50);
      expect(page.rows.at(-1)?.id).toBe(122);
    } finally {
      rows[122].message_type = 'text';
    }
  });

  it.each([
    { beforeIdRaw: '0' },
    { afterIdRaw: '-1' },
    { aroundIdRaw: '1.5' },
    { limitRaw: '2.5' },
    { beforeIdRaw: '20', afterIdRaw: '21' },
  ])('rejects invalid pagination: %j', async (opts) => {
    await expect(
      setup().service['loadInboxMessagePage'](7, opts),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a cursor outside this conversation', async () => {
    await expect(
      setup().service['loadInboxMessagePage'](8, { aroundIdRaw: '20' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('checks the user area before reading historical messages', async () => {
    const { service, prisma } = setup();
    prisma.conversations.findFirst.mockResolvedValue(null);
    await expect(
      service.getOlderMessages({ area: 'pam' } as AuthUser, 7, '50'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.conversations.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 7, area: { in: ['pam'] } }),
      }),
    );
    expect(prisma.chat_messages.findMany).not.toHaveBeenCalled();
  });

  it('returns bounded messages and timeline events through the history endpoint', async () => {
    const { service } = setup();
    const result = await service.getOlderMessages(
      { area: 'ti' } as AuthUser,
      7,
      '100',
    );
    expect(result.messages).toHaveLength(50);
    expect(result.messages[0].id).toBe(50);
    expect(result.messages.at(-1)?.id).toBe(99);
    expect(result.has_older_messages).toBe(true);
    expect(result.events).toEqual([]);
  });

  it('bounds live updates, including a burst into an initially empty chat', async () => {
    const { service } = setup();
    jest.spyOn(service as any, 'loadMessageReactions').mockResolvedValue([]);
    jest.spyOn(service as any, 'loadMessageDeliveries').mockResolvedValue([]);
    jest
      .spyOn(service as any, 'clearInboxUnreadOnOpen')
      .mockResolvedValue(undefined);
    jest.spyOn(service as any, 'loadAiAreaEnabled').mockResolvedValue(false);
    const first = await service.getUpdates({ area: 'ti' } as AuthUser, 7, 0);
    expect(first.messages.map((m) => m.id)).toEqual(
      rows.slice(0, 50).map((r) => r.id),
    );
    expect(first.has_newer_messages).toBe(true);
    const next = await service.getUpdates({ area: 'ti' } as AuthUser, 7, 50);
    expect(next.messages.map((m) => m.id)).toEqual(
      rows.slice(50, 100).map((r) => r.id),
    );
  });
});

describe('inbox calendar range', () => {
  it.each(['2026-02-30', '2026-13-01', '2026-00-10', 'junk'])(
    'ignores an invalid calendar date %s',
    (value) => {
      expect(parseInboxDateParam(value)).toBeNull();
    },
  );
  it('accepts a real leap day', () => {
    expect(parseInboxDateParam('2024-02-29')).toBe('2024-02-29');
  });
  it('converts the bounds instead of wrapping the indexed timestamp column', () => {
    const query = buildLastMessageDateRangeSql('2026-10-01', '2026-10-21');
    expect(query.text).toContain('c.last_message_at >=');
    expect(query.text).toContain('c.last_message_at <');
    expect(query.text).not.toContain('c.last_message_at AT TIME ZONE');
    expect(query.values).toEqual([
      '2026-10-01',
      expect.any(String),
      '2026-10-21',
      expect.any(String),
    ]);
  });
});
