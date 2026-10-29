import { EducationLeadWorkflowService } from './education-lead-workflow.service';

describe('Education lead cycle creation', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const origin = {
    id: 7, area: 'educacion_ep', contact_id: 10, channel: 'meta_lead_form',
    source_key: 'form-1', source_label: 'Formulario EP', first_seen_at: now,
  };

  function setup(previousStatus: string, previousAt: Date, previousClosedAt: Date | null = null) {
    const previous = {
      id: 1, contact_id: 10, area: 'educacion_ep', assigned_user_id: 22,
      assigned_user: { first_name: 'Ana', last_name: 'Soto', email: 'ana@example.org' },
      last_interaction_at: previousAt,
      closed_at: previousClosedAt,
      first_inbound_at: previousAt,
      lead_status: {
        slug: previousStatus,
        label: previousStatus,
        is_terminal: ['convertido', 'venta_exitosa', 'perdido', 'no_interesado'].includes(previousStatus),
      },
    };
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      education_lead_entries: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 8 }),
      },
      education_lead_cycles: {
        findFirst: jest.fn().mockResolvedValue(previous),
        create: jest.fn().mockResolvedValue({ id: 2 }),
        update: jest.fn(),
      },
      education_lead_alerts: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      education_lead_conversation_links: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      lead_status_definitions: { findFirst: jest.fn().mockResolvedValue({ id: 99 }) },
      conversations: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      contacts: {
        findUnique: jest.fn().mockResolvedValue({
          person_id: 55, business_area_id: 3, lead_status_id: null, lead_score: null,
        }),
        update: jest.fn(),
      },
    };
    const prisma = {
      contact_origins: { findUnique: jest.fn().mockResolvedValue(origin) },
      app_settings: {
        findUnique: jest.fn().mockResolvedValue({ value: '1' }),
      },
      $transaction: (fn: (client: typeof tx) => Promise<void>) => fn(tx),
    };
    return { service: new EducationLeadWorkflowService(prisma as never), tx };
  }

  it('opens a new cycle after 60 days while retaining the advisor until review', async () => {
    const { service, tx } = setup('contactado', new Date(now.getTime() - 61 * 86400000));
    await service.recordOrigin(origin.id);
    expect(tx.$executeRaw.mock.calls[0][0].join('?')).toContain(
      'pg_advisory_xact_lock(?::integer, ?::integer)',
    );
    expect(tx.education_lead_cycles.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      contact_id: 10, person_id: 55, assigned_user_id: 22, requires_review: true,
    }) });
    expect(tx.education_lead_alerts.create).toHaveBeenCalled();
    expect(tx.$executeRaw.mock.calls.some(([sql]) => sql.join('?').includes('UPDATE conversations c'))).toBe(true);
    expect(tx.contacts.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lead_status_id: 99, lead_score: null }),
    }));
    expect(tx.education_lead_entries.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      classification: 'new', assignment_rule: 'reassignable',
      previous_assigned_user_id: 22, previous_advisor_label: 'Ana Soto',
      previous_interaction_at: new Date(now.getTime() - 61 * 86400000),
      cycle_id: 2, channel: 'meta_lead_form',
    }) });
  });

  it('opens a new cycle after a closed converted opportunity on commercial intake', async () => {
    const closedAt = new Date(now.getTime() - 61 * 86400000);
    const { service, tx } = setup('convertido', closedAt, closedAt);
    await service.recordOrigin(origin.id);
    expect(tx.education_lead_cycles.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      contact_id: 10, person_id: 55, requires_review: true,
    }) });
    expect(tx.education_lead_entries.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      classification: 'new', assignment_rule: 'reassignable', cycle_id: 2,
    }) });
  });

  it('does not create another intake while inbound messages remain in the same session', async () => {
    const linkTx = {
      $queryRaw: jest.fn().mockResolvedValue([{ closed_at: null }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      education_lead_conversation_links: {
        findFirst: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };
    const prisma = {
      contacts: { findUnique: jest.fn().mockResolvedValue({ person_id: 55 }) },
      education_lead_entries: {
        findFirst: jest.fn().mockResolvedValue({
          occurred_at: new Date(now.getTime() - 90 * 86400000), classification: 'new',
        }),
        create: jest.fn(),
      },
      education_lead_cycles: {
        findFirst: jest.fn().mockResolvedValue({
          id: 2,
          last_interaction_at: new Date(now.getTime() - 60 * 60 * 1000),
          closed_at: null,
          first_inbound_at: new Date(now.getTime() - 60 * 60 * 1000),
          lead_status: { slug: 'contactado', is_terminal: false },
        }),
        update: jest.fn(),
        create: jest.fn(),
      },
      conversations: { findUnique: jest.fn().mockResolvedValue({ whatsapp_line: null }) },
      chat_messages: { findFirst: jest.fn().mockResolvedValue({
        created_at: new Date(now.getTime() - 60 * 60 * 1000),
      }) },
      // linkConversation uses a short transaction; must not open a new cycle.
      $transaction: jest.fn(async (fn: (client: typeof linkTx) => Promise<unknown>) => fn(linkTx)),
    };
    const service = new EducationLeadWorkflowService(prisma as never);
    await service.recordInbound({ area: 'educacion_ep', contactId: 10,
      conversationId: 4, messageId: 20, occurredAt: now });
    expect(prisma.education_lead_cycles.update).toHaveBeenCalledWith({
      where: { id: 2 }, data: expect.objectContaining({ last_interaction_at: now }),
    });
    expect(prisma.education_lead_cycles.create).not.toHaveBeenCalled();
    expect(prisma.education_lead_entries.create).not.toHaveBeenCalled();
  });

  it('does not reopen after a closed cycle on organic inbound', async () => {
    const closedAt = new Date(now.getTime() - 10 * 86400000);
    const prisma = {
      contacts: { findUnique: jest.fn().mockResolvedValue({ person_id: 55 }) },
      education_lead_entries: { findFirst: jest.fn().mockResolvedValue(null) },
      education_lead_cycles: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null) // no open cycle
          .mockResolvedValueOnce({
            id: 1,
            closed_at: closedAt,
            close_reason: 'sold',
            last_interaction_at: closedAt,
            lead_status: { slug: 'convertido', is_terminal: true },
          }),
        update: jest.fn(),
      },
      conversations: { findUnique: jest.fn().mockResolvedValue({ whatsapp_line: { program_id: 9 } }) },
      chat_messages: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    const service = new EducationLeadWorkflowService(prisma as never);
    await service.recordInbound({
      area: 'educacion_ep',
      contactId: 10,
      conversationId: 4,
      messageId: 21,
      occurredAt: now,
      channel: 'organic_wa',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.education_lead_cycles.findFirst).toHaveBeenCalledTimes(2);
  });

  it('distributes only numbers without history, leaving reassignable returns for manual review', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      users: { findMany: jest.fn().mockResolvedValue([{ id: 22 }]) },
      education_lead_entries: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = { $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };
    const service = new EducationLeadWorkflowService(prisma as never);
    await service.distribute({ area: 'educacion_ep' });
    expect(tx.education_lead_entries.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assignment_rule: 'new_number',
        cycle: { is: { assigned_user_id: null } } }),
    }));
  });

  it('rejects clearing an advisor instead of reassigning directly', async () => {
    const prisma = { contacts: { findFirst: jest.fn().mockResolvedValue({ id: 10 }) } };
    const service = new EducationLeadWorkflowService(prisma as never);
    await expect(service.updateManagement(10, 'educacion_ep', {
      assigned_user_id: null,
    })).rejects.toThrow('Para reasignar, selecciona otro asesor');
  });

  it('does not create a cycle when an explicit opportunity does not belong to the contact', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      education_lead_cycles: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const prisma = {
      contacts: { findFirst: jest.fn().mockResolvedValue({ id: 10, person_id: 55 }) },
      $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    };
    await expect(new EducationLeadWorkflowService(prisma as never).updateManagement(
      10, 'educacion_ep', { lead_id: 999 },
    )).rejects.toThrow('Oportunidad no encontrada');
    expect(tx.education_lead_cycles.create).not.toHaveBeenCalled();
  });

  it('keeps the previous advisor when a conflict is reviewed as a new cycle', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      education_lead_entries: {
        findFirst: jest.fn().mockResolvedValue({ id: 8, area: 'educacion_ep',
          contact_id: 10, classification: 'conflict', reviewed_at: null,
          cycle_id: 1, occurred_at: now }),
        update: jest.fn().mockResolvedValue({ id: 8 }),
      },
      education_lead_cycles: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, assigned_user_id: 22,
          started_at: new Date(now.getTime() - 70 * 86400000), closed_at: null }),
        create: jest.fn().mockResolvedValue({ id: 2 }),
        update: jest.fn(),
      },
      education_lead_alerts: { create: jest.fn().mockResolvedValue({ id: 1 }) },
      lead_status_definitions: { findFirst: jest.fn().mockResolvedValue({ id: 99 }) },
      contacts: {
        findUnique: jest.fn().mockResolvedValue({ person_id: 55, business_area_id: 3 }),
        update: jest.fn(),
      },
      conversations: { updateMany: jest.fn() },
      audit_logs: { create: jest.fn() },
    };
    const prisma = { $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };
    await new EducationLeadWorkflowService(prisma as never)
      .reviewEntry(8, 'educacion_ep', 'open_new');
    expect(tx.education_lead_cycles.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      person_id: 55, assigned_user_id: 22, requires_review: true,
    }) });
    expect(tx.conversations.updateMany).not.toHaveBeenCalled();
  });

  it('lists closed opportunities with operational counts and the latest capture context', async () => {
    const count = jest.fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3);
    const item = {
      id: 31, area: 'educacion_ep', contact_id: 10, person_id: 55,
      started_at: now, last_interaction_at: now, closed_at: now,
      assigned_user_id: 22,
      assigned_user: { id: 22, first_name: 'Ana', last_name: 'Soto', email: 'ana@example.org' },
      lead_status_id: 9, lead_status: { id: 9, label: 'Venta exitosa', slug: 'venta_exitosa' },
      lead_score: 10, requires_review: false,
      program: { slug: 'ep', label: 'Extensión profesional' },
      contact: { id: 10, person_id: 55, name: 'Luz', last_name: 'Ramos',
        phone: '999111222', email: 'luz@example.org', whatsapp_user_id: 'bsuid-1',
        conversations: [{ wa_username: 'luz.ramos' }] },
      conversation_links: [{ conversation_id: 70 }],
      entries: [{ channel: 'meta_lead_form', source_label: 'Formulario EP',
        assignment_rule: 'same_advisor', classification: 'duplicate', occurred_at: now,
        origin: { payload: { curso: 'Fotografía' } } }],
    };
    const prisma = {
      education_lead_cycles: { count, findMany: jest.fn().mockResolvedValue([item]) },
      $transaction: (queries: Array<Promise<unknown>>) => Promise.all(queries),
    };
    const result = await new EducationLeadWorkflowService(prisma as never).listCycles({
      area: 'educacion_ep', view: 'closed', page: 1, limit: 50,
    });

    expect(prisma.education_lead_cycles.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [expect.any(Object), { closed_at: { not: null } }] },
    }));
    expect(result.counts).toEqual({ open: 4, closed: 2, review: 1, unassigned: 3 });
    expect(result.items[0]).toEqual(expect.objectContaining({
      id: 31, curso_interes: 'Fotografía', assignment_rule: 'same_advisor',
      conversation_id: 70, assigned_user_label: 'Ana Soto',
      contacts: expect.objectContaining({ wa_username: 'luz.ramos' }),
    }));
  });
});
