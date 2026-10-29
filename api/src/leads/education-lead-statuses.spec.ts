import { syncEducationLeadStatuses } from './education-lead-statuses';
import { EDUCATION_LEAD_STATUSES } from './leads.types';

describe('syncEducationLeadStatuses', () => {
  it('creates missing base statuses without overwriting catalog customizations', async () => {
    const tx = {
      lead_status_definitions: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      contacts: { updateMany: jest.fn() },
      education_lead_cycles: { updateMany: jest.fn() },
    };
    const prisma = {
      $transaction: (callback: (client: typeof tx) => Promise<void>) => callback(tx),
    };

    await syncEducationLeadStatuses(prisma as never, 'educacion_ep');

    expect(tx.lead_status_definitions.upsert).toHaveBeenCalledTimes(
      EDUCATION_LEAD_STATUSES.length,
    );
    for (const call of tx.lead_status_definitions.upsert.mock.calls) {
      expect(call[0].update).toEqual({});
    }
  });
});
