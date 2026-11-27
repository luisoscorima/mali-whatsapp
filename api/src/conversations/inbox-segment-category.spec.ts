import { PGlite } from '@electric-sql/pglite';
import { Prisma } from '@prisma/client';
import {
  buildConversationSegmentSql,
  buildContactSegmentSql,
  parseInboxExcludeSegmentFilter,
  parseInboxSegmentFilter,
} from './inbox-query.util';
import { ConversationsService } from './conversations.service';

describe('segmentos de la bandeja por identidad y categoría', () => {
  let db: PGlite;
  const options = [
    { id: 1, slug: 'interesados' },
    { id: 2, slug: 'interesados' },
    { id: 3, slug: 'interesados' },
  ];
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE business_programs(id int, slug text);
      CREATE TABLE whatsapp_lines(id int, program_id int, program_key text);
      CREATE TABLE contacts(id int, area text);
      CREATE TABLE conversations(id int, contact_id int, whatsapp_line_id int, area text);
      CREATE TABLE segment_definitions(id int, area text, slug text, program_id int);
      CREATE TABLE contact_segments(contact_id int, area text, segment_slug text, program_id int);
      INSERT INTO business_programs VALUES(10,'ca'),(20,'ep');
      INSERT INTO whatsapp_lines VALUES(1,NULL,NULL),(2,10,'ca'),(3,20,'ep'),(4,NULL,'ca');
      INSERT INTO contacts VALUES(1,'educacion'),(2,'educacion'),(3,'pam'),(4,'patronato'),(5,'ti');
      INSERT INTO segment_definitions VALUES(1,'educacion','interesados',NULL),(2,'educacion','interesados',10),(3,'educacion','interesados',20),
        (4,'pam','interesados',NULL),(5,'patronato','interesados',NULL),(6,'ti','interesados',NULL);
      INSERT INTO contact_segments VALUES(1,'educacion','interesados',NULL),(1,'educacion','interesados',10),(1,'educacion','interesados',20),
        (3,'pam','interesados',NULL),(4,'patronato','interesados',NULL),(5,'ti','interesados',NULL);
      INSERT INTO conversations VALUES(1,1,1,'educacion'),(2,1,2,'educacion'),(3,1,3,'educacion'),(4,1,4,'educacion'),
        (5,2,2,'educacion'),(6,NULL,2,'educacion'),(7,3,NULL,'pam'),(8,4,NULL,'patronato'),(9,5,NULL,'ti');
    `);
  }, 30000);
  afterAll(async () => {
    await db?.close();
  });

  async function ids(
    tokens: string[],
    categories: string[] | null = null,
    exclude: string[] = [],
  ) {
    const filter = parseInboxSegmentFilter(tokens, options, categories);
    const excluded = parseInboxExcludeSegmentFilter(exclude, options, categories);
    filter.excludeIds = excluded.ids;
    filter.excludeSlugs = excluded.slugs;
    const sql = Prisma.sql`SELECT c.id FROM conversations c LEFT JOIN contacts ct ON ct.id=c.contact_id
      WHERE c.area='educacion' ${buildConversationSegmentSql(filter)} ORDER BY c.id`;
    return (await db.query<{ id: number }>(sql.text, sql.values)).rows.map(
      (row) => row.id,
    );
  }

  it.each([
    [['id:1'], [1]],
    [['id:2'], [2, 4]],
    [['id:3'], [3]],
    [
      ['id:2', 'id:3'],
      [2, 3, 4],
    ],
    [
      ['id:1', 'id:2', 'id:3'],
      [1, 2, 3, 4],
    ],
    [['__none__'], [5, 6]],
    [
      ['id:3', '__none__'],
      [3, 5, 6],
    ],
  ])('selección %j respeta la línea del chat', async (tokens, expected) => {
    expect(await ids(tokens as string[])).toEqual(expected);
  });

  it('conserva enlaces antiguos por slug dentro de las categorías seleccionadas', async () => {
    expect(await ids(['interesados'], ['ca'])).toEqual([2, 4]);
  });

  it.each(['id:999', 'id:0', 'id:-1', 'inexistente'])(
    'rechaza %s sin ampliar a todos los chats',
    (token) => {
      expect(() => parseInboxSegmentFilter([token], options, null)).toThrow();
    },
  );

  it.each([
    ['pam', 4, 7],
    ['patronato', 5, 8],
    ['ti', 6, 9],
  ])('mantiene aislada el área %s', async (area, id, expected) => {
    const filter = parseInboxSegmentFilter(
      [`id:${id}`],
      [{ id: Number(id), slug: 'interesados' }],
      null,
    );
    const sql = Prisma.sql`SELECT c.id FROM conversations c JOIN contacts ct ON ct.id=c.contact_id
      WHERE c.area=${area} ${buildConversationSegmentSql(filter)}`;
    expect((await db.query(sql.text, sql.values)).rows).toEqual([
      { id: expected },
    ]);
  });

  it.each([
    [['id:2'], [1, 3, 5, 6]],
    [['id:2', 'id:3'], [1, 5, 6]],
  ])('excluir %j deja fuera solo esa identidad de línea', async (exclude, expected) => {
    expect(await ids([], null, exclude as string[])).toEqual(expected);
  });

  it('un slug compartido solo excluye el programa de la categoría', async () => {
    expect(await ids([], ['ca'], ['interesados'])).toEqual([1, 3, 5, 6]);
  });

  it('la exclusión gana cuando el mismo chat también está incluido', async () => {
    expect(await ids(['id:1', 'id:2', 'id:3'], null, ['id:2'])).toEqual([1, 3]);
  });

  it('sin inclusión, un contacto sin segmento sigue en la lista', async () => {
    expect(await ids([], null, ['id:1'])).toEqual([2, 3, 4, 5, 6]);
  });

  it('rechaza excluir un segmento ajeno o «sin segmento»', () => {
    expect(() => parseInboxExcludeSegmentFilter(['id:999'], options, null)).toThrow();
    expect(() => parseInboxExcludeSegmentFilter(['__none__'], options, null)).toThrow();
  });

  it('excluye contactos virtuales y conserva los que no tienen segmento', async () => {
    const excluded = parseInboxExcludeSegmentFilter(['id:2'], options, ['ca']);
    const filter = parseInboxSegmentFilter([], options, ['ca']);
    filter.excludeIds = excluded.ids;
    filter.excludeSlugs = excluded.slugs;
    const sql = Prisma.sql`SELECT ct.id FROM contacts ct WHERE ct.area='educacion' ${buildContactSegmentSql(filter)} ORDER BY ct.id`;
    expect((await db.query(sql.text, sql.values)).rows).toEqual([{ id: 2 }]);
  });

  it('filtra contactos virtuales por la misma identidad exacta', async () => {
    const filter = parseInboxSegmentFilter(['id:2'], options, ['ca']);
    const sql = Prisma.sql`SELECT ct.id FROM contacts ct WHERE ct.area='educacion' ${buildContactSegmentSql(filter)}`;
    expect((await db.query(sql.text, sql.values)).rows).toEqual([{ id: 1 }]);
  });

  it('carga solo categorías del riel y devuelve ID y categoría', async () => {
    const findMany = jest
      .fn()
      .mockResolvedValue([
        {
          id: 2,
          slug: 'interesados',
          label: 'Interesados',
          color_key: 'teal',
          program: { slug: 'ca' },
        },
      ]);
    const service = Object.create(
      ConversationsService.prototype,
    ) as ConversationsService;
    Object.assign(service, { prisma: { segment_definitions: { findMany } } });
    expect(await service['loadSegmentOptions']('educacion_ca', ['ca'])).toEqual(
      [
        {
          id: 2,
          slug: 'interesados',
          label: 'Interesados',
          color_key: 'teal',
          category: 'ca',
        },
      ],
    );
    expect(findMany.mock.calls[0][0].where).toEqual({
      area: 'educacion',
      active: true,
      show_in_filter: true,
      program: { slug: { in: ['ca'] } },
    });
  });
});
