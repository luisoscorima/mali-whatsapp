import { ProspectiaSyncService } from './prospectia-sync.service';

describe('Sincronización de Prospectia', () => {
  it('cuenta las filas, separa las consultas y guarda el fin', async () => {
    const entries = [
      { id: 1, area: 'educacion', contactId: 10, phone: '51911111111', username: null, whatsappUserId: null },
      { id: 2, area: 'educacion', contactId: 11, phone: '51922222222', username: null, whatsappUserId: null },
    ];
    let batch = 0;
    const workflow = {
      prospectiaSyncCount: jest.fn().mockResolvedValue(2),
      prospectiaSyncBatch: jest.fn().mockImplementation(async () => (batch++ === 0 ? entries : [])),
      applyProspectiaSnapshot: jest.fn().mockResolvedValue(undefined),
    };
    const lookedUpAt: number[] = [];
    const prospectia = {
      lookup: jest.fn().mockImplementation(async () => {
        lookedUpAt.push(Date.now());
        return { match: 'missing', advisorEmail: null };
      }),
    };
    const prisma = {
      app_settings: { upsert: jest.fn().mockResolvedValue({}) },
    };
    const service = new ProspectiaSyncService(workflow as never, prospectia as never, prisma as never);

    expect(service.start('all')).toEqual({ started: true });
    expect(service.start('all')).toEqual({ started: false });
    const started = Date.now();
    while (service.status().running && Date.now() - started < 5000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    const status = service.status();
    expect(status).toMatchObject({ running: false, processed: 2, total: 2 });
    expect(status.finished_at).toEqual(expect.any(String));
    expect(lookedUpAt).toHaveLength(2);
    expect(lookedUpAt[1] - lookedUpAt[0]).toBeGreaterThanOrEqual(450);
    expect(prisma.app_settings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ area: 'educacion', key: 'prospectia_sync_finished_at' }),
    }));
  });
});
