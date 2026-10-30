import { Prisma } from '@prisma/client';
import { businessReadScope, type BusinessArea } from '../config/areas';

export const REPORT_SOURCE_HEADERS = ['Categoría', 'Línea'];
export type ReportSource = { category?: string | null; whatsapp_line?: string | null };

function categoryCell(area: BusinessArea, slug: string | null | undefined): string {
  if (businessReadScope(area).canonicalArea !== 'educacion') return 'No aplica';
  const value = String(slug ?? '').trim().toLowerCase();
  if (!value) return 'Sin categoría';
  if (value === 'general') return 'General';
  if (value === 'ca') return 'Cursos de Arte';
  if (value === 'ep') return 'Extensión Profesional';
  return value.toUpperCase();
}

/** Categoría y línea de la fila. No usa el número por defecto del área. */
export function reportExportSourceCells(area: BusinessArea, source: ReportSource = {}): string[] {
  return [
    categoryCell(area, source.category),
    source.whatsapp_line?.trim() || 'Sin línea',
  ];
}

/** Categoría y línea de la conversación ya unida como conv. */
export function reportConversationSourceSql(): Prisma.Sql {
  return Prisma.sql`
    (SELECT COALESCE(bp.slug, NULLIF(BTRIM(wl.program_key), ''), 'general')
     FROM whatsapp_lines wl
     LEFT JOIN business_programs bp ON bp.id = wl.program_id
     WHERE wl.id = conv.whatsapp_line_id) AS category,
    (SELECT NULLIF(CONCAT_WS(' · ', NULLIF(BTRIM(wl.label), ''), NULLIF(BTRIM(wl.display_phone_number), '')), '')
     FROM whatsapp_lines wl
     WHERE wl.id = conv.whatsapp_line_id) AS whatsapp_line
  `;
}
