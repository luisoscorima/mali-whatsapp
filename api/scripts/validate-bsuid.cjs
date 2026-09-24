// Run after `npm run build` and migrate deploy on the isolated validation database.
// No real Meta calls: HTTP is blocked, and automated replies are replaced by a recorder.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const runId = Date.now();
const runtimeDb = `bsuid_runtime_${runId}`;
const upgradeDb = `bsuid_upgrade_${runId}`;
process.env.DATABASE_URL = `postgresql://postgres:bsuid_test_only@127.0.0.1:55439/${runtimeDb}`;
process.env.PHONE_NUMBER_ID_TI = 'bsuid-test-line';
process.env.WHATSAPP_TOKEN_TI = 'test-only';
global.fetch = async () => { throw new Error('External HTTP disabled in BSUID validation'); };
const { PrismaClient } = require('@prisma/client');
const { WebhookService } = require('../dist/webhook/webhook.service');
const { fetchRecipientsUnion, countRecipientsUnion } = require('../dist/campaigns/campaign-recipients.util');
const { persistCampaignChatMessage } = require('../dist/campaigns/campaign-chat-message.util');
const { ContactsService } = require('../dist/contacts/contacts.service');
const { LeadsService } = require('../dist/leads/leads.service');
const { EducationLeadWorkflowService } = require('../dist/leads/education-lead-workflow.service');
const prisma = new PrismaClient();
const container = 'mali-bsuid-validation';
function sql(database, input) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'],
    { input, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}
