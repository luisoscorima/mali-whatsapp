#!/usr/bin/env node
/**
 * Absorbe contacts en educacion_ca/ep → educacion (merge+DELETE).
 * Equivalente operativo a POST /api/admin/conflicts/education-alias-contacts/apply.
 *
 *   node scripts/absorb-education-alias-contacts.cjs
 *   node scripts/absorb-education-alias-contacts.cjs --apply
 *   node scripts/absorb-education-alias-contacts.cjs --apply --limit=100
 */
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = Math.min(500, Math.max(1, Number(limitArg?.split('=')[1] || 200) || 200));
const prisma = new PrismaClient();

async function programIds(tx) {
  const rows = await tx.$queryRaw`
    SELECT p.id, p.slug FROM business_programs p
    JOIN business_areas a ON a.id = p.business_area_id
    WHERE a.slug = 'educacion' AND p.slug IN ('ca','ep')
  `;
  return {
    ca: rows.find((r) => r.slug === 'ca')?.id ?? null,
    ep: rows.find((r) => r.slug === 'ep')?.id ?? null,
  };
}

async function moveDonor(tx, donorId, keepId) {
  await tx.$executeRaw`UPDATE conversations SET contact_id = ${keepId}, updated_at = NOW() WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`UPDATE campaign_logs SET contact_id = ${keepId} WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`UPDATE contact_origins SET contact_id = ${keepId}, updated_at = NOW() WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`UPDATE meta_leadgen_leads SET contact_id = ${keepId}, updated_at = NOW() WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`UPDATE tiktok_leads SET contact_id = ${keepId}, updated_at = NOW() WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`UPDATE meta_ctwa_ad_leads SET contact_id = ${keepId} WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`
    UPDATE education_lead_entries entry SET cycle_id = winner.id
    FROM education_lead_cycles loser
    JOIN education_lead_cycles winner ON winner.contact_id = ${keepId} AND winner.started_at = loser.started_at
    WHERE loser.contact_id = ${donorId} AND entry.cycle_id = loser.id`;
  await tx.$executeRaw`
    DELETE FROM education_lead_cycles loser USING education_lead_cycles winner
    WHERE loser.contact_id = ${donorId} AND winner.contact_id = ${keepId} AND winner.started_at = loser.started_at`;
  await tx.$executeRaw`UPDATE education_lead_cycles SET contact_id = ${keepId}, updated_at = NOW() WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`UPDATE education_lead_entries SET contact_id = ${keepId} WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`
    INSERT INTO contact_attributes (contact_id, attr_key, attr_value, program_id, updated_at)
    SELECT ${keepId}, src.attr_key, src.attr_value, src.program_id, src.updated_at
    FROM contact_attributes src WHERE src.contact_id = ${donorId}
      AND NOT EXISTS (
        SELECT 1 FROM contact_attributes e
        WHERE e.contact_id = ${keepId} AND e.attr_key = src.attr_key
          AND e.program_id IS NOT DISTINCT FROM src.program_id)`;
  await tx.$executeRaw`DELETE FROM contact_attributes WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`
    INSERT INTO contact_segments (contact_id, area, segment_slug, program_id, created_at)
    SELECT ${keepId}, src.area, src.segment_slug, src.program_id, src.created_at
    FROM contact_segments src WHERE src.contact_id = ${donorId}
      AND NOT EXISTS (
        SELECT 1 FROM contact_segments e
        WHERE e.contact_id = ${keepId} AND e.segment_slug = src.segment_slug
          AND e.program_id IS NOT DISTINCT FROM src.program_id)`;
  await tx.$executeRaw`DELETE FROM contact_segments WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`
    INSERT INTO contact_programs (contact_id, program_id, source, first_seen_at, last_seen_at)
    SELECT ${keepId}, src.program_id, src.source, src.first_seen_at, NOW()
    FROM contact_programs src WHERE src.contact_id = ${donorId}
    ON CONFLICT (contact_id, program_id) DO NOTHING`;
  await tx.$executeRaw`DELETE FROM contact_programs WHERE contact_id = ${donorId}`;
}

