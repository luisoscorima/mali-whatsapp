import {
  extractCursoFromWebPrefill,
  isWebButtonRefSlug,
  matchWebButtonWhatsapp,
} from './web-button-match.util';

describe('web-button-match.util', () => {
  it('detecta ref:web_*', () => {
    expect(isWebButtonRefSlug('web')).toBe(true);
    expect(isWebButtonRefSlug('web_ca')).toBe(true);
    expect(isWebButtonRefSlug('web-ep')).toBe(true);
    expect(isWebButtonRefSlug('curso_arte')).toBe(false);
  });

  it('prioriza ref web sobre el copy', () => {
    const hit = matchWebButtonWhatsapp(
      'ref:web_ca · ¡Hola MALI Educación! Vengo desde la web, deseo más información',
    );
    expect(hit).toMatchObject({ slug: 'web_ca', match: 'ref' });
  });

  it('deja otros ref al catálogo mali_one_link', () => {
    expect(
      matchWebButtonWhatsapp('ref:promo_octubre · Hola quiero info'),
    ).toBeNull();
  });

  it('detecta el prefijo dominante de WordPress', () => {
    const hit = matchWebButtonWhatsapp(
      '¡Hola MALI Educación! Vengo desde la web, deseo más información sobre los cursos de arte, por favor.',
    );
    expect(hit).toMatchObject({
      slug: 'web_prefill',
      match: 'text',
      curso: 'cursos de arte',
    });
  });

  it('extrae curso concreto', () => {
    expect(
      extractCursoFromWebPrefill(
        '¡Hola MALI Educación! Vengo desde la web, deseo más información sobre el curso Oratoria y Liderazgo, por favor.',
      ),
    ).toBe('Oratoria y Liderazgo');
  });

  it('no marca frases sueltas sin ancla MALI', () => {
    expect(matchWebButtonWhatsapp('Hola, vengo desde la web')).toBeNull();
  });
});
