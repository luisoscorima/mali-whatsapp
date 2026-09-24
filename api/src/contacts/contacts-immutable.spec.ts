import { ContactsService } from './contacts.service';

describe('Contact phone identity', () => {
  it('rejects replacing an existing phone before mutating contact or conversations', async () => {
    const prisma = {
      contacts: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7, area: 'ti', name: 'Ana', last_name: '',
          phone: '51911111111', whatsapp_user_id: null,
        }),
        update: jest.fn(),
      },
      segment_definitions: { findMany: jest.fn().mockResolvedValue([{ slug: 'clientes' }]) },
      conversations: { updateMany: jest.fn() },
    };
    const service = new ContactsService(prisma as never, {} as never);
    await expect(service.update(
      { area: 'ti' } as never,
      7,
      { name: 'Ana', phone: '51922222222', segments: ['clientes'] },
    )).rejects.toThrow('El teléfono no se puede cambiar');
    expect(prisma.contacts.update).not.toHaveBeenCalled();
    expect(prisma.conversations.updateMany).not.toHaveBeenCalled();
  });
});
