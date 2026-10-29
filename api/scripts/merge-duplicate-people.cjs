#!/usr/bin/env node
/**
 * Une filas de `people` conectadas por whatsapp_user_id O teléfono
 * (cierre transitivo: WA une A-B y teléfono une B-C ⇒ un solo canónico A+B+C).
 *
 * Reglas:
 * - Canónica: prioriza WA, luego DNI, luego teléfono, luego updated_at, luego menor id.
 * - Email / teléfono: el valor más recientemente actualizado entre los que lo tienen.
 * - Resto: rellena huecos desde donantes.
 * - Reapunta contacts, education_lead_cycles y cierra person_identity_reviews del grupo.
 *
 *   node scripts/merge-duplicate-people.cjs
 *   node scripts/merge-duplicate-people.cjs --apply
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
      ? 'MERGE PEOPLE DUPLICADAS: escritura'
      : 'MERGE PEOPLE DUPLICADAS: simulación (se revierte)',
  );

  let summary = null;
  try {
    await prisma.$transaction(
      async (tx) => {
        await sql(tx, `SET LOCAL statement_timeout = '20min'`, 'timeout');

        await sql(
          tx,
          `SELECT set_config('mali.people_before', (SELECT COUNT(*)::text FROM people), true)`,
          'count people before',
        );
        await sql(
          tx,
          `SELECT set_config('mali.contacts_before', (SELECT COUNT(*)::text FROM contacts), true)`,
          'count contacts before',
        );
        await sql(
          tx,
          `SELECT set_config('mali.cycles_before', (SELECT COUNT(*)::text FROM education_lead_cycles), true)`,
          'count cycles before',
        );

        // Aristas: mismo WA o mismo teléfono (componente conexo).
        await sql(
          tx,
          `CREATE TEMP TABLE people_dup_edges ON COMMIT DROP AS
           SELECT LEAST(a.id, b.id) AS id1, GREATEST(a.id, b.id) AS id2
           FROM people a
           JOIN people b ON a.id < b.id AND a.whatsapp_user_id = b.whatsapp_user_id
           WHERE NULLIF(BTRIM(a.whatsapp_user_id), '') IS NOT NULL
           UNION
           SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id)
           FROM people a
           JOIN people b ON a.id < b.id AND a.phone = b.phone
           WHERE NULLIF(BTRIM(a.phone), '') IS NOT NULL`,
          'create edges',
        );

        await sql(
          tx,
          `CREATE TEMP TABLE people_dup_nodes ON COMMIT DROP AS
           SELECT id1 AS id FROM people_dup_edges
           UNION
           SELECT id2 FROM people_dup_edges`,
          'create nodes',
        );

        // Componentes conexos (punto fijo por min id alcanzable).
        await sql(
          tx,
          `CREATE TEMP TABLE people_dup_comp ON COMMIT DROP AS
           WITH RECURSIVE walk AS (
             SELECT id AS root, id FROM people_dup_nodes
             UNION
             SELECT w.root,
                    CASE WHEN e.id1 = w.id THEN e.id2 ELSE e.id1 END
             FROM walk w
             JOIN people_dup_edges e ON e.id1 = w.id OR e.id2 = w.id
           )
           SELECT id, MIN(root) AS component
           FROM walk
           GROUP BY id`,
          'create components',
        );

        // Canónica por componente.
        await sql(
          tx,
          `CREATE TEMP TABLE people_dup_keep ON COMMIT DROP AS
           SELECT DISTINCT ON (c.component)
             c.component,
             p.id AS keep_id
           FROM people_dup_comp c
           JOIN people p ON p.id = c.id
           ORDER BY
             c.component,
             (NULLIF(BTRIM(p.whatsapp_user_id), '') IS NOT NULL) DESC,
             (NULLIF(BTRIM(p.dni), '') IS NOT NULL) DESC,
             (NULLIF(BTRIM(p.phone), '') IS NOT NULL) DESC,
             p.updated_at DESC NULLS LAST,
             p.id`,
          'pick keep',
        );

        await sql(
          tx,
          `CREATE TEMP TABLE people_dup_donors ON COMMIT DROP AS
           SELECT c.component, k.keep_id, c.id AS donor_id
           FROM people_dup_comp c
           JOIN people_dup_keep k ON k.component = c.component
           WHERE c.id <> k.keep_id`,
          'pick donors',
        );

        // Perfil fusionado.
        await sql(
          tx,
          `CREATE TEMP TABLE people_dup_profile ON COMMIT DROP AS
           SELECT
             k.keep_id,
             COALESCE(
               NULLIF(BTRIM(keep.name), ''),
               (
                 SELECT NULLIF(BTRIM(d.name), '')
                 FROM people_dup_donors dd
                 JOIN people d ON d.id = dd.donor_id
                 WHERE dd.keep_id = k.keep_id
                 ORDER BY length(BTRIM(COALESCE(d.name, ''))) DESC, d.updated_at DESC NULLS LAST
                 LIMIT 1
               ),
               keep.name
             ) AS name,
             COALESCE(
               NULLIF(BTRIM(keep.last_name), ''),
               (
                 SELECT NULLIF(BTRIM(d.last_name), '')
                 FROM people_dup_donors dd
                 JOIN people d ON d.id = dd.donor_id
                 WHERE dd.keep_id = k.keep_id
                 ORDER BY length(BTRIM(COALESCE(d.last_name, ''))) DESC, d.updated_at DESC NULLS LAST
                 LIMIT 1
               ),
               keep.last_name
             ) AS last_name,
             (
               SELECT NULLIF(BTRIM(x.phone), '')
               FROM (
                 SELECT keep.id, keep.phone, keep.updated_at, keep.created_at
                 UNION ALL
                 SELECT d.id, d.phone, d.updated_at, d.created_at
                 FROM people_dup_donors dd
                 JOIN people d ON d.id = dd.donor_id
                 WHERE dd.keep_id = k.keep_id
               ) x
               WHERE NULLIF(BTRIM(x.phone), '') IS NOT NULL
               ORDER BY x.updated_at DESC NULLS LAST, x.created_at DESC NULLS LAST, x.id DESC
               LIMIT 1
             ) AS phone,
             (
               SELECT NULLIF(BTRIM(x.email), '')
               FROM (
                 SELECT keep.id, keep.email, keep.updated_at, keep.created_at
                 UNION ALL
                 SELECT d.id, d.email, d.updated_at, d.created_at
                 FROM people_dup_donors dd
                 JOIN people d ON d.id = dd.donor_id
                 WHERE dd.keep_id = k.keep_id
               ) x
               WHERE NULLIF(BTRIM(x.email), '') IS NOT NULL
               ORDER BY x.updated_at DESC NULLS LAST, x.created_at DESC NULLS LAST, x.id DESC
               LIMIT 1
             ) AS email,
             COALESCE(
               NULLIF(BTRIM(keep.dni), ''),
               (
                 SELECT NULLIF(BTRIM(d.dni), '')
                 FROM people_dup_donors dd
                 JOIN people d ON d.id = dd.donor_id
                 WHERE dd.keep_id = k.keep_id AND NULLIF(BTRIM(d.dni), '') IS NOT NULL
                 ORDER BY d.updated_at DESC NULLS LAST
                 LIMIT 1
               )
             ) AS dni,
             COALESCE(
               NULLIF(BTRIM(keep.whatsapp_user_id), ''),
               (
                 SELECT NULLIF(BTRIM(d.whatsapp_user_id), '')
                 FROM people_dup_donors dd
                 JOIN people d ON d.id = dd.donor_id
                 WHERE dd.keep_id = k.keep_id
                   AND NULLIF(BTRIM(d.whatsapp_user_id), '') IS NOT NULL
                 LIMIT 1
               )
             ) AS whatsapp_user_id,
             COALESCE(
               keep.birth_date,
               (
                 SELECT d.birth_date
                 FROM people_dup_donors dd
                 JOIN people d ON d.id = dd.donor_id
                 WHERE dd.keep_id = k.keep_id AND d.birth_date IS NOT NULL
                 ORDER BY d.updated_at DESC NULLS LAST
                 LIMIT 1
               )
             ) AS birth_date,
             COALESCE(
               keep.mali_one_person_id,
               (
                 SELECT d.mali_one_person_id
                 FROM people_dup_donors dd
                 JOIN people d ON d.id = dd.donor_id
                 WHERE dd.keep_id = k.keep_id AND d.mali_one_person_id IS NOT NULL
                 LIMIT 1
               )
             ) AS mali_one_person_id
           FROM people_dup_keep k
           JOIN people keep ON keep.id = k.keep_id`,
          'build profile',
        );

        const preview = (
          await query(
            tx,
            `SELECT
               (SELECT COUNT(*)::int FROM people_dup_keep) AS grupos,
               (SELECT COUNT(*)::int FROM people_dup_donors) AS donantes,
               (SELECT COUNT(*)::int FROM people_dup_comp) AS personas_en_grupos`,
            'preview counts',
          )
        )[0];

        // Antes de borrar: liberar identidad de donantes.
        await sql(tx, `ALTER TABLE people DISABLE TRIGGER USER`, 'disable people triggers');
        await sql(tx, `ALTER TABLE contacts DISABLE TRIGGER USER`, 'disable contacts triggers');
        let triggersDisabled = true;
        try {
          await sql(
            tx,
            `UPDATE people donor
             SET phone = NULL, email = NULL, dni = NULL, whatsapp_user_id = NULL,
                 mali_one_person_id = NULL, updated_at = NOW()
             FROM people_dup_donors d
             WHERE donor.id = d.donor_id`,
            'clear donor identity',
          );

          await sql(
            tx,
            `UPDATE people keep
             SET name = COALESCE(p.name, keep.name),
                 last_name = COALESCE(p.last_name, keep.last_name),
                 phone = p.phone,
                 email = p.email,
                 dni = p.dni,
                 whatsapp_user_id = p.whatsapp_user_id,
                 birth_date = COALESCE(p.birth_date, keep.birth_date),
                 mali_one_person_id = COALESCE(p.mali_one_person_id, keep.mali_one_person_id),
                 updated_at = NOW()
             FROM people_dup_profile p
             WHERE keep.id = p.keep_id`,
            'update keep profile',
          );

          await sql(
            tx,
            `UPDATE contacts c
             SET person_id = d.keep_id, updated_at = NOW()
             FROM people_dup_donors d
             WHERE c.person_id = d.donor_id`,
            'repoint contacts',
          );

          // Ciclos abiertos del grupo: evitar choque unique (person, business_area, program).
          await sql(
            tx,
            `CREATE TEMP TABLE people_dup_group_people ON COMMIT DROP AS
             SELECT keep_id, keep_id AS person_id FROM people_dup_keep
             UNION
             SELECT keep_id, donor_id FROM people_dup_donors`,
            'group people ids',
          );
          await sql(
            tx,
            `CREATE TEMP TABLE people_dup_cycle_keep ON COMMIT DROP AS
             SELECT DISTINCT ON (g.keep_id, elc.business_area_id, elc.program_id)
               elc.id AS cycle_id
             FROM education_lead_cycles elc
             JOIN people_dup_group_people g ON g.person_id = elc.person_id
             WHERE elc.closed_at IS NULL
             ORDER BY
               g.keep_id,
               elc.business_area_id,
               elc.program_id,
               elc.last_interaction_at DESC NULLS LAST,
               elc.id DESC`,
            'pick surviving cycles',
          );
          await sql(
            tx,
            `UPDATE education_lead_cycles loser
             SET closed_at = NOW(),
                 close_reason = 'superseded_duplicate',
                 updated_at = NOW()
             FROM people_dup_group_people g
             WHERE loser.person_id = g.person_id
               AND loser.closed_at IS NULL
               AND NOT EXISTS (
                 SELECT 1 FROM people_dup_cycle_keep k WHERE k.cycle_id = loser.id
               )`,
            'close colliding cycles',
          );

          await sql(
            tx,
            `UPDATE education_lead_cycles elc
             SET person_id = d.keep_id, updated_at = NOW()
             FROM people_dup_donors d
             WHERE elc.person_id = d.donor_id`,
            'repoint cycles',
          );

          await sql(
            tx,
            `UPDATE person_identity_reviews r
             SET person_id = d.keep_id
             FROM people_dup_donors d
             WHERE r.person_id = d.donor_id`,
            'repoint identity reviews',
          );

          await sql(
            tx,
            `UPDATE person_identity_reviews r
             SET resolved_at = NOW()
             WHERE r.resolved_at IS NULL
               AND r.person_id IN (SELECT keep_id FROM people_dup_keep)`,
            'resolve identity reviews for merged',
          );

          await sql(
            tx,
            `DELETE FROM people p
             USING people_dup_donors d
             WHERE p.id = d.donor_id`,
            'delete donors',
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
               current_setting('mali.people_before')::int AS people_before,
               (SELECT COUNT(*)::int FROM people) AS people_after,
               current_setting('mali.contacts_before')::int AS contacts_before,
               (SELECT COUNT(*)::int FROM contacts) AS contacts_after,
               current_setting('mali.cycles_before')::int AS cycles_before,
               (SELECT COUNT(*)::int FROM education_lead_cycles) AS cycles_after,
               (
                 SELECT COUNT(*)::int FROM (
                   SELECT whatsapp_user_id FROM people
                   WHERE NULLIF(BTRIM(whatsapp_user_id), '') IS NOT NULL
                   GROUP BY whatsapp_user_id HAVING COUNT(*) > 1
                 ) t
               ) AS wa_dup_groups_left,
               (
                 SELECT COUNT(*)::int FROM (
                   SELECT phone FROM people
                   WHERE NULLIF(BTRIM(phone), '') IS NOT NULL
                   GROUP BY phone HAVING COUNT(*) > 1
                 ) t
               ) AS phone_dup_groups_left_info,
               (
                 SELECT COUNT(*)::int FROM person_identity_reviews WHERE resolved_at IS NULL
               ) AS identity_pending`,
            'validation',
          )
        )[0];

        summary = {
          preview,
          check,
          luis: await query(
            tx,
            `SELECT id, name, last_name, phone, email, dni, whatsapp_user_id
             FROM people WHERE phone = '51968330895'`,
            'luis sample',
          ),
        };
        summary.ok =
          num(check.contacts_before) === num(check.contacts_after) &&
          num(check.cycles_before) === num(check.cycles_after) &&
          num(check.people_after) === num(check.people_before) - num(preview.donantes) &&
          num(check.wa_dup_groups_left) === 0 &&
          num(check.phone_dup_groups_left_info) === 0;

        console.log(JSON.stringify(summary, null, 2));
        if (!summary.ok) throw new Error('Validación falló; se revierte la transacción');
        if (!APPLY) throw new Error('DRY_RUN_ROLLBACK');
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
