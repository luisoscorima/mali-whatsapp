/**
 * Propose conflict resolutions (dry-run by default).
 *
 * Rules (product 2026-10-29):
 * - Keep cycle with the most recent assigned advisor (first_assigned_at, else last_interaction_at).
 *   Unassigned loses to assigned. If both unassigned, keep most recent last_interaction_at.
 * - On the keeper: set lead_status_id to the latest non-null status among the group
 *   (by last_interaction_at of the cycle that carries that status). Empty is OK if none.
 * - Losers: close with close_reason=superseded_duplicate; end live conversation links.
 *
 * Usage (isolated/local or prod host via docker):
 *   node api/scripts/leads-conflicts-propose.cjs
 *   node api/scripts/leads-conflicts-propose.cjs --apply   # WRITES; require ALLOW_APPLY=1
 *
 * Requires DATABASE_URL. Never invents history.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Prisma, PrismaClient } = require('@prisma/client');

const apply = process.argv.includes('--apply');
const allowApply = process.env.ALLOW_APPLY === '1';
const outputDir = process.env.OUTPUT_DIR || '';

function ts(value) {
  if (!value) return 0;
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function pickKeeper(cycles) {
  const assigned = cycles.filter((c) => c.assigned_user_id != null);
  const pool = assigned.length ? assigned : cycles;
  return [...pool].sort((a, b) => {
    const aa = ts(a.first_assigned_at) || ts(a.last_interaction_at);
    const ba = ts(b.first_assigned_at) || ts(b.last_interaction_at);
    if (ba !== aa) return ba - aa;
    const al = ts(a.last_interaction_at);
    const bl = ts(b.last_interaction_at);
    if (bl !== al) return bl - al;
    return b.id - a.id;
  })[0];
}

function pickStatusId(cycles) {
  const withStatus = cycles.filter((c) => c.lead_status_id != null);
  if (!withStatus.length) return null;
  return [...withStatus].sort((a, b) => {
    const al = ts(a.last_interaction_at);
    const bl = ts(b.last_interaction_at);
    if (bl !== al) return bl - al;
    return b.id - a.id;
  })[0].lead_status_id;
}

function categoryOf(cycle) {
  return cycle.program?.slug || (cycle.program_id == null ? 'general' : String(cycle.program_id));
}

async function main() {
  if (apply && !allowApply) {
    console.error('Refusing --apply without ALLOW_APPLY=1');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const groups = await prisma.$queryRaw`
      SELECT person_id, business_area_id, program_id,
             array_agg(id ORDER BY last_interaction_at DESC, id DESC) AS cycle_ids,
             COUNT(*)::int AS cycle_count
      FROM education_lead_cycles
      WHERE closed_at IS NULL AND person_id IS NOT NULL
      GROUP BY person_id, business_area_id, program_id
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, person_id`;

    const proposals = [];
    let keepAssigned = 0;
    let keepUnassigned = 0;
    let statusFilled = 0;
    let statusEmpty = 0;

    for (const g of groups) {
      const cycles = await prisma.education_lead_cycles.findMany({
        where: { id: { in: g.cycle_ids } },
        select: {
          id: true,
          area: true,
          contact_id: true,
          person_id: true,
          program_id: true,
          assigned_user_id: true,
          lead_status_id: true,
          first_assigned_at: true,
          started_at: true,
          last_interaction_at: true,
          program: { select: { slug: true } },
          lead_status: { select: { slug: true, label: true } },
          assigned_user: {
            select: { id: true, email: true, first_name: true, last_name: true },
          },
        },
      });
      const keep = pickKeeper(cycles);
      const statusId = pickStatusId(cycles);
      const closeIds = cycles.filter((c) => c.id !== keep.id).map((c) => c.id);
      const statusChanged =
        statusId != null && statusId !== keep.lead_status_id;

      if (keep.assigned_user_id != null) keepAssigned += 1;
      else keepUnassigned += 1;
      if (statusId != null) statusFilled += 1;
      else statusEmpty += 1;

      const statusSource = cycles.find((c) => c.lead_status_id === statusId);
      proposals.push({
        person_id: g.person_id,
        business_area_id: g.business_area_id,
        program_id: g.program_id,
        category: categoryOf(keep),
        cycle_count: g.cycle_count,
        keep_cycle_id: keep.id,
        keep_contact_id: keep.contact_id,
        keep_area: keep.area,
        keep_advisor_id: keep.assigned_user_id,
        keep_advisor_email: keep.assigned_user?.email ?? null,
        keep_status_id_current: keep.lead_status_id,
        keep_status_slug_current: keep.lead_status?.slug ?? null,
        proposed_status_id: statusId,
        proposed_status_slug: statusSource?.lead_status?.slug ?? null,
        status_will_update: statusChanged,
        close_cycle_ids: closeIds,
        close_reason: 'superseded_duplicate',
        evidence: cycles.map((c) => ({
          id: c.id,
          contact_id: c.contact_id,
          advisor_id: c.assigned_user_id,
          advisor_email: c.assigned_user?.email ?? null,
          first_assigned_at: c.first_assigned_at,
          status_id: c.lead_status_id,
          status_slug: c.lead_status?.slug ?? null,
          last_interaction_at: c.last_interaction_at,
          role: c.id === keep.id ? 'keep' : 'close',
        })),
      });
    }

    const summary = {
      mode: apply ? 'apply' : 'dry-run',
      unique_groups: proposals.length,
      keep_with_advisor: keepAssigned,
      keep_unassigned: keepUnassigned,
      status_filled_on_keep: statusFilled,
      status_empty_on_keep: statusEmpty,
      cycles_to_close: proposals.reduce((n, p) => n + p.close_cycle_ids.length, 0),
      note: apply
        ? 'Applied closes + optional status patch + conflict resolved_at'
        : 'No writes. Re-run with --apply ALLOW_APPLY=1 after review.',
    };
    const payload = { summary, proposals };
    console.log(JSON.stringify(summary, null, 2));
    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true });
      const jsonPath = path.join(outputDir, 'conflicts-propose.json');
      fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2) + '\n');
      const cols = [
        'person_id',
        'category',
        'cycle_count',
        'keep_cycle_id',
        'keep_advisor_id',
        'keep_advisor_email',
        'proposed_status_id',
        'proposed_status_slug',
        'status_will_update',
        'close_cycle_ids',
      ];
      const cell = (v) =>
        `"${String(v ?? '')
          .replace(/"/g, '""')
          .replace(/\r?\n/g, ' ')}"`;
      const rows = proposals.map((p) =>
        cols
          .map((k) =>
            cell(k === 'close_cycle_ids' ? p.close_cycle_ids.join('|') : p[k]),
          )
          .join(','),
      );
      fs.writeFileSync(
        path.join(outputDir, 'conflicts-propose.csv'),
        '\uFEFF' + [cols.join(','), ...rows].join('\r\n') + '\r\n',
      );
      console.log(JSON.stringify({ wrote: { json: jsonPath, csv: path.join(outputDir, 'conflicts-propose.csv') } }));
    } else {
      console.log(JSON.stringify({ proposals_omitted: proposals.length, hint: 'Set OUTPUT_DIR to write full JSON/CSV' }));
    }

    if (!apply) return;

    const now = new Date();
    let closed = 0;
    let statuses = 0;
    let conflictsMarked = 0;

    await prisma.$transaction(async (tx) => {
      for (const p of proposals) {
        if (p.status_will_update && p.proposed_status_id != null) {
          const updated = await tx.education_lead_cycles.updateMany({
            where: { id: p.keep_cycle_id, closed_at: null },
            data: {
              lead_status_id: p.proposed_status_id,
              updated_at: now,
            },
          });
          statuses += updated.count;
        }
        if (p.close_cycle_ids.length) {
          const result = await tx.education_lead_cycles.updateMany({
            where: {
              id: { in: p.close_cycle_ids },
              closed_at: null,
            },
            data: {
              closed_at: now,
              close_reason: 'superseded_duplicate',
              updated_at: now,
            },
          });
          closed += result.count;
          await tx.$executeRaw`
            UPDATE education_lead_conversation_links
            SET unlinked_at = GREATEST(linked_at, ${now})
            WHERE cycle_id IN (${Prisma.join(p.close_cycle_ids)})
              AND unlinked_at IS NULL`;
        }
        const marked = await tx.$executeRaw`
          UPDATE education_lead_open_conflicts
          SET resolved_at = ${now}
          WHERE person_id = ${p.person_id}
            AND business_area_id = ${p.business_area_id}
            AND program_id IS NOT DISTINCT FROM ${p.program_id}
            AND resolved_at IS NULL`;
        conflictsMarked += Number(marked) || 0;
      }
    }, { timeout: 180000 });

    const remaining = await prisma.$queryRaw`
      SELECT
        (SELECT COUNT(*)::int FROM education_lead_open_conflicts WHERE resolved_at IS NULL) AS unresolved_conflicts,
        (SELECT COUNT(*)::int FROM (
           SELECT 1 FROM education_lead_cycles
           WHERE closed_at IS NULL AND person_id IS NOT NULL
           GROUP BY person_id, business_area_id, program_id
           HAVING COUNT(*) > 1
         ) d) AS open_duplicate_groups`;

    console.log(
      JSON.stringify({
        applied: { closed, status_updates: statuses, conflicts_marked: conflictsMarked },
        after: remaining[0],
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
