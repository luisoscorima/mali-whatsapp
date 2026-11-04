import {
  isSaleClosingStatusSlug,
  missingFieldsForVentaExitosa,
} from './education-lead-sale-ready.util';

describe('education-lead-sale-ready', () => {
  const readyContact = {
    name: 'Ana',
    last_name: 'Pérez',
    phone: '51999999999',
    email: 'ana@mali.pe',
    dni: '12345678',
    whatsapp_user_id: null as string | null,
  };

  it('detecta venta_exitosa y convertido', () => {
    expect(isSaleClosingStatusSlug('venta_exitosa')).toBe(true);
    expect(isSaleClosingStatusSlug('convertido')).toBe(true);
    expect(isSaleClosingStatusSlug('promesa')).toBe(false);
  });

  it('pasa con ficha completa y categoría', () => {
    expect(missingFieldsForVentaExitosa(readyContact, { program_id: 2 })).toEqual([]);
  });

  it('acepta whatsapp_user_id sin teléfono', () => {
    expect(
      missingFieldsForVentaExitosa(
        { ...readyContact, phone: null, whatsapp_user_id: 'bsuid:abc' },
        { program_id: 1 },
      ),
    ).toEqual([]);
  });

  it('lista faltantes', () => {
    expect(
      missingFieldsForVentaExitosa(
        { name: 'Lead', last_name: '', phone: null, email: null, dni: null },
        { area: 'educacion' },
      ),
    ).toEqual(['nombre', 'apellido', 'dni', 'email', 'telefono', 'categoria']);
  });

  it('exige apellido aunque el nombre esté completo', () => {
    expect(
      missingFieldsForVentaExitosa(
        { ...readyContact, last_name: '' },
        { program_id: 2 },
      ),
    ).toEqual(['apellido']);
  });

  it('acepta area educacion_ca como categoría', () => {
    expect(
      missingFieldsForVentaExitosa(readyContact, { area: 'educacion_ca', program_id: null }),
    ).toEqual([]);
  });
});
