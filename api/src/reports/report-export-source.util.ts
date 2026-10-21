import { AREA_LABELS, type BusinessArea } from '../config/areas';
import { getStoredDisplayPhoneNumber } from '../meta-settings/meta-settings.store';

export const REPORT_SOURCE_HEADERS = ['Área', 'Número del área'];

/** Mantiene el número como texto y muestra las líneas peruanas sin el prefijo 51. */
export function reportExportSourceCells(area: BusinessArea): string[] {
  const digits = getStoredDisplayPhoneNumber(area).replace(/\D/g, '');
  const phone = digits.replace(/^51(\d{9})$/, '$1');
  return [AREA_LABELS[area], phone || 'Sin número configurado'];
}
