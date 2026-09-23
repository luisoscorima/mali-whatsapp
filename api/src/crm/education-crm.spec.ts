import { CrmService } from './crm.service';
import { LeadsService } from '../leads/leads.service';

describe('CRM Educación', () => {
  it('pagina contactos de las tres áreas en una sola consulta y conserva el área de cada fila', async () => {
    const rows = [
      { id: 9, area: 'educacion_ca', name: 'Ana', last_name: '', phone: '51911',
        email: null, dni: null, opt_in: true, opt_in_email: false, active: true,
        contact_attributes: [], contact_segments: [],
        created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01') },
      { id: 8, area: 'educacion_ep', name: 'Ana', last_name: '', phone: '51911',
        email: null, dni: null, opt_in: true, opt_in_email: false, active: true,
        contact_attributes: [], contact_segments: [],
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
    await expect(service.listEducationContacts({ area: 'pam' })).rejects.toThrow('Área de educación inválida');
  });

  it('solo registra un chat orgánico si no hay otro origen atribuible', async () => {
    const findFirst = jest.fn().mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null);
    const firstSeen = new Date('2026-01-03T10:00:00Z');
    const seenAt = new Date('2026-01-05T10:00:00Z');
    const firstInbound = jest.fn().mockResolvedValue({ created_at: firstSeen });
    const service = new LeadsService({
      contact_origins: { findFirst },
      chat_messages: { findFirst: firstInbound },
    } as never);
    const upsert = jest.spyOn(service, 'upsertOrigin').mockResolvedValue({
      origin_id: 5, contact_id: 10, created: true,
    });
    const input = { area: 'educacion_ep', conversationId: 20, contactId: 10, phone: '51911', seenAt };

    await service.recordEducationOrganicOrigin(input);
    expect(upsert).not.toHaveBeenCalled();
    await service.recordEducationOrganicOrigin(input);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      area: 'educacion_ep', channel: 'organic_wa', external_id: 'conversation:20',
      first_seen_at: firstSeen, last_seen_at: seenAt,
    }));
    await service.recordEducationOrganicOrigin({ ...input, area: 'pam' });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
