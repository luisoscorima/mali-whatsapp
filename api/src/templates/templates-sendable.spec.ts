import { NotFoundException } from '@nestjs/common';
import { TemplatesService } from './templates.service';

describe('TemplatesService sendable templates', () => {
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const service = new TemplatesService(
    { whatsapp_templates: { findMany, findFirst } } as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists only approved and active templates in the current area', async () => {
    findMany.mockResolvedValue([
      {
        id: 7,
        name: 'reactivar_chat',
        language: 'es',
        category: 'MARKETING',
        status: 'APPROVED',
        active: true,
      },
    ]);

    await expect(service.listSendable('educacion')).resolves.toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { area: 'educacion', status: 'APPROVED', active: true },
      }),
    );
  });

  it('does not return a definition for a disabled or unapproved template', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      service.getSendableDefinition('educacion', 7),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 7,
          area: 'educacion',
          status: 'APPROVED',
          active: true,
        },
      }),
    );
  });
});
