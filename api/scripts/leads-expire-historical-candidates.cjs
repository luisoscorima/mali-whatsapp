/**
 * List (or optionally close) historical open cycles past 60d that the auto job skips.
 *
 * Auto expire only touches rows with inactivity_deadline_at set (post-activation).
 * Historical opens keep deadline NULL after migration → candidates here.
 *
 * Usage:
 *   node api/scripts/leads-expire-historical-candidates.cjs
 *   node api/scripts/leads-expire-historical-candidates.cjs --apply   # closes with close_reason=historical_expire_batch
 *
 * Requires DATABASE_URL. Default is dry-run.
 */
const { Prisma, PrismaClient } = require('@prisma/client');

const apply = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number(limitArg.slice(8)) || 500) : 500;

async function main() {
  const prisma = new PrismaClient();
  try {
    const total = await prisma.$queryRaw`
      SELECT COUNT(*)::int AS n
      FROM education_lead_cycles
      WHERE closed_at IS NULL
        AND inactivity_deadline_at IS NULL
        AND last_interaction_at < (NOW() - INTERVAL '60 days')`;

    const sample = await prisma.$queryRaw`
      SELECT c.id, c.area, c.person_id, c.contact_id, c.program_id,
             c.assigned_user_id, c.lead_status_id, c.started_at, c.last_interaction_at,
             s.slug AS status_slug
      FROM education_lead_cycles c
      LEFT JOIN lead_status_definitions s ON s.id = c.lead_status_id
      WHERE c.closed_at IS NULL
        AND c.inactivity_deadline_at IS NULL
        AND c.last_interaction_at < (NOW() - INTERVAL '60 days')
      ORDER BY c.last_interaction_at ASC, c.id ASC
      LIMIT ${limit}`;

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          candidates_total: total[0]?.n ?? 0,
          sample_size: sample.length,
          close_reason: 'historical_expire_batch',
          hint: 'Review sample before --apply. Auto job never closes these (deadline IS NULL).',
          sample,
        },
        null,
        2,
      ),
    );

    if (!apply) return;

    const ids = sample.map((r) => r.id);
    if (!ids.length) return;
    const updated = await prisma.$queryRaw`
      WITH closed AS (
      UPDATE education_lead_cycles
      SET closed_at = NOW(),
          close_reason = 'historical_expire_batch',
          updated_at = NOW()
      WHERE id IN (${Prisma.join(ids)})
        AND closed_at IS NULL
        AND inactivity_deadline_at IS NULL
        AND last_interaction_at < (NOW() - INTERVAL '60 days')
      RETURNING id, closed_at
      ), ended_links AS (
        UPDATE education_lead_conversation_links link
        SET unlinked_at = GREATEST(link.linked_at, closed.closed_at)
        FROM closed WHERE link.cycle_id = closed.id AND link.unlinked_at IS NULL
      ) SELECT id FROM closed`;
    console.log(JSON.stringify({ closed: updated.length, cycle_ids: updated.map(row => row.id) }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
