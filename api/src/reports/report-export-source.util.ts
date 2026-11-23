import { Prisma } from '@prisma/client';
import { businessReadScope, type BusinessArea } from '../config/areas';

export const REPORT_SOURCE_HEADERS = ['Categoría', 'Línea'];
export type ReportSource = {
  category?: string | null;
  category_label?: string | null;
  whatsapp_line?: string | null;
};

function categoryCell(area: BusinessArea, source: ReportSource): string {
  if (businessReadScope(area).canonicalArea !== 'educacion') return 'No aplica';
  const labeled = String(source.category_label ?? '').trim();
  if (labeled) return labeled;
  const value = String(source.category ?? '').trim().toLowerCase();
  if (!value) return 'Sin categoría';
  if (value === 'general') return 'General';
  return value.toUpperCase();
}

/** Categoría y línea de la fila. No usa el número por defecto del área. */
export function reportExportSourceCells(area: BusinessArea, source: ReportSource = {}): string[] {
  return [
    categoryCell(area, source),
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
    (SELECT CASE
        WHEN COALESCE(bp.slug, NULLIF(BTRIM(wl.program_key), ''), 'general') = 'general'
          THEN 'General'
        ELSE COALESCE(
          NULLIF(BTRIM(bp.label), ''),
          UPPER(COALESCE(bp.slug, NULLIF(BTRIM(wl.program_key), ''), 'general'))
        )
      END
     FROM whatsapp_lines wl
     LEFT JOIN business_programs bp ON bp.id = wl.program_id
     WHERE wl.id = conv.whatsapp_line_id) AS category_label,
    (SELECT NULLIF(CONCAT_WS(' · ', NULLIF(BTRIM(wl.label), ''), NULLIF(BTRIM(wl.display_phone_number), '')), '')
     FROM whatsapp_lines wl
     WHERE wl.id = conv.whatsapp_line_id) AS whatsapp_line
  `;
}
