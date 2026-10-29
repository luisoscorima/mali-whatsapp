/** Integration checks on the local copy. All fixture/index changes are rolled back. */
const fs = require('node:fs');
const path = require('node:path');
const url = new URL(process.env.DATABASE_URL || '');
if (url.hostname !== 'mali-leads-rehearsal-20261029' || url.pathname !== '/leads_rehearsal') {
  throw new Error('Only the isolated rehearsal container is allowed');
}
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json');
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const { EducationLeadWorkflowService } = require('../src/leads/education-lead-workflow.service.ts');
const { withLeadCreateSavepoint } = require('../src/leads/education-lead-lifecycle.util.ts');
const prisma = new PrismaClient();
const results = [];
const rollback = new Error('REHEARSAL_ROLLBACK');
const check = (name, ok, detail) => results.push({ name, passed: !!ok, detail });
async function main() {
  try {
    await prisma.$transaction(async tx => {
      const adapter = new Proxy(tx, { get(target, prop) {
        if (prop === '$transaction') return async cb => typeof cb === 'function' ? cb(tx) : Promise.all(cb);
        return Reflect.get(target, prop);
      }});
      const service = new EducationLeadWorkflowService(adapter);
      check('real_flag_remains_off', !(await service.isAttentionV1Enabled()));
      // Simulate enabled behavior in memory only; never write the feature flag.
      service.isAttentionV1Enabled = async () => true;
      const expiry = await service.expireDueCycles(200);
      check('historical_cycles_not_auto_expired', expiry.expired === 0, expiry);
      const area = await tx.business_areas.findUnique({ where: { slug: 'educacion' } });
      const programs = await tx.business_programs.findMany({ where: { business_area_id: area.id, slug: { in: ['ca','ep'] } }, orderBy:{slug:'asc'} });
      const advisors = await tx.users.findMany({ where: { is_provisioned: true }, take: 2 });
      const person = await tx.people.create({data:{ name:'REHEARSAL ROLLBACK' }});
      const contact = await tx.contacts.create({data:{name:'REHEARSAL ROLLBACK',person_id:person.id,business_area_id:area.id,area:'educacion'}});
      const conversations = [];
      for (const program of programs) {
        const line = await tx.whatsapp_lines.findFirst({where:{program_id:program.id}});
        conversations.push(await tx.conversations.create({data:{area:'educacion',business_area_id:area.id,contact_id:contact.id,whatsapp_line_id:line.id}}));
      }
      const leads = [];
      for (const conversation of conversations) leads.push(await service.startAttention({contactId:contact.id,area:'educacion',conversationId:conversation.id}));
      check('two_categories_two_leads', leads.length===2 && leads[0].id!==leads[1].id && leads[0].program_id!==leads[1].program_id);
      check('cta_without_message_has_null_first_inbound', leads.every(c=>c.first_inbound_at===null));
      const repeat = await service.startAttention({contactId:contact.id,area:'educacion',conversationId:conversations[0].id});
      check('repeated_start_reuses_cycle', repeat.id===leads[0].id);
      const claim = await service.reserveClaim({leadId:leads[0].id,userId:advisors[0].id,conversationId:conversations[0].id});
      check('first_claim_wins',claim.claimed);
      const secondClaim = await service.reserveClaim({leadId:leads[0].id,userId:advisors[1].id,conversationId:conversations[0].id});
      check('another_advisor_cannot_take_claim',!secondClaim.claimed);
      const untouched = await tx.conversations.findUnique({where:{id:conversations[1].id}});
      check('claim_does_not_assign_other_category_chat',untouched.assigned_user_id===null,{other_category_chat_assigned:untouched.assigned_user_id!==null});
      const sold = await tx.lead_status_definitions.findFirst({where:{area:'educacion',slug:'venta_exitosa'}});
      await service.updateManagement(contact.id,'educacion',{lead_id:leads[0].id,lead_status_id:sold.id});
      await service.recordInbound({area:'educacion',contactId:contact.id,conversationId:conversations[0].id,messageId:2147483000,channel:'organic_wa',occurredAt:new Date()});
      check('organic_after_close_does_not_reopen',await tx.education_lead_cycles.count({where:{person_id:person.id,program_id:leads[0].program_id,closed_at:null}})===0);
      const oldLink = await tx.education_lead_conversation_links.findFirst({where:{cycle_id:leads[0].id,conversation_id:conversations[0].id}});
      check('closing_cycle_ends_link_period',oldLink?.unlinked_at!=null);
      service.isAttentionV1Enabled = async () => false;
      let refused = false;
      try { await service.startAttention({contactId:contact.id,area:'educacion'}); } catch(e) { refused = e.message.includes('activada'); }
      check('flag_off_blocks_start',refused);
      throw rollback;
    },{timeout:60000});
  } catch(e) { if(e!==rollback) results.push({name:'workflow_execution',passed:false,detail:e.message}); }
  try {
    await prisma.$transaction(async tx => {
      const data = { area:'educacion',key:'rehearsal.unique_probe',value:'local_rollback' };
      await tx.app_settings.create({data});
      try { await tx.app_settings.create({data}); } catch(e) {
        check('prisma_unique_failure_is_P2002',e.code==='P2002');
      }
      await tx.app_settings.findUnique({where:{area_key:{area:data.area,key:data.key}}});
      throw rollback;
    });
  } catch(e) {
    check('unique_error_aborts_transaction_without_savepoint',String(e.message).includes('25P02') || String(e.message).includes('current transaction is aborted'));
  }
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE UNIQUE INDEX rehearsal_probe_open_program_uq ON education_lead_cycles(person_id,business_area_id,program_id) WHERE closed_at IS NULL AND program_id IS NOT NULL');
      throw rollback;
    });
  } catch(e) {
    check('unique_index_correctly_rejects_unresolved_conflicts',e!==rollback && (String(e.message).includes('23505') || String(e.message).includes('could not create unique index')));
  }
  try {
    await prisma.$transaction(async tx => {
      const data = { area:'educacion',key:'rehearsal.savepoint_probe',value:'rollback' };
      const winner = await tx.app_settings.create({data});
      try {
        await withLeadCreateSavepoint(tx, () => tx.app_settings.create({data}));
      } catch(e) {
        check('savepoint_preserves_P2002', e.code === 'P2002');
      }
      const recovered = await tx.app_settings.findUnique({where:{area_key:{area:data.area,key:data.key}}});
      check('savepoint_allows_reading_winner', recovered.id === winner.id);
      throw rollback;
    });
  } catch(e) { if(e!==rollback) check('savepoint_execution',false,e.message); }
  const output='/app/backups/leads-rehearsal-20261029/integration-checks.json';
  fs.writeFileSync(output,JSON.stringify({at:new Date().toISOString(),fixture_changes:'rolled back',flag:'not modified',results},null,2)+'\n');
  console.log(JSON.stringify(results,null,2));
  await prisma.$disconnect();
  if (results.some(result=>!result.passed)) process.exitCode=1;
}
main().catch(async e=>{ console.error(e.message); await prisma.$disconnect();process.exitCode=1; });
