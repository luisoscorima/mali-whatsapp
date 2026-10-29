/**
 * Export unique open-lead conflict groups and propose (never apply) resolutions.
 *
 * Usage: node api/scripts/leads-conflicts-export.cjs > conflicts.json
 * Requires DATABASE_URL. Read-only.
 *
 * propose_auto requires ALL of:
 *   - same assigned_user_id
 *   - same lead_status_id
 *   - clear chronology (strictly newer last_interaction_at, tie-break started_at/id)
 *   - no independent activity (at most one cycle with first_inbound_at / first_human_reply_at)
 * Otherwise → manual. Counts are unique groups (not sum of advisor+status buckets).
 */
const { PrismaClient } = require('@prisma/client');

/** Null-aware distinct: "sin asesor" vs assigned counts as different. */
function distinctKey(value) {
  return value == null ? '<sin valor>' : String(value);
}

function classify(cycles) {
  const advisors = new Set(cycles.map((c) => distinctKey(c.assigned_user_id)));
  const statuses = new Set(cycles.map((c) => distinctKey(c.lead_status_id)));
  const withInbound = cycles.filter((c) => c.first_inbound_at).length;
  const withHuman = cycles.filter((c) => c.first_human_reply_at).length;
  const sorted = [...cycles].sort((a, b) => {
    const la = a.last_interaction_at?.getTime?.() ?? new Date(a.last_interaction_at).getTime();
    const lb = b.last_interaction_at?.getTime?.() ?? new Date(b.last_interaction_at).getTime();
    if (lb !== la) return lb - la;
    const sa = a.started_at?.getTime?.() ?? new Date(a.started_at).getTime();
    const sb = b.started_at?.getTime?.() ?? new Date(b.started_at).getTime();
    if (sb !== sa) return sb - sa;
    return b.id - a.id;
  });
  const keep = sorted[0];
  const clearChronology =
    sorted.length >= 2 &&
    (sorted[0].last_interaction_at?.getTime?.() ?? new Date(sorted[0].last_interaction_at).getTime()) >
      (sorted[1].last_interaction_at?.getTime?.() ?? new Date(sorted[1].last_interaction_at).getTime());
  const independentActivity = withInbound > 1 || withHuman > 1;
  // Same management including both null; never propose_auto solely on that.
  const sameAdvisor = advisors.size === 1;
  const sameStatus = statuses.size === 1;
  const proposeAuto =
    sameAdvisor && sameStatus && clearChronology && !independentActivity;

  let manualReason = null;
  if (!sameAdvisor) manualReason = 'asesores_distintos_incluye_sin_asignar';
  else if (!sameStatus) manualReason = 'estados_distintos_incluye_sin_estado';
  else if (independentActivity) manualReason = 'independent_activity';
  else if (!clearChronology) manualReason = 'unclear_chronology';

  return {
    // propose_auto = candidate pending human validation; this script never closes.
    proposal: proposeAuto ? 'candidato_requiere_validar' : 'manual',
    manual_reason: manualReason,
    keep_cycle_id: proposeAuto ? keep.id : null,
    close_cycle_ids: proposeAuto ? sorted.slice(1).map((c) => c.id) : [],
    close_reason_if_applied: 'superseded_duplicate',
    same_advisor: sameAdvisor,
    same_status: sameStatus,
    clear_chronology: clearChronology,
    independent_activity: independentActivity,
    advisor_keys: [...advisors],
    status_keys: [...statuses],
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const groups = await prisma.$queryRaw`
      SELECT person_id, business_area_id, program_id,
             array_agg(id ORDER BY last_interaction_at DESC, started_at DESC, id DESC) AS cycle_ids,
             COUNT(*)::int AS cycle_count
      FROM education_lead_cycles
      WHERE closed_at IS NULL AND person_id IS NOT NULL
      GROUP BY person_id, business_area_id, program_id
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC, person_id`;

    const items = [];
    let candidates = 0;
    let manual = 0;
    const manualReasons = {};
    let distinctAdvisors = 0;
    let distinctStatuses = 0;

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
          started_at: true,
          last_interaction_at: true,
          first_inbound_at: true,
          first_human_reply_at: true,
          requires_review: true,
          lead_status: { select: { slug: true, label: true, is_terminal: true } },
        },
      });
      const decision = classify(cycles);
      if (decision.proposal === 'candidato_requiere_validar') candidates += 1;
      else {
        manual += 1;
        manualReasons[decision.manual_reason] =
          (manualReasons[decision.manual_reason] ?? 0) + 1;
      }
      if (!decision.same_advisor) distinctAdvisors += 1;
      if (!decision.same_status) distinctStatuses += 1;

      items.push({
        person_id: g.person_id,
        business_area_id: g.business_area_id,
        program_id: g.program_id,
        cycle_count: g.cycle_count,
        category:
          cycles[0]?.program_id == null
            ? 'general'
            : cycles.find((c) => c.program_id)?.area ?? 'program',
        ...decision,
        cycles: cycles.map((c) => ({
          id: c.id,
          area: c.area,
          contact_id: c.contact_id,
          assigned_user_id: c.assigned_user_id,
          lead_status_id: c.lead_status_id,
          status_slug: c.lead_status?.slug ?? null,
          started_at: c.started_at,
          last_interaction_at: c.last_interaction_at,
          first_inbound_at: c.first_inbound_at,
          first_human_reply_at: c.first_human_reply_at,
        })),
      });
    }

    console.log(
      JSON.stringify(
        {
          unique_groups: groups.length,
          manual_review_groups: manual,
          provisional_candidates: candidates,
          manual_reasons: manualReasons,
          groups_with_distinct_advisors_null_aware: distinctAdvisors,
          groups_with_distinct_statuses_null_aware: distinctStatuses,
          note:
            'Null-aware distinct (sin asesor/sin estado). Buckets may overlap; unique_groups is authoritative. Never closes cycles.',
          items,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
