// Local review probes: in-memory PostgreSQL only; no network or application DB.
// Run after `npm run build -w api`: node scripts/review-multiline.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
const { conversationCategoryPredicate } = require('../api/dist/config/business-scope');
const { fetchContactAttributesMap } = require('../api/dist/campaigns/contact-template-params.util');
const { runWithBusinessAccess } = require('../api/dist/business-model/business-access.context');
const { CampaignsService } = require('../api/dist/campaigns/campaigns.service');
const { fetchCampaignResponderMetrics } = require('../api/dist/campaigns/campaign-responders.util');
const { NotFoundException } = require('@nestjs/common');

async function main() {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    const root = path.join(__dirname, '../api/prisma/migrations');
    let count = 0;
    for (const dir of fs.readdirSync(root).sort()) {
      const file = path.join(root, dir, 'migration.sql');
      if (!fs.existsSync(file)) continue;
      try { await db.exec(fs.readFileSync(file, 'utf8')); count++; }
      catch (error) { throw new Error(`Migration ${dir}: ${error.message}`); }
    }
    console.log(`PASS: ${count} migrations applied to empty in-memory PostgreSQL`);

    const check = await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='app_settings_area_check'");
    assert.equal(check.rows.length, 0);
    await db.query("INSERT INTO app_settings(area,key,value) VALUES ('educacion_norte','ai_config','{}')");
    console.log('PASS: new category settings accepted (CHECK dropped)');

    await db.exec(`CREATE TEMP TABLE review_conversations(id int, area text, whatsapp_line_id int);
      CREATE TEMP TABLE whatsapp_lines(id int, program_id int, program_key text);
      CREATE TEMP TABLE business_programs(id int, slug text);
      INSERT INTO business_programs VALUES(20,'ep');
      INSERT INTO whatsapp_lines VALUES(100,20,'ep');
      INSERT INTO review_conversations VALUES (1,'educacion',100);`);
    const caPredicate = conversationCategoryPredicate('c', ['ca']);
    const stale = await db.query(`SELECT c.id FROM review_conversations c WHERE ${caPredicate.text}`, caPredicate.values);
    assert.equal(stale.rows.length, 0);
    const epPredicate = conversationCategoryPredicate('c', ['ep']);
    const moved = await db.query(`SELECT c.id FROM review_conversations c WHERE ${epPredicate.text}`, epPredicate.values);
    assert.equal(moved.rows.length, 1);
    console.log('PASS: after move to EP, conversation matches EP only (not CA)');

    const attrRows = [
      {contact_id: 1, attr_key: 'curso', attr_value: 'CA value', program_id: 10},
      {contact_id: 1, attr_key: 'curso', attr_value: 'EP value', program_id: 20},
      {contact_id: 1, attr_key: 'sede', attr_value: 'General sede', program_id: null},
    ];
    const attrsCa = await fetchContactAttributesMap({ contact_attributes: { findMany: async (args) => {
      const or = args?.where?.OR;
      if (!or) return attrRows;
      return attrRows.filter((row) => or.some((clause) =>
        Object.prototype.hasOwnProperty.call(clause, 'program_id') &&
        clause.program_id === row.program_id
      ));
    } } }, [1], { programId: 10 });
    assert.equal(attrsCa.get(1).curso, 'CA value');
    assert.equal(attrsCa.get(1).sede, 'General sede');
    console.log('PASS: template attribute map uses category program (+ generales)');

    let query;
    let retried = false;
    const service = new CampaignsService(
      {
        $queryRaw: async () => [],
        campaigns: {
          findFirst: async q => {
            query = q;
            return {id: 99, status: 'done', manual_retry_count: 0};
          },
        },
      },
      {},
      {runCampaignRetryJob: async () => { retried = true; return {retried: 1, recovered: 1, stillFailed: 0}; }},
      {write: async () => {}},
    );
    const user = {area: 'educacion', isMaster: false, businessAccess: {mode: 'restricted', businessAreaId: 4, canonicalArea: 'educacion', programIds: [10], lineIds: [1], categorySlugs: ['ca']}};
    await assert.rejects(
      () => runWithBusinessAccess(user, () => service.retryFailed(user, 99)),
      (error) => error instanceof NotFoundException,
    );
    assert.equal(retried, false);
    console.log('PASS: restricted CA user cannot retry campaign outside category scope');

    await db.exec(`
      CREATE TEMP TABLE campaigns (id int, area text, whatsapp_line_id int);
      CREATE TEMP TABLE campaign_logs (id int, campaign_id int, phone text, contact_id int, created_at timestamptz, status text);
      CREATE TEMP TABLE contacts (id int, name text, email text, dni text);
      CREATE TEMP TABLE conversations (id int, area text, phone text, whatsapp_user_id text, contact_id int, whatsapp_line_id int);
      CREATE TEMP TABLE chat_messages (id int, conversation_id int, direction text, created_at timestamptz, message_type text, body_text text, raw_payload jsonb);
      CREATE TEMP TABLE contact_segments (contact_id int, area text, segment_slug text, program_id int);
      CREATE TEMP TABLE segment_definitions (area text, slug text, label text, sort_order int, program_id int);
      INSERT INTO campaigns VALUES(1,'educacion',100);
      INSERT INTO campaign_logs VALUES(1,1,'51999999999',1,'2026-10-27T10:00:00Z','sent');
      INSERT INTO contacts VALUES(1,'Example','','');
      INSERT INTO conversations VALUES(10,'educacion','51999999999',NULL,1,100),(20,'educacion','51999999999',NULL,1,200);
      INSERT INTO chat_messages VALUES(1,20,'inbound','2026-10-27T11:00:00Z','text','Reply on OTHER line','{}');
    `);
    const metrics = await fetchCampaignResponderMetrics({$queryRaw: async q => (await db.query(q.text, q.values)).rows}, 1, 'educacion');
    assert.equal(metrics.responded_count, 0);
    console.log('PASS: campaign on line 100 ignores response exclusive to line 200');

    const unique = await db.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'whatsapp_templates'
        AND indexname = 'whatsapp_templates_whatsapp_waba_id_name_language_key'
    `);
    assert.equal(unique.rows.length, 1);
    console.log('PASS: templates unique by WABA + name + language');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
