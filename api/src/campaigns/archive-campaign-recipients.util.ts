import { normalizePhone } from '../contacts/contacts-validation.utils';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Archiva manualmente (archived=true) las conversaciones del área
 * que coinciden con destinatarios de una campaña masiva.
 * No toca last_user_message_at. Idempotente si ya estaban archivadas.
 */
export async function archiveCampaignRecipientConversations(
  prisma: PrismaService,
  area: string,
  recipients: { id: number; phone: string }[],
): Promise<{ archivedCount: number; recipientCount: number }> {
  const phones = [
    ...new Set(
      recipients
        .map((r) => normalizePhone(r.phone))
        .filter((p): p is string => Boolean(p)),
    ),
  ];
  const contactIds = [
    ...new Set(
      recipients
        .map((r) => Number(r.id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];

  const recipientCount = recipients.length;
  if (!phones.length && !contactIds.length) {
    return { archivedCount: 0, recipientCount };
  }

  const or: { phone?: { in: string[] }; contact_id?: { in: number[] } }[] =
    [];
  if (phones.length) or.push({ phone: { in: phones } });
  if (contactIds.length) or.push({ contact_id: { in: contactIds } });

  const result = await prisma.conversations.updateMany({
    where: {
      area,
      archived: false,
      OR: or,
    },
    data: { archived: true, updated_at: new Date() },
  });

  return { archivedCount: result.count, recipientCount };
}
