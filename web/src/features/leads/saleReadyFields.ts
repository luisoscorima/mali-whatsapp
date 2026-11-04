/** Etiquetas UI para campos exigidos al marcar venta exitosa (RQ0017). */

const LABELS: Record<string, string> = {
  nombre: 'Nombre',
  apellido: 'Apellido',
  dni: 'DNI',
  email: 'Email',
  telefono: 'Teléfono',
  categoria: 'Categoría',
}

export function formatSaleMissingFields(fields: string[]): string {
  return fields.map((f) => LABELS[f] ?? f).join(', ')
}
