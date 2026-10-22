import { AuditEvent } from '../audit/audit-events';
import {
  collectUserIdsFromAuditRows,
  formatInboxTimelineEventLabel,
} from './inbox-timeline.util';

describe('direct template assignment timeline', () => {
  const row = {
    id: 1n,
    created_at: new Date('2026-10-22T12:00:00Z'),
    event_type: AuditEvent.CONVERSATION_ASSIGN,
    actor_email: 'nuevo.asesor@mali.pe',
    meta: {
      conversation_id: 44,
      from_user_id: 10,
      to_user_id: 20,
      source: 'direct_template',
    },
  };

  it('shows the previous and new assignee', () => {
    const label = formatInboxTimelineEventLabel(
      row,
      new Map([
        [10, 'asesor.anterior'],
        [20, 'nuevo.asesor'],
      ]),
      new Map(),
    );

    expect(label).toBe(
      'nuevo.asesor reasignó el chat de asesor.anterior a nuevo.asesor al enviar una plantilla',
    );
  });

  it('loads both assignees for historical labels', () => {
    expect(collectUserIdsFromAuditRows([row])).toEqual([10, 20]);
  });
});
