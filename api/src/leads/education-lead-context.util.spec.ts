import {
  exactOpenCycleWhere,
  inactivityDeadlineFrom,
  isCommercialLeadChannel,
  isCycleOpen,
  isEducationAttentionArea,
} from './education-lead-context.util';
import { EDUCATION_LEAD_WINDOW_MS } from './education-lead-classification.util';

describe('education-lead-context.util', () => {
  it('recognizes education attention areas', () => {
    expect(isEducationAttentionArea('educacion_ep')).toBe(true);
    expect(isEducationAttentionArea('ti')).toBe(false);
  });

  it('matches open cycles by exact program without falling back to General', () => {
    expect(exactOpenCycleWhere({ personId: 3, area: 'educacion', programId: 9 })).toEqual({
      person_id: 3,
      closed_at: null,
      OR: [{ program_id: 9 }],
    });
    expect(exactOpenCycleWhere({ personId: 3, area: 'educacion', programId: null })).toEqual({
      person_id: 3,
      closed_at: null,
      program_id: null,
      area: 'educacion',
    });
  });

  it('keeps legacy CA/EP null-program rows only for those area slugs', () => {
    expect(exactOpenCycleWhere({ personId: 3, area: 'educacion_ca', programId: 9 })).toEqual({
      person_id: 3,
      closed_at: null,
      OR: [{ program_id: 9 }, { program_id: null, area: 'educacion_ca' }],
    });
  });

  it('distinguishes commercial channels from organic', () => {
    expect(isCommercialLeadChannel('meta_lead_form')).toBe(true);
    expect(isCommercialLeadChannel('organic_wa')).toBe(false);
    expect(isCommercialLeadChannel(null)).toBe(false);
  });

  it('computes inactivity deadline from the window', () => {
    const start = new Date('2026-01-01T00:00:00Z');
    expect(inactivityDeadlineFrom(start).getTime()).toBe(
      start.getTime() + EDUCATION_LEAD_WINDOW_MS,
    );
  });

  it('treats terminal or closed cycles as not open', () => {
    expect(isCycleOpen({ closed_at: null, lead_status: { is_terminal: false } })).toBe(true);
    expect(isCycleOpen({ closed_at: new Date(), lead_status: null })).toBe(false);
    expect(isCycleOpen({ closed_at: null, lead_status: { is_terminal: true } })).toBe(false);
  });
});
