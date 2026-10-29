import { Prisma } from '@prisma/client';

/** Project commercial ownership only to this person's chats in the lead category. */
export async function projectLeadAssignee(
  tx: Prisma.TransactionClient,
  cycleId: number,
  userId: number,
  at: Date,
  onlyUnassigned = false,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE conversations c
    SET assigned_user_id = ${userId}, assigned_at = ${at}, updated_at = ${at}
    FROM education_lead_cycles lead
    WHERE lead.id = ${cycleId} AND lead.closed_at IS NULL
      AND c.business_area_id = lead.business_area_id
      AND EXISTS (SELECT 1 FROM contacts ct
        WHERE ct.id = c.contact_id AND ct.person_id = lead.person_id)
      AND (
        (lead.program_id IS NULL AND c.whatsapp_line_id IS NULL)
        OR EXISTS (SELECT 1 FROM whatsapp_lines line
          WHERE line.id = c.whatsapp_line_id
            AND line.business_area_id = lead.business_area_id
            AND line.program_id IS NOT DISTINCT FROM lead.program_id)
      )
      AND (${onlyUnassigned} = FALSE OR c.assigned_user_id IS NULL)
  `;
}

/** Call in the same transaction as the cycle closure. Preserve every historical link. */
export async function endLeadConversationLinks(
  tx: Prisma.TransactionClient,
  cycleId: number,
  at: Date,
): Promise<number> {
  return tx.$executeRaw`
    UPDATE education_lead_conversation_links
    SET unlinked_at = GREATEST(linked_at, ${at})
    WHERE cycle_id = ${cycleId} AND unlinked_at IS NULL
  `;
}

/** PostgreSQL aborts a transaction on uniqueness errors; recover the savepoint first. */
export async function withLeadCreateSavepoint<T>(
  tx: Prisma.TransactionClient,
  create: () => Promise<T>,
): Promise<T> {
  await tx.$executeRaw`SAVEPOINT lead_cycle_create`;
  try {
    const result = await create();
    await tx.$executeRaw`RELEASE SAVEPOINT lead_cycle_create`;
    return result;
  } catch (error) {
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT lead_cycle_create`;
    await tx.$executeRaw`RELEASE SAVEPOINT lead_cycle_create`;
    throw error;
  }
}
