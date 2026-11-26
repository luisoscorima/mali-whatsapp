import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import { readMessageDelivery } from '../conversations/chat-delivery.util';
import type { PrismaService } from '../prisma/prisma.service';
import { WhatsAppGraphRequestError } from '../templates/whatsapp-meta.util';
import {
  claimOutboundDispatch,
  isConfirmedOutboundFailure,
  isOutboundUncertain,
  markOutboundUncertain,
  persistOutboundAccepted,
  promoteScheduledOutbound,
  settleOutboundFailure,
  stashOutboundAcceptedWamid,
} from './outbound-accepted.util';

describe('durable outbound dispatch', () => {
  let db: PGlite;
  let prisma: PrismaService;
  const prismaTag = (strings: TemplateStringsArray, values: unknown[]) =>
    Prisma.sql(strings, ...values);

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE chat_messages (id int PRIMARY KEY, wa_message_id text, raw_payload jsonb);
      CREATE TABLE campaign_logs (wamid text PRIMARY KEY);
    `);

    const adapter = {
      $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const { text, values: params } = prismaTag(strings, values);
        return (await db.query(text, params)).affectedRows;
      },
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => db.transaction((tx) =>
        fn({
          $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
            const { text, values: params } = prismaTag(strings, values);
            return (await tx.query(text, params)).rows;
          },
          chat_messages: {
            update: ({ where, data }: { where: { id: number }; data: {
              wa_message_id?: string; raw_payload: unknown;
            } }) => tx.query(
              'UPDATE chat_messages SET wa_message_id = COALESCE($2, wa_message_id), raw_payload = $3 WHERE id = $1',
              [where.id, data.wa_message_id ?? null, JSON.stringify(data.raw_payload)],
            ),
          },
          campaign_logs: {
            create: ({ data }: { data: { whatsapp_message_id: string } }) =>
              tx.query('INSERT INTO campaign_logs VALUES ($1)', [data.whatsapp_message_id]),
          },
        }),
      ),
    };
    prisma = adapter as unknown as PrismaService;
  }, 30000);

  beforeEach(async () => {
    await db.exec(`
      TRUNCATE chat_messages, campaign_logs;
      INSERT INTO chat_messages VALUES (1, NULL, '{"delivery_status":{"status":"pending"}}');
    `);
  });

  afterAll(async () => { await db?.close(); });

  async function message() {
    return (await db.query<{ wa_message_id: string | null; raw_payload: unknown }>(
      'SELECT wa_message_id, raw_payload FROM chat_messages WHERE id = 1',
    )).rows[0];
  }

  it('claims the send once and keeps an ambiguous result ineligible', async () => {
    const claims = await Promise.all([claimOutboundDispatch(prisma, 1), claimOutboundDispatch(prisma, 1)]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    await settleOutboundFailure(prisma, 1, 'Queue reply lost', 'before-dispatch');
    expect((await message()).raw_payload).toMatchObject({ outbound_dispatch_started: true });
    await markOutboundUncertain(prisma, 1, 'Meta reply lost');
    expect(isOutboundUncertain((await message()).raw_payload)).toBe(true);
    expect(await claimOutboundDispatch(prisma, 1)).toBe(false);
  });

  it('marks a scheduled message failed when enqueue never reaches Redis', async () => {
    await db.query(
      'UPDATE chat_messages SET raw_payload = $1 WHERE id = 1',
      [JSON.stringify({
        status: 'scheduled',
        scheduled_at: '2099-01-01T12:00:00.000Z',
        delivery_status: { status: 'scheduled' },
      })],
    );
    await settleOutboundFailure(prisma, 1, 'Redis down', 'before-dispatch');
    expect(readMessageDelivery((await message()).raw_payload)).toMatchObject({
      status: 'failed',
    });
  });

  it('records the send time only once Meta accepts a scheduled message', async () => {
    await db.query(
      'UPDATE chat_messages SET raw_payload = $1 WHERE id = 1',
      [JSON.stringify({ status: 'scheduled', scheduled_at: '2099-01-01T12:00:00.000Z' })],
    );
    expect(await promoteScheduledOutbound(prisma, 1)).toBe(true);
    expect((await message()).raw_payload).not.toHaveProperty('sent_at');

    const acceptedAt = '2099-01-01T12:05:00.000Z';
    await stashOutboundAcceptedWamid(prisma, 1, 'wamid.1', acceptedAt);
    await persistOutboundAccepted(prisma, { messageId: 1, waMessageId: 'wamid.1' });
    expect((await message()).raw_payload).toMatchObject({
      status: 'sent',
      sent_at: acceptedAt,
    });
  });

  it('rolls back a failed campaign finalization and resumes from an accepted ID', async () => {
    await claimOutboundDispatch(prisma, 1);
    await stashOutboundAcceptedWamid(prisma, 1, 'wamid.1');
    await expect(persistOutboundAccepted(prisma, {
      messageId: 1,
      waMessageId: 'wamid.1',
      finalize: async () => { throw new Error('campaign write failed'); },
    })).rejects.toThrow('campaign write failed');
    expect((await message()).wa_message_id).toBeNull();
    expect(await claimOutboundDispatch(prisma, 1)).toBe(false);
    await persistOutboundAccepted(prisma, {
      messageId: 1,
      waMessageId: 'wamid.1',
      finalize: async (tx) => {
        await tx.campaign_logs.create({
          data: { campaign_id: 1, phone: '1', status: 'sent', whatsapp_message_id: 'wamid.1' },
        });
      },
    });
    expect((await message()).wa_message_id).toBe('wamid.1');
    expect((await db.query('SELECT wamid FROM campaign_logs')).rows).toEqual([{ wamid: 'wamid.1' }]);
  });

  it.each(['read', 'delivered', 'failed'])('preserves a provider webhook in state %s', async (status) => {
    const webhook = { status, timestamp: '1' };
    await db.query(
      'UPDATE chat_messages SET wa_message_id = $1, raw_payload = $2 WHERE id = 1',
      ['wamid.1', JSON.stringify({ delivery_status: webhook })],
    );
    await persistOutboundAccepted(prisma, {
      messageId: 1,
      waMessageId: 'wamid.1',
      patch: { delivery_status: { status: 'sent' } },
    });
    expect((await message()).raw_payload).toMatchObject({ delivery_status: webhook });
  });

  it('uses provider status rather than the text to identify a confirmed rejection', () => {
    expect(isConfirmedOutboundFailure(new WhatsAppGraphRequestError('Invalid recipient', 400))).toBe(true);
    expect(isConfirmedOutboundFailure(new Error('Wrapped', {
      cause: new WhatsAppGraphRequestError('Unknown error', 500),
    }))).toBe(false);
    expect(isConfirmedOutboundFailure(new WhatsAppGraphRequestError('Timeout', 408))).toBe(false);
    expect(isConfirmedOutboundFailure(new SyntaxError('Invalid JSON'))).toBe(false);
  });

  it('offers manual retry only for failures without a provider acceptance', () => {
    expect(readMessageDelivery({
      outbound_accepted_wamid: 'wamid.1', delivery_status: { status: 'failed' },
    }).retryable).toBe(false);
    expect(readMessageDelivery({
      outbound_uncertain: true, delivery_status: { status: 'failed' },
    }).retryable).toBe(false);
    expect(readMessageDelivery({ delivery_status: { status: 'failed' } }).retryable)
      .not.toBe(false);
  });
});
