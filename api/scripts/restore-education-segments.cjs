#!/usr/bin/env node
/**
 * Devuelve a cada segmento la categoría que tenía antes de la fusión.
 *
 * Lee una copia anterior al --apply (SOURCE_DATABASE_URL) y escribe en la
 * base actual. Sin --apply solo cuenta. No borra definiciones.
 *
 *   SOURCE_DATABASE_URL=postgresql://.../mali_whatsapp_ensayo \
 *     node scripts/restore-education-segments.cjs
 *   SOURCE_DATABASE_URL=... node scripts/restore-education-segments.cjs --apply
 *
 * Si el ensayo ya no existe, restaura el backup anterior a la fusión
 * (mali_whatsapp_20261026_004146.sql.gz) en otra base y apunta ahí.
 */
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const sourceUrl = process.env.SOURCE_DATABASE_URL;
if (!sourceUrl) {
  console.error('Falta SOURCE_DATABASE_URL con la copia anterior a la fusión.');
  process.exit(1);
}

const source = new PrismaClient({ datasourceUrl: sourceUrl });
const target = new PrismaClient();

function programSlug(area) {
  if (area === 'educacion_ca') return 'ca';
  if (area === 'educacion_ep') return 'ep';
  return null;
}

async function main() {
  const [definitions, assignments, programs, mapRows, targetDefs, targetSegs, contacts] =
    await Promise.all([
      source.$queryRaw`
        SELECT id, area, slug, label, sort_order, color_key, active,
               show_in_filter, assignable, assignment_group
        FROM segment_definitions
        WHERE area IN ('educacion', 'educacion_ca', 'educacion_ep')
      `,
      source.$queryRaw`
        SELECT contact_id, area, segment_slug, created_at
        FROM contact_segments
        WHERE area IN ('educacion', 'educacion_ca', 'educacion_ep')
      `,
      target.$queryRaw`
        SELECT p.id, p.slug
        FROM business_programs p
        JOIN business_areas a ON a.id = p.business_area_id
        WHERE a.slug = 'educacion' AND p.slug IN ('ca', 'ep')
      `,
      target.$queryRaw`
        SELECT contact_id, canonical_id, decision
        FROM education_consolidation_map
      `.catch(() => []),
      target.$queryRaw`SELECT id FROM segment_definitions`,
      target.$queryRaw`
        SELECT contact_id, segment_slug, program_id
        FROM contact_segments
        WHERE area IN ('educacion', 'educacion_ca', 'educacion_ep')
      `,
      target.$queryRaw`SELECT id FROM contacts`,
    ]);

  const programId = new Map(programs.map((row) => [row.slug, row.id]));
  const targetDefIds = new Set(targetDefs.map((row) => Number(row.id)));
  const liveContacts = new Set(contacts.map((row) => Number(row.id)));
  const canonicalOf = new Map();
  for (const row of mapRows) {
    const id = Number(row.contact_id);
    const canonical = Number(row.canonical_id);
    if (row.decision === 'merge' && canonical !== id) canonicalOf.set(id, canonical);
  }

  function desiredProgram(area) {
    const slug = programSlug(area);
    if (!slug) return null;
    const id = programId.get(slug);
    if (!id) throw new Error(`No existe la categoría ${slug}`);
    return id;
  }

  const defUpdates = [];
  const defInserts = [];
  for (const row of definitions) {
    const nextProgram = desiredProgram(row.area);
    if (targetDefIds.has(Number(row.id))) {
      defUpdates.push({ id: Number(row.id), programId: nextProgram });
    } else {
      defInserts.push({ ...row, programId: nextProgram });
    }
  }

  const groups = new Map();
  for (const row of assignments) {
    const contactId = canonicalOf.get(Number(row.contact_id)) ?? Number(row.contact_id);
    if (!liveContacts.has(contactId)) continue;
    const key = `${contactId}\t${row.segment_slug}`;
    if (!groups.has(key)) {
      groups.set(key, {
        contactId,
        slug: row.segment_slug,
        createdAt: row.created_at,
        programs: new Set(),
      });
    }
    groups.get(key).programs.add(desiredProgram(row.area));
  }

  const existing = new Set(
    targetSegs.map(
      (row) => `${row.contact_id}\t${row.segment_slug}\t${row.program_id ?? ''}`,
    ),
  );

  let assignInserts = 0;
  let assignClears = 0;
  const work = [];
  for (const group of groups.values()) {
    const wantsGeneral = group.programs.has(null);
    if (!wantsGeneral && existing.has(`${group.contactId}\t${group.slug}\t`)) {
      assignClears += 1;
    }
    for (const program of group.programs) {
      const mark = `${group.contactId}\t${group.slug}\t${program ?? ''}`;
      if (!existing.has(mark)) assignInserts += 1;
    }
    work.push({ ...group, wantsGeneral });
  }

  console.log(
    [
      `Definiciones a marcar: ${defUpdates.length}`,
      `Definiciones a recrear: ${defInserts.length}`,
      `Asignaciones a crear: ${assignInserts}`,
      `Asignaciones generales de más a quitar: ${assignClears}`,
    ].join('\n'),
  );

  if (!APPLY) {
    console.log('SIMULACIÓN. Para escribir: --apply');
    return;
  }

  await target.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '20min'`);
    for (const row of defUpdates) {
      await tx.$executeRaw`
        UPDATE segment_definitions
        SET area = 'educacion', program_id = ${row.programId}, updated_at = NOW()
        WHERE id = ${row.id}
      `;
    }
    for (const row of defInserts) {
      await tx.$executeRaw`
        INSERT INTO segment_definitions (
          area, slug, label, sort_order, color_key, active, show_in_filter,
          assignable, assignment_group, program_id
        )
        SELECT ${'educacion'}, ${row.slug}, ${row.label}, ${row.sort_order},
               ${row.color_key}, ${row.active}, ${row.show_in_filter},
               ${row.assignable}, ${row.assignment_group}, ${row.programId}
        WHERE NOT EXISTS (
          SELECT 1 FROM segment_definitions keep
          WHERE keep.area = 'educacion'
            AND keep.slug = ${row.slug}
            AND keep.program_id IS NOT DISTINCT FROM ${row.programId}
        )
      `;
    }
    for (const group of work) {
      for (const program of group.programs) {
        await tx.$executeRaw`
          INSERT INTO contact_segments (contact_id, area, segment_slug, program_id, created_at)
          SELECT ${group.contactId}, ${'educacion'}, ${group.slug}, ${program}, ${group.createdAt}
          WHERE NOT EXISTS (
            SELECT 1 FROM contact_segments keep
            WHERE keep.contact_id = ${group.contactId}
              AND keep.segment_slug = ${group.slug}
              AND keep.program_id IS NOT DISTINCT FROM ${program}
          )
        `;
      }
      if (!group.wantsGeneral) {
        await tx.$executeRaw`
          DELETE FROM contact_segments
          WHERE contact_id = ${group.contactId}
            AND segment_slug = ${group.slug}
            AND program_id IS NULL
        `;
      }
    }
  }, { timeout: 20 * 60 * 1000 });
  console.log('SEGMENTOS RESTAURADOS');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await source.$disconnect();
    await target.$disconnect();
  });
