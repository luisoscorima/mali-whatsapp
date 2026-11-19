import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('cycle shadow outbox migration', () => {
  it('preserves existing rows and atomically records stage, assignment and closure', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite();
    try {
      await db.exec(`CREATE TABLE education_lead_cycles (
        id serial PRIMARY KEY, contact_id int, area text, program_id int,
        lead_status_id int, assigned_user_id int, closed_at timestamptz,
        close_reason text, updated_at timestamptz);
        INSERT INTO education_lead_cycles (contact_id, area) VALUES (10, 'educacion');`);
      await db.exec(readFileSync(resolve('prisma/migrations/20261118150000_commercial_channel_outbox/migration.sql'), 'utf8'));
      await db.exec(readFileSync(resolve('prisma/migrations/20261120010000_cycle_shadow_outbox_trigger/migration.sql'), 'utf8'));
      const count = async () => (await db.query<{ n: number }>('SELECT count(*)::int AS n FROM commercial_channel_outbox')).rows[0].n;
      expect(await count()).toBe(0); // no backfill or historical mutation
      await db.exec('UPDATE education_lead_cycles SET lead_status_id=2 WHERE id=1');
      await db.exec('UPDATE education_lead_cycles SET assigned_user_id=7 WHERE id=1');
      await db.exec("UPDATE education_lead_cycles SET closed_at=now(), close_reason='paid' WHERE id=1");
      expect(await count()).toBe(3);
      await db.exec('UPDATE education_lead_cycles SET updated_at=now(), lead_status_id=2 WHERE id=1');
      expect(await count()).toBe(3);
      await db.exec('BEGIN; UPDATE education_lead_cycles SET assigned_user_id=9 WHERE id=1; ROLLBACK;');
      expect(await count()).toBe(3);
      const row = (await db.query<{ assigned_user_id: number }>('SELECT assigned_user_id FROM education_lead_cycles WHERE id=1')).rows[0];
      expect(row.assigned_user_id).toBe(7);
      await db.exec("INSERT INTO education_lead_cycles (contact_id, area) VALUES (11, 'educacion')");
      expect(await count()).toBe(4);
      const unique = (await db.query<{ n: number }>('SELECT count(DISTINCT event_id)::int AS n FROM commercial_channel_outbox')).rows[0].n;
      expect(unique).toBe(4);
    } finally { await db.close(); }
  }, 60000);
});
