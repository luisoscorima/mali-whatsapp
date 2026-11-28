import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  applyCampaignDeliveryWebhook,
  requireCampaignAcceptedMessageId,
  settleExistingCampaignWaWithoutResend,
} from './campaign-delivery-status.util';

describe('campaign delivery status', () => {
  let db: PGlite;
  let prisma: PrismaService;
  const prismaTag = (strings: TemplateStringsArray, values: unknown[]) =>
    Prisma.sql(strings, ...values);

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE campaign_logs (
        id int PRIMARY KEY,
        whatsapp_message_id text,
        status text NOT NULL,
        response jsonb,
        attempt int NOT NULL DEFAULT 1,
        retryable boolean NOT NULL DEFAULT true,
        last_retry_at timestamptz
      );
      CREATE TABLE chat_messages (
        id int PRIMARY KEY,
        wa_message_id text,
        raw_payload jsonb
      );
    `);

    prisma = {
      $executeRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const query = prismaTag(strings, values);
        return (await db.query(query.text, query.values)).affectedRows;
      },
      $queryRaw: async (
        strings: TemplateStringsArray,
        ...values: unknown[]
      ) => {
        const query = prismaTag(strings, values);
        return (await db.query(query.text, query.values)).rows;
      },
    } as unknown as PrismaService;
  }, 30000);

  beforeEach(async () => {
    await db.exec('TRUNCATE campaign_logs, chat_messages;');
  });

  afterAll(async () => {
    await db?.close();
  });

  async function seed(input: {
    logStatus: string;
    responseStatus?: string;
    chatStatus?: string;
  }) {
    await db.query(
      `INSERT INTO campaign_logs
        (id, whatsapp_message_id, status, response)
       VALUES (1, 'wamid.1', $1, $2)`,
      [
        input.logStatus,
        JSON.stringify(
          input.responseStatus ? { status: input.responseStatus } : {},
        ),
      ],
    );
    await db.query(
      `INSERT INTO chat_messages (id, wa_message_id, raw_payload)
       VALUES (1, 'wamid.1', $1)`,
      [
        JSON.stringify({
          delivery_status: { status: input.chatStatus || 'sent' },
        }),
      ],
    );
  }

  async function current() {
    const log = (
      await db.query<{
        status: string;
        attempt: number;
        retryable: boolean;
      }>('SELECT status, attempt, retryable FROM campaign_logs WHERE id=1')
    ).rows[0];
    const chat = (
      await db.query<{ status: string }>(`
        SELECT raw_payload->'delivery_status'->>'status' AS status
        FROM chat_messages WHERE id=1
      `)
    ).rows[0];
    return { log, chat };
  }

  it.each([
    { source: 'log', logStatus: 'failed', chatStatus: 'sent' },
    {
      source: 'response',
      logStatus: 'error',
      responseStatus: 'failed',
      chatStatus: 'sent',
    },
    { source: 'chat', logStatus: 'error', chatStatus: 'failed' },
  ])('does not heal a provider failure found in $source', async (row) => {
    await seed(row);

    await expect(
      settleExistingCampaignWaWithoutResend(prisma, {
        logId: 1,
        waMessageId: 'wamid.1',
        nextAttempt: 2,
      }),
    ).resolves.toBe('failed');
    expect((await current()).log).toEqual({
      status: 'failed',
      attempt: 2,
      retryable: false,
    });
  });

  it('heals only an error with a wamid and no provider failure', async () => {
    await seed({ logStatus: 'error', chatStatus: 'sent' });

    await expect(
      settleExistingCampaignWaWithoutResend(prisma, {
        logId: 1,
        waMessageId: 'wamid.1',
        nextAttempt: 2,
      }),
    ).resolves.toBe('sent');
    expect((await current()).log).toEqual({
      status: 'sent',
      attempt: 2,
      retryable: false,
    });
  });

  it('keeps failed terminal when a delayed sent webhook arrives', async () => {
    await seed({
      logStatus: 'failed',
      responseStatus: 'failed',
      chatStatus: 'failed',
    });

    await applyCampaignDeliveryWebhook(prisma, 'wamid.1', 'sent', {
      id: 'wamid.1',
      status: 'sent',
    });

    const state = await current();
    expect(state.log.status).toBe('failed');
    expect(state.chat.status).toBe('failed');
  });

  it('lets failed win after read and preserves normal delivery ordering', async () => {
    await seed({ logStatus: 'sent', chatStatus: 'sent' });

    await applyCampaignDeliveryWebhook(prisma, 'wamid.1', 'delivered', {
      id: 'wamid.1',
      status: 'delivered',
    });
    await applyCampaignDeliveryWebhook(prisma, 'wamid.1', 'sent', {
      id: 'wamid.1',
      status: 'sent',
    });
    expect((await current()).chat.status).toBe('delivered');

    await applyCampaignDeliveryWebhook(prisma, 'wamid.1', 'failed', {
      id: 'wamid.1',
      status: 'failed',
    });
    const state = await current();
    expect(state.log.status).toBe('failed');
    expect(state.chat.status).toBe('failed');
  });

  it('requires a wamid before a campaign send can be marked sent', () => {
    expect(
      requireCampaignAcceptedMessageId({ messages: [{ id: ' wamid.1 ' }] }),
    ).toBe('wamid.1');
    expect(() => requireCampaignAcceptedMessageId({ messages: [] })).toThrow(
      'WhatsApp respondió sin wamid',
    );
  });
});
