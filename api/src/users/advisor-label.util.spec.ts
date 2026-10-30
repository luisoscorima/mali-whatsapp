import {
  advisorLabelSql,
  firstNamePart,
  formatAdvisorLabel,
} from './advisor-label.util';

describe('formatAdvisorLabel', () => {
  it('usa primer nombre y primer apellido', () => {
    expect(
      formatAdvisorLabel({
        first_name: 'Luis Gustavo',
        last_name: 'Oscorima Palomino',
        email: 'loscorima@mali.pe',
      }),
    ).toBe('Luis Oscorima');
  });

  it('usa solo el nombre cuando no hay apellido', () => {
    expect(
      formatAdvisorLabel({
        first_name: 'Luis',
        last_name: null,
        email: 'loscorima@mali.pe',
      }),
    ).toBe('Luis');
  });

  it('cae al local-part del email sin nombres', () => {
    expect(
      formatAdvisorLabel({
        first_name: null,
        last_name: null,
        email: 'loscorima@mali.pe',
      }),
    ).toBe('loscorima');
  });

  it('no usa el correo completo como título', () => {
    expect(
      formatAdvisorLabel({
        first_name: '  ',
        last_name: '',
        email: 'loscorima@mali.pe',
      }),
    ).toBe('loscorima');
  });
});

describe('firstNamePart', () => {
  it('toma el primer token', () => {
    expect(firstNamePart('María Fernanda')).toBe('María');
    expect(firstNamePart(null)).toBe('');
  });
});

describe('advisorLabelSql', () => {
  it('rechaza alias inválidos', () => {
    expect(() => advisorLabelSql('u; drop')).toThrow(/Invalid SQL alias/);
  });

  it('emite SQL con el alias indicado', () => {
    const sql = advisorLabelSql('au');
    expect(sql.strings.join('?')).toContain('au');
    expect(sql.strings.join('?')).toContain('first_name');
    expect(sql.strings.join('?')).toContain('SPLIT_PART');
  });
});
