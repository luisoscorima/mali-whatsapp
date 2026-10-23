#!/usr/bin/env node

/**
 * Read-only readiness audit for consolidating the legacy Education areas.
 *
 * Usage (inside the API container):
 *   node scripts/audit-education-program-cutover.cjs
 *
 * This script never writes. It deliberately exits with code 2 when structural
 * blockers exist, so it can also be used as a deployment/cutover gate.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const EDUCATION_AREAS = ['educacion', 'educacion_ca', 'educacion_ep'];

function number(value) {
  return typeof value === 'bigint' ? Number(value) : Number(value || 0);
}

function printSection(title, rows) {
  console.log(`\n${title}`);
  if (!rows.length) {
    console.log('(sin filas)');
    return;
  }
  console.table(rows);
}

async function main() {
  console.log('AUDITORÍA READ-ONLY: Educación → área canónica + programas');

  const programs = await prisma.$queryRaw`
    SELECT
      program.slug,
      program.label,
      program.active,
      COUNT(DISTINCT line.id)::int AS lines,
      COUNT(DISTINCT membership.contact_id)::int AS contacts
    FROM business_programs program
    JOIN business_areas area ON area.id = program.business_area_id
    LEFT JOIN whatsapp_lines line ON line.program_id = program.id
    LEFT JOIN contact_programs membership ON membership.program_id = program.id
    WHERE area.slug = 'educacion'
    GROUP BY program.id
    ORDER BY program.sort_order, program.id
  `;
  printSection('1. Programas de Educación', programs);

  const lines = await prisma.$queryRaw`
    SELECT
      line.id,
      line.legacy_area,
      COALESCE(line.program_key, '-') AS program_key,
      COALESCE(program.slug, '-') AS mapped_program,
      RIGHT(line.phone_number_id, 6) AS pid_suffix,
      line.is_default,
      line.active
    FROM whatsapp_lines line
    JOIN business_areas area ON area.id = line.business_area_id
    LEFT JOIN business_programs program ON program.id = line.program_id
    WHERE area.slug = 'educacion'
    ORDER BY line.id
  `;
  printSection('2. Líneas del área canónica Educación', lines);

  const linkCoverage = await prisma.$queryRaw`
    SELECT 'conversations' AS entity,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE whatsapp_line_id IS NULL)::int AS missing_link
    FROM conversations WHERE area = ANY(${EDUCATION_AREAS}::varchar[])
    UNION ALL
    SELECT 'campaigns', COUNT(*)::int,
           COUNT(*) FILTER (WHERE whatsapp_line_id IS NULL)::int
    FROM campaigns WHERE area = ANY(${EDUCATION_AREAS}::varchar[])
    UNION ALL
    SELECT 'whatsapp_templates', COUNT(*)::int,
           COUNT(*) FILTER (WHERE whatsapp_waba_id IS NULL)::int
    FROM whatsapp_templates WHERE area = ANY(${EDUCATION_AREAS}::varchar[])
  `;
  printSection('3. Cobertura de claves nuevas', linkCoverage);

  const routingErrors = await prisma.$queryRaw`
    SELECT
      COUNT(*) FILTER (
        WHERE line.id IS NULL
      )::int AS line_missing,
      COUNT(*) FILTER (
        WHERE line.id IS NOT NULL
          AND conv.whatsapp_phone_number_id IS NOT NULL
          AND conv.whatsapp_phone_number_id <> line.phone_number_id
      )::int AS phone_number_id_mismatch,
      COUNT(*) FILTER (
        WHERE line.id IS NOT NULL
          AND line.legacy_area IS DISTINCT FROM conv.area
      )::int AS legacy_area_mismatch
    FROM conversations conv
    LEFT JOIN whatsapp_lines line ON line.id = conv.whatsapp_line_id
    WHERE conv.area = ANY(${EDUCATION_AREAS}::varchar[])
  `;
  printSection('4. Integridad de enrutamiento histórico', routingErrors);

  const contactCoverage = await prisma.$queryRaw`
    SELECT
      contact.area,
      COUNT(*)::int AS contacts,
      COUNT(*) FILTER (
        WHERE alias.program_key IS NOT NULL AND membership.contact_id IS NULL
      )::int AS missing_program_membership
    FROM contacts contact
    LEFT JOIN business_area_aliases alias ON alias.alias = contact.area
    LEFT JOIN business_programs program
      ON program.business_area_id = alias.business_area_id
     AND program.slug = alias.program_key
    LEFT JOIN contact_programs membership
      ON membership.contact_id = contact.id
     AND membership.program_id = program.id
    WHERE contact.area = ANY(${EDUCATION_AREAS}::varchar[])
    GROUP BY contact.area
    ORDER BY contact.area
  `;
  printSection('5. Membresía de contactos por programa', contactCoverage);

  const contactCollisions = await prisma.$queryRaw`
    WITH normalized AS (
      SELECT
        id,
        area,
        NULLIF(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), '') AS phone_norm,
        NULLIF(BTRIM(whatsapp_user_id), '') AS wuid,
        NULLIF(BTRIM(LOWER(email)), '') AS email_norm,
        NULLIF(REGEXP_REPLACE(COALESCE(dni, ''), '[^0-9A-Za-z]', '', 'g'), '') AS dni_norm,
        NULLIF(BTRIM(LOWER(CONCAT_WS(' ', name, last_name))), '') AS name_norm
      FROM contacts
      WHERE area = ANY(${EDUCATION_AREAS}::varchar[])
        AND active = TRUE
    ), groups AS (
      SELECT
        phone_norm,
        COUNT(*)::int AS rows,
        COUNT(DISTINCT area)::int AS areas,
        COUNT(DISTINCT wuid)::int AS wuids,
        COUNT(DISTINCT email_norm)::int AS emails,
        COUNT(DISTINCT dni_norm)::int AS dnis,
        COUNT(DISTINCT name_norm)::int AS names
      FROM normalized
      WHERE phone_norm IS NOT NULL
      GROUP BY phone_norm
      HAVING COUNT(DISTINCT area) > 1
    )
    SELECT
      COUNT(*)::int AS shared_phone_groups,
      COALESCE(SUM(rows), 0)::int AS contact_rows,
      COUNT(*) FILTER (WHERE wuids > 1 OR dnis > 1)::int AS hard_conflicts,
      COUNT(*) FILTER (
        WHERE wuids <= 1 AND dnis <= 1 AND (emails > 1 OR names > 1)
      )::int AS review_conflicts,
      COUNT(*) FILTER (
        WHERE wuids <= 1 AND dnis <= 1 AND emails <= 1 AND names <= 1
      )::int AS structurally_mergeable
    FROM groups
  `;
  printSection('6. Colisiones al consolidar contactos por teléfono', contactCollisions);

  const conversationsAcrossLines = await prisma.$queryRaw`
    WITH normalized AS (
      SELECT
        COALESCE(
          NULLIF(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), ''),
          NULLIF(BTRIM(whatsapp_user_id), '')
        ) AS recipient,
        whatsapp_line_id
      FROM conversations
      WHERE area = ANY(${EDUCATION_AREAS}::varchar[])
    )
    SELECT
      COUNT(*)::int AS recipients_on_multiple_lines,
      COALESCE(SUM(conversation_count), 0)::int AS conversations_to_preserve
    FROM (
      SELECT recipient, COUNT(*)::int AS conversation_count
      FROM normalized
      WHERE recipient IS NOT NULL
      GROUP BY recipient
      HAVING COUNT(DISTINCT whatsapp_line_id) > 1
    ) shared
  `;
  printSection('7. Conversaciones legítimas en varias líneas', conversationsAcrossLines);

  const structuralBlockers =
    linkCoverage.reduce((sum, row) => sum + number(row.missing_link), 0) +
    routingErrors.reduce(
      (sum, row) =>
        sum +
        number(row.line_missing) +
        number(row.phone_number_id_mismatch) +
        number(row.legacy_area_mismatch),
      0,
    ) +
    contactCoverage.reduce(
      (sum, row) => sum + number(row.missing_program_membership),
      0,
    ) +
    lines.filter(
      (line) =>
        ['ca', 'ep'].includes(String(line.program_key)) &&
        String(line.mapped_program) !== String(line.program_key),
    ).length +
    ['ca', 'ep'].filter(
      (slug) =>
        !lines.some(
          (line) =>
            String(line.program_key) === slug &&
            String(line.mapped_program) === slug &&
            line.active === true,
        ),
    ).length +
    (lines.some((line) => line.is_default === true && line.active === true)
      ? 0
      : 1);

  console.log('\nRESULTADO');
  if (structuralBlockers > 0) {
    console.error(
      `BLOQUEADO: ${structuralBlockers} inconsistencia(s) estructural(es). No ejecutar consolidación.`,
    );
    process.exitCode = 2;
  } else {
    console.log(
      'ESTRUCTURA LISTA: líneas, WABA y programas están vinculados. La consolidación de contactos sigue siendo una fase separada y debe respetar los conflictos reportados.',
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
