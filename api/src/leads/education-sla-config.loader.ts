import type { PrismaClient } from '@prisma/client';
import {
  EDUCATION_SLA_SETTINGS_AREA,
  EDUCATION_SLA_SETTINGS_KEY,
  defaultEducationSlaConfig,
  parseEducationSlaConfig,
  serializeEducationSlaConfig,
  type EducationSlaConfig,
} from './education-sla-config.util';

export async function loadEducationSlaConfig(
  prisma: PrismaClient,
): Promise<EducationSlaConfig> {
  const row = await prisma.app_settings.findUnique({
    where: {
      area_key: {
        area: EDUCATION_SLA_SETTINGS_AREA,
        key: EDUCATION_SLA_SETTINGS_KEY,
      },
    },
    select: { value: true },
  });
  return (
    parseEducationSlaConfig(row?.value) ?? defaultEducationSlaConfig()
  );
}

/**
 * Ensures alerts_since exists (defaults to now) and persists it.
 * Used so SLA alerts only apply to cycles started after monitoring began.
 */
export async function ensureEducationSlaAlertsSince(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<{ config: EducationSlaConfig; since: Date; initialized: boolean }> {
  const config = await loadEducationSlaConfig(prisma);
  if (config.alerts_since) {
    const since = new Date(config.alerts_since);
    if (!Number.isNaN(since.getTime())) {
      return { config, since, initialized: false };
    }
  }
  const since = now;
  const next: EducationSlaConfig = {
    ...config,
    alerts_since: since.toISOString(),
  };
  await prisma.app_settings.upsert({
    where: {
      area_key: {
        area: EDUCATION_SLA_SETTINGS_AREA,
        key: EDUCATION_SLA_SETTINGS_KEY,
      },
    },
    create: {
      area: EDUCATION_SLA_SETTINGS_AREA,
      key: EDUCATION_SLA_SETTINGS_KEY,
      value: serializeEducationSlaConfig(next),
    },
    update: {
      value: serializeEducationSlaConfig(next),
      updated_at: new Date(),
    },
  });
  return { config: next, since, initialized: true };
}
