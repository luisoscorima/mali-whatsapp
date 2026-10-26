import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConversationsService } from './conversations.service';

describe('contador real de mensajes sin leer', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE conversations (id int PRIMARY KEY, inbox_unread boolean DEFAULT false);
      CREATE TABLE chat_messages (id int PRIMARY KEY, conversation_id int, direction text);
      INSERT INTO conversations VALUES (1,false), (2,true), (3,false);
    `);
    await db.exec(readFileSync(resolve(__dirname, '../../prisma/migrations/20261026040000_inbox_unread_message_count/migration.sql'), 'utf8'));
  }, 30000);
  afterAll(async () => { await db?.close(); });

  it('conserva como desconocida la cantidad histórica y empieza en cero para chats leídos', async () => {
    expect((await db.query('SELECT unread_message_count FROM conversations ORDER BY id')).rows).toEqual([
      { unread_message_count: 0 }, { unread_message_count: null }, { unread_message_count: 0 },
    ]);
  });

  it('cuenta solo entrantes nuevos, no salientes ni duplicados, y mantiene separados los hilos', async () => {
    await db.exec(`
      INSERT INTO chat_messages VALUES (1,1,'inbound'), (2,1,'inbound'), (3,1,'outbound'), (4,3,'inbound');
      INSERT INTO chat_messages VALUES (2,1,'inbound') ON CONFLICT DO NOTHING;
    `);
    expect((await db.query('SELECT id,inbox_unread,unread_message_count FROM conversations WHERE id IN (1,3) ORDER BY id')).rows).toEqual([
      { id: 1, inbox_unread: true, unread_message_count: 2 },
      { id: 3, inbox_unread: true, unread_message_count: 1 },
    ]);
  });

  it('al leer reinicia el contador; marcar no leído manualmente no inventa mensajes', async () => {
    await db.exec('UPDATE conversations SET inbox_unread=false WHERE id=1');
    await db.exec('UPDATE conversations SET inbox_unread=true WHERE id=1');
    expect((await db.query('SELECT unread_message_count FROM conversations WHERE id=1')).rows).toEqual([{ unread_message_count: 0 }]);
    await db.exec("INSERT INTO chat_messages VALUES (5,1,'inbound')");
    expect((await db.query('SELECT unread_message_count FROM conversations WHERE id=1')).rows).toEqual([{ unread_message_count: 1 }]);
  });

  it('solo da un número fiable a chats antiguos después de su primera lectura', async () => {
    await db.exec("INSERT INTO chat_messages VALUES (6,2,'inbound')");
    expect((await db.query('SELECT unread_message_count FROM conversations WHERE id=2')).rows).toEqual([{ unread_message_count: null }]);
    await db.exec('UPDATE conversations SET inbox_unread=false WHERE id=2');
    await db.exec("INSERT INTO chat_messages VALUES (7,2,'inbound')");
    expect((await db.query('SELECT unread_message_count FROM conversations WHERE id=2')).rows).toEqual([{ unread_message_count: 1 }]);
  });

  it('muestra primer nombre y primer apellido del asesor, con usuario como respaldo', async () => {
    const service = Object.create(ConversationsService.prototype) as ConversationsService;
    const sql = service['inboxAssignedUserLabelSql']();
    const result = await db.query(`SELECT ${sql.text} AS label FROM (VALUES
      ('Luis Gustavo','Pérez Ruiz','lperez@mali.pe'),
      ('','','asesor@mali.pe')) AS au(first_name,last_name,email)`, sql.values);
    expect(result.rows).toEqual([{ label: 'Luis Pérez' }, { label: 'asesor' }]);
  });
});
