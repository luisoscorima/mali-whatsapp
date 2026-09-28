import {
  cursoFromOriginPayload,
  payloadCursoPatch,
  pickCursoFromAnswers,
} from './lead-curso.util';

describe('pickCursoFromAnswers', () => {
  it('lee las preguntas de Meta y TikTok', () => {
    expect(
      pickCursoFromAnswers({
        '¿Cuál de nuestros programas o cursos integrales te interesa?':
          'Historia del arte',
        'Nombre y apellidos': 'Ana Pérez',
        'Correo electrónico': 'ana@example.com',
        'Número de teléfono': '51999888777',
      }),
    ).toBe('Historia del arte');

    expect(
      pickCursoFromAnswers({
        '¿Qué curso te interesa?': 'Fotografía',
        'Nombre completo': 'Luis',
        'Correo electrónico': 'luis@example.com',
        'Número de teléfono': '51999111222',
      }),
    ).toBe('Fotografía');

    expect(
      pickCursoFromAnswers({
        '¿Cuál de nuestros cursos te interesa?': 'Grabado',
      }),
    ).toBe('Grabado');

    expect(
      pickCursoFromAnswers({
        '¿Qué programa te interesa?': 'Extensión profesional',
        'Correo electrónico': 'ana@example.com',
      }),
    ).toBe('Extensión profesional');
  });

  it('no confunde programación con programa', () => {
    expect(
      pickCursoFromAnswers({
        '¿Te interesa programación?': 'Sí',
      }),
    ).toBeUndefined();
  });

  it('ignora nombre, correo y teléfono', () => {
    expect(
      pickCursoFromAnswers({
        'Nombre completo': 'Ana',
        'Correo electrónico': 'ana@example.com',
        'Número de teléfono': '51999888777',
      }),
    ).toBeUndefined();
  });
});

describe('cursoFromOriginPayload', () => {
  it('usa payload.curso si ya está', () => {
    expect(
      cursoFromOriginPayload({
        curso: 'Widget',
        mapped: { '¿Qué curso te interesa?': 'Otro' },
      }),
    ).toBe('Widget');
  });

  it('lo saca de mapped o de field_data de Meta', () => {
    expect(
      cursoFromOriginPayload({
        mapped: { '¿qué curso te interesa?': 'Cerámica' },
      }),
    ).toBe('Cerámica');

    expect(
      cursoFromOriginPayload({
        field_data: [
          {
            name: '¿Cuál de nuestros programas o cursos integrales te interesa?',
            values: ['Museografía'],
          },
          { name: 'email', values: ['ana@example.com'] },
        ],
      }),
    ).toBe('Museografía');
  });

  it('prepara el parche solo si curso está vacío', () => {
    expect(
      payloadCursoPatch({
        mapped: { '¿Qué programa te interesa?': 'Grabado' },
      }),
    ).toEqual({
      mapped: { '¿Qué programa te interesa?': 'Grabado' },
      curso: 'Grabado',
    });
    expect(
      payloadCursoPatch({ curso: 'Ya estaba', mapped: { '¿Qué curso te interesa?': 'Otro' } }),
    ).toBeNull();
  });
});
