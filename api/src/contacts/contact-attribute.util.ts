import { Prisma } from '@prisma/client';

export async function upsertScopedAttribute(
  tx: Prisma.TransactionClient,
  contactId: number,
  attrKey: string,
  attrValue: string,
  programId: number | null = null,
): Promise<void> {
  const existing = await tx.contact_attributes.findFirst({
    where: { contact_id: contactId, attr_key: attrKey, program_id: programId },
    select: { id: true },
  });
  if (existing) {
    await tx.contact_attributes.update({
      where: { id: existing.id },
      data: { attr_value: attrValue, updated_at: new Date() },
    });
    return;
  }
  await tx.contact_attributes.create({
    data: {
      contact_id: contactId,
      attr_key: attrKey,
      attr_value: attrValue,
      program_id: programId,
    },
  });
}
