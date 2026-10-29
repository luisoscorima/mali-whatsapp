#!/usr/bin/env node
/**
 * Limpia person_identity_reviews pendientes:
 * 1) Une people complementarias enlazadas por el dato que llegó (WA/tel en otra ficha).
 * 2) Rellena huecos (WA/tel/email/DNI) cuando el valor está libre.
 * 3) Marca todos los avisos pendientes como resueltos.
 *
 *   node scripts/resolve-person-identity-reviews.cjs
 *   node scripts/resolve-person-identity-reviews.cjs --apply
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
      ? 'RESOLVER IDENTITY REVIEWS: escritura'
      : 'RESOLVER IDENTITY REVIEWS: simulación (se revierte)',
  );

  try {
    await prisma.$transaction(
      async (tx) => {
        await sql(tx, `SET LOCAL statement_timeout = '20min'`, 'timeout');
        await sql(
          tx,
          `SELECT set_config('mali.people_before', (SELECT COUNT(*)::text FROM people), true)`,
          'people before',
        );
        await sql(
          tx,
          `SELECT set_config('mali.pending_before', (
              SELECT COUNT(*)::text FROM person_identity_reviews WHERE resolved_at IS NULL
            ), true)`,
          'pending before',
        );

        // Último aviso por persona.
        await sql(
          tx,
          `CREATE TEMP TABLE ir_latest ON COMMIT DROP AS
           SELECT DISTINCT ON (person_id)
             id, person_id, phone, whatsapp_user_id, email, dni
           FROM person_identity_reviews
           WHERE resolved_at IS NULL
           ORDER BY person_id, id DESC`,
          'ir_latest',
        );

        // Aristas: phone/WA actuales + review que apunta a otra people.
        await sql(
          tx,
          `CREATE TEMP TABLE ir_edges ON COMMIT DROP AS
           SELECT LEAST(a.id, b.id) AS id1, GREATEST(a.id, b.id) AS id2
           FROM people a
           JOIN people b ON a.id < b.id AND a.whatsapp_user_id = b.whatsapp_user_id
           WHERE NULLIF(BTRIM(a.whatsapp_user_id), '') IS NOT NULL
           UNION
           SELECT LEAST(a.id, b.id), GREATEST(a.id, b.id)
           FROM people a
           JOIN people b ON a.id < b.id AND a.phone = b.phone
           WHERE NULLIF(BTRIM(a.phone), '') IS NOT NULL
           UNION
           SELECT LEAST(l.person_id, o.id), GREATEST(l.person_id, o.id)
           FROM ir_latest l
           JOIN people o ON o.id <> l.person_id AND o.whatsapp_user_id = l.whatsapp_user_id
           WHERE NULLIF(BTRIM(l.whatsapp_user_id), '') IS NOT NULL
           UNION
           SELECT LEAST(l.person_id, o.id), GREATEST(l.person_id, o.id)
           FROM ir_latest l
           JOIN people o ON o.id <> l.person_id AND o.phone = l.phone
           WHERE NULLIF(BTRIM(l.phone), '') IS NOT NULL`,
          'ir_edges',
        );

        await sql(
          tx,
          `CREATE TEMP TABLE ir_nodes ON COMMIT DROP AS
           SELECT id1 AS id FROM ir_edges UNION SELECT id2 FROM ir_edges`,
          'ir_nodes',
        );

        await sql(
          tx,
          `CREATE TEMP TABLE ir_comp ON COMMIT DROP AS
           WITH RECURSIVE walk AS (
             SELECT id AS root, id FROM ir_nodes
             UNION
             SELECT w.root, CASE WHEN e.id1 = w.id THEN e.id2 ELSE e.id1 END
             FROM walk w
             JOIN ir_edges e ON e.id1 = w.id OR e.id2 = w.id
           )
           SELECT id, MIN(root) AS component FROM walk GROUP BY id`,
          'ir_comp',
        );

        await sql(
          tx,
          `CREATE TEMP TABLE ir_keep ON COMMIT DROP AS
           SELECT DISTINCT ON (c.component)
             c.component, p.id AS keep_id
           FROM ir_comp c
           JOIN people p ON p.id = c.id
           ORDER BY
             c.component,
             (NULLIF(BTRIM(p.whatsapp_user_id), '') IS NOT NULL) DESC,
             (NULLIF(BTRIM(p.dni), '') IS NOT NULL) DESC,
             (NULLIF(BTRIM(p.phone), '') IS NOT NULL) DESC,
             p.updated_at DESC NULLS LAST,
             p.id`,
          'ir_keep',
        );

        await sql(
          tx,
          `CREATE TEMP TABLE ir_donors ON COMMIT DROP AS
           SELECT c.component, k.keep_id, c.id AS donor_id
           FROM ir_comp c
           JOIN ir_keep k ON k.component = c.component
           WHERE c.id <> k.keep_id`,
          'ir_donors',
        );

        const preview = (
          await query(
            tx,
            `SELECT
               (SELECT COUNT(*)::int FROM ir_keep) AS grupos_merge,
               (SELECT COUNT(*)::int FROM ir_donors) AS donantes,
               (SELECT COUNT(*)::int FROM ir_latest) AS personas_con_aviso,
               current_setting('mali.pending_before')::int AS avisos_antes`,
            'preview',
          )
        )[0];

        await sql(tx, `ALTER TABLE people DISABLE TRIGGER USER`, 'disable people');
        await sql(tx, `ALTER TABLE contacts DISABLE TRIGGER USER`, 'disable contacts');
        let triggersDisabled = true;
        try {
          if (num(preview.donantes) > 0) {
            await sql(
              tx,
              `CREATE TEMP TABLE ir_profile ON COMMIT DROP AS
               SELECT
                 k.keep_id,
                 COALESCE(
                   NULLIF(BTRIM(keep.name), ''),
                   (SELECT NULLIF(BTRIM(d.name), '') FROM ir_donors dd JOIN people d ON d.id = dd.donor_id
                    WHERE dd.keep_id = k.keep_id ORDER BY length(BTRIM(COALESCE(d.name,''))) DESC LIMIT 1),
                   keep.name
                 ) AS name,
                 COALESCE(
                   NULLIF(BTRIM(keep.last_name), ''),
                   (SELECT NULLIF(BTRIM(d.last_name), '') FROM ir_donors dd JOIN people d ON d.id = dd.donor_id
                    WHERE dd.keep_id = k.keep_id ORDER BY length(BTRIM(COALESCE(d.last_name,''))) DESC LIMIT 1),
                   keep.last_name
                 ) AS last_name,
                 (
                   SELECT NULLIF(BTRIM(x.phone), '') FROM (
                     SELECT keep.phone, keep.updated_at, keep.created_at, keep.id
                     UNION ALL
                     SELECT d.phone, d.updated_at, d.created_at, d.id
                     FROM ir_donors dd JOIN people d ON d.id = dd.donor_id WHERE dd.keep_id = k.keep_id
                     UNION ALL
                     SELECT l.phone, NOW(), NOW(), 0 FROM ir_latest l WHERE l.person_id = k.keep_id
                        OR l.person_id IN (SELECT donor_id FROM ir_donors WHERE keep_id = k.keep_id)
                   ) x WHERE NULLIF(BTRIM(x.phone), '') IS NOT NULL
                   ORDER BY x.updated_at DESC NULLS LAST, x.id DESC LIMIT 1
                 ) AS phone,
                 (
                   SELECT NULLIF(BTRIM(x.email), '') FROM (
                     SELECT keep.email, keep.updated_at, keep.created_at, keep.id
                     UNION ALL
                     SELECT d.email, d.updated_at, d.created_at, d.id
                     FROM ir_donors dd JOIN people d ON d.id = dd.donor_id WHERE dd.keep_id = k.keep_id
                     UNION ALL
                     SELECT l.email, NOW(), NOW(), 0 FROM ir_latest l WHERE l.person_id = k.keep_id
                        OR l.person_id IN (SELECT donor_id FROM ir_donors WHERE keep_id = k.keep_id)
                   ) x WHERE NULLIF(BTRIM(x.email), '') IS NOT NULL
                   ORDER BY x.updated_at DESC NULLS LAST, x.id DESC LIMIT 1
                 ) AS email,
                 COALESCE(
                   NULLIF(BTRIM(keep.dni), ''),
                   (SELECT NULLIF(BTRIM(d.dni), '') FROM ir_donors dd JOIN people d ON d.id = dd.donor_id
                    WHERE dd.keep_id = k.keep_id AND NULLIF(BTRIM(d.dni),'') IS NOT NULL LIMIT 1),
                   (SELECT NULLIF(BTRIM(l.dni), '') FROM ir_latest l WHERE l.person_id = k.keep_id LIMIT 1)
                 ) AS dni,
                 COALESCE(
                   NULLIF(BTRIM(keep.whatsapp_user_id), ''),
                   (SELECT NULLIF(BTRIM(d.whatsapp_user_id), '') FROM ir_donors dd JOIN people d ON d.id = dd.donor_id
                    WHERE dd.keep_id = k.keep_id AND NULLIF(BTRIM(d.whatsapp_user_id),'') IS NOT NULL LIMIT 1),
                   (SELECT NULLIF(BTRIM(l.whatsapp_user_id), '') FROM ir_latest l
                    WHERE (l.person_id = k.keep_id OR l.person_id IN (SELECT donor_id FROM ir_donors WHERE keep_id = k.keep_id))
                      AND NULLIF(BTRIM(l.whatsapp_user_id),'') IS NOT NULL LIMIT 1)
                 ) AS whatsapp_user_id
               FROM ir_keep k
               JOIN people keep ON keep.id = k.keep_id`,
              'ir_profile',
            );

            await sql(
              tx,
              `UPDATE people donor
               SET phone = NULL, email = NULL, dni = NULL, whatsapp_user_id = NULL,
                   mali_one_person_id = NULL, updated_at = NOW()
               FROM ir_donors d WHERE donor.id = d.donor_id`,
              'clear donors',
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
                   updated_at = NOW()
               FROM ir_profile p WHERE keep.id = p.keep_id`,
              'update keep',
            );

            await sql(
              tx,
              `UPDATE contacts c SET person_id = d.keep_id, updated_at = NOW()
               FROM ir_donors d WHERE c.person_id = d.donor_id`,
              'repoint contacts',
            );

            await sql(
              tx,
              `CREATE TEMP TABLE ir_group_people ON COMMIT DROP AS
               SELECT keep_id, keep_id AS person_id FROM ir_keep
               UNION SELECT keep_id, donor_id FROM ir_donors`,
              'group people',
            );
            await sql(
              tx,
              `CREATE TEMP TABLE ir_cycle_keep ON COMMIT DROP AS
               SELECT DISTINCT ON (g.keep_id, elc.business_area_id, elc.program_id) elc.id AS cycle_id
               FROM education_lead_cycles elc
               JOIN ir_group_people g ON g.person_id = elc.person_id
               WHERE elc.closed_at IS NULL
               ORDER BY g.keep_id, elc.business_area_id, elc.program_id,
                        elc.last_interaction_at DESC NULLS LAST, elc.id DESC`,
              'cycle keep',
            );
            await sql(
              tx,
              `UPDATE education_lead_cycles loser
               SET closed_at = NOW(), close_reason = 'superseded_duplicate', updated_at = NOW()
               FROM ir_group_people g
               WHERE loser.person_id = g.person_id AND loser.closed_at IS NULL
                 AND NOT EXISTS (SELECT 1 FROM ir_cycle_keep k WHERE k.cycle_id = loser.id)`,
              'close cycles',
            );
            await sql(
              tx,
              `UPDATE education_lead_cycles elc
               SET person_id = d.keep_id, updated_at = NOW()
               FROM ir_donors d WHERE elc.person_id = d.donor_id`,
              'repoint cycles',
            );
            await sql(
              tx,
              `UPDATE person_identity_reviews r
               SET person_id = d.keep_id FROM ir_donors d WHERE r.person_id = d.donor_id`,
              'repoint reviews',
            );
            await sql(
              tx,
              `DELETE FROM people p USING ir_donors d WHERE p.id = d.donor_id`,
              'delete donors',
            );
          }

          // Rellenar huecos con el dato del aviso si está libre.
          await sql(
            tx,
            `UPDATE people p
             SET whatsapp_user_id = l.whatsapp_user_id, updated_at = NOW()
             FROM ir_latest l
             WHERE p.id = l.person_id
               AND NULLIF(BTRIM(p.whatsapp_user_id), '') IS NULL
               AND NULLIF(BTRIM(l.whatsapp_user_id), '') IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM people o
                 WHERE o.id <> p.id AND o.whatsapp_user_id = l.whatsapp_user_id
               )`,
            'fill wa gaps',
          );
          await sql(
            tx,
            `UPDATE people p
             SET phone = l.phone, updated_at = NOW()
             FROM ir_latest l
             WHERE p.id = l.person_id
               AND NULLIF(BTRIM(p.phone), '') IS NULL
               AND NULLIF(BTRIM(l.phone), '') IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM people o WHERE o.id <> p.id AND o.phone = l.phone
               )`,
            'fill phone gaps',
          );
          await sql(
            tx,
            `UPDATE people p
             SET email = l.email, updated_at = NOW()
             FROM ir_latest l
             WHERE p.id = l.person_id
               AND NULLIF(BTRIM(p.email), '') IS NULL
               AND NULLIF(BTRIM(l.email), '') IS NOT NULL`,
            'fill email gaps',
          );
          await sql(
            tx,
            `UPDATE people p
             SET dni = l.dni, updated_at = NOW()
             FROM ir_latest l
             WHERE p.id = l.person_id
               AND NULLIF(BTRIM(p.dni), '') IS NULL
               AND NULLIF(BTRIM(l.dni), '') IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM people o WHERE o.id <> p.id AND o.dni = l.dni
               )`,
            'fill dni gaps',
          );

          await sql(
            tx,
            `UPDATE person_identity_reviews
             SET resolved_at = NOW()
             WHERE resolved_at IS NULL`,
            'resolve all pending',
          );

          await sql(tx, `ALTER TABLE contacts ENABLE TRIGGER USER`, 'enable contacts');
          await sql(tx, `ALTER TABLE people ENABLE TRIGGER USER`, 'enable people');
          triggersDisabled = false;
        } catch (error) {
          if (triggersDisabled) {
            console.error('Error:', error instanceof Error ? error.message : error);
          }
          throw error;
        }

        const check = (
          await query(
            tx,
            `SELECT
               current_setting('mali.people_before')::int AS people_before,
               (SELECT COUNT(*)::int FROM people) AS people_after,
               current_setting('mali.pending_before')::int AS pending_before,
               (SELECT COUNT(*)::int FROM person_identity_reviews WHERE resolved_at IS NULL) AS pending_after,
               (SELECT COUNT(*)::int FROM (
                  SELECT whatsapp_user_id FROM people
                  WHERE NULLIF(BTRIM(whatsapp_user_id),'') IS NOT NULL
                  GROUP BY whatsapp_user_id HAVING COUNT(*)>1
                ) t) AS wa_dups,
               (SELECT COUNT(*)::int FROM (
                  SELECT phone FROM people
                  WHERE NULLIF(BTRIM(phone),'') IS NOT NULL
                  GROUP BY phone HAVING COUNT(*)>1
                ) t) AS phone_dups`,
            'check',
          )
        )[0];

        const summary = {
          preview,
          check,
          ok:
            num(check.pending_after) === 0 &&
            num(check.wa_dups) === 0 &&
            num(check.phone_dups) === 0 &&
            num(check.people_after) === num(check.people_before) - num(preview.donantes),
        };
        console.log(JSON.stringify(summary, null, 2));
        if (!summary.ok) throw new Error('Validación falló; se revierte');
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
