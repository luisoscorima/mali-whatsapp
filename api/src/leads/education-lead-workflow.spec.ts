import { EducationLeadWorkflowService } from './education-lead-workflow.service';

describe('Education lead cycle creation', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const origin = {
    id: 7, area: 'educacion_ep', contact_id: 10, channel: 'meta_lead_form',
    source_key: 'form-1', source_label: 'Formulario EP', first_seen_at: now,
  };

  function setup(previousStatus: string, previousAt: Date) {
    const previous = { id: 1, contact_id: 10, area: 'educacion_ep', assigned_user_id: 22,
      assigned_user: { first_name: 'Ana', last_name: 'Soto', email: 'ana@example.org' },
      last_interaction_at: previousAt, lead_status: { slug: previousStatus, label: previousStatus } };
    const tx = {
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
      lead_status_definitions: { findFirst: jest.fn().mockResolvedValue({ id: 99 }) },
      conversations: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      contacts: { update: jest.fn() },
    };
    const prisma = {
      contact_origins: { findUnique: jest.fn().mockResolvedValue(origin) },
      $transaction: (fn: (client: typeof tx) => Promise<void>) => fn(tx),
    };
    return { service: new EducationLeadWorkflowService(prisma as never), tx };
  }

  it('opens a new cycle after 60 days while retaining the advisor until review', async () => {
    const { service, tx } = setup('contactado', new Date(now.getTime() - 61 * 86400000));
    await service.recordOrigin(origin.id);
    expect(tx.education_lead_cycles.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      contact_id: 10, assigned_user_id: 22, requires_review: true,
    }) });
    expect(tx.conversations.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ assigned_user_id: 22 }),
    }));
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

  it('keeps a converted lead for human conflict review', async () => {
    const { service, tx } = setup('convertido', new Date(now.getTime() - 61 * 86400000));
    await service.recordOrigin(origin.id);
    expect(tx.education_lead_cycles.create).not.toHaveBeenCalled();
    expect(tx.conversations.updateMany).not.toHaveBeenCalled();
    expect(tx.education_lead_entries.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      classification: 'conflict', assignment_rule: 'conflict',
      conflict_reason: 'estado_convertido', cycle_id: 1,
    }) });
  });

  it('does not create another intake while inbound messages remain in the same session', async () => {
    const prisma = {
      education_lead_entries: { findFirst: jest.fn().mockResolvedValue({
        occurred_at: new Date(now.getTime() - 90 * 86400000), classification: 'new',
      }) },
      education_lead_cycles: {
        findFirst: jest.fn().mockResolvedValue({ id: 2,
          last_interaction_at: new Date(now.getTime() - 60 * 60 * 1000) }),
        update: jest.fn(),
      },
      chat_messages: { findFirst: jest.fn().mockResolvedValue({
        created_at: new Date(now.getTime() - 60 * 60 * 1000),
      }) },
      $transaction: jest.fn(),
    };
    const service = new EducationLeadWorkflowService(prisma as never);
    await service.recordInbound({ area: 'educacion_ep', contactId: 10,
      conversationId: 4, messageId: 20, occurredAt: now });
    expect(prisma.education_lead_cycles.update).toHaveBeenCalledWith({
      where: { id: 2 }, data: expect.objectContaining({ last_interaction_at: now }),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('distributes only numbers without history, leaving reassignable returns for manual review', async () => {
    const tx = {
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

  it('keeps the previous advisor when a conflict is reviewed as a new cycle', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      education_lead_entries: {
        findFirst: jest.fn().mockResolvedValue({ id: 8, area: 'educacion_ep',
          contact_id: 10, classification: 'conflict', reviewed_at: null,
          cycle_id: 1, occurred_at: now }),
        update: jest.fn().mockResolvedValue({ id: 8 }),
      },
      education_lead_cycles: {
        findFirst: jest.fn().mockResolvedValue({ id: 1, assigned_user_id: 22,
          started_at: new Date(now.getTime() - 70 * 86400000) }),
        create: jest.fn().mockResolvedValue({ id: 2 }),
      },
      lead_status_definitions: { findFirst: jest.fn().mockResolvedValue({ id: 99 }) },
      contacts: { update: jest.fn() },
      conversations: { updateMany: jest.fn() },
      audit_logs: { create: jest.fn() },
    };
    const prisma = { $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx) };
    await new EducationLeadWorkflowService(prisma as never)
      .reviewEntry(8, 'educacion_ep', 'open_new');
    expect(tx.education_lead_cycles.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      assigned_user_id: 22, requires_review: true,
    }) });
    expect(tx.conversations.updateMany).not.toHaveBeenCalled();
  });
});