async function deleteDonor(tx, donorId) {
  const mapExists = await tx.$queryRaw`
    SELECT to_regclass('public.education_consolidation_map') IS NOT NULL AS ok`;
  if (mapExists[0]?.ok) {
    await tx.$executeRaw`DELETE FROM education_consolidation_map WHERE contact_id = ${donorId}`;
  }
  await tx.$executeRaw`DELETE FROM contacts WHERE id = ${donorId}`;
  await tx.$executeRaw`
    DELETE FROM people person
    WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.person_id = person.id)`;
}

async function main() {
  console.log(APPLY ? `APPLY limit=${LIMIT}` : 'DRY-RUN (sin escritura)');
  const donors = await prisma.$queryRaw`
    SELECT id, area, person_id, name, last_name, phone, whatsapp_user_id, email, dni, active
    FROM contacts WHERE area IN ('educacion_ca','educacion_ep') ORDER BY id`;
  console.log('residuales', donors.length);

  const programs = await programIds(prisma);
  let merged = 0;
  let created = 0;
  let deleted = 0;
  let ambiguous = 0;
  let errors = 0;
  let processed = 0;

  for (const donor of donors) {
    if (processed >= LIMIT) break;
    const phone = donor.phone?.trim() || null;
    const wuid = donor.whatsapp_user_id?.trim() || null;
    const byPhone = phone
      ? await prisma.contacts.findFirst({
          where: { area: 'educacion', phone },
          select: { id: true },
        })
      : null;
    const byWuid = wuid
      ? await prisma.contacts.findFirst({
          where: { area: 'educacion', whatsapp_user_id: wuid },
          select: { id: true },
        })
      : null;
    if (byPhone && byWuid && byPhone.id !== byWuid.id) {
      ambiguous += 1;
      console.log('AMBIGUOUS', donor.id, byPhone.id, byWuid.id);
      continue;
    }
    processed += 1;
    if (!APPLY) continue;

    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`ALTER TABLE contacts DISABLE TRIGGER USER`;
        await tx.$executeRaw`ALTER TABLE people DISABLE TRIGGER USER`;
        try {
          let keepId = (byPhone || byWuid)?.id ?? null;
          if (!keepId) {
            // Sin identidad usable: borrar residual (activo o no).
            if (!wuid && !phone) {
              await deleteDonor(tx, donor.id);
              deleted += 1;
              return;
            }
            const area = await tx.business_areas.findFirst({
              where: { slug: 'educacion' },
              select: { id: true },
            });
            const keep = await tx.contacts.create({
              data: {
                person_id: donor.person_id,
                business_area_id: area.id,
                area: 'educacion',
                name: donor.name || '',
                last_name: donor.last_name || '',
                phone,
                whatsapp_user_id: wuid,
                email: donor.email,
                dni: donor.dni,
                opt_in: true,
                active: true,
              },
              select: { id: true },
            });
            keepId = keep.id;
            created += 1;
          }
          const programId =
            donor.area === 'educacion_ca'
              ? programs.ca
              : donor.area === 'educacion_ep'
                ? programs.ep
                : null;
          if (programId) {
            await tx.$executeRaw`
              INSERT INTO contact_programs (contact_id, program_id, source, first_seen_at, last_seen_at)
              VALUES (${keepId}, ${programId}, 'alias_absorb', NOW(), NOW())
              ON CONFLICT (contact_id, program_id) DO UPDATE SET last_seen_at = NOW()`;
          }
          if (wuid) {
            await tx.$executeRaw`
              UPDATE contacts SET whatsapp_user_id = ${wuid}, updated_at = NOW()
              WHERE id = ${keepId} AND whatsapp_user_id IS NULL`;
          }
          await moveDonor(tx, donor.id, keepId);
          await deleteDonor(tx, donor.id);
          merged += 1;
          deleted += 1;
        } finally {
          await tx.$executeRaw`ALTER TABLE contacts ENABLE TRIGGER USER`;
          await tx.$executeRaw`ALTER TABLE people ENABLE TRIGGER USER`;
        }
      });
    } catch (e) {
      errors += 1;
      console.error('ERR', donor.id, e.message || e);
    }
  }

  const left = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS n FROM contacts WHERE area IN ('educacion_ca','educacion_ep')`;
  console.log({
    processed,
    merged,
    created,
    deleted,
    ambiguous,
    errors,
    remaining: left[0]?.n,
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
