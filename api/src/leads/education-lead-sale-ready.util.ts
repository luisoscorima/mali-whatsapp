/** Campos mínimos para marcar venta_exitosa / convertido (RQ0017). */

const PLACEHOLDER_NAMES = new Set([
  'lead',
  'contacto',
  'sin nombre',
  'usuario',
  'whatsapp',
]);

export type SaleReadyContact = {
  name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  whatsapp_user_id?: string | null;
  email?: string | null;
  dni?: string | null;
};

export type SaleReadyCycle = {
  program_id?: number | null;
  area?: string | null;
};

export type SaleReadyMissingField =
  | 'nombre'
  | 'apellido'
  | 'dni'
  | 'email'
  | 'telefono'
  | 'categoria';

function clean(value?: string | null): string {
  return (value ?? '').trim();
}

function isUsablePersonName(value: string): boolean {
  if (value.length < 2) return false;
  const normalized = value.toLowerCase().replace(/\s+/g, ' ');
  if (PLACEHOLDER_NAMES.has(normalized)) return false;
  // Solo dígitos / teléfono como nombre
  if (/^[\d+\s\-()]+$/.test(normalized)) return false;
  return true;
}

function hasCategoria(cycle: SaleReadyCycle): boolean {
  if (cycle.program_id != null && cycle.program_id > 0) return true;
  const area = clean(cycle.area).toLowerCase();
  return area === 'educacion_ca' || area === 'educacion_ep';
}

/** Lista de campos faltantes; vacía si puede cerrar como venta. */
export function missingFieldsForVentaExitosa(
  contact: SaleReadyContact,
  cycle: SaleReadyCycle,
): SaleReadyMissingField[] {
  const missing: SaleReadyMissingField[] = [];
  if (!isUsablePersonName(clean(contact.name))) missing.push('nombre');
  if (!isUsablePersonName(clean(contact.last_name))) missing.push('apellido');
  if (!clean(contact.dni)) missing.push('dni');
  if (!clean(contact.email) || !clean(contact.email).includes('@')) missing.push('email');
  if (!clean(contact.phone) && !clean(contact.whatsapp_user_id)) missing.push('telefono');
  if (!hasCategoria(cycle)) missing.push('categoria');
  return missing;
}

export function isSaleClosingStatusSlug(slug?: string | null): boolean {
  const status = slug?.trim().toLowerCase().replace(/[\s-]+/g, '_') ?? '';
  return status === 'venta_exitosa' || status === 'convertido';
}
