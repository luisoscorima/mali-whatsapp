#!/usr/bin/env node
/**
 * Une los grupos de education_consolidation_map en decision=review.
 *
 * Reglas:
 * - Conserva canonical_id del mapa.
 * - En conflicto de asesor/estado: gana el ciclo con last_interaction_at más reciente
 *   del grupo (asesor y lead_status del contacto de ese ciclo).
 * - Omite teléfonos con WhatsApp/DNI distintos o el mismo WA en otro teléfono.
 * - Conversaciones no se fusionan (siguen 1 por línea); solo se reenlazan al canónico
 *   y se les asigna el asesor ganador.
 *
 *   node scripts/join-education-review.cjs
 *   node scripts/join-education-review.cjs --apply
 */
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

function num(value) {
  return typeof value === 'bigint' ? Number(value) : Number(value || 0);
}

async function sql(tx, text, label) {
  try {
    return await tx.$executeRawUnsafe(text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${label || 'sql'} falló: ${msg}`);
  }
}

async function query(tx, text, label) {
  try {
    return await tx.$queryRawUnsafe(text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`${label || 'query'} falló: ${msg}`);
  }
}

async function main() {
  console.log(
    APPLY
      ? 'JOIN REVIEW EDUCACIÓN: escritura'
      : 'JOIN REVIEW EDUCACIÓN: simulación (se revierte)',
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
          `SELECT set_config('mali.review_before', (
              SELECT COUNT(DISTINCT phone_norm)::text
              FROM education_consolidation_map
              WHERE decision = 'review'
            ), true)`,
        );

        // Teléfonos elegibles vs identidad dudosa.
        await sql(
          tx,
          `CREATE TEMP TABLE review_members ON COMMIT DROP AS
           SELECT
             m.phone_norm,
             m.contact_id,
             m.canonical_id,
             c.area,
             c.person_id,
             c.name,
             c.last_name,
             c.email,
             c.dni,
             c.whatsapp_user_id,
             c.lead_status_id,
             c.active
           FROM education_consolidation_map m
           JOIN contacts c ON c.id = m.contact_id
           WHERE m.decision = 'review'`,
        );

        await sql(
          tx,
          `CREATE TEMP TABLE review_skip ON COMMIT DROP AS
           SELECT phone_norm, reason
           FROM (
             SELECT
               phone_norm,
               CASE
                 WHEN COUNT(DISTINCT NULLIF(BTRIM(whatsapp_user_id), '')) > 1
                   THEN 'whatsapp_distinto'
                 WHEN COUNT(DISTINCT CASE
                        WHEN length(regexp_replace(COALESCE(dni, ''), '\\D', '', 'g')) >= 8
                        THEN regexp_replace(dni, '\\D', '', 'g')
                      END) > 1
                   THEN 'dni_distinto'
                 WHEN BOOL_OR(EXISTS (
                        SELECT 1
                        FROM contacts other
                        WHERE other.whatsapp_user_id IS NOT NULL
                          AND BTRIM(other.whatsapp_user_id) <> ''
                          AND other.whatsapp_user_id = rm.whatsapp_user_id
                          AND other.id <> rm.contact_id
                          AND regexp_replace(COALESCE(other.phone, ''), '\\D', '', 'g')
                              IS DISTINCT FROM rm.phone_norm
                      ))
                   THEN 'whatsapp_en_otro_telefono'
               END AS reason
             FROM review_members rm
             GROUP BY phone_norm
           ) s
           WHERE reason IS NOT NULL`,
        );

        // Canónico efectivo: si ya hay ficha activa en educacion con ese teléfono
        // (aunque no esté en el mapa), esa gana. Si no, el canonical_id del mapa.
        await sql(
          tx,
          `CREATE TEMP TABLE review_join ON COMMIT DROP AS
           SELECT
             base.phone_norm,
             COALESCE(edu.id, base.map_canonical_id) AS canonical_id,
             base.map_canonical_id
           FROM (
             SELECT DISTINCT phone_norm, canonical_id AS map_canonical_id
             FROM review_members
             WHERE phone_norm NOT IN (SELECT phone_norm FROM review_skip)
           ) base
           LEFT JOIN LATERAL (
             SELECT c.id
             FROM contacts c
             WHERE c.area = 'educacion'
               AND c.active = TRUE
               AND c.phone = base.phone_norm
             ORDER BY (c.id = base.map_canonical_id) DESC, c.updated_at DESC NULLS LAST, c.id
             LIMIT 1
           ) edu ON TRUE`,
          'create review_join',
        );

        // Donantes = miembros del mapa (≠ canónico) + ficha educacion activa fuera del mapa.
        await sql(
          tx,
          `CREATE TEMP TABLE review_donors ON COMMIT DROP AS
           SELECT phone_norm, canonical_id, contact_id FROM (
             SELECT j.phone_norm, j.canonical_id, rm.contact_id
             FROM review_join j
             JOIN review_members rm ON rm.phone_norm = j.phone_norm
             WHERE rm.contact_id <> j.canonical_id
             UNION
             SELECT j.phone_norm, j.canonical_id, c.id
             FROM review_join j
             JOIN contacts c
               ON c.area = 'educacion'
              AND c.active = TRUE
              AND c.phone = j.phone_norm
              AND c.id <> j.canonical_id
           ) d`,
          'create review_donors',
        );

        // Asesor/estado ganadores: ciclo más reciente del grupo (mapa + canónico efectivo).
        await sql(
          tx,
          `CREATE TEMP TABLE review_group_contacts ON COMMIT DROP AS
           SELECT j.phone_norm, j.canonical_id, j.canonical_id AS contact_id
           FROM review_join j
           UNION
           SELECT d.phone_norm, d.canonical_id, d.contact_id
           FROM review_donors d`,
          'create review_group_contacts',
        );
        await sql(
          tx,
          `CREATE TEMP TABLE review_winner ON COMMIT DROP AS
           SELECT DISTINCT ON (gc.phone_norm)
             gc.phone_norm,
             gc.canonical_id,
             elc.assigned_user_id AS advisor_id,
             COALESCE(elc.lead_status_id, c.lead_status_id) AS lead_status_id,
             gc.contact_id AS source_contact_id,
             elc.last_interaction_at
           FROM review_group_contacts gc
           JOIN contacts c ON c.id = gc.contact_id
           LEFT JOIN education_lead_cycles elc
             ON elc.contact_id = gc.contact_id
            AND elc.assigned_user_id IS NOT NULL
           ORDER BY
             gc.phone_norm,
             elc.last_interaction_at DESC NULLS LAST,
             elc.id DESC NULLS LAST,
             (gc.contact_id = gc.canonical_id) DESC,
             gc.contact_id`,
          'create review_winner',
        );

        // Perfil canónico: nombre del canónico si existe; huecos desde donantes.
        await sql(
          tx,
          `CREATE TEMP TABLE review_profile ON COMMIT DROP AS
           SELECT
             j.phone_norm,
             j.canonical_id,
             COALESCE(
               NULLIF(BTRIM(keep.name), ''),
               (
                 SELECT NULLIF(BTRIM(d.name), '')
                 FROM contacts d
                 JOIN review_donors rd ON rd.contact_id = d.id AND rd.phone_norm = j.phone_norm
                 ORDER BY length(BTRIM(COALESCE(d.name, ''))) DESC, d.id
                 LIMIT 1
               ),
               keep.name
             ) AS name,
             COALESCE(
               NULLIF(BTRIM(keep.last_name), ''),
               (
                 SELECT NULLIF(BTRIM(d.last_name), '')
                 FROM contacts d
                 JOIN review_donors rd ON rd.contact_id = d.id AND rd.phone_norm = j.phone_norm
                 ORDER BY length(BTRIM(COALESCE(d.last_name, ''))) DESC, d.id
                 LIMIT 1
               ),
               keep.last_name
             ) AS last_name,
             COALESCE(
               NULLIF(BTRIM(keep.email), ''),
               (
                 SELECT NULLIF(BTRIM(d.email), '')
                 FROM contacts d
                 JOIN review_donors rd ON rd.contact_id = d.id AND rd.phone_norm = j.phone_norm
                 WHERE NULLIF(BTRIM(d.email), '') IS NOT NULL
                 ORDER BY d.id
                 LIMIT 1
               )
             ) AS email,
             COALESCE(
               NULLIF(BTRIM(keep.dni), ''),
               (
                 SELECT NULLIF(BTRIM(d.dni), '')
                 FROM contacts d
                 JOIN review_donors rd ON rd.contact_id = d.id AND rd.phone_norm = j.phone_norm
                 WHERE NULLIF(BTRIM(d.dni), '') IS NOT NULL
                 ORDER BY d.id
                 LIMIT 1
               )
             ) AS dni,
             w.advisor_id,
             w.lead_status_id
           FROM review_join j
           JOIN contacts keep ON keep.id = j.canonical_id
           LEFT JOIN review_winner w ON w.phone_norm = j.phone_norm`,
        );

        const preview = await query(
          tx,
          `SELECT
             (SELECT COUNT(*)::int FROM review_join) AS telefonos_a_unir,
             (SELECT COUNT(*)::int FROM review_skip) AS telefonos_omitidos,
             (SELECT COUNT(*)::int FROM review_donors) AS fichas_donantes,
             (SELECT COUNT(*)::int FROM review_join
               WHERE canonical_id IS DISTINCT FROM map_canonical_id) AS canonicos_reapuntados,
             (SELECT COUNT(*)::int FROM review_winner WHERE advisor_id IS NOT NULL) AS con_asesor_ganador,
             (SELECT COUNT(*)::int FROM review_skip WHERE reason = 'whatsapp_distinto') AS skip_wa,
             (SELECT COUNT(*)::int FROM review_skip WHERE reason = 'dni_distinto') AS skip_dni,
             (SELECT COUNT(*)::int FROM review_skip WHERE reason = 'whatsapp_en_otro_telefono') AS skip_wa_otro`,
        );
        summary = {
          preview: preview[0],
          skipped: await query(
            tx,
            `SELECT phone_norm, reason FROM review_skip ORDER BY phone_norm`,
          ),
        };

        await sql(tx, `ALTER TABLE contacts DISABLE TRIGGER USER`, 'disable contacts triggers');
        await sql(tx, `ALTER TABLE people DISABLE TRIGGER USER`, 'disable people triggers');
        let triggersDisabled = true;
        try {
          // Liberar identidad de donantes antes de mover FKs.
          await sql(
            tx,
            `UPDATE contacts donor
             SET phone = NULL, email = NULL, dni = NULL, whatsapp_user_id = NULL,
                 active = FALSE, updated_at = NOW()
             FROM review_donors rd
             WHERE donor.id = rd.contact_id`,
            'deactivate donors',
          );

          await sql(
            tx,
            `UPDATE contacts keep
             SET name = p.name,
                 last_name = COALESCE(p.last_name, ''),
                 email = p.email,
                 dni = p.dni,
                 lead_status_id = COALESCE(p.lead_status_id, keep.lead_status_id),
                 lead_status_updated_at = CASE
                   WHEN p.lead_status_id IS NOT NULL
                     AND p.lead_status_id IS DISTINCT FROM keep.lead_status_id
                   THEN NOW()
                   ELSE keep.lead_status_updated_at
                 END,
                 area = 'educacion',
                 active = TRUE,
                 updated_at = NOW()
             FROM review_profile p
             WHERE keep.id = p.canonical_id`,
            'update canonical profile',
          );

          await sql(
            tx,
            `UPDATE people person
             SET name = keep.name,
                 last_name = keep.last_name,
                 email = keep.email,
                 dni = keep.dni,
                 phone = COALESCE(person.phone, keep.phone),
                 whatsapp_user_id = COALESCE(person.whatsapp_user_id, keep.whatsapp_user_id),
                 updated_at = NOW()
             FROM contacts keep
             JOIN review_join j ON j.canonical_id = keep.id
             WHERE person.id = keep.person_id`,
            'update people profile',
          );

          // Reasignar FKs de donante → canónico (mismo patrón que consolidate / Admin Unir).
          await sql(
            tx,
            `UPDATE conversations c
             SET contact_id = rd.canonical_id,
                 area = 'educacion',
                 updated_at = NOW()
             FROM review_donors rd
             WHERE c.contact_id = rd.contact_id`,
            'move conversations',
          );
          await sql(
            tx,
            `UPDATE campaign_logs log
             SET contact_id = rd.canonical_id
             FROM review_donors rd
             WHERE log.contact_id = rd.contact_id`,
            'move campaign_logs',
          );
          await sql(
            tx,
            `UPDATE contact_origins origin
             SET contact_id = rd.canonical_id, updated_at = NOW()
             FROM review_donors rd
             WHERE origin.contact_id = rd.contact_id`,
            'move contact_origins',
          );
          await sql(
            tx,
            `UPDATE meta_leadgen_leads lead
             SET contact_id = rd.canonical_id, updated_at = NOW()
             FROM review_donors rd
             WHERE lead.contact_id = rd.contact_id`,
            'move meta_leadgen_leads',
          );
          await sql(
            tx,
            `UPDATE tiktok_leads lead
             SET contact_id = rd.canonical_id, updated_at = NOW()
             FROM review_donors rd
             WHERE lead.contact_id = rd.contact_id`,
            'move tiktok_leads',
          );
          await sql(
            tx,
            `UPDATE meta_ctwa_ad_leads lead
             SET contact_id = rd.canonical_id
             FROM review_donors rd
             WHERE lead.contact_id = rd.contact_id`,
            'move meta_ctwa_ad_leads',
          );

          await sql(
            tx,
            `UPDATE education_lead_entries entry
             SET cycle_id = winner.id
             FROM education_lead_cycles loser
             JOIN review_donors rd ON rd.contact_id = loser.contact_id
             JOIN education_lead_cycles winner
               ON winner.contact_id = rd.canonical_id
              AND winner.started_at = loser.started_at
             WHERE entry.cycle_id = loser.id`,
            'remap lead entries same started_at',
          );
          await sql(
            tx,
            `DELETE FROM education_lead_cycles loser
             USING review_donors rd, education_lead_cycles winner
             WHERE loser.contact_id = rd.contact_id
               AND winner.contact_id = rd.canonical_id
               AND winner.started_at = loser.started_at`,
            'delete duplicate cycles same started_at',
          );

          // Antes de unificar person_id: cerrar ciclos abiertos que chocarían.
          await sql(
            tx,
            `CREATE TEMP TABLE review_group_cycles ON COMMIT DROP AS
             SELECT gc.phone_norm, gc.canonical_id, keep.person_id AS keep_person_id, elc.id AS cycle_id,
                    elc.business_area_id, elc.program_id, elc.last_interaction_at, elc.closed_at
             FROM review_group_contacts gc
             JOIN contacts keep ON keep.id = gc.canonical_id
             JOIN education_lead_cycles elc ON elc.contact_id = gc.contact_id`,
            'list group cycles',
          );

          await sql(
            tx,
            `CREATE TEMP TABLE review_cycle_keep ON COMMIT DROP AS
             SELECT DISTINCT ON (keep_person_id, business_area_id, program_id)
               cycle_id, keep_person_id, business_area_id, program_id
             FROM review_group_cycles
             WHERE closed_at IS NULL
             ORDER BY
               keep_person_id,
               business_area_id,
               program_id,
               last_interaction_at DESC NULLS LAST,
               cycle_id DESC`,
            'pick surviving open cycles',
          );

          await sql(
            tx,
            `UPDATE education_lead_cycles loser
             SET closed_at = NOW(),
                 close_reason = 'superseded_duplicate',
                 updated_at = NOW()
             FROM review_group_cycles g
             WHERE loser.id = g.cycle_id
               AND loser.closed_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM review_cycle_keep k WHERE k.cycle_id = loser.id
               )`,
            'close colliding open cycles',
          );

          await sql(
            tx,
            `UPDATE education_lead_cycles cycle
             SET contact_id = rd.canonical_id,
                 person_id = keep.person_id,
                 area = 'educacion',
                 updated_at = NOW()
             FROM review_donors rd
             JOIN contacts keep ON keep.id = rd.canonical_id
             WHERE cycle.contact_id = rd.contact_id`,
            'move cycles to canonical',
          );

          // Ciclos que ya estaban en el canónico: alinear person_id/área por si acaso.
          await sql(
            tx,
            `UPDATE education_lead_cycles cycle
             SET person_id = keep.person_id,
                 area = 'educacion',
                 updated_at = NOW()
             FROM review_join j
             JOIN contacts keep ON keep.id = j.canonical_id
             WHERE cycle.contact_id = j.canonical_id
               AND (
                 cycle.person_id IS DISTINCT FROM keep.person_id
                 OR cycle.area IS DISTINCT FROM 'educacion'
               )`,
          );

          await sql(
            tx,
            `UPDATE education_lead_entries entry
             SET contact_id = rd.canonical_id
             FROM review_donors rd
             WHERE entry.contact_id = rd.contact_id`,
            'move lead entries contact_id',
          );

          await sql(
            tx,
            `INSERT INTO contact_attributes (contact_id, attr_key, attr_value, program_id, updated_at)
             SELECT rd.canonical_id, src.attr_key, src.attr_value, src.program_id, src.updated_at
             FROM contact_attributes src
             JOIN review_donors rd ON rd.contact_id = src.contact_id
             WHERE NOT EXISTS (
               SELECT 1 FROM contact_attributes existing
               WHERE existing.contact_id = rd.canonical_id
                 AND existing.attr_key = src.attr_key
                 AND existing.program_id IS NOT DISTINCT FROM src.program_id
             )`,
            'copy attributes',
          );
          await sql(
            tx,
            `DELETE FROM contact_attributes src
             USING review_donors rd
             WHERE src.contact_id = rd.contact_id`,
            'delete donor attributes',
          );

          await sql(
            tx,
            `INSERT INTO contact_segments (contact_id, area, segment_slug, program_id, created_at)
             SELECT rd.canonical_id, 'educacion', src.segment_slug, src.program_id, src.created_at
             FROM contact_segments src
             JOIN review_donors rd ON rd.contact_id = src.contact_id
             WHERE NOT EXISTS (
               SELECT 1 FROM contact_segments existing
               WHERE existing.contact_id = rd.canonical_id
                 AND existing.segment_slug = src.segment_slug
                 AND existing.program_id IS NOT DISTINCT FROM src.program_id
             )`,
            'copy segments',
          );
          await sql(
            tx,
            `DELETE FROM contact_segments src
             USING review_donors rd
             WHERE src.contact_id = rd.contact_id`,
            'delete donor segments',
          );

          await sql(
            tx,
            `INSERT INTO contact_programs (contact_id, program_id, source, first_seen_at, last_seen_at)
             SELECT rd.canonical_id, src.program_id, src.source, src.first_seen_at, NOW()
             FROM contact_programs src
             JOIN review_donors rd ON rd.contact_id = src.contact_id
             ON CONFLICT (contact_id, program_id) DO NOTHING`,
            'copy programs',
          );
          await sql(
            tx,
            `DELETE FROM contact_programs src
             USING review_donors rd
             WHERE src.contact_id = rd.contact_id`,
            'delete donor programs',
          );

          await sql(
            tx,
            `UPDATE contacts donor
             SET person_id = keep.person_id
             FROM review_donors rd
             JOIN contacts keep ON keep.id = rd.canonical_id
             WHERE donor.id = rd.contact_id
               AND donor.person_id IS DISTINCT FROM keep.person_id`,
            'repoint donor person_id',
          );

          // Asesor ganador en ciclos abiertos y conversaciones del canónico.
          await sql(
            tx,
            `UPDATE education_lead_cycles cycle
             SET assigned_user_id = p.advisor_id,
                 first_assigned_at = COALESCE(cycle.first_assigned_at, NOW()),
                 updated_at = NOW()
             FROM review_profile p
             WHERE cycle.contact_id = p.canonical_id
               AND cycle.closed_at IS NULL
               AND p.advisor_id IS NOT NULL
               AND cycle.assigned_user_id IS DISTINCT FROM p.advisor_id`,
          );

          await sql(
            tx,
            `UPDATE conversations c
             SET assigned_user_id = p.advisor_id,
                 updated_at = NOW()
             FROM review_profile p
             WHERE c.contact_id = p.canonical_id
               AND c.area IN ('educacion', 'educacion_ca', 'educacion_ep')
               AND p.advisor_id IS NOT NULL
               AND c.assigned_user_id IS DISTINCT FROM p.advisor_id`,
          );

          // También chats del mismo teléfono aún sin contact_id o con id viejo ya movido.
          await sql(
            tx,
            `UPDATE conversations c
             SET contact_id = p.canonical_id,
                 assigned_user_id = COALESCE(p.advisor_id, c.assigned_user_id),
                 area = 'educacion',
                 updated_at = NOW()
             FROM review_profile p
             WHERE c.phone = p.phone_norm
               AND c.area IN ('educacion', 'educacion_ca', 'educacion_ep')
               AND (c.contact_id IS DISTINCT FROM p.canonical_id OR c.area IS DISTINCT FROM 'educacion')`,
            'relink conversations by phone',
          );

          await sql(
            tx,
            `DELETE FROM people person
             WHERE NOT EXISTS (
               SELECT 1 FROM contacts contact WHERE contact.person_id = person.id
             )
             AND NOT EXISTS (
               SELECT 1 FROM education_lead_cycles cycle WHERE cycle.person_id = person.id
             )`,
          );

          await sql(
            tx,
            `UPDATE education_consolidation_map m
             SET decision = 'joined'
             FROM review_join j
             WHERE m.phone_norm = j.phone_norm
               AND m.decision = 'review'`,
            'mark map joined',
          );

          await sql(tx, `ALTER TABLE contacts ENABLE TRIGGER USER`, 'enable contacts triggers');
          await sql(tx, `ALTER TABLE people ENABLE TRIGGER USER`, 'enable people triggers');
          triggersDisabled = false;
        } catch (error) {
          if (triggersDisabled) {
            console.error('Error durante merge:', error instanceof Error ? error.message : error);
          }
          throw error;
        }

        const check = (
          await query(
            tx,
            `SELECT
               current_setting('mali.conv_before')::int AS conv_before,
               (SELECT COUNT(*)::int FROM conversations
                 WHERE area IN ('educacion','educacion_ca','educacion_ep')) AS conv_after,
               current_setting('mali.msg_before')::int AS msg_before,
               (
                 SELECT COUNT(*)::int
                 FROM chat_messages m
                 JOIN conversations c ON c.id = m.conversation_id
                 WHERE c.area IN ('educacion','educacion_ca','educacion_ep')
               ) AS msg_after,
               current_setting('mali.review_before')::int AS review_before,
               (
                 SELECT COUNT(DISTINCT phone_norm)::int
                 FROM education_consolidation_map
                 WHERE decision = 'review'
               ) AS review_after,
               (
                 SELECT COUNT(DISTINCT phone_norm)::int
                 FROM education_consolidation_map
                 WHERE decision = 'joined'
               ) AS joined_phones,
               (
                 SELECT COUNT(*)::int
                 FROM review_join j
                 JOIN contacts c ON c.id = j.canonical_id
                 WHERE c.active = FALSE OR c.area IS DISTINCT FROM 'educacion'
               ) AS canonical_mal,
               (
                 SELECT COUNT(*)::int
                 FROM review_donors rd
                 JOIN contacts c ON c.id = rd.contact_id
                 WHERE c.active = TRUE
               ) AS donors_activos`,
          )
        )[0];

        summary.check = check;
        // Mensajes pueden subir por webhooks concurrentes; no deben bajar.
        summary.ok =
          num(check.conv_before) === num(check.conv_after) &&
          num(check.msg_after) >= num(check.msg_before) &&
          num(check.canonical_mal) === 0 &&
          num(check.donors_activos) === 0 &&
          num(check.review_after) === num(summary.preview.telefonos_omitidos);

        console.log(JSON.stringify(summary, null, 2));

        if (!summary.ok) {
          throw new Error('Validación falló; se revierte la transacción');
        }
        if (!APPLY) {
          throw new Error('DRY_RUN_ROLLBACK');
        }
      },
      { timeout: 1_200_000, maxWait: 60_000 },
    );
    console.log('Aplicado OK');
  } catch (error) {
    if (error instanceof Error && error.message === 'DRY_RUN_ROLLBACK') {
      console.log('Simulación OK (revertida)');
      return;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
