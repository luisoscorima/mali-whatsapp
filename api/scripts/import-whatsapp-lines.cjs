#!/usr/bin/env node

/**
 * Imports the legacy one-line-per-area configuration into the multiline catalog.
 *
 * Safe defaults:
 *   node scripts/import-whatsapp-lines.cjs                  # read-only plan
 *   node scripts/import-whatsapp-lines.cjs --apply          # catalog only
 *   node scripts/import-whatsapp-lines.cjs --apply --backfill # catalog + nullable FKs
 *
 * Run inside the API container after the foundation migration. Tokens are never
 * printed or copied into the new tables: only their source reference and SHA-256
 * fingerprint are stored during this transition.
 */
const crypto = require('node:crypto');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const args = new Set(process.argv.slice(2));
const shouldApply = args.has('--apply');
const shouldBackfill = args.has('--backfill');

if (shouldBackfill && !shouldApply) {
  console.error('--backfill requiere --apply.');
  process.exit(2);
}

const META_KEYS = {
  token: 'meta.whatsapp_token',
  phone: 'meta.phone_number_id',
  display: 'meta.display_phone_number',
  waba: 'meta.waba_id',
};

const LEGACY_AREAS = [
  {
    legacy: 'ti',
    canonical: 'ti',
    areaLabel: 'Tecnología de la Información',
    lineLabel: 'TI',
    program: null,
    default: true,
  },
  {
    legacy: 'pam',
    canonical: 'pam',
    areaLabel: 'PAM',
    lineLabel: 'PAM',
    program: null,
    default: true,
  },
  {
    legacy: 'patronato',
    canonical: 'patronato',
    areaLabel: 'Patronato',
    lineLabel: 'Patronato',
    program: null,
    default: true,
  },
  {
    legacy: 'educacion',
    canonical: 'educacion',
    areaLabel: 'Educación',
    lineLabel: 'Educación general',
    program: null,
    default: true,
  },
  {
    legacy: 'educacion_ca',
    canonical: 'educacion',
    areaLabel: 'Educación',
    lineLabel: 'Educación CA',
    program: 'ca',
    default: false,
  },
  {
    legacy: 'educacion_ep',
    canonical: 'educacion',
    areaLabel: 'Educación',
    lineLabel: 'Educación EP',
    program: 'ep',
    default: false,
  },
];

function envSuffix(area) {
  return area.toUpperCase();
}

function clean(value) {
  let result = String(value ?? '').replace(/^\uFEFF/, '').trim();
  if (
    result.length >= 2 &&
    ((result.startsWith('"') && result.endsWith('"')) ||
      (result.startsWith("'") && result.endsWith("'")))
  ) {
    result = result.slice(1, -1).trim();
  }
  return result;
}

function mask(value) {
  const normalized = clean(value);
  if (!normalized) return '(vacío)';
  return normalized.length <= 6
    ? '*'.repeat(normalized.length)
    : `…${normalized.slice(-6)}`;
}

