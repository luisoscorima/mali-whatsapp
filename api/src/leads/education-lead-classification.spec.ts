import { classifyEducationIntake, EDUCATION_LEAD_WINDOW_MS } from './education-lead-classification.util';

describe('education lead 60-day classification', () => {
  const occurredAt = new Date('2026-09-23T12:00:00.000Z');

  it('opens a cycle only after more than 60 days without a customer interaction', () => {
    expect(classifyEducationIntake({ occurredAt }).classification).toBe('new');
    expect(classifyEducationIntake({ occurredAt }).assignmentRule).toBe('new_number');
    expect(classifyEducationIntake({ occurredAt,
      previousInteractionAt: new Date(occurredAt.getTime() - EDUCATION_LEAD_WINDOW_MS),
    }).classification).toBe('duplicate');
    expect(classifyEducationIntake({ occurredAt,
      previousInteractionAt: new Date(occurredAt.getTime() - EDUCATION_LEAD_WINDOW_MS),
    }).assignmentRule).toBe('same_advisor');
    expect(classifyEducationIntake({ occurredAt,
      previousInteractionAt: new Date(occurredAt.getTime() - EDUCATION_LEAD_WINDOW_MS - 1),
    }).classification).toBe('new');
    expect(classifyEducationIntake({ occurredAt,
      previousInteractionAt: new Date(occurredAt.getTime() - EDUCATION_LEAD_WINDOW_MS - 1),
    }).assignmentRule).toBe('reassignable');
  });

  it('treats a return one month after a new cycle as duplicate', () => {
    const returnAt = new Date(occurredAt.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(classifyEducationIntake({ occurredAt: returnAt,
      previousInteractionAt: new Date(returnAt.getTime() - 180 * 24 * 60 * 60 * 1000),
    }).classification).toBe('new');
    expect(classifyEducationIntake({ occurredAt, previousInteractionAt: returnAt }).classification).toBe('duplicate');
  });

  it('sends converted and recent no-interested leads to manual review', () => {
    expect(classifyEducationIntake({ occurredAt, previousStatusSlug: 'convertido',
      previousInteractionAt: new Date(occurredAt.getTime() - 120 * 24 * 60 * 60 * 1000),
    })).toEqual({ classification: 'conflict', assignmentRule: 'conflict', conflictReason: 'estado_convertido' });
    expect(classifyEducationIntake({ occurredAt, previousStatusSlug: 'no_interesado',
      previousInteractionAt: new Date(occurredAt.getTime() - 10 * 24 * 60 * 60 * 1000),
    })).toEqual({ classification: 'conflict', assignmentRule: 'conflict', conflictReason: 'no_interesado_reciente' });
  });
});
