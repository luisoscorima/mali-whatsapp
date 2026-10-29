/**
 * Post-migration checks for education lead lifecycle (read-mostly).
 *
 * Usage:
 *   node api/scripts/leads-backfill-lifecycle.cjs
 *   node api/scripts/leads-backfill-lifecycle.cjs --alerts   # OPT-IN: backfill new_lead for open cycles
 *
 * Requires DATABASE_URL. Does not invent missing history.
 * Default mode never creates alerts (would notify every historical open cycle).
 */
const { PrismaClient } = require('@prisma/client');

const wantAlerts = process.argv.includes('--alerts');

async function main() {
  const prisma = new PrismaClient();
  try {
    const openWithoutPerson = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n FROM education_lead_cycles
      WHERE person_id IS NULL`;
    const openCount = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n FROM education_lead_cycles
      WHERE closed_at IS NULL`;
    const openDupes = await prisma.$queryRaw`
      SELECT person_id, business_area_id, program_id, COUNT(*)::int AS n
      FROM education_lead_cycles
      WHERE closed_at IS NULL
      GROUP BY person_id, business_area_id, program_id
      HAVING COUNT(*) > 1
      LIMIT 20`;
    const conflictRows = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n
      FROM education_lead_open_conflicts
      WHERE resolved_at IS NULL`.catch(() => [{ n: null }]);
    const alertsMissing = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n
      FROM education_lead_cycles c
      WHERE c.closed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM education_lead_alerts a
          WHERE a.cycle_id = c.id AND a.event_type = 'new_lead'
        )`;
    const dueExpire = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n
      FROM education_lead_cycles
      WHERE closed_at IS NULL
        AND last_interaction_at < (NOW() - INTERVAL '60 days')`;
    const noStatus = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n
      FROM education_lead_cycles
      WHERE closed_at IS NULL AND lead_status_id IS NULL`;

    console.log(JSON.stringify({
      open_cycles: openCount[0]?.n ?? 0,
      open_without_person: openWithoutPerson[0]?.n ?? 0,
      unresolved_conflicts: conflictRows[0]?.n,
      open_duplicate_samples: openDupes,
      open_without_alert: alertsMissing[0]?.n ?? 0,
      open_due_60d: dueExpire[0]?.n ?? 0,
      open_without_status: noStatus[0]?.n ?? 0,
      alerts_mode: wantAlerts ? 'write' : 'dry-run (pass --alerts to backfill)',
      hint: 'Resolve conflicts, then deferred_open_unique.sql, before leads.attention_v1=1.',
    }, null, 2));

    if (!wantAlerts) {
      console.log(JSON.stringify({
        alerts_backfilled: 0,
        note: 'Skipped historical alert insert. Use --alerts only for a deliberate subset after review.',
      }));
      return;
    }

    const created = await prisma.$executeRaw`
      INSERT INTO education_lead_alerts (cycle_id, business_area_id, program_id, area, event_type, created_at)
      SELECT c.id, c.business_area_id, c.program_id, c.area, 'new_lead', c.started_at
      FROM education_lead_cycles c
      WHERE c.closed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM education_lead_alerts a
          WHERE a.cycle_id = c.id AND a.event_type = 'new_lead'
        )
      ON CONFLICT DO NOTHING`;
    console.log(JSON.stringify({ alerts_backfilled: created }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
