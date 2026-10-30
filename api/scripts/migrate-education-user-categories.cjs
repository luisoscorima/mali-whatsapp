#!/usr/bin/env node
/**
 * Migra permisos de Educación de áreas alias a categorías (general/ca/ep).
 *
 *   node scripts/migrate-education-user-categories.cjs
 *   node scripts/migrate-education-user-categories.cjs --apply
 */
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

/** Permisos históricos Educación / CA / EP → categorías general/ca/ep. */
const ROLE_CATEGORIES = {
  'achumpitasi@mali.pe': ['general', 'ep'],
  'asesordeadmision3@mali.pe': ['general', 'ca'],
  'asesordeadmision6@mali.pe': ['general'],
  'bsegura@mali.pe': ['general', 'ca'],
  'darias@mali.pe': ['general', 'ep'],
  'ezurita@mali.pe': ['general', 'ca'],
  'gbacaflor@mali.pe': ['general', 'ca'],
  'gzabalbeascoa@mali.pe': ['general', 'ep'],
  'joropeza@mali.pe': [],
  'jserrano@mali.pe': ['general'],
  'kbaumann@mali.pe': ['general', 'ca', 'ep'],
  'khuerta@mali.pe': ['general', 'ca'],
  'kvillegas@mali.pe': ['general', 'ca'],
  'lcontreras@mali.pe': ['general', 'ca', 'ep'],
  'lramirez@mali.pe': ['general', 'ca', 'ep'],
  'ngonzales@mali.pe': ['general', 'ca', 'ep'],
  'ocaceres@mali.pe': ['general', 'ca', 'ep'],
  'rroman@mali.pe': ['general'],
  'spacheco@mali.pe': ['general'],
  'visitaseducativas@mali.pe': ['general'],
};

async function main() {
  console.log(
    APPLY
      ? 'MIGRATE EDUCATION CATEGORIES: escritura'
      : 'MIGRATE EDUCATION CATEGORIES: simulación',
  );

  const educacion = await prisma.business_areas.findFirst({
    where: { slug: 'educacion' },
    select: { id: true },
  });
  if (!educacion) throw new Error('Falta business_area educacion');

  const programs = await prisma.business_programs.findMany({
    where: { business_area_id: educacion.id, active: true, slug: { in: ['ca', 'ep'] } },
    select: { id: true, slug: true },
  });
  const programId = Object.fromEntries(programs.map((p) => [p.slug, p.id]));
  if (!programId.ca || !programId.ep) throw new Error('Faltan programs ca/ep');

  const memberships = await prisma.user_area_memberships.findMany({
    where: { active: true, business_area_id: educacion.id },
    include: {
      user: { select: { id: true, email: true, role_slug: true, is_master: true } },
      programs: { include: { program: { select: { slug: true } } } },
    },
  });

  const plan = [];
  for (const membership of memberships) {
    if (membership.user.is_master) continue;
    const email = String(membership.user.email || '').trim().toLowerCase();
    const currentPrograms = membership.programs.map((g) => g.program.slug).sort();
    const current = {
      access_mode: membership.access_mode,
      include_general: membership.include_general,
      programs: currentPrograms,
    };

    let categories = Object.prototype.hasOwnProperty.call(ROLE_CATEGORIES, email)
      ? ROLE_CATEGORIES[email]
      : null;
    if (categories == null) {
      // Legacy access_mode=all sin grants: acceso completo a Educación.
      if (
        membership.access_mode === 'all' &&
        !membership.include_general &&
        currentPrograms.length === 0
      ) {
        categories = ['general', 'ca', 'ep'];
      } else {
        // Ya tiene grants explícitos (p. ej. solo ca): no tocar.
        continue;
      }
    }

    const wantedPrograms = categories.filter((c) => c !== 'general');
    const includeGeneral = categories.includes('general');
    const open =
      categories.length > 0 &&
      includeGeneral &&
      wantedPrograms.includes('ca') &&
      wantedPrograms.includes('ep');
    const next = {
      access_mode: open ? 'all' : 'restricted',
      include_general: includeGeneral,
      programs: wantedPrograms.slice().sort(),
    };

    const same =
      current.access_mode === next.access_mode &&
      current.include_general === next.include_general &&
      current.programs.join(',') === next.programs.join(',');
    if (same) continue;

    plan.push({
      userId: membership.user.id,
      email,
      membershipId: membership.id,
      roleSlug: membership.user.role_slug || 'asesor_comercial',
      from: current,
      to: next,
      categories,
    });
  }

  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', changes: plan }, null, 2));

  if (!APPLY) {
    console.log(`Dry-run: ${plan.length} usuario(s) a actualizar.`);
    return;
  }

  for (const item of plan) {
    await prisma.user_area_memberships.update({
      where: { id: item.membershipId },
      data: {
        access_mode: item.to.access_mode,
        include_general: item.to.include_general,
        role_slug: item.roleSlug,
        updated_at: new Date(),
      },
    });
    await prisma.user_program_grants.deleteMany({
      where: { membership_id: item.membershipId },
    });
    const ids = item.to.programs.map((slug) => programId[slug]).filter(Boolean);
    if (ids.length) {
      await prisma.user_program_grants.createMany({
        data: ids.map((program_id) => ({
          membership_id: item.membershipId,
          program_id,
        })),
        skipDuplicates: true,
      });
    }
  }
  console.log(`Apply OK: ${plan.length} usuario(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
