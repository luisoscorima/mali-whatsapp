import {
  conversationAreaPredicate,
  educationProgramOf,
  educationReadScope,
  isEducationAreaSlug,
} from './education-scope';

describe('education scope', () => {
  it('trata CA y EP como programas del área educación', () => {
    expect(educationProgramOf('educacion_ca')).toBe('ca');
    expect(educationProgramOf('ep')).toBe('ep');
    expect(educationProgramOf('educacion')).toBeNull();
    expect(isEducationAreaSlug('educacion_ep')).toBe(true);
    expect(isEducationAreaSlug('pam')).toBe(false);
  });

  it('al leer educacion incluye las tres áreas y un alias filtra el programa', () => {
    expect(educationReadScope('educacion')).toEqual({
      areas: ['educacion', 'educacion_ca', 'educacion_ep'],
      program: null,
    });
    expect(educationReadScope('educacion_ep').program).toBe('ep');
    expect(educationReadScope('all').program).toBeNull();
    expect(educationReadScope('pam').areas).toEqual(['pam']);
  });

  it('el predicado de una línea CA exige el programa', () => {
    const sql = conversationAreaPredicate('c', 'educacion_ca');
    expect(sql.strings.join(' ')).toContain('program_key');
    expect(conversationAreaPredicate('c', 'ti').strings.join(' ')).toContain(
      'c.area',
    );
  });
});
