import {
  formatLeadScoreLabel,
  isValidLeadScore,
  remapLegacyLeadScore,
} from './lead-score.util';

describe('lead-score.util', () => {
  it('valida escala 1–3', () => {
    expect(isValidLeadScore(1)).toBe(true);
    expect(isValidLeadScore(3)).toBe(true);
    expect(isValidLeadScore(4)).toBe(false);
    expect(isValidLeadScore(0)).toBe(false);
  });

  it('formatea labels', () => {
    expect(formatLeadScoreLabel(1)).toBe('Bajo');
    expect(formatLeadScoreLabel(2)).toBe('Medio');
    expect(formatLeadScoreLabel(3)).toBe('Alto');
    expect(formatLeadScoreLabel(5)).toBe('Alto');
    expect(formatLeadScoreLabel(null)).toBe('');
  });

  it('remapea estrellas legacy', () => {
    expect(remapLegacyLeadScore(1)).toBe(1);
    expect(remapLegacyLeadScore(2)).toBe(1);
    expect(remapLegacyLeadScore(3)).toBe(2);
    expect(remapLegacyLeadScore(4)).toBe(3);
    expect(remapLegacyLeadScore(5)).toBe(3);
    expect(remapLegacyLeadScore(null)).toBe(null);
  });
});
