/**
 * Borra TODOS los organic_wa falsos del historial: misma ficha ya tenía un
 * origen comercial (tiktok / meta_lead_form / meta_ctwa / widget / mali_one_link / web_button)
 * con first_seen_at <= el orgánico.
 *
 * Por defecto no hay tope de horas (todo el historial).
 * Opcional: --hours=24 para limitar la ventana.
 *
 * No toca education_lead_entries.
 *
 * Usage:
 *   node api/scripts/leads-cleanup-false-organic.cjs
 *   node api/scripts/leads-cleanup-false-organic.cjs --apply
 *   node api/scripts/leads-cleanup-false-organic.cjs --sample=984344366
 *
 * Requires DATABASE_URL. Default is dry-run.
 */
const { Prisma, PrismaClient } = require('@prisma/client');

const apply = process.argv.includes('--apply');
const hoursArg = process.argv.find((a) => a.startsWith('--hours='));
const hours = hoursArg ? Math.max(1, Number(hoursArg.slice(8)) || 0) : 0;
const sampleArg = process.argv.find((a) => a.startsWith('--sample='));
const samplePhone = sampleArg ? String(sampleArg.slice(9)).replace(/\D/g, '') : '';
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Math.max(1, Number(limitArg.slice(8)) || 50) : 50;

const COMMERCIAL = [
  'tiktok',
  'meta_lead_form',
  'meta_ctwa',
  'widget',
  'mali_one_link',
  'web_button',
];

async function main() {
  const prisma = new PrismaClient();
  try {
    const lagFilter =
      hours > 0
        ? Prisma.sql`AND org.first_seen_at - paid.first_seen_at <= make_interval(hours => ${hours})`
        : Prisma.empty;

    const candidates = await prisma.$queryRaw`
      SELECT
        org.id AS organic_id,
        org.contact_id,
        org.conversation_id,
        org.phone AS organic_phone,
        org.first_seen_at AS organic_at,
        paid.id AS paid_id,
        paid.channel AS paid_channel,
        paid.source_label AS paid_label,
        paid.first_seen_at AS paid_at,
        EXTRACT(EPOCH FROM (org.first_seen_at - paid.first_seen_at)) AS lag_seconds
      FROM contact_origins org
      JOIN contact_origins paid
        ON paid.contact_id = org.contact_id
       AND paid.channel IN (${Prisma.join(COMMERCIAL.map((c) => Prisma.sql`${c}`))})
       AND paid.area = 'educacion'
       AND paid.first_seen_at <= org.first_seen_at
       ${lagFilter}
      WHERE org.channel = 'organic_wa'
        AND org.area = 'educacion'
        AND org.contact_id IS NOT NULL
      ORDER BY org.first_seen_at DESC, org.id DESC
    `;

    // Un orgánico puede matchear varios paid; quedarse con el más cercano.
    const byOrganic = new Map();
    for (const row of candidates) {
      const prev = byOrganic.get(row.organic_id);
      if (!prev || Number(row.lag_seconds) < Number(prev.lag_seconds)) {
        byOrganic.set(row.organic_id, row);
      }
    }
    const unique = [...byOrganic.values()];
    const sample = unique.slice(0, limit);

    let phoneHits = [];
    if (samplePhone) {
      phoneHits = unique.filter((r) =>
        String(r.organic_phone || '').includes(samplePhone),
      );
    }

    const ids = unique.map((r) => r.organic_id);

    console.log(
      JSON.stringify(
        {
          mode: apply ? 'apply' : 'dry-run',
          hours_window: hours > 0 ? hours : 'all_history',
          candidates: unique.length,
          sample_size: sample.length,
          sample_phone: samplePhone || null,
          phone_hits: phoneHits,
          sample,
          hint: apply
            ? 'Deleting ALL listed organic_wa origins; CRM entries untouched.'
            : 'Dry-run: lista todo el historial a borrar. Luego --apply.',
        },
        null,
        2,
      ),
    );

    if (!apply || !ids.length) return;

    const deleted = await prisma.contact_origins.deleteMany({
      where: {
        id: { in: ids },
        channel: 'organic_wa',
        area: 'educacion',
      },
    });
    console.log(JSON.stringify({ deleted: deleted.count, organic_ids: ids.length }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
