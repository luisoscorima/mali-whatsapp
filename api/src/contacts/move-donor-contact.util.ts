import type { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Reapunta FKs del donor al keep y elimina filas hijas exclusivas del donor. */
export async function moveDonorOntoKeep(
  tx: Tx,
  donorId: number,
  keepId: number,
): Promise<void> {
  await tx.$executeRaw`UPDATE conversations SET contact_id = ${keepId}, updated_at = NOW() WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`UPDATE campaign_logs SET contact_id = ${keepId} WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`UPDATE contact_origins SET contact_id = ${keepId}, updated_at = NOW() WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`UPDATE meta_leadgen_leads SET contact_id = ${keepId}, updated_at = NOW() WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`UPDATE tiktok_leads SET contact_id = ${keepId}, updated_at = NOW() WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`UPDATE meta_ctwa_ad_leads SET contact_id = ${keepId} WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`
    UPDATE education_lead_entries entry
    SET cycle_id = winner.id
    FROM education_lead_cycles loser
    JOIN education_lead_cycles winner
      ON winner.contact_id = ${keepId} AND winner.started_at = loser.started_at
    WHERE loser.contact_id = ${donorId} AND entry.cycle_id = loser.id
  `;
  await tx.$executeRaw`
    DELETE FROM education_lead_cycles loser
    USING education_lead_cycles winner
    WHERE loser.contact_id = ${donorId}
      AND winner.contact_id = ${keepId}
      AND winner.started_at = loser.started_at
  `;
  await tx.$executeRaw`
    UPDATE education_lead_cycles SET contact_id = ${keepId}, updated_at = NOW() WHERE contact_id = ${donorId}
  `;
  await tx.$executeRaw`UPDATE education_lead_entries SET contact_id = ${keepId} WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`
    INSERT INTO contact_attributes (contact_id, attr_key, attr_value, program_id, updated_at)
    SELECT ${keepId}, src.attr_key, src.attr_value, src.program_id, src.updated_at
    FROM contact_attributes src
    WHERE src.contact_id = ${donorId}
      AND NOT EXISTS (
        SELECT 1 FROM contact_attributes existing
        WHERE existing.contact_id = ${keepId}
          AND existing.attr_key = src.attr_key
          AND existing.program_id IS NOT DISTINCT FROM src.program_id
      )
  `;
  await tx.$executeRaw`DELETE FROM contact_attributes WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`
    INSERT INTO contact_segments (contact_id, area, segment_slug, program_id, created_at)
    SELECT ${keepId}, src.area, src.segment_slug, src.program_id, src.created_at
    FROM contact_segments src
    WHERE src.contact_id = ${donorId}
      AND NOT EXISTS (
        SELECT 1 FROM contact_segments existing
        WHERE existing.contact_id = ${keepId}
          AND existing.segment_slug = src.segment_slug
          AND existing.program_id IS NOT DISTINCT FROM src.program_id
      )
  `;
  await tx.$executeRaw`DELETE FROM contact_segments WHERE contact_id = ${donorId}`;
  await tx.$executeRaw`
    INSERT INTO contact_programs (contact_id, program_id, source, first_seen_at, last_seen_at)
    SELECT ${keepId}, src.program_id, src.source, src.first_seen_at, NOW()
    FROM contact_programs src
    WHERE src.contact_id = ${donorId}
    ON CONFLICT (contact_id, program_id) DO NOTHING
  `;
  await tx.$executeRaw`DELETE FROM contact_programs WHERE contact_id = ${donorId}`;
}

/** Tras moveDonorOntoKeep: borra el donor y people huérfanos. */
export async function deleteDonorContact(tx: Tx, donorId: number): Promise<void> {
  const mapExists = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT to_regclass('public.education_consolidation_map') IS NOT NULL AS ok
  `;
  if (mapExists[0]?.ok) {
    await tx.$executeRaw`
      DELETE FROM education_consolidation_map WHERE contact_id = ${donorId}
    `;
  }
  await tx.$executeRaw`DELETE FROM contacts WHERE id = ${donorId}`;
  await tx.$executeRaw`
    DELETE FROM people person
    WHERE NOT EXISTS (SELECT 1 FROM contacts contact WHERE contact.person_id = person.id)
  `;
}