async function main() {
  // A second database simulates an upgrade with legacy data, including duplicates.
  sql('postgres', `CREATE DATABASE ${upgradeDb}; CREATE DATABASE ${runtimeDb};`);
  const migrations = path.join(__dirname, '../prisma/migrations');
  const names = fs.readdirSync(migrations).filter(n => fs.existsSync(path.join(migrations, n, 'migration.sql'))).sort();
  const identityMigration = '20260924110000_nullable_conversation_phone_no_replacements';
  const identityIndex = names.indexOf(identityMigration);
  assert.notEqual(identityIndex, -1);
  const readMigrations = migrationNames => migrationNames
    .map(name => fs.readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8')).join('\n');
  const precedingSql = readMigrations(names.slice(0, identityIndex));
  const identitySql = readMigrations([identityMigration]);
  const followingSql = readMigrations(names.slice(identityIndex + 1));
  sql(runtimeDb, readMigrations(names));
  sql(upgradeDb, precedingSql);
  sql(upgradeDb, `
    INSERT INTO contacts(id,name,area,phone,replaced_at,replacement_reason) VALUES (900001,'Legacy','ti','51911111111',NOW(),'old');
    INSERT INTO conversations(id,area,phone,whatsapp_user_id,contact_id) VALUES
      (900001,'ti','51911111111','PE.legacy',900001),
      (900002,'ti','PE.legacy',NULL,NULL),
      (900003,'ti','PE.only',NULL,NULL);
    INSERT INTO chat_messages(conversation_id,direction,wa_message_id,body_text) VALUES (900002,'inbound','migration-fixture','Preserve me');
    INSERT INTO conversation_tags(conversation_id,label) VALUES (900002,'Migrated');
  `);
  sql(upgradeDb, identitySql + '\n' + followingSql);
  sql(upgradeDb, `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM conversations WHERE id=900003 AND phone IS NULL AND whatsapp_user_id='PE.only') THEN RAISE EXCEPTION 'BSUID conversion failed'; END IF;
    IF EXISTS (SELECT 1 FROM conversations WHERE id=900002) THEN RAISE EXCEPTION 'Duplicate remains'; END IF;
    IF NOT EXISTS (SELECT 1 FROM chat_messages WHERE wa_message_id='migration-fixture' AND conversation_id=900001) THEN RAISE EXCEPTION 'History lost'; END IF;
    IF NOT EXISTS (SELECT 1 FROM conversation_tags WHERE conversation_id=900001 AND label='Migrated') THEN RAISE EXCEPTION 'Tag lost'; END IF;
    IF NOT EXISTS (SELECT 1 FROM contact_replacement_history WHERE old_contact_id=900001) THEN RAISE EXCEPTION 'Replacement audit lost'; END IF;
  END $$;`);
  console.log('PASS migration upgrade: legacy phone, BSUID conversion, duplicate history, tags, replacement audit');

  const replies = [];
  const webhook = new WebhookService(prisma, { handleInbound: async x => { replies.push(x); return { handled: true }; } },
    {}, { recordEducationOrganicOrigin: async () => {} }, { getCatalog: async () => [] });
  let message = 0;
  async function inbound(phone, userId, username = 'ana') {
    const id = `validation-${++message}`;
    await webhook.persistInboundMessages({ metadata: { phone_number_id: 'bsuid-test-line' },
      contacts: [{ ...(phone ? { wa_id: phone } : {}), ...(userId ? { user_id: userId } : {}), profile: { name: 'Ana', username } }],
      messages: [{ id, type: 'text', text: { body: 'Hola' }, ...(phone ? { from: phone } : {}), ...(userId ? { from_user_id: userId } : {}) }],
    }, {});
    const row = await prisma.chat_messages.findUniqueOrThrow({ where: { wa_message_id: id }, include: { conversations: true } });
    return row.conversations;
  }
  const legacy = await inbound('51922222222', null);
  const both = await inbound('51922222222', 'PE.testA');
  const hidden = await inbound(null, 'PE.testA', 'ana_changed');
  assert.equal(legacy.id, both.id);
  assert.equal(both.id, hidden.id);
  assert.equal(hidden.wa_username, 'ana_changed');
  const fresh = await inbound(null, 'PE.testB');
  assert.equal(fresh.phone, null);
  assert.equal(replies.at(-1).phone, 'PE.testB');
  const collision = await inbound('51922222222', 'PE.testC');
  assert.notEqual(collision.id, legacy.id);
  assert.equal(collision.phone, null);
  assert.equal(replies.at(-1).phone, 'PE.testC');
  console.log('PASS inbound: phone-only, both, hidden phone, username change, conflicting BSUID, reply recipient');

  const contact = await prisma.contacts.create({ data: { name: 'BSUID campaign', area: 'ti', whatsapp_user_id: 'PE.testB' } });
  await prisma.segment_definitions.create({ data: { area: 'ti', slug: 'validation', label: 'Validation' } });
  await prisma.contact_segments.create({ data: { area: 'ti', contact_id: contact.id, segment_slug: 'validation' } });
  await prisma.conversations.update({ where: { id: fresh.id }, data: { contact_id: contact.id } });
  const audience = await fetchRecipientsUnion(prisma, 'ti', ['validation']);
  assert.equal(audience.length, 1);
  assert.equal(audience[0].phone, 'PE.testB');
  assert.equal(audience[0].actual_phone, null);
  assert.equal(await countRecipientsUnion(prisma, 'ti', ['validation'], { excludeOpenServiceWindow: true }), 0);
  await persistCampaignChatMessage(prisma, { area: 'ti', campaignId: 1, contactId: contact.id, phone: 'PE.testB',
    waMessageId: 'validation-campaign', preview: { bodyText: 'Test', headerText: '' } });
  const sent = await prisma.chat_messages.findUniqueOrThrow({ where: { wa_message_id: 'validation-campaign' } });
  assert.equal(sent.conversation_id, fresh.id);
  console.log('PASS BSUID contact, campaign audience, service window exclusion, campaign history');

  // Multiple historical conversations must not duplicate recipients or bypass the open window exclusion.
  await prisma.conversations.create({ data: { area: 'ti', whatsapp_user_id: 'PE.historical', contact_id: contact.id,
    last_user_message_at: new Date('2020-01-01') } });
  assert.equal((await fetchRecipientsUnion(prisma, 'ti', ['validation'])).length, 1);
  assert.equal(await countRecipientsUnion(prisma, 'ti', ['validation'], { excludeOpenServiceWindow: true }), 0);
  console.log('PASS campaign audience deduplication and latest service window across conversations');

  const contacts = new ContactsService(prisma, { write: async () => {} });
  const operator = { area: 'ti', id: 1, email: 'validation@example.invalid' };
  await assert.rejects(contacts.create(operator, { name: 'Mismatch', phone: '51922222222', whatsapp_user_id: 'PE.unrelated', segments: ['validation'] }),
    /pertenecen a conversaciones distintas/);
  const created = await contacts.create(operator, { name: 'BSUID only', whatsapp_user_id: 'PE.testC', segments: ['validation'] });
  assert.equal(created.phone, null);
  await assert.rejects(contacts.update(operator, created.id, { name: 'Mismatch', phone: '51922222222', segments: ['validation'] }),
    /pertenecen a conversaciones distintas/);
  assert.equal((await prisma.conversations.findUniqueOrThrow({ where: { id: legacy.id } })).contact_id, null);
  console.log('PASS real ContactService BSUID creation and rejection of mismatched identity pairs');

  const importRow = { name: 'Imported', last_name: '', phone: '51933333333', segments: ['validation'], attributes: {} };
  await contacts.importSingleRow(operator, 'ti', importRow, []);
  await contacts.importSingleRow(operator, 'ti', { ...importRow, name: 'Updated import' }, []);
  assert.equal(await prisma.contacts.count({ where: { area: 'ti', phone: importRow.phone } }), 1);
  const imported = await prisma.contacts.findFirstOrThrow({ where: { area: 'ti', phone: importRow.phone } });
  await assert.rejects(contacts.update(operator, imported.id, { name: 'Changed', phone: '51944444444', segments: ['validation'] }),
    /El teléfono no se puede cambiar/);
  await contacts.importSingleRow(operator, 'ti', { ...importRow, phone: '51944444444' }, []);
  assert.equal(await prisma.contacts.count({ where: { area: 'ti', phone: { in: ['51933333333', '51944444444'] } } }), 2);
  console.log('PASS repeated import, immutable phone, new number creates separate contact');

  const wa = require('../dist/conversations/conversation-whatsapp.util');
  const { sendTemplateWithComponents } = require('../dist/templates/whatsapp-meta.util');
  const requests = [];
  global.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ messages: [{ id: 'simulated-outbound' }] }) };
  };
  for (const to of ['51933333333', 'PE.testB']) {
    const start = requests.length;
    await wa.sendSessionTextMessage({ to, text: 'Test', area: 'ti' });
    await wa.sendSessionInteractiveButtons({ to, bodyText: 'Test', buttons: [{ id: 'yes', title: 'Yes' }], area: 'ti' });
    await wa.sendMessageReaction({ to, waMessageId: 'inbound', emoji: '👍', area: 'ti' });
    for (const waType of ['image', 'video', 'audio', 'document']) {
      await wa.sendSessionMediaMessage({ to, area: 'ti', waType, mediaId: 'test-media' });
    }
    await sendTemplateWithComponents({ to, area: 'ti', templateName: 'test', languageCode: 'es' });
    assert.equal(requests.length - start, 8);
    for (const request of requests.slice(start)) {
      assert.equal(request[to.startsWith('PE.') ? 'recipient' : 'to'], to);
      assert.equal(request[to.startsWith('PE.') ? 'to' : 'recipient'], undefined);
    }
  }
  console.log('PASS outbound HTTP payloads for phone and BSUID: text, buttons, reaction, four media types, template (Meta simulated)');

  const leadUserId = 'PE.organicLead123';
  const leadConversation = await prisma.conversations.create({ data: {
    area: 'educacion_ca', phone: null, whatsapp_user_id: leadUserId,
    wa_profile_name: 'Ponce', wa_username: 'ponce.de.leon08',
    last_user_message_at: new Date(),
  } });
  const leadMessage = await prisma.chat_messages.create({ data: {
    conversation_id: leadConversation.id, direction: 'inbound',
    wa_message_id: `validation-organic-${runId}`, body_text: 'Vengo desde la web',
  } });
  const leads = new LeadsService(prisma, new EducationLeadWorkflowService(prisma));
  await leads.recordEducationOrganicOrigin({
    area: 'educacion_ca', conversationId: leadConversation.id,
    contactId: null, phone: null, whatsappUserId: leadUserId,
    name: 'Ponce', seenAt: leadMessage.created_at, messageId: leadMessage.id,
  });
  const leadContact = await prisma.contacts.findUniqueOrThrow({
    where: { area_whatsapp_user_id: { area: 'educacion_ca', whatsapp_user_id: leadUserId } },
  });
  const leadOrigin = await prisma.contact_origins.findUniqueOrThrow({
    where: { area_channel_external_id: {
      area: 'educacion_ca', channel: 'organic_wa',
      external_id: `conversation:${leadConversation.id}`,
    } },
  });
  assert.equal(leadOrigin.contact_id, leadContact.id);
  assert.equal(leadOrigin.whatsapp_user_id, leadUserId);
  assert.equal((await prisma.conversations.findUniqueOrThrow({ where: { id: leadConversation.id } })).contact_id, leadContact.id);
  assert.equal((await leads.listOrigins({ area: 'educacion_ca', q: '@ponce.de.leon08' })).total, 1);
  assert.equal(await prisma.education_lead_entries.count({ where: { contact_id: leadContact.id } }), 1);
  console.log('PASS BSUID-only organic lead: contact, origin, chat link, education entry, @username search');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