function fingerprint(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function rowsByArea(rows) {
  const result = new Map();
  for (const row of rows) {
    if (!result.has(row.area)) result.set(row.area, new Map());
    result.get(row.area).set(row.key, clean(row.value));
  }
  return result;
}

function stored(settings, area, key) {
  return clean(settings.get(area)?.get(key));
}

function resolveToken(settings, area) {
  const databaseValue = stored(settings, area, META_KEYS.token);
  if (databaseValue) {
    return {
      value: databaseValue,
      source: 'app_settings',
      ref: `${area}:${META_KEYS.token}`,
    };
  }
  const areaKey = `WHATSAPP_TOKEN_${envSuffix(area)}`;
  const areaValue = clean(process.env[areaKey]);
  if (areaValue) return { value: areaValue, source: 'env', ref: areaKey };
  const fallback = clean(process.env.WHATSAPP_TOKEN);
  if (fallback) return { value: fallback, source: 'env', ref: 'WHATSAPP_TOKEN' };
  return null;
}

function resolveWaba(settings, area) {
  const databaseValue = stored(settings, area, META_KEYS.waba);
  if (databaseValue) return databaseValue;
  return clean(
    process.env[`WABA_ID_${envSuffix(area)}`] || process.env.WABA_ID,
  );
}

function resolvePhone(settings, area, tiPhone) {
  const areaKey = `PHONE_NUMBER_ID_${envSuffix(area)}`;
  const environmentValue = clean(process.env[areaKey]);
  const fallback = clean(process.env.PHONE_NUMBER_ID);
  let value =
    stored(settings, area, META_KEYS.phone) || environmentValue || fallback;

  // Mirrors the current runtime protection against a stale TI PID copied to another area.
  if (area !== 'ti' && value && tiPhone && value === tiPhone) {
    const preferred = environmentValue || fallback;
    if (preferred && preferred !== value) value = preferred;
  }
  return value;
}

function assertNumericId(value, field, area, errors) {
  if (value && !/^\d+$/.test(value)) {
    errors.push(`${area}: ${field} debe contener solo dígitos.`);
  }
}

async function buildPlan() {
  const rows = await prisma.app_settings.findMany({
    where: { key: { in: Object.values(META_KEYS) } },
    select: { area: true, key: true, value: true },
  });
  const settings = rowsByArea(rows);
  const tiPhone =
    stored(settings, 'ti', META_KEYS.phone) ||
    clean(process.env.PHONE_NUMBER_ID_TI) ||
    clean(process.env.PHONE_NUMBER_ID);
  const errors = [];
  const skipped = [];
  const lines = [];
  const seenPhones = new Map();

  for (const descriptor of LEGACY_AREAS) {
    const phoneNumberId = resolvePhone(settings, descriptor.legacy, tiPhone);
    const wabaId = resolveWaba(settings, descriptor.legacy);
    const token = resolveToken(settings, descriptor.legacy);

    if (!phoneNumberId && !wabaId && !token) {
      skipped.push(`${descriptor.legacy}: sin configuración WhatsApp`);
      continue;
    }
    if (!phoneNumberId) {
      errors.push(`${descriptor.legacy}: falta Phone Number ID.`);
    }
    if (!wabaId) errors.push(`${descriptor.legacy}: falta WABA ID.`);
    if (!token) errors.push(`${descriptor.legacy}: falta token.`);
    assertNumericId(phoneNumberId, 'Phone Number ID', descriptor.legacy, errors);
    assertNumericId(wabaId, 'WABA ID', descriptor.legacy, errors);
    if (!phoneNumberId || !wabaId || !token) continue;

    const previousArea = seenPhones.get(phoneNumberId);
    if (previousArea) {
      errors.push(
        `${descriptor.legacy}: Phone Number ID duplicado con ${previousArea}.`,
      );
      continue;
    }
    seenPhones.set(phoneNumberId, descriptor.legacy);

    lines.push({
      ...descriptor,
      phoneNumberId,
      wabaId,
      displayPhoneNumber: stored(
        settings,
        descriptor.legacy,
        META_KEYS.display,
      ) || null,
      credential: {
        source: token.source,
        ref: token.ref,
        fingerprint: fingerprint(token.value),
      },
    });
  }

  return { lines, errors, skipped };
}

function printPlan(plan) {
  console.log(shouldApply ? 'Modo: APPLY' : 'Modo: DRY-RUN (sin escrituras)');
  for (const line of plan.lines) {
    console.log(
      [
        line.legacy.padEnd(13),
        `→ área=${line.canonical}`,
        `programa=${line.program || '-'}`,
        `PID=${mask(line.phoneNumberId)}`,
        `WABA=${mask(line.wabaId)}`,
        `token=${line.credential.source}:${line.credential.ref}`,
        `default=${line.default ? 'sí' : 'no'}`,
      ].join(' | '),
    );
  }
  for (const item of plan.skipped) console.log(`SKIP: ${item}`);
  for (const item of plan.errors) console.error(`ERROR: ${item}`);
}

async function upsertCredential(tx, line) {
  const existing = await tx.meta_credentials.findFirst({
    where: {
      secret_source: line.credential.source,
      secret_ref: line.credential.ref,
    },
    select: { id: true },
  });
  const data = {
    label: `Token heredado ${line.lineLabel}`,
    secret_source: line.credential.source,
    secret_ref: line.credential.ref,
    encrypted_token: null,
    token_fingerprint: line.credential.fingerprint,
    active: true,
    updated_at: new Date(),
  };
  if (existing) {
    return tx.meta_credentials.update({ where: { id: existing.id }, data });
  }
  return tx.meta_credentials.create({ data });
}

async function applyPlan(plan) {
  return prisma.$transaction(
    async (tx) => {
      const imported = [];
      for (const line of plan.lines) {
        const area = await tx.business_areas.upsert({
          where: { slug: line.canonical },
          create: { slug: line.canonical, label: line.areaLabel },
          update: {
            label: line.areaLabel,
            active: true,
            updated_at: new Date(),
          },
        });
        await tx.business_area_aliases.upsert({
          where: { alias: line.legacy },
          create: {
            alias: line.legacy,
            business_area_id: area.id,
            program_key: line.program,
          },
          update: {
            business_area_id: area.id,
            program_key: line.program,
            active: true,
            updated_at: new Date(),
          },
        });
        const credential = await upsertCredential(tx, line);
        const waba = await tx.whatsapp_wabas.upsert({
          where: { meta_waba_id: line.wabaId },
          create: {
            meta_waba_id: line.wabaId,
            label: `WABA ${line.areaLabel}`,
          },
          update: { active: true, updated_at: new Date() },
        });

        if (line.default) {
          await tx.whatsapp_lines.updateMany({
            where: { business_area_id: area.id, is_default: true },
            data: { is_default: false, updated_at: new Date() },
          });
        }

        const importedLine = await tx.whatsapp_lines.upsert({
          where: { phone_number_id: line.phoneNumberId },
          create: {
            business_area_id: area.id,
            waba_id: waba.id,
            credential_override_id: credential.id,
            phone_number_id: line.phoneNumberId,
            display_phone_number: line.displayPhoneNumber,
            label: line.lineLabel,
            legacy_area: line.legacy,
            program_key: line.program,
            is_default: line.default,
          },
          update: {
            business_area_id: area.id,
            waba_id: waba.id,
            credential_override_id: credential.id,
            display_phone_number: line.displayPhoneNumber,
            label: line.lineLabel,
            legacy_area: line.legacy,
            program_key: line.program,
            is_default: line.default,
            active: true,
            updated_at: new Date(),
          },
        });

        const counts = { conversations: 0, campaigns: 0, templates: 0 };
        if (shouldBackfill) {
          counts.conversations = (
            await tx.conversations.updateMany({
              where: {
                whatsapp_line_id: null,
                area: line.legacy,
                OR: [
                  { whatsapp_phone_number_id: line.phoneNumberId },
                  { whatsapp_phone_number_id: null },
                ],
              },
              data: { whatsapp_line_id: importedLine.id },
            })
          ).count;
          counts.campaigns = (
            await tx.campaigns.updateMany({
              where: { whatsapp_line_id: null, area: line.legacy },
              data: { whatsapp_line_id: importedLine.id },
            })
          ).count;
          counts.templates = (
            await tx.whatsapp_templates.updateMany({
              where: { whatsapp_waba_id: null, area: line.legacy },
              data: { whatsapp_waba_id: waba.id },
            })
          ).count;
        }
        imported.push({
          legacy: line.legacy,
          lineId: importedLine.id,
          counts,
        });
      }
      return imported;
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
}

async function main() {
  const plan = await buildPlan();
  printPlan(plan);
  if (plan.errors.length) {
    throw new Error(
      `Importación cancelada: ${plan.errors.length} problema(s) de configuración.`,
    );
  }
  if (!shouldApply) {
    console.log('Sin cambios. Repite con --apply cuando el plan esté verificado.');
    return;
  }
  const result = await applyPlan(plan);
  for (const item of result) {
    const suffix = shouldBackfill
      ? `; backfill conversaciones=${item.counts.conversations}, campañas=${item.counts.campaigns}, plantillas=${item.counts.templates}`
      : '';
    console.log(
      `OK ${item.legacy}: whatsapp_line_id=${item.lineId}${suffix}`,
    );
  }
  console.log('Importación completada. No se almacenaron tokens en texto plano.');
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
