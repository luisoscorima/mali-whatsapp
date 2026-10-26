#!/usr/bin/env node
/**
 * Consolidación de Educación hacia un área, con CA y EP como programas.
 *
 *   node scripts/consolidate-education.cjs
 *   node scripts/consolidate-education.cjs --apply
 *
 * Sin --apply calcula el mapa dentro de una transacción y la revierte.
 * Las reglas están en docs/REGLAS-CONSOLIDACION-EDUCACION.md.
 */
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

function num(value) {
  return typeof value === 'bigint' ? Number(value) : Number(value || 0);
}

async function sql(tx, text) {
  return tx.$executeRawUnsafe(text);
}

async function query(tx, text) {
  return tx.$queryRawUnsafe(text);
}

async function main() {
  console.log(
    APPLY
      ? 'CONSOLIDACIÓN EDUCACIÓN: escritura'
      : 'CONSOLIDACIÓN EDUCACIÓN: simulación (se revierte)',
  );

  let summary = null;
  try {
    await prisma.$transaction(
      async (tx) => {
        await sql(tx, `SET LOCAL statement_timeout = '20min'`);
        await sql(
          tx,
          `SELECT set_config('mali.conv_before', (
              SELECT COUNT(*)::text FROM conversations
              WHERE area IN ('educacion','educacion_ca','educacion_ep')
            ), true)`,
        );
        await sql(
          tx,
          `SELECT set_config('mali.msg_before', (
              SELECT COUNT(*)::text
              FROM chat_messages m
              JOIN conversations c ON c.id = m.conversation_id
              WHERE c.area IN ('educacion','educacion_ca','educacion_ep')
            ), true)`,
        );

        await sql(
          tx,
          `CREATE TABLE IF NOT EXISTS education_consolidation_map (
            contact_id INTEGER PRIMARY KEY,
            canonical_id INTEGER NOT NULL,
            phone_norm VARCHAR(32),
            decision VARCHAR(16) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )`,
        );
        await sql(
          tx,
          `CREATE TABLE IF NOT EXISTS education_consolidation_audit (
            id BIGSERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            mode VARCHAR(16) NOT NULL,
            summary JSONB NOT NULL
          )`,
        );
        await sql(
          tx,
          `ALTER TABLE meta_lead_form_routes
             ADD COLUMN IF NOT EXISTS program_key VARCHAR(40)`,
        );
        await sql(
          tx,
          `ALTER TABLE tiktok_lead_form_routes
             ADD COLUMN IF NOT EXISTS program_key VARCHAR(40)`,
        );

        await sql(
          tx,
          `CREATE TEMP TABLE edu_contacts ON COMMIT DROP AS
           SELECT
             c.id,
             c.area,
             c.updated_at,
             NULLIF(REGEXP_REPLACE(COALESCE(c.phone, ''), '\\D', '', 'g'), '') AS phone_norm,
             NULLIF(BTRIM(c.whatsapp_user_id), '') AS wuid,
             NULLIF(REGEXP_REPLACE(COALESCE(c.dni, ''), '\\D', '', 'g'), '') AS dni_norm,
             NULLIF(BTRIM(c.email), '') AS email,
             NULLIF(BTRIM(c.name), '') AS name,
             NULLIF(BTRIM(c.last_name), '') AS last_name,
             ls.slug AS status_slug,
             adv.assigned_user_id
           FROM contacts c
           LEFT JOIN lead_status_definitions ls ON ls.id = c.lead_status_id
           LEFT JOIN LATERAL (
             SELECT assigned_user_id
             FROM education_lead_cycles ec
             WHERE ec.contact_id = c.id
             ORDER BY ec.last_interaction_at DESC
             LIMIT 1
           ) adv ON TRUE
           WHERE c.area IN ('educacion','educacion_ca','educacion_ep')
             AND c.active = TRUE`,
        );

        await sql(
          tx,
          `CREATE TEMP TABLE edu_wuid_block ON COMMIT DROP AS
           SELECT DISTINCT c.id AS contact_id, c.phone_norm
           FROM edu_contacts c
           JOIN edu_contacts other
             ON other.wuid = c.wuid AND other.id <> c.id
           WHERE c.wuid IS NOT NULL
             AND COALESCE(c.phone_norm, '') IS DISTINCT FROM COALESCE(other.phone_norm, '')`,
        );

        await sql(
          tx,
          `CREATE TEMP TABLE edu_phone_groups ON COMMIT DROP AS
           SELECT
             phone_norm,
             COUNT(*)::int AS members,
             COUNT(DISTINCT wuid) FILTER (WHERE wuid IS NOT NULL)::int AS wuids,
             COUNT(DISTINCT dni_norm) FILTER (WHERE dni_norm IS NOT NULL AND length(dni_norm) >= 8)::int AS dnis,
             COUNT(DISTINCT status_slug) FILTER (WHERE status_slug IS NOT NULL)::int AS statuses,
             COUNT(DISTINCT assigned_user_id) FILTER (WHERE assigned_user_id IS NOT NULL)::int AS advisors,
             BOOL_OR(id IN (SELECT contact_id FROM edu_wuid_block)) AS wuid_outside
           FROM edu_contacts
           WHERE phone_norm IS NOT NULL
           GROUP BY phone_norm
           HAVING COUNT(*) > 1`,
        );

        await sql(
          tx,
          `CREATE TEMP TABLE edu_map ON COMMIT DROP AS
           SELECT
             c.id AS contact_id,
             c.phone_norm,
             FIRST_VALUE(c.id) OVER (
               PARTITION BY c.phone_norm
               ORDER BY
                 CASE c.area WHEN 'educacion' THEN 0 ELSE 1 END,
                 c.updated_at DESC NULLS LAST,
                 c.id
             ) AS canonical_id,
             CASE
               WHEN g.wuids > 1 OR g.dnis > 1 OR g.statuses > 1
                 OR g.advisors > 1 OR g.wuid_outside
               THEN 'review'
               ELSE 'merge'
             END AS decision
           FROM edu_contacts c
           JOIN edu_phone_groups g ON g.phone_norm = c.phone_norm`,
        );

        const preview = await query(
          tx,
          `SELECT
             (SELECT COUNT(*)::int FROM edu_phone_groups) AS grupos_telefono,
             (SELECT COUNT(*)::int FROM edu_phone_groups g
                JOIN edu_map m ON m.phone_norm = g.phone_norm
               WHERE m.decision = 'merge' AND m.contact_id = m.canonical_id) AS grupos_fusion,
             (SELECT COUNT(*)::int FROM edu_phone_groups g
                JOIN edu_map m ON m.phone_norm = g.phone_norm
               WHERE m.decision = 'review' AND m.contact_id = m.canonical_id) AS grupos_revision,
             (SELECT COUNT(*)::int FROM edu_map WHERE decision = 'merge' AND contact_id <> canonical_id) AS contactos_a_desactivar,
             (SELECT COUNT(*)::int FROM edu_contacts c
               WHERE c.phone_norm IS NULL
                  OR NOT EXISTS (
                    SELECT 1 FROM edu_map m
                    WHERE m.contact_id = c.id AND m.decision = 'review'
                  )) AS contactos_que_pueden_moverse`,
        );
        summary = preview[0];
        console.table([summary]);

        await sql(
          tx,
          `UPDATE contacts win
           SET
             whatsapp_user_id = CASE
               WHEN win.whatsapp_user_id IS NOT NULL THEN win.whatsapp_user_id
               WHEN EXISTS (
                 SELECT 1 FROM contacts other
                 WHERE other.id <> win.id
                   AND other.whatsapp_user_id = donor.whatsapp_user_id
                   AND NULLIF(BTRIM(COALESCE(donor.whatsapp_user_id, '')), '') IS NOT NULL
                   AND other.area = win.area
               ) THEN win.whatsapp_user_id
               ELSE COALESCE(win.whatsapp_user_id, donor.whatsapp_user_id)
             END,
             email = CASE
               WHEN NULLIF(BTRIM(win.email), '') IS NOT NULL THEN win.email
               WHEN EXISTS (
                 SELECT 1 FROM contacts other
                 WHERE other.id <> win.id
                   AND lower(BTRIM(COALESCE(other.email, ''))) = lower(BTRIM(COALESCE(donor.email, '')))
                   AND NULLIF(BTRIM(COALESCE(donor.email, '')), '') IS NOT NULL
                   AND other.area = win.area
               ) THEN win.email
               ELSE COALESCE(NULLIF(BTRIM(win.email), ''), donor.email)
             END,
             dni = CASE
               WHEN NULLIF(BTRIM(win.dni), '') IS NOT NULL THEN win.dni
               WHEN EXISTS (
                 SELECT 1 FROM contacts other
                 WHERE other.id <> win.id
                   AND other.dni = donor.dni
                   AND NULLIF(BTRIM(COALESCE(donor.dni, '')), '') IS NOT NULL
                   AND other.area = win.area
               ) THEN win.dni
               ELSE COALESCE(NULLIF(BTRIM(win.dni), ''), donor.dni)
             END,
             name = CASE
               WHEN NULLIF(BTRIM(win.name), '') IS NULL THEN COALESCE(donor.name, win.name)
               ELSE win.name
             END,
             last_name = CASE
               WHEN NULLIF(BTRIM(win.last_name), '') IS NULL THEN COALESCE(donor.last_name, win.last_name)
               ELSE win.last_name
             END,
             updated_at = NOW()
           FROM (
             SELECT DISTINCT ON (m.canonical_id)
               m.canonical_id,
               c.whatsapp_user_id,
               c.email,
               c.dni,
               c.name,
               c.last_name
             FROM edu_map m
             JOIN contacts c ON c.id = m.contact_id
             WHERE m.decision = 'merge' AND m.contact_id <> m.canonical_id
             ORDER BY m.canonical_id, c.updated_at DESC NULLS LAST
           ) donor
           WHERE win.id = donor.canonical_id`,
        );

        await sql(
          tx,
          `UPDATE conversations conv
           SET contact_id = m.canonical_id, updated_at = NOW()
           FROM edu_map m
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND conv.contact_id = m.contact_id`,
        );
        await sql(
          tx,
          `UPDATE campaign_logs log
           SET contact_id = m.canonical_id
           FROM edu_map m
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND log.contact_id = m.contact_id`,
        );
        await sql(
          tx,
          `UPDATE contact_origins origin
           SET contact_id = m.canonical_id, updated_at = NOW()
           FROM edu_map m
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND origin.contact_id = m.contact_id`,
        );
        await sql(
          tx,
          `UPDATE meta_leadgen_leads lead
           SET contact_id = m.canonical_id, updated_at = NOW()
           FROM edu_map m
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND lead.contact_id = m.contact_id`,
        );
        await sql(
          tx,
          `UPDATE tiktok_leads lead
           SET contact_id = m.canonical_id, updated_at = NOW()
           FROM edu_map m
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND lead.contact_id = m.contact_id`,
        );
        await sql(
          tx,
          `UPDATE meta_ctwa_ad_leads lead
           SET contact_id = m.canonical_id
           FROM edu_map m
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND lead.contact_id = m.contact_id`,
        );

        const scopedAttrs = await query(
          tx,
          `SELECT 1 AS ok FROM pg_indexes WHERE indexname = 'contact_attributes_area_key_uq'`,
        );
        if (scopedAttrs.length) {
          await sql(
            tx,
            `INSERT INTO contact_attributes (contact_id, attr_key, attr_value, program_id, updated_at)
             SELECT m.canonical_id, attr.attr_key, attr.attr_value,
                    COALESCE(attr.program_id, program.id), attr.updated_at
             FROM contact_attributes attr
             JOIN edu_map m ON m.contact_id = attr.contact_id
             JOIN contacts donor ON donor.id = attr.contact_id
             LEFT JOIN business_area_aliases alias
               ON alias.alias = donor.area AND alias.program_key IS NOT NULL
             LEFT JOIN business_programs program
               ON program.business_area_id = alias.business_area_id
              AND program.slug = alias.program_key
             WHERE m.decision = 'merge' AND m.contact_id <> m.canonical_id
             ON CONFLICT DO NOTHING`,
          );
        } else {
          await sql(
            tx,
            `INSERT INTO contact_attributes (contact_id, attr_key, attr_value, updated_at)
             SELECT m.canonical_id, attr.attr_key, attr.attr_value, attr.updated_at
             FROM contact_attributes attr
             JOIN edu_map m ON m.contact_id = attr.contact_id
             WHERE m.decision = 'merge' AND m.contact_id <> m.canonical_id
             ON CONFLICT (contact_id, attr_key) DO NOTHING`,
          );
        }
        await sql(
          tx,
          `DELETE FROM contact_attributes attr
           USING edu_map m
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND attr.contact_id = m.contact_id`,
        );
        await sql(
          tx,
          `INSERT INTO contact_segments (contact_id, area, segment_slug, created_at)
           SELECT m.canonical_id, 'educacion', seg.segment_slug, seg.created_at
           FROM contact_segments seg
           JOIN edu_map m ON m.contact_id = seg.contact_id
           WHERE m.decision = 'merge' AND m.contact_id <> m.canonical_id
           ON CONFLICT (contact_id, segment_slug) DO NOTHING`,
        );
        await sql(
          tx,
          `DELETE FROM contact_segments seg
           USING edu_map m
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND seg.contact_id = m.contact_id`,
        );
        await sql(
          tx,
          `INSERT INTO contact_programs (contact_id, program_id, source, first_seen_at, last_seen_at)
           SELECT m.canonical_id, membership.program_id, 'consolidation',
                  membership.first_seen_at, NOW()
           FROM contact_programs membership
           JOIN edu_map m ON m.contact_id = membership.contact_id
           WHERE m.decision = 'merge'
           ON CONFLICT (contact_id, program_id) DO NOTHING`,
        );
        await sql(
          tx,
          `INSERT INTO contact_programs (contact_id, program_id, source, first_seen_at, last_seen_at)
           SELECT DISTINCT m.canonical_id, program.id, 'legacy_area', NOW(), NOW()
           FROM edu_map m
           JOIN contacts c ON c.id = m.contact_id
           JOIN business_area_aliases alias ON alias.alias = c.area
           JOIN business_programs program
             ON program.business_area_id = alias.business_area_id
            AND program.slug = alias.program_key
           WHERE m.decision = 'merge' AND alias.program_key IS NOT NULL
           ON CONFLICT (contact_id, program_id) DO NOTHING`,
        );

        await sql(
          tx,
          `UPDATE education_lead_entries entry
           SET contact_id = m.canonical_id
           FROM edu_map m
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND entry.contact_id = m.contact_id`,
        );
        await sql(
          tx,
          `UPDATE education_lead_entries entry
           SET cycle_id = winner.id
           FROM education_lead_cycles loser
           JOIN edu_map m ON m.contact_id = loser.contact_id
           JOIN education_lead_cycles winner
             ON winner.contact_id = m.canonical_id
            AND winner.started_at = loser.started_at
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND entry.cycle_id = loser.id`,
        );
        await sql(
          tx,
          `DELETE FROM education_lead_cycles loser
           USING edu_map m, education_lead_cycles winner
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND loser.contact_id = m.contact_id
             AND winner.contact_id = m.canonical_id
             AND winner.started_at = loser.started_at`,
        );
        await sql(
          tx,
          `UPDATE education_lead_cycles cycle
           SET contact_id = m.canonical_id, updated_at = NOW()
           FROM edu_map m
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND cycle.contact_id = m.contact_id`,
        );

        await sql(
          tx,
          `UPDATE contacts loser
           SET active = FALSE,
               whatsapp_user_id = NULL,
               updated_at = NOW()
           FROM edu_map m
           WHERE m.decision = 'merge'
             AND m.contact_id <> m.canonical_id
             AND loser.id = m.contact_id`,
        );

        const peopleReady = await query(
          tx,
          `SELECT to_regclass('public.people')::text AS rel`,
        );
        if (peopleReady[0] && peopleReady[0].rel) {
          await sql(tx, `ALTER TABLE contacts DISABLE TRIGGER USER`);
          await sql(tx, `ALTER TABLE people DISABLE TRIGGER USER`);
          await sql(
            tx,
            `UPDATE people winner
             SET phone = COALESCE(winner.phone, gaps.phone),
                 email = COALESCE(winner.email, gaps.email),
                 dni = COALESCE(winner.dni, gaps.dni),
                 whatsapp_user_id = COALESCE(winner.whatsapp_user_id, gaps.wuid),
                 birth_date = COALESCE(winner.birth_date, gaps.birth_date),
                 name = CASE WHEN BTRIM(winner.name) = '' THEN COALESCE(gaps.name, winner.name) ELSE winner.name END,
                 last_name = CASE WHEN BTRIM(winner.last_name) = '' THEN COALESCE(gaps.last_name, winner.last_name) ELSE winner.last_name END,
                 updated_at = NOW()
             FROM (
               SELECT win.person_id,
                 (ARRAY_AGG(donor.phone) FILTER (WHERE donor.phone IS NOT NULL))[1] AS phone,
                 (ARRAY_AGG(donor.email) FILTER (WHERE donor.email IS NOT NULL))[1] AS email,
                 (ARRAY_AGG(donor.dni) FILTER (WHERE donor.dni IS NOT NULL))[1] AS dni,
                 (ARRAY_AGG(donor.whatsapp_user_id) FILTER (WHERE donor.whatsapp_user_id IS NOT NULL))[1] AS wuid,
                 (ARRAY_AGG(donor.birth_date) FILTER (WHERE donor.birth_date IS NOT NULL))[1] AS birth_date,
                 (ARRAY_AGG(donor.name) FILTER (WHERE BTRIM(donor.name) <> ''))[1] AS name,
                 (ARRAY_AGG(donor.last_name) FILTER (WHERE BTRIM(donor.last_name) <> ''))[1] AS last_name
               FROM edu_map m
               JOIN contacts win ON win.id = m.canonical_id
               JOIN contacts lose ON lose.id = m.contact_id
               JOIN people donor ON donor.id = lose.person_id
               WHERE m.decision = 'merge' AND m.contact_id <> m.canonical_id
               GROUP BY win.person_id
             ) gaps
             WHERE winner.id = gaps.person_id`,
          );
          await sql(
            tx,
            `UPDATE contacts lose
             SET person_id = win.person_id,
                 phone = NULL,
                 email = NULL,
                 dni = NULL,
                 whatsapp_user_id = NULL
             FROM edu_map m
             JOIN contacts win ON win.id = m.canonical_id
             WHERE lose.id = m.contact_id
               AND m.decision = 'merge'
               AND m.contact_id <> m.canonical_id
               AND lose.person_id IS DISTINCT FROM win.person_id`,
          );
          await sql(
            tx,
            `DELETE FROM people p
             WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.person_id = p.id)`,
          );
          await sql(tx, `ALTER TABLE people ENABLE TRIGGER USER`);
          await sql(tx, `ALTER TABLE contacts ENABLE TRIGGER USER`);
        }

        const categoryColumns = await query(
          tx,
          `SELECT 1 AS ok FROM information_schema.columns
           WHERE table_name = 'education_lead_entries' AND column_name = 'program_id'`,
        );
        if (categoryColumns.length) {
          await sql(
            tx,
            `UPDATE contact_attributes attr
             SET program_id = program.id
             FROM contacts c
             JOIN business_area_aliases alias
               ON alias.alias = c.area AND alias.program_key IS NOT NULL
             JOIN business_programs program
               ON program.business_area_id = alias.business_area_id
              AND program.slug = alias.program_key
             WHERE attr.contact_id = c.id
               AND attr.program_id IS NULL
               AND c.area IN ('educacion_ca','educacion_ep')`,
          );
          for (const table of ['contact_origins', 'education_lead_cycles', 'education_lead_entries']) {
            await sql(
              tx,
              `UPDATE ${table} moved
               SET program_id = program.id
               FROM business_area_aliases alias
               JOIN business_programs program
                 ON program.business_area_id = alias.business_area_id
                AND program.slug = alias.program_key
               WHERE moved.program_id IS NULL
                 AND alias.alias = moved.area
                 AND alias.program_key IS NOT NULL`,
            );
          }
        }

        await sql(
          tx,
          `UPDATE contacts c
           SET area = 'educacion', updated_at = NOW()
           WHERE c.active = TRUE
             AND c.area IN ('educacion_ca','educacion_ep')
             AND NOT EXISTS (
               SELECT 1 FROM edu_map m
               WHERE m.contact_id = c.id AND m.decision = 'review'
             )
             AND NOT EXISTS (
               SELECT 1 FROM edu_wuid_block b WHERE b.contact_id = c.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM contacts other
               WHERE other.id <> c.id
                 AND (
                   (
                     NULLIF(BTRIM(c.email), '') IS NOT NULL
                     AND lower(BTRIM(other.email)) = lower(BTRIM(c.email))
                   )
                   OR (
                     NULLIF(BTRIM(c.dni), '') IS NOT NULL
                     AND other.dni = c.dni
                   )
                   OR (
                     NULLIF(BTRIM(c.phone), '') IS NOT NULL
                     AND other.phone = c.phone
                   )
                   OR (
                     NULLIF(BTRIM(c.whatsapp_user_id), '') IS NOT NULL
                     AND other.whatsapp_user_id = c.whatsapp_user_id
                   )
                 )
                 AND (
                   other.area = 'educacion'
                   OR (
                     other.area IN ('educacion_ca','educacion_ep')
                     AND other.id < c.id
                     AND NOT EXISTS (
                       SELECT 1 FROM edu_map m
                       WHERE m.contact_id = other.id AND m.decision = 'review'
                     )
                     AND NOT EXISTS (
                       SELECT 1 FROM edu_wuid_block b WHERE b.contact_id = other.id
                     )
                   )
                 )
             )`,
        );

        await sql(
          tx,
          `UPDATE conversations
           SET area = 'educacion', updated_at = NOW()
           WHERE area IN ('educacion_ca','educacion_ep')
             AND whatsapp_line_id IS NOT NULL`,
        );
        await sql(
          tx,
          `UPDATE campaigns
           SET area = 'educacion'
           WHERE area IN ('educacion_ca','educacion_ep')
             AND whatsapp_line_id IS NOT NULL`,
        );

        await sql(
          tx,
          `UPDATE contacts c
           SET lead_status_id = target.id, updated_at = NOW()
           FROM lead_status_definitions source
           JOIN lead_status_definitions target
             ON target.area = 'educacion' AND target.slug = source.slug
           WHERE c.lead_status_id = source.id
             AND source.area IN ('educacion_ca','educacion_ep')
             AND c.area = 'educacion'`,
        );
        await sql(
          tx,
          `UPDATE education_lead_cycles cycle
           SET lead_status_id = target.id, updated_at = NOW()
           FROM lead_status_definitions source
           JOIN lead_status_definitions target
             ON target.area = 'educacion' AND target.slug = source.slug
           WHERE cycle.lead_status_id = source.id
             AND source.area IN ('educacion_ca','educacion_ep')
             AND cycle.area IN ('educacion','educacion_ca','educacion_ep')`,
        );

        await sql(
          tx,
          `UPDATE segment_definitions moved
           SET area = 'educacion', updated_at = NOW()
           WHERE moved.id IN (
             SELECT MIN(candidate.id)
             FROM segment_definitions candidate
             WHERE candidate.area IN ('educacion_ca','educacion_ep')
               AND NOT EXISTS (
                 SELECT 1 FROM segment_definitions keep
                 WHERE keep.area = 'educacion' AND keep.slug = candidate.slug
               )
             GROUP BY candidate.slug
           )`,
        );
        await sql(
          tx,
          `UPDATE contact_segments seg
           SET area = 'educacion'
           WHERE seg.area IN ('educacion','educacion_ca','educacion_ep')
             AND EXISTS (
               SELECT 1 FROM segment_definitions def
               WHERE def.area = 'educacion' AND def.slug = seg.segment_slug
             )`,
        );
        await sql(
          tx,
          `DELETE FROM segment_definitions extra
           WHERE extra.area IN ('educacion_ca','educacion_ep')
             AND EXISTS (
               SELECT 1 FROM segment_definitions keep
               WHERE keep.area = 'educacion' AND keep.slug = extra.slug
             )`,
        );
        await sql(
          tx,
          `DELETE FROM whatsapp_templates extra
           WHERE extra.area IN ('educacion_ca','educacion_ep')
             AND EXISTS (
               SELECT 1 FROM whatsapp_templates keep
               WHERE keep.area = 'educacion'
                 AND keep.name = extra.name
                 AND keep.language = extra.language
             )`,
        );
        await sql(
          tx,
          `UPDATE whatsapp_templates moved
           SET area = 'educacion'
           WHERE moved.area IN ('educacion_ca','educacion_ep')`,
        );

        await sql(
          tx,
          `UPDATE contact_origins SET area = 'educacion', updated_at = NOW()
           WHERE area IN ('educacion_ca','educacion_ep')`,
        );
        await sql(
          tx,
          `UPDATE education_lead_cycles SET area = 'educacion', updated_at = NOW()
           WHERE area IN ('educacion_ca','educacion_ep')`,
        );
        await sql(
          tx,
          `UPDATE education_lead_entries SET area = 'educacion'
           WHERE area IN ('educacion_ca','educacion_ep')`,
        );
        await sql(
          tx,
          `UPDATE meta_lead_forms SET area = 'educacion', updated_at = NOW()
           WHERE area IN ('educacion_ca','educacion_ep')`,
        );
        await sql(
          tx,
          `UPDATE meta_leadgen_leads SET area = 'educacion', updated_at = NOW()
           WHERE area IN ('educacion_ca','educacion_ep')`,
        );
        await sql(
          tx,
          `UPDATE tiktok_leads SET area = 'educacion', updated_at = NOW()
           WHERE area IN ('educacion_ca','educacion_ep')`,
        );
        await sql(
          tx,
          `UPDATE meta_ctwa_ads SET area = 'educacion', updated_at = NOW()
           WHERE area IN ('educacion_ca','educacion_ep')`,
        );
        await sql(
          tx,
          `UPDATE meta_ctwa_ad_leads SET area = 'educacion'
           WHERE area IN ('educacion_ca','educacion_ep')`,
        );
        await sql(
          tx,
          `UPDATE meta_lead_form_routes
           SET program_key = COALESCE(program_key, CASE area
                 WHEN 'educacion_ca' THEN 'ca'
                 WHEN 'educacion_ep' THEN 'ep'
                 ELSE program_key
               END),
               area = 'educacion',
               updated_at = NOW()
           WHERE area IN ('educacion','educacion_ca','educacion_ep')`,
        );
        await sql(
          tx,
          `UPDATE tiktok_lead_form_routes
           SET program_key = COALESCE(program_key, CASE area
                 WHEN 'educacion_ca' THEN 'ca'
                 WHEN 'educacion_ep' THEN 'ep'
                 ELSE program_key
               END),
               area = 'educacion',
               updated_at = NOW()
           WHERE area IN ('educacion','educacion_ca','educacion_ep')`,
        );

        await sql(
          tx,
          `INSERT INTO user_areas (user_id, area)
           SELECT DISTINCT user_id, 'educacion'
           FROM user_areas
           WHERE area IN ('educacion_ca','educacion_ep')
           ON CONFLICT (user_id, area) DO NOTHING`,
        );
        await sql(
          tx,
          `UPDATE users SET area = 'educacion'
           WHERE area IN ('educacion_ca','educacion_ep')`,
        );

        await sql(
          tx,
          `INSERT INTO education_consolidation_map
             (contact_id, canonical_id, phone_norm, decision)
           SELECT contact_id, canonical_id, phone_norm, decision
           FROM edu_map
           ON CONFLICT (contact_id) DO UPDATE
           SET canonical_id = EXCLUDED.canonical_id,
               phone_norm = EXCLUDED.phone_norm,
               decision = EXCLUDED.decision,
               created_at = NOW()`,
        );

        const after = await query(
          tx,
          `SELECT
             (SELECT COUNT(*)::int FROM conversations
              WHERE area IN ('educacion','educacion_ca','educacion_ep')) AS conv_after,
             current_setting('mali.conv_before')::int AS conv_before,
             (SELECT COUNT(*)::int FROM chat_messages m
              JOIN conversations c ON c.id = m.conversation_id
              WHERE c.area IN ('educacion','educacion_ca','educacion_ep')) AS msg_after,
             current_setting('mali.msg_before')::int AS msg_before,
             (SELECT COUNT(*)::int FROM edu_map m
              JOIN contacts c ON c.id = m.contact_id
              WHERE m.decision = 'review' AND c.active = FALSE
             ) AS review_alterado,
             (SELECT COUNT(*)::int FROM (
                SELECT phone_norm
                FROM edu_map m
                JOIN contacts c ON c.id = m.canonical_id
                WHERE m.decision = 'merge' AND m.contact_id = m.canonical_id
                GROUP BY phone_norm
                HAVING COUNT(*) FILTER (WHERE c.active) <> 1
              ) bad) AS fusiones_incompletas,
             (SELECT COUNT(*)::int FROM (
                SELECT whatsapp_user_id
                FROM contacts
                WHERE area = 'educacion' AND active = TRUE
                  AND NULLIF(BTRIM(whatsapp_user_id), '') IS NOT NULL
                GROUP BY whatsapp_user_id
                HAVING COUNT(*) > 1
              ) dup) AS wuid_duplicado`,
        );
        const check = after[0];
        console.table([check]);
        const failed =
          num(check.conv_after) !== num(check.conv_before) ||
          num(check.msg_after) !== num(check.msg_before) ||
          num(check.review_alterado) !== 0 ||
          num(check.fusiones_incompletas) !== 0 ||
          num(check.wuid_duplicado) !== 0;
        if (failed) {
          throw new Error('GATE: la consolidación no cuadra y se revierte');
        }

        await sql(
          tx,
          `INSERT INTO education_consolidation_audit (mode, summary)
           VALUES (
             '${APPLY ? 'apply' : 'simulate'}',
             $json$${JSON.stringify({ preview: summary, check })}$json$::jsonb
           )`,
        );

        if (!APPLY) {
          throw new Error('DRY_RUN');
        }
      },
      { timeout: 20 * 60 * 1000, maxWait: 20_000 },
    );
    console.log('APLICADO');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('DRY_RUN')) {
      console.log('SIMULACIÓN REVERTIDA. Ningún dato quedó escrito.');
      return;
    }
    throw error;
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
