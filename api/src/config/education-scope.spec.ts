import {
  conversationAreaPredicate,
  educationManagementArea,
  educationProgramOf,
  educationReadScope,
  isEducationAreaSlug,
} from './education-scope';

describe('education scope', () => {
  it('trata CA y EP como programas del área educación', () => {
    expect(educationProgramOf('educacion_ca')).toBe('ca');
    expect(educationProgramOf('ep')).toBe('ep');
    expect(educationProgramOf('educacion')).toBeNull();
    expect(educationProgramOf('norte')).toBe('norte');
    expect(educationProgramOf('educacion_norte')).toBe('norte');
    expect(educationProgramOf('pam')).toBeNull();
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
    expect(educationReadScope('norte')).toEqual({
      areas: ['educacion', 'educacion_ca', 'educacion_ep'],
      program: 'norte',
    });
  });

  it('deriva el alcance de gestión desde el programa del ciclo', () => {
    expect(educationManagementArea({ area: 'educacion', programSlug: 'ca' })).toBe('educacion_ca');
    expect(educationManagementArea({ area: 'educacion', programSlug: 'ep' })).toBe('educacion_ep');
    expect(educationManagementArea({ area: 'educacion_ep' })).toBe('educacion_ep');
    expect(educationManagementArea({ area: 'educacion' })).toBe('educacion');
  });

  it('el predicado de una línea CA exige el programa', () => {
    const sql = conversationAreaPredicate('c', 'educacion_ca');
    const text = sql.strings.join(' ');
    expect(text).toContain('program_key');
    expect(text).not.toContain('contact_programs');
    expect(conversationAreaPredicate('c', 'ti').strings.join(' ')).toContain(
      'c.area',
    );
  });
});
