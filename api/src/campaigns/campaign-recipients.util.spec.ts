import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import {
  countRecipientsUnion,
  fetchRecipientsUnion,
  RecipientFilterOptions,
} from './campaign-recipients.util';
import { CampaignSenderService } from './campaign-sender.service';
import { CampaignsService } from './campaigns.service';

// Ejecuta el SQL de producción en PostgreSQL en memoria, sin DATABASE_URL.
describe('audiencia de campañas por área y categoría', () => {
  let db: PGlite;
  const prisma = {
    $queryRaw: async <T>(query: Prisma.Sql): Promise<T> =>
      (await db.query(query.text, query.values)).rows as T,
    segment_definitions: { findMany: jest.fn() },
  };

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE business_programs (id int PRIMARY KEY, slug text);
      CREATE TABLE contacts (id int PRIMARY KEY, person_id int NOT NULL, area text,
        name text, phone text, whatsapp_user_id text, email text, dni text,
        active boolean DEFAULT true, opt_in boolean DEFAULT true);
      CREATE TABLE segment_definitions (area text, slug text, program_id int);
      CREATE TABLE contact_segments (contact_id int, area text, segment_slug text, program_id int);
      CREATE TABLE conversations (contact_id int, area text, last_user_message_at timestamptz);
      INSERT INTO business_programs VALUES (10, 'ca'), (20, 'ep');
      INSERT INTO contacts (id,person_id,area,name,phone) VALUES
        (1,1,'educacion','General','1'), (2,2,'educacion','CA','2'),
        (3,3,'educacion','EP','3'), (4,4,'educacion','Compartido','4'),
        (5,4,'educacion','Otra ficha misma persona','4'),
        (6,6,'pam','PAM','6'), (7,7,'patronato','Patronato','7'),
        (8,8,'ti','TI','8'), (9,9,'educacion','Sin consentimiento','9'),
        (10,10,'educacion','Inactivo','10'), (11,11,'educacion','Sin identidad',NULL),
        (12,12,'educacion','Asignación sin definición','12');
      UPDATE contacts SET opt_in = false WHERE id=9;
      UPDATE contacts SET active = false WHERE id=10;
      INSERT INTO segment_definitions VALUES
        ('educacion','interesados',NULL), ('educacion','interesados',10),
        ('educacion','interesados',20), ('educacion','excluir',NULL),
        ('educacion','excluir',10), ('educacion','excluir',20),
        ('pam','interesados',NULL), ('patronato','interesados',NULL), ('ti','interesados',NULL);
      INSERT INTO contact_segments VALUES
        (1,'educacion','interesados',NULL), (2,'educacion','interesados',10),
        (3,'educacion','interesados',20), (4,'educacion','interesados',10),
        (4,'educacion','interesados',20), (5,'educacion','interesados',20),
        (2,'educacion','excluir',20), (3,'educacion','excluir',NULL),
        (4,'educacion','excluir',10),
        (6,'pam','interesados',NULL), (7,'patronato','interesados',NULL), (8,'ti','interesados',NULL),
        (9,'educacion','interesados',10), (10,'educacion','interesados',10),
        (11,'educacion','interesados',10), (12,'educacion','interesados',999);
      INSERT INTO conversations VALUES (2,'educacion',NOW());
    `);
  }, 30000);

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(() => {
    prisma.segment_definitions.findMany.mockReset().mockResolvedValue([
      { slug: 'interesados' },
    ]);
  });

  async function expectAudience(
    area: string,
    options: RecipientFilterOptions,
    ids: number[],
  ) {
    const rows = await fetchRecipientsUnion(
      prisma,
      area,
      ['interesados'],
      options,
    );
    expect(rows.map((row) => row.id)).toEqual(ids);
    expect(
      await countRecipientsUnion(prisma, area, ['interesados'], options),
    ).toBe(ids.length);
  }

  it.each([
    [['general'], [1]],
    [['ca'], [2, 4]],
    [['ep'], [3, 4]],
    [
      ['ca', 'ep'],
      [2, 3, 4],
    ],
    [
      ['general', 'ep'],
      [1, 3, 4],
    ],
    [null, [1, 2, 3, 4]],
    [['desconocida'], []],
  ])(
    'resuelve categorías %j sin mezclar slugs ni duplicar personas',
    async (categories, ids) => {
      await expectAudience(
        'educacion',
        { categories: categories as string[] | null },
        ids as number[],
      );
    },
  );

  it.each([
    ['pam', 6],
    ['patronato', 7],
    ['ti', 8],
  ])('conserva el área %s', async (area, id) => {
    await expectAudience(area as string, { categories: null }, [
      id as number,
    ]);
  });

  it('mantiene los alias como categorías de la ficha canónica', async () => {
    await expectAudience('educacion_ca', { categories: ['ep'] }, [2, 4]);
    await expectAudience('educacion_ep', {}, [3, 4]);
  });

  it('aplica exclusiones solamente dentro de las categorías elegidas', async () => {
    await expectAudience(
      'educacion',
      { categories: ['ca'], excludeSegmentSlugs: ['excluir'] },
      [2],
    );
    await expectAudience(
      'educacion',
      { categories: ['ep'], excludeSegmentSlugs: ['excluir'] },
      [3, 4],
    );
    await expectAudience(
      'educacion',
      { categories: ['ca', 'ep'], excludeSegmentSlugs: ['excluir'] },
      [3],
    );
  });

  it('intersecta IDs explícitos con categoría y respeta exclusiones y ventana', async () => {
    await expectAudience(
      'educacion',
      { categories: ['ca'], contactIds: [1, 2, 3] },
      [2],
    );
    await expectAudience(
      'educacion',
      { categories: ['ca'], excludeContactIds: [4] },
      [2],
    );
    await expectAudience(
      'educacion',
      { categories: ['ca'], excludeOpenServiceWindow: true },
      [4],
    );
  });

  it('la previsualización usa el catálogo y la misma consulta filtrada', async () => {
    const service = new CampaignsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const result = await service.previewRecipients(
      'educacion',
      { segments: ['interesados'] },
      ['ca'],
    );
    expect(result.contacts.map((row) => row.id)).toEqual([2, 4]);
    expect(prisma.segment_definitions.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          area: 'educacion',
          active: true,
          program: { slug: { in: ['ca'] } },
        },
      }),
    );
  });

  it('el worker conserva el filtro guardado al reconstruir la audiencia', async () => {
    const sender = new CampaignSenderService(
      prisma as never,
      {} as never,
      {} as never,
    );
    const rows = await sender['buildCampaignRecipients']('educacion', {
      area: 'educacion',
      categories: ['ep'],
      segments: ['interesados'],
      recipientContactIds: [1, 2, 3, 4],
    } as never);
    expect(rows.map((row) => row.id)).toEqual([3, 4]);
  });

  it.each(['now', 'scheduled'])(
    'guarda categorías y audiencia para %s',
    async (scheduleMode) => {
      const create = jest.fn().mockResolvedValue({ id: 77 });
      const enqueueSendJob = jest.fn();
      const service = new CampaignsService(
        {
          ...prisma,
          campaigns: { create },
          whatsapp_lines: {
            findFirst: jest.fn().mockResolvedValue({
              id: 55,
              program_id: 20,
              waba_id: 9,
              program: { slug: 'ep' },
            }),
          },
          whatsapp_templates: {
            findFirst: jest.fn().mockResolvedValue({
              id: 1,
              name: 'saludo',
              language: 'es',
              category: 'MARKETING',
              status: 'APPROVED',
              components_json: [{ type: 'BODY', text: 'Hola' }],
              placeholder_aliases_json: null,
            }),
          },
          users: { findUnique: jest.fn().mockResolvedValue(null) },
        } as never,
        { enqueueSendJob } as never,
        {} as never,
        { write: jest.fn() } as never,
      );
      await service.sendCampaign(
        { id: 1, area: 'educacion' } as never,
        {
          segment: 'interesados',
          templateSyncId: 1,
          whatsappLineId: 55,
          scheduleMode,
          scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        },
        ['ep'],
      );
      const payload = create.mock.calls[0][0].data.campaign_payload;
      expect(payload.categories).toEqual(['ep']);
      expect(payload.recipientContactIds).toEqual([3, 4]);
      if (scheduleMode === 'now')
        expect(enqueueSendJob).toHaveBeenCalledWith(77, payload);
      else expect(enqueueSendJob).not.toHaveBeenCalled();
    },
  );
});
