import {
  endLeadConversationLinks,
  projectLeadAssignee,
  withLeadCreateSavepoint,
} from './education-lead-lifecycle.util';
import { Prisma } from '@prisma/client';

describe('education-lead-lifecycle.util', () => {
  it('projects assignee only within the lead category SQL', async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(1) };
    await projectLeadAssignee(tx as never, 9, 22, new Date('2026-10-29T00:00:00Z'));
    const sql = tx.$executeRaw.mock.calls[0][0].join('?');
    expect(sql).toContain('UPDATE conversations c');
    expect(sql).toContain('line.program_id IS NOT DISTINCT FROM lead.program_id');
    expect(sql).toContain('ct.person_id = lead.person_id');
  });

  it('ends live conversation links without deleting history', async () => {
    const tx = { $executeRaw: jest.fn().mockResolvedValue(2) };
    const at = new Date('2026-10-29T12:00:00Z');
    await endLeadConversationLinks(tx as never, 9, at);
    const sql = tx.$executeRaw.mock.calls[0][0].join('?');
    expect(sql).toContain('SET unlinked_at = GREATEST(linked_at');
    expect(sql).toContain('unlinked_at IS NULL');
    expect(sql).not.toContain('DELETE');
  });

  it('rolls back to savepoint so the outer transaction can continue after P2002', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
    };
    const p2002 = new Prisma.PrismaClientKnownRequestError('Unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    await expect(
      withLeadCreateSavepoint(tx as never, async () => {
        throw p2002;
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const sqls = tx.$executeRaw.mock.calls.map(([sql]) => sql.join('?'));
    expect(sqls[0]).toContain('SAVEPOINT lead_cycle_create');
    expect(sqls[1]).toContain('ROLLBACK TO SAVEPOINT lead_cycle_create');
    expect(sqls[2]).toContain('RELEASE SAVEPOINT lead_cycle_create');
  });
});
