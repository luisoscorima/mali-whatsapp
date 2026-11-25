import { PGlite } from '@electric-sql/pglite';
import type { Prisma } from '@prisma/client';
import type { ResolvedWhatsAppLine } from '../meta-settings/meta-settings.store';
import { rebindPamCutoverIdentity } from './pam-cutover-identity.util';

describe('PAM cutover identity', () => {
  const oldPhoneId = '1139890925881358';
  const newPhoneId = '1441307959065007';
  const phone = '51911112222';
  const oldUserId = 'PE.old123';
  const newUserId = 'PE.new123';
  const line = {
    id: 2,
    canonicalArea: 'pam',
    wabaId: '3141752249499039',
  } as ResolvedWhatsAppLine;
  let db: PGlite;
  const prisma = {
    $queryRaw: jest.fn(
      async (query: Prisma.Sql) =>
        (await db.query(query.text, query.values)).rows,
    ) as unknown as Prisma.TransactionClient['$queryRaw'],
  };
  const inbound = {
    area: 'pam',
    metadataPhoneId: newPhoneId,
    line,
    record: { type: 'text', from: phone, from_user_id: newUserId },
    contacts: undefined,
    phone,
    userId: newUserId,
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE contacts (
        id integer PRIMARY KEY, person_id integer, area text, active boolean,
        phone text, whatsapp_user_id text, updated_at timestamptz,
        UNIQUE (area, whatsapp_user_id)
      );
      CREATE TABLE conversations (
        id integer PRIMARY KEY, contact_id integer REFERENCES contacts,
        area text, business_area_id integer DEFAULT 2, whatsapp_line_id integer, whatsapp_phone_number_id text,
        phone text, whatsapp_user_id text, wa_username text, updated_at timestamptz,
        UNIQUE (whatsapp_line_id, phone), UNIQUE (whatsapp_line_id, whatsapp_user_id)
      );
      CREATE TABLE chat_messages (
        id integer GENERATED ALWAYS AS IDENTITY, conversation_id integer REFERENCES conversations,
        direction text, wa_message_id text UNIQUE, raw_payload jsonb
      );
      CREATE TABLE whatsapp_identity_events (
        business_area_id integer, area text, event_type text,
        previous_user_id text, new_user_id text, raw_payload jsonb
      );
    `);
  }, 30000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await db.exec(`
      TRUNCATE chat_messages, conversations, contacts, whatsapp_identity_events;
      INSERT INTO contacts VALUES (15, 7, 'pam', true, '${phone}', '${oldUserId}', now());
      INSERT INTO contacts VALUES (14, 7, 'educacion', true, '${phone}', '${oldUserId}', now());
      INSERT INTO conversations VALUES
        (10, 15, 'pam', 2, 2, '${newPhoneId}', '${phone}', '${oldUserId}', 'mali.amigo', now());
      INSERT INTO chat_messages (conversation_id, direction, wa_message_id, raw_payload)
      VALUES (10, 'inbound', 'previous', '{
        "from": "${phone}", "from_user_id": "${oldUserId}",
        "_mali_routing": { "phone_number_id": "${oldPhoneId}" }
      }');
    `);
  });

  it('keeps the historical PAM chat, history and contact without changing any shared contact identity', async () => {
    await expect(rebindPamCutoverIdentity(prisma, inbound)).resolves.toEqual({
      contactId: 15,
      reboundChatId: 10,
    });
    await expect(
      rebindPamCutoverIdentity(prisma, {
        ...inbound,
        phone: null,
        record: { type: 'text', from_user_id: newUserId },
      }),
    ).resolves.toEqual({ contactId: 15 });
    const result = await db.query(`
      SELECT c.id AS conversation_id, ct.id AS contact_id, ct.person_id,
             c.whatsapp_user_id AS chat_user, ct.whatsapp_user_id AS contact_user,
             msg.wa_message_id
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      JOIN chat_messages msg ON msg.conversation_id = c.id
    `);
    expect(result.rows).toEqual([
      {
        conversation_id: 10,
        contact_id: 15,
        person_id: 7,
        chat_user: newUserId,
        contact_user: oldUserId,
        wa_message_id: 'previous',
      },
    ]);
    const shared = await db.query(
      'SELECT DISTINCT whatsapp_user_id FROM contacts WHERE person_id = 7',
    );
    expect(shared.rows).toEqual([{ whatsapp_user_id: oldUserId }]);
    const events = await db.query(
      'SELECT event_type FROM whatsapp_identity_events',
    );
    expect(events.rows).toEqual([{ event_type: 'pam_cutover_rebind' }]);
  });

  it('leaves another area and webhooks without the new PAM phone metadata out of the database', async () => {
    await expect(
      rebindPamCutoverIdentity(prisma, { ...inbound, area: 'educacion' }),
    ).resolves.toBeNull();
    await expect(
      rebindPamCutoverIdentity(prisma, {
        ...inbound,
        metadataPhoneId: undefined,
      }),
    ).resolves.toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('requires evidence from the previous PAM number and does not replace a current identity', async () => {
    await db.query(
      `UPDATE chat_messages SET raw_payload = raw_payload ||
      jsonb_build_object('_mali_routing', jsonb_build_object('phone_number_id', $1::text))`,
      [newPhoneId],
    );
    await expect(rebindPamCutoverIdentity(prisma, inbound)).resolves.toBeNull();
    await db.exec(`
      INSERT INTO chat_messages (conversation_id, direction, wa_message_id, raw_payload)
      VALUES (10, 'inbound', 'legacy-proof', '{
        "from": "${phone}", "from_user_id": "${oldUserId}",
        "_mali_routing": { "phone_number_id": "${oldPhoneId}" }
      }');
    `);
    await expect(rebindPamCutoverIdentity(prisma, inbound)).resolves.toBeNull();
  });

  it('leaves an incoming ID already linked to another PAM contact for review', async () => {
    await db.query(
      `INSERT INTO contacts VALUES (16, 8, 'pam', true, NULL, $1, now())`,
      [newUserId],
    );
    await expect(rebindPamCutoverIdentity(prisma, inbound)).resolves.toBeNull();
  });

  it('accepts a username match only with a reply to an outbound message in that PAM chat', async () => {
    const usernameInbound = {
      ...inbound,
      phone: null,
      record: { type: 'text', from_user_id: newUserId },
      contacts: [{ user_id: newUserId, profile: { username: '@Mali.Amigo' } }],
    };
    await expect(
      rebindPamCutoverIdentity(prisma, usernameInbound),
    ).resolves.toBeNull();
    await db.exec(`
      INSERT INTO chat_messages (conversation_id, direction, wa_message_id, raw_payload)
      VALUES (10, 'outbound', 'new-campaign', '{
        "_mali_routing": { "phone_number_id": "${newPhoneId}" }
      }');
    `);
    await expect(
      rebindPamCutoverIdentity(prisma, {
        ...usernameInbound,
        record: { ...usernameInbound.record, context: { id: 'new-campaign' } },
      }),
    ).resolves.toEqual({ contactId: 15, reboundChatId: 10 });
  });
});
