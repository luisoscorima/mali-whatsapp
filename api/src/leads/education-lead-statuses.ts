import type { PrismaService } from '../prisma/prisma.service';
import {
  EDUCATION_LEAD_AREAS,
  EDUCATION_LEAD_STATUSES,
  EDUCATION_LEGACY_STATUS_SLUGS,
} from './leads.types';

export function isEducationLeadArea(area: string): boolean {
  return (EDUCATION_LEAD_AREAS as readonly string[]).includes(area);
}

/** Deja el catálogo de Educación en las ocho etiquetas y mueve los estados viejos. */
export async function syncEducationLeadStatuses(
  prisma: PrismaService,
  area: string,
): Promise<void> {
  if (!isEducationLeadArea(area)) return;
  await prisma.$transaction(async (tx) => {
    for (const status of EDUCATION_LEAD_STATUSES) {
      await tx.lead_status_definitions.upsert({
        where: { area_slug: { area, slug: status.slug } },
        create: { area, ...status, active: true },
        update: {
          label: status.label,
          sort_order: status.sort_order,
          is_default: status.is_default,
          is_terminal: status.is_terminal,
          active: true,
          updated_at: new Date(),
        },
      });
    }
    for (const [legacy, target] of Object.entries(EDUCATION_LEGACY_STATUS_SLUGS)) {
      const src = await tx.lead_status_definitions.findUnique({
        where: { area_slug: { area, slug: legacy } },
        select: { id: true },
      });
      if (!src) continue;
      const dest = await tx.lead_status_definitions.findUnique({
        where: { area_slug: { area, slug: target } },
        select: { id: true },
      });
      if (!dest || dest.id === src.id) continue;
      const now = new Date();
      await tx.contacts.updateMany({
        where: { lead_status_id: src.id },
        data: { lead_status_id: dest.id, lead_status_updated_at: now, updated_at: now },
      });
      await tx.education_lead_cycles.updateMany({
        where: { lead_status_id: src.id },
        data: { lead_status_id: dest.id, updated_at: now },
      });
      await tx.lead_status_definitions.update({
        where: { id: src.id },
        data: { active: false, is_default: false, updated_at: now },
      });
    }
  });
}
