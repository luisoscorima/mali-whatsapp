#!/usr/bin/env node
/**
 * Reetiqueta remanente educacion_ca / educacion_ep → educacion + program.
 *
 *   node scripts/relabel-education-aliases.cjs
 *   node scripts/relabel-education-aliases.cjs --apply
 *
 * No re-ejecuta consolidate-education. Dry-run por defecto (revierte).
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

async function countAlias(tx, table) {
  const rows = await query(
    tx,
    `SELECT COUNT(*)::int AS n FROM ${table}
     WHERE area IN ('educacion_ca', 'educacion_ep')`,
  );
  return num(rows[0]?.n);
}

async function tableExists(tx, table) {
  const rows = await query(
    tx,
    `SELECT to_regclass('public.${table}') IS NOT NULL AS ok`,
  );
  return Boolean(rows[0]?.ok);
}

async function columnNames(tx, table) {
  const cols = await query(
    tx,
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = '${table}'`,
  );
  return new Set(cols.map((c) => c.column_name));
}

async function main() {
  console.log(
    APPLY
      ? 'RELABEL EDUCACIÓN ALIASES: escritura'
      : 'RELABEL EDUCACIÓN ALIASES: simulación (se revierte)',
  );

  try {
    await prisma.$transaction(
      async (tx) => {
        await sql(tx, `SET LOCAL statement_timeout = '20min'`);

        const programs = await query(
          tx,
          `SELECT id, slug FROM business_programs
           WHERE slug IN ('ca', 'ep')
             AND business_area_id = (
               SELECT id FROM business_areas WHERE slug = 'educacion' LIMIT 1
             )`,
        );
        const programId = Object.fromEntries(
          programs.map((row) => [row.slug, Number(row.id)]),
        );
        if (!programId.ca || !programId.ep) {
          throw new Error('Faltan business_programs ca/ep bajo educacion');
        }

        const before = {
          contacts: await countAlias(tx, 'contacts'),
          conversations: await countAlias(tx, 'conversations'),
          contact_origins: await countAlias(tx, 'contact_origins'),
          education_lead_cycles: await countAlias(tx, 'education_lead_cycles'),
          education_lead_entries: await countAlias(tx, 'education_lead_entries'),
          meta_ctwa_ads: (await tableExists(tx, 'meta_ctwa_ads'))
            ? await countAlias(tx, 'meta_ctwa_ads')
            : 0,
          meta_ctwa_ad_leads: (await tableExists(tx, 'meta_ctwa_ad_leads'))
            ? await countAlias(tx, 'meta_ctwa_ad_leads')
            : 0,
          tiktok_leads: (await tableExists(tx, 'tiktok_leads'))
            ? await countAlias(tx, 'tiktok_leads')
            : 0,
          user_areas: await countAlias(tx, 'user_areas'),
        };

        // 1) Conversaciones
        await sql(
          tx,
          `UPDATE conversations
           SET area = 'educacion', updated_at = NOW()
           WHERE area IN ('educacion_ca', 'educacion_ep')`,
        );

        // 2) Orígenes: borrar alias que ya existen en educacion (mismo channel+external_id)
        await sql(
          tx,
          `DELETE FROM contact_origins alias_o
           USING contact_origins keep
           WHERE alias_o.area IN ('educacion_ca', 'educacion_ep')
             AND keep.area = 'educacion'
             AND keep.channel = alias_o.channel
             AND keep.external_id = alias_o.external_id`,
        );

        await sql(
          tx,
          `UPDATE contact_origins
           SET
             program_id = COALESCE(
               program_id,
               CASE area
                 WHEN 'educacion_ca' THEN ${programId.ca}
                 WHEN 'educacion_ep' THEN ${programId.ep}
               END
             ),
             area = 'educacion',
             updated_at = NOW()
           WHERE area IN ('educacion_ca', 'educacion_ep')`,
        );

        // 3) Ciclos: program_id desde alias, cerrar conflictos open, luego reetiquetar
        await sql(
          tx,
          `UPDATE education_lead_cycles
           SET program_id = CASE area
                 WHEN 'educacion_ca' THEN ${programId.ca}
                 WHEN 'educacion_ep' THEN ${programId.ep}
               END,
               updated_at = NOW()
           WHERE area IN ('educacion_ca', 'educacion_ep')
             AND program_id IS NULL`,
        );

        await sql(
          tx,
          `UPDATE education_lead_cycles alias_c
           SET closed_at = NOW(),
               close_reason = COALESCE(alias_c.close_reason, 'relabel_duplicate'),
               updated_at = NOW()
           WHERE alias_c.area IN ('educacion_ca', 'educacion_ep')
             AND alias_c.closed_at IS NULL
             AND EXISTS (
               SELECT 1 FROM education_lead_cycles keep
               WHERE keep.area = 'educacion'
                 AND keep.closed_at IS NULL
                 AND keep.person_id = alias_c.person_id
                 AND keep.business_area_id = alias_c.business_area_id
                 AND keep.program_id IS NOT DISTINCT FROM alias_c.program_id
             )`,
        );

        await sql(
          tx,
          `UPDATE education_lead_cycles
           SET area = 'educacion', updated_at = NOW()
           WHERE area IN ('educacion_ca', 'educacion_ep')`,
        );

        // 4) Entries / alerts
        await sql(
          tx,
          `UPDATE education_lead_entries
           SET
             program_id = COALESCE(
               program_id,
               CASE area
                 WHEN 'educacion_ca' THEN ${programId.ca}
                 WHEN 'educacion_ep' THEN ${programId.ep}
               END
             ),
             area = 'educacion'
           WHERE area IN ('educacion_ca', 'educacion_ep')`,
        );

        if (await tableExists(tx, 'education_lead_alerts')) {
          await sql(
            tx,
            `UPDATE education_lead_alerts
             SET
               program_id = COALESCE(
                 program_id,
                 CASE area
                   WHEN 'educacion_ca' THEN ${programId.ca}
                   WHEN 'educacion_ep' THEN ${programId.ep}
                 END
               ),
               area = 'educacion'
             WHERE area IN ('educacion_ca', 'educacion_ep')`,
          );
        }

        // 5) Meta / TikTok / routes (borrar alias que chocan con educacion)
        if (await tableExists(tx, 'meta_ctwa_ads')) {
          await sql(
            tx,
            `DELETE FROM meta_ctwa_ads alias_a
             USING meta_ctwa_ads keep
             WHERE alias_a.area IN ('educacion_ca', 'educacion_ep')
               AND keep.area = 'educacion'
               AND keep.meta_source_id = alias_a.meta_source_id`,
          );
        }
        if (await tableExists(tx, 'meta_ctwa_ad_leads')) {
          await sql(
            tx,
            `DELETE FROM meta_ctwa_ad_leads alias_l
             USING meta_ctwa_ad_leads keep
             WHERE alias_l.area IN ('educacion_ca', 'educacion_ep')
               AND keep.area = 'educacion'
               AND keep.meta_ctwa_ad_id = alias_l.meta_ctwa_ad_id
               AND keep.conversation_id = alias_l.conversation_id`,
          );
        }
        if (await tableExists(tx, 'meta_lead_forms')) {
          await sql(
            tx,
            `DELETE FROM meta_lead_forms alias_f
             USING meta_lead_forms keep
             WHERE alias_f.area IN ('educacion_ca', 'educacion_ep')
               AND keep.area = 'educacion'
               AND keep.form_id = alias_f.form_id`,
          );
        }

        for (const table of [
          'meta_ctwa_ads',
          'meta_ctwa_ad_leads',
          'tiktok_leads',
          'meta_leadgen_leads',
          'meta_lead_forms',
          'meta_lead_form_routes',
          'tiktok_lead_form_routes',
        ]) {
          if (!(await tableExists(tx, table))) continue;
          const names = await columnNames(tx, table);
          if (!names.has('area')) continue;
          if (names.has('program_key')) {
            await sql(
              tx,
              `UPDATE ${table}
               SET
                 program_key = COALESCE(
                   NULLIF(BTRIM(program_key), ''),
                   CASE area WHEN 'educacion_ca' THEN 'ca' WHEN 'educacion_ep' THEN 'ep' END
                 ),
                 area = 'educacion'
               WHERE area IN ('educacion_ca', 'educacion_ep')`,
            );
          } else if (names.has('program_id')) {
            await sql(
              tx,
              `UPDATE ${table}
               SET
                 program_id = COALESCE(
                   program_id,
                   CASE area
                     WHEN 'educacion_ca' THEN ${programId.ca}
                     WHEN 'educacion_ep' THEN ${programId.ep}
                   END
                 ),
                 area = 'educacion'
               WHERE area IN ('educacion_ca', 'educacion_ep')`,
            );
          } else {
            await sql(
              tx,
              `UPDATE ${table}
               SET area = 'educacion'
               WHERE area IN ('educacion_ca', 'educacion_ep')`,
            );
          }
        }

        // 6) Contactos sin conflicto de identidad en educacion
        await sql(
          tx,
          `CREATE TEMP TABLE relabel_contact_moves AS
           SELECT c.id AS contact_id, c.area AS from_area
           FROM contacts c
           WHERE c.area IN ('educacion_ca', 'educacion_ep')
             AND NOT EXISTS (
               SELECT 1 FROM contacts o
               WHERE o.area = 'educacion'
                 AND o.id <> c.id
                 AND (
                   (c.phone IS NOT NULL AND o.phone IS NOT NULL AND o.phone = c.phone)
                   OR (c.whatsapp_user_id IS NOT NULL AND o.whatsapp_user_id IS NOT NULL
                       AND o.whatsapp_user_id = c.whatsapp_user_id)
                   OR (NULLIF(BTRIM(COALESCE(c.email, '')), '') <> ''
                       AND LOWER(BTRIM(c.email)) = LOWER(BTRIM(o.email)))
                   OR (LENGTH(BTRIM(COALESCE(c.dni, ''))) >= 8
                       AND BTRIM(c.dni) = BTRIM(o.dni))
                 )
             )`,
        );

        const movable = await query(
          tx,
          `SELECT COUNT(*)::int AS n FROM relabel_contact_moves`,
        );
        const contactsMoved = num(movable[0]?.n);
        const contactsBlocked = before.contacts - contactsMoved;

        await sql(
          tx,
          `UPDATE contacts c
           SET area = 'educacion', updated_at = NOW()
           FROM relabel_contact_moves m
           WHERE c.id = m.contact_id`,
        );

        await sql(
          tx,
          `INSERT INTO contact_programs (contact_id, program_id, source, first_seen_at, last_seen_at)
           SELECT m.contact_id,
                  CASE m.from_area WHEN 'educacion_ca' THEN ${programId.ca} ELSE ${programId.ep} END,
                  'relabel_alias',
                  NOW(),
                  NOW()
           FROM relabel_contact_moves m
           ON CONFLICT (contact_id, program_id) DO UPDATE
             SET last_seen_at = EXCLUDED.last_seen_at`,
        );

        // 7) user_areas alias → educacion
        await sql(
          tx,
          `INSERT INTO user_areas (user_id, area)
           SELECT DISTINCT ua.user_id, 'educacion'
           FROM user_areas ua
           WHERE ua.area IN ('educacion_ca', 'educacion_ep')
           ON CONFLICT (user_id, area) DO NOTHING`,
        );
        await sql(
          tx,
          `DELETE FROM user_areas
           WHERE area IN ('educacion_ca', 'educacion_ep')`,
        );

        const after = {
          contacts: await countAlias(tx, 'contacts'),
          conversations: await countAlias(tx, 'conversations'),
          contact_origins: await countAlias(tx, 'contact_origins'),
          education_lead_cycles: await countAlias(tx, 'education_lead_cycles'),
          education_lead_entries: await countAlias(tx, 'education_lead_entries'),
          meta_ctwa_ads: (await tableExists(tx, 'meta_ctwa_ads'))
            ? await countAlias(tx, 'meta_ctwa_ads')
            : 0,
          meta_ctwa_ad_leads: (await tableExists(tx, 'meta_ctwa_ad_leads'))
            ? await countAlias(tx, 'meta_ctwa_ad_leads')
            : 0,
          tiktok_leads: (await tableExists(tx, 'tiktok_leads'))
            ? await countAlias(tx, 'tiktok_leads')
            : 0,
          user_areas: await countAlias(tx, 'user_areas'),
        };

        const summary = {
          mode: APPLY ? 'apply' : 'dry-run',
          before,
          after,
          contacts_moved: contactsMoved,
          contacts_blocked: contactsBlocked,
        };
        console.log(JSON.stringify(summary, null, 2));

        if (!APPLY) {
          throw new Error('DRY_RUN_ROLLBACK');
        }
      },
      { maxWait: 20_000, timeout: 1_200_000 },
    );
  } catch (err) {
    if (String(err?.message || err) === 'DRY_RUN_ROLLBACK') {
      console.log('Dry-run OK (transacción revertida).');
      return;
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
  console.log('Apply OK.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
