/**
 * Cierra ciclos General abiertos nacidos del mismo origen comercial
 * (web_button / meta_ctwa / mali_one_link) junto a un ciclo CA/EP abierto.
 * También rellena contact_origins.program_id si estaba null.
 *
 * Usage:
 *   node api/scripts/leads-backfill-duplicate-general.cjs
 *   node api/scripts/leads-backfill-duplicate-general.cjs --apply
 *
 * Default: dry-run. Requires DATABASE_URL.
 */
const { PrismaClient } = require('@prisma/client');

const apply = process.argv.includes('--apply');

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT ON (g.id)
        g.id AS general_cycle_id,
        cat.id AS category_cycle_id,
        g.person_id,
        g.contact_id,
        o.id AS origin_id,
        o.channel,
        cat.program_id AS category_program_id,
        bp.slug AS category_slug,
        o.program_id AS origin_program_id
      FROM education_lead_cycles g
      JOIN education_lead_entries eg
        ON eg.cycle_id = g.id AND eg.origin_id IS NOT NULL
      JOIN contact_origins o
        ON o.id = eg.origin_id
       AND o.channel IN ('web_button', 'meta_ctwa', 'mali_one_link')
      JOIN education_lead_entries ec
        ON ec.origin_id = eg.origin_id
       AND ec.program_id IS NOT NULL
       AND ec.cycle_id IS NOT NULL
      JOIN education_lead_cycles cat
        ON cat.id = ec.cycle_id
       AND cat.closed_at IS NULL
       AND cat.program_id IS NOT NULL
       AND cat.person_id = g.person_id
       AND cat.id <> g.id
      LEFT JOIN business_programs bp ON bp.id = cat.program_id
      WHERE g.closed_at IS NULL
        AND g.program_id IS NULL
      ORDER BY g.id, cat.started_at ASC, cat.id ASC
    `;

    const sample = rows.slice(0, 40).map((row) => ({
      person_id: row.person_id,
      contact_id: row.contact_id,
      general_cycle_id: row.general_cycle_id,
      category_cycle_id: row.category_cycle_id,
      category_slug: row.category_slug,
      origin_id: row.origin_id,
      channel: row.channel,
    }));

    if (!apply) {
      console.log(
        JSON.stringify(
          {
            mode: 'dry-run',
            matched: rows.length,
            closed: 0,
            origins_updated: 0,
            sample,
            hint: 'Pass --apply to close General orphans and fix origin.program_id',
          },
          null,
          2,
        ),
      );
      return;
    }

    let closed = 0;
    let originsUpdated = 0;
    const now = new Date();
    for (const row of rows) {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.education_lead_cycles.updateMany({
          where: {
            id: row.general_cycle_id,
            closed_at: null,
            program_id: null,
          },
          data: {
            closed_at: now,
            close_reason: 'superseded_by_category',
            updated_at: now,
          },
        });
        if (!updated.count) return;
        await tx.$executeRaw`
          UPDATE education_lead_conversation_links
          SET unlinked_at = GREATEST(linked_at, ${now})
          WHERE cycle_id = ${row.general_cycle_id} AND unlinked_at IS NULL
        `;
        closed += 1;
        if (row.origin_program_id == null) {
          const originFix = await tx.contact_origins.updateMany({
            where: { id: row.origin_id, program_id: null },
            data: {
              program_id: row.category_program_id,
              updated_at: now,
            },
          });
          originsUpdated += originFix.count;
        }
      });
    }

    console.log(
      JSON.stringify(
        {
          mode: 'apply',
          matched: rows.length,
          closed,
          origins_updated: originsUpdated,
          sample,
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
