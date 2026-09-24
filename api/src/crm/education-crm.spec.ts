import { CrmService } from './crm.service';
import { LeadsService } from '../leads/leads.service';

describe('CRM Educación', () => {
  it('expone BSUID y username de un contacto PAM sin teléfono y permite buscarlos', async () => {
    const row = { id: 12, area: 'pam', name: 'Ana', last_name: '', phone: null,
      whatsapp_user_id: 'PE.987', conversations: [{ wa_username: 'ana_mali' }],
      email: null, dni: null, opt_in: true, opt_in_email: false, active: true,
      contact_attributes: [], contact_segments: [], education_lead_cycles: [],
      lead_status_id: null, lead_status: null,
      created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01') };
    const prisma = {
      contacts: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([row]) },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    };
    const result = await new CrmService(prisma as never, {} as never)
      .listContacts({ area: 'pam', q: '@ana_mali' });
    expect(result.items[0]).toMatchObject({ phone: null,
      whatsapp_user_id: 'PE.987', wa_username: 'ana_mali' });
    expect(prisma.contacts.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ area: { in: ['pam'] }, AND: expect.arrayContaining([
        expect.objectContaining({ OR: expect.arrayContaining([
          expect.objectContaining({ conversations: { some: {
            wa_username: { contains: 'ana_mali', mode: 'insensitive' },
          } } }),
        ]) }),
      ]) }),
    }));
  });

  it('pagina contactos de las tres áreas en una sola consulta y conserva el área de cada fila', async () => {
    const rows = [
      { id: 9, area: 'educacion_ca', name: 'Ana', last_name: '', phone: '51911',
        whatsapp_user_id: 'PE.123', conversations: [{ wa_username: 'ana_mali' }],
        email: null, dni: null, opt_in: true, opt_in_email: false, active: true,
        contact_attributes: [], contact_segments: [], education_lead_cycles: [],
        lead_status_id: null, lead_status: null,
        created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01') },
      { id: 8, area: 'educacion_ep', name: 'Ana', last_name: '', phone: '51911',
        whatsapp_user_id: null, conversations: [],
        email: null, dni: null, opt_in: true, opt_in_email: false, active: true,
        contact_attributes: [], contact_segments: [], education_lead_cycles: [],
        lead_status_id: null, lead_status: null,
        created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01') },
    ];
    const prisma = {
      contacts: { count: jest.fn().mockResolvedValue(3), findMany: jest.fn().mockResolvedValue(rows) },
      $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    };
    const service = new CrmService(prisma as never, {} as never);

    const result = await service.listEducationContacts({ page: 2, limit: 2 });

    expect(prisma.contacts.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ area: { in: ['educacion', 'educacion_ca', 'educacion_ep'] } }),
      skip: 2,
      take: 2,
    }));
    expect(result).toMatchObject({ total: 3, page: 2, pages: 2 });
    expect(result.items.map((row) => [row.contact_id, row.area])).toEqual([
      [9, 'educacion_ca'], [8, 'educacion_ep'],
    ]);
    expect(result.items[0]).toMatchObject({
      whatsapp_user_id: 'PE.123', wa_username: 'ana_mali',
    });
    await expect(service.listEducationContacts({ area: 'pam' })).rejects.toThrow('Área de educación inválida');
  });

  it('solo registra un chat orgánico si no hay otro origen atribuible', async () => {
    const firstSeen = new Date('2026-01-03T10:00:00Z');
    const seenAt = new Date('2026-01-05T10:00:00Z');
    const findFirst = jest.fn().mockResolvedValueOnce({ id: 1, contact_id: 10,
      channel: 'meta_lead_form', source_key: null, source_label: 'Formulario',
      last_seen_at: seenAt }).mockResolvedValueOnce(null);
    const firstInbound = jest.fn().mockImplementation(({ orderBy }) =>
      Promise.resolve(orderBy?.id ? { id: 3 } : { created_at: firstSeen }));
    const recordInbound = jest.fn();
    const service = new LeadsService({
      contact_origins: { findFirst },
      chat_messages: { findFirst: firstInbound },
    } as never, { recordInbound } as never);
    const upsert = jest.spyOn(service, 'upsertOrigin').mockResolvedValue({
      origin_id: 5, contact_id: 10, created: true,
    });
    const input = { area: 'educacion_ep', conversationId: 20, contactId: 10,
      phone: '51911', whatsappUserId: null, seenAt };

    await service.recordEducationOrganicOrigin(input);
    expect(upsert).not.toHaveBeenCalled();
    await service.recordEducationOrganicOrigin(input);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      area: 'educacion_ep', channel: 'organic_wa', external_id: 'conversation:20',
      first_seen_at: firstSeen, last_seen_at: seenAt,
    }));
    await service.recordEducationOrganicOrigin({ ...input, area: 'pam' });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(recordInbound).toHaveBeenCalledTimes(2);
  });

  it('registra como lead orgánico una identidad BSUID sin teléfono', async () => {
    const seenAt = new Date('2026-09-24T10:00:00Z');
    const service = new LeadsService({
      contact_origins: { findFirst: jest.fn().mockResolvedValue(null) },
      chat_messages: { findFirst: jest.fn().mockResolvedValue({ created_at: seenAt }) },
    } as never, { recordInbound: jest.fn() } as never);
    const upsert = jest.spyOn(service, 'upsertOrigin').mockResolvedValue({
      origin_id: 9, contact_id: 11, created: true,
    });

    await service.recordEducationOrganicOrigin({
      area: 'educacion_ca', conversationId: 42, contactId: null,
      phone: null, whatsappUserId: 'PE.13491208655302741918',
      name: 'ponce.de.leon08', seenAt, messageId: 123,
    });

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      channel: 'organic_wa', phone: null,
      whatsapp_user_id: 'PE.13491208655302741918',
      contact: expect.objectContaining({
        whatsapp_user_id: 'PE.13491208655302741918',
      }),
    }));
  });
});
