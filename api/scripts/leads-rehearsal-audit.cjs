/** Read-only audit of an isolated local lifecycle rehearsal. Never accepts a production URL. */
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (!['127.0.0.1', 'localhost', 'mali-leads-rehearsal-20261029'].includes(url.hostname) || url.pathname !== '/leads_rehearsal') {
    throw new Error('Only localhost/leads_rehearsal is allowed');
  }
  const output = path.resolve(process.argv[2] || 'backups/leads-rehearsal-20261029');
  const backupRoot = path.resolve(__dirname, '../../backups');
  const relative = path.relative(backupRoot, output);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Output must stay in backups/');
  fs.mkdirSync(output, { recursive: true });
  const prisma = new PrismaClient();
  try {
    const data = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '30s'");
      const counts = await tx.$queryRawUnsafe(`SELECT count(*)::int AS total_cycles,
        count(*) FILTER (WHERE closed_at IS NULL)::int AS open_cycles,
        count(*) FILTER (WHERE closed_at IS NULL AND inactivity_deadline_at<=now())::int AS auto_expiry_due_cycles,
        count(*) FILTER (WHERE closed_at IS NULL AND last_interaction_at<=now()-interval '60 days')::int AS historical_60d_candidates,
        count(*) FILTER (WHERE closed_at IS NULL AND lead_status_id IS NULL)::int AS without_status,
        count(*) FILTER (WHERE person_id IS NULL)::int AS missing_person
        FROM education_lead_cycles`);
      const flags = await tx.$queryRawUnsafe("SELECT area,value FROM app_settings WHERE key='leads.attention_v1'");
      const alerts = await tx.$queryRawUnsafe('SELECT count(*)::int AS n FROM education_lead_alerts');
      const conflicts = await tx.$queryRawUnsafe(`WITH groups AS (
          SELECT person_id,business_area_id,program_id FROM education_lead_cycles WHERE closed_at IS NULL
          GROUP BY person_id,business_area_id,program_id HAVING count(*)>1
        ) SELECT c.person_id,c.business_area_id,c.program_id,coalesce(p.slug,'general') AS category,
          json_agg(json_build_object('cycle_id',c.id,'contact_id',c.contact_id,'area',c.area,
          'advisor_id',c.assigned_user_id,'status_id',c.lead_status_id,'status_slug',s.slug,
          'score',c.lead_score,'started_at',c.started_at,'last_interaction_at',c.last_interaction_at,
          'entries', (SELECT count(*) FROM education_lead_entries e WHERE e.cycle_id=c.id),
          'first_entry_at',(SELECT min(e.occurred_at) FROM education_lead_entries e WHERE e.cycle_id=c.id),
          'last_entry_at',(SELECT max(e.occurred_at) FROM education_lead_entries e WHERE e.cycle_id=c.id)
          ) ORDER BY c.started_at,c.id) AS cycles
        FROM education_lead_cycles c JOIN groups g ON g.person_id=c.person_id
          AND g.business_area_id=c.business_area_id AND g.program_id IS NOT DISTINCT FROM c.program_id
        LEFT JOIN business_programs p ON p.id=c.program_id
        LEFT JOIN lead_status_definitions s ON s.id=c.lead_status_id
        WHERE c.closed_at IS NULL
        GROUP BY c.person_id,c.business_area_id,c.program_id,p.slug ORDER BY c.person_id,c.program_id`);
      const expiry = await tx.$queryRawUnsafe(`SELECT c.id AS cycle_id,c.person_id,c.contact_id,
          c.area,coalesce(p.slug,'general') AS category,c.assigned_user_id,c.lead_status_id,
          c.started_at,c.last_interaction_at,c.inactivity_deadline_at
        FROM education_lead_cycles c LEFT JOIN business_programs p ON p.id=c.program_id
        WHERE c.closed_at IS NULL AND c.last_interaction_at<=now()-interval '60 days' ORDER BY c.last_interaction_at,c.id`);
      const migration = await tx.$queryRawUnsafe(`SELECT migration_name,finished_at,rolled_back_at
        FROM _prisma_migrations WHERE migration_name='20261028120000_leads_additive_lifecycle'`);
      return { counts: counts[0], flags, alerts: alerts[0].n, conflicts, expiry, migration };
    }, { timeout: 90000 });
    const rows = data.conflicts.map(group => {
      const cycles = group.cycles;
      const distinct = key => new Set(cycles.map(c => c[key] ?? '<sin valor>')).size;
      const reasons = [];
      if (distinct('advisor_id') > 1) reasons.push('asesores_distintos_incluye_sin_asignar');
      if (distinct('status_id') > 1) reasons.push('estados_distintos_incluye_sin_estado');
      const managementConflict = reasons.length > 0;
      if (distinct('score') > 1) reasons.push('calificaciones_distintas');
      if (distinct('contact_id') > 1) reasons.push('fichas_distintas');
      if (cycles.some(c => !c.started_at || !c.last_interaction_at || !c.entries)) reasons.push('evidencia_incompleta');
      if (cycles.some((c, i) => cycles.slice(i + 1).some(next =>
        Date.parse(c.last_interaction_at) >= Date.parse(next.started_at)))) reasons.push('periodos_solapados');
      const nonNullAdvisors = new Set(cycles.filter(c => c.advisor_id != null).map(c => c.advisor_id)).size;
      const nonNullStatuses = new Set(cycles.filter(c => c.status_id != null).map(c => c.status_id)).size;
      return {
        person_id: group.person_id, business_area_id: group.business_area_id,
        program_id: group.program_id, category: group.category,
        cycle_ids: cycles.map(c => c.cycle_id).join('|'),
        management_conflict: managementConflict,
        previous_count_criterion: nonNullAdvisors > 1 || nonNullStatuses > 1,
        review: reasons.length ? 'manual' : 'candidato_requiere_validar',
        reasons: reasons.join('|') || 'misma_gestion_sin_solapamiento_detectado',
        suggested_keep_id: reasons.length ? '' : [...cycles].sort((a,b) =>
          Date.parse(b.last_interaction_at)-Date.parse(a.last_interaction_at) || b.cycle_id-a.cycle_id)[0].cycle_id,
        cycles_json: JSON.stringify(cycles),
      };
    });
    const csv = (name, list) => {
      if (!list.length) { fs.writeFileSync(path.join(output,name),'sin_registros\n'); return; }
      const columns = Object.keys(list[0]);
      const cell = value => '"' + String(value instanceof Date ? value.toISOString() : value ?? '').replace(/"/g,'""') + '"';
      fs.writeFileSync(path.join(output,name), '\uFEFF' + [columns.map(cell).join(','), ...list.map(r => columns.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n');
    };
    csv('conflicts-all.csv', rows);
    csv('conflicts-manual.csv', rows.filter(r=>r.review==='manual'));
    csv('conflicts-management.csv', rows.filter(r=>r.management_conflict));
    csv('conflicts-candidates.csv', rows.filter(r=>r.review!=='manual'));
    csv('conflicts-manual-details.csv', rows.filter(r=>r.review==='manual').flatMap(row =>
      JSON.parse(row.cycles_json).map(cycle => ({
        person_id: row.person_id, category: row.category, program_id: row.program_id,
        cycle_id: cycle.cycle_id, contact_id: cycle.contact_id, area: cycle.area,
        advisor_id: cycle.advisor_id ?? 'sin_asignar', status_id: cycle.status_id ?? 'sin_estado',
        status: cycle.status_slug ?? 'sin_estado', score: cycle.score,
        started_at: cycle.started_at, last_interaction_at: cycle.last_interaction_at,
        entries: cycle.entries, first_entry_at: cycle.first_entry_at, last_entry_at: cycle.last_entry_at,
        review_reasons: row.reasons, proposed_action: 'pendiente_revision',
      }))));
    csv('expiry-candidates.csv', data.expiry);
    const summary = {
      audited_at: new Date().toISOString(), scope: 'local snapshot; production unchanged',
      ...data.counts, migration: data.migration, flags: data.flags, alerts: data.alerts,
      conflict_groups: rows.length,
      conflicting_cycles: data.conflicts.reduce((n,g)=>n+g.cycles.length,0),
      management_conflicts_null_aware: rows.filter(r=>r.management_conflict).length,
      management_conflicts_previous_count: rows.filter(r=>r.previous_count_criterion).length,
      manual_review_groups: rows.filter(r=>r.review==='manual').length,
      provisional_candidates: rows.filter(r=>r.review!=='manual').length,
      note: 'Candidates are proposals only. No closures, expiry, alerts or index changes executed by this script.',
    };
    fs.writeFileSync(path.join(output,'audit-summary.json'),JSON.stringify(summary,null,2)+'\n');
    console.log(JSON.stringify(summary,null,2));
  } finally { await prisma.$disconnect(); }
}
main().catch(error=>{ console.error(error.message); process.exitCode=1; });
