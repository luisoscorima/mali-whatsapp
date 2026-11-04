import type { PrismaClient } from '@prisma/client';
import {
  EDUCATION_SLA_SETTINGS_AREA,
  EDUCATION_SLA_SETTINGS_KEY,
  defaultEducationSlaConfig,
  parseEducationSlaConfig,
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
