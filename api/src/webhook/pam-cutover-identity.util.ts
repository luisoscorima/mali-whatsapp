import { Prisma } from '@prisma/client';
import type { ResolvedWhatsAppLine } from '../meta-settings/meta-settings.store';
import type { MetaWebhookContact } from './webhook.types';

const OLD_PAM_PHONE_ID = '1139890925881358';
const NEW_PAM_PHONE_ID = '1441307959065007';
const NEW_PAM_WABA_ID = '3141752249499039';

export async function rebindPamCutoverIdentity(
  db: Pick<Prisma.TransactionClient, '$queryRaw'>,
  inbound: {
    area: string;
    metadataPhoneId: string | undefined;
    line: ResolvedWhatsAppLine | null;
    record: Record<string, unknown>;
    contacts: MetaWebhookContact[] | undefined;
    phone: string | null;
    userId: string | null;
  },
): Promise<{ contactId: number; reboundChatId?: number } | null> {
  const { area, metadataPhoneId, line, record, contacts, phone, userId } =
    inbound;
  if (
    area !== 'pam' ||
    metadataPhoneId !== NEW_PAM_PHONE_ID ||
    line?.canonicalArea !== 'pam' ||
    line.wabaId !== NEW_PAM_WABA_ID ||
    !userId
  ) {
    return null;
  }

  let identityMatch: Prisma.Sql | null = null;
  const canRebind =
    record.from_user_id === userId &&
    record.type !== 'system' &&
    record.type !== 'reaction';
  if (canRebind && phone && record.from === phone) {
    identityMatch = Prisma.sql`
      c.phone = ${phone} AND ct.phone = ${phone}
      AND old_message.raw_payload->>'from' = ${phone}
    `;
  } else if (canRebind && !phone) {
    // The username can change. Require an exact reply to a message sent from
    // the historical chat on the new PAM number as corroboration.
    const username = contacts
      ?.find((contact) => contact.user_id === userId)
      ?.profile?.username?.trim()
      .replace(/^@/, '')
      .toLowerCase();
    const replyId = (record.context as { id?: unknown } | undefined)?.id;
    if (username && typeof replyId === 'string' && replyId) {
      identityMatch = Prisma.sql`
      lower(c.wa_username) = ${username}
      AND EXISTS (
        SELECT 1 FROM chat_messages reply
        WHERE reply.wa_message_id = ${replyId}
          AND reply.conversation_id = c.id
          AND reply.direction = 'outbound'
          AND reply.raw_payload #>> '{_mali_routing,phone_number_id}' = ${NEW_PAM_PHONE_ID}
      )
    `;
    }
  }

  if (identityMatch) {
    try {
      // A write to contacts.whatsapp_user_id is projected onto the shared person
      // and their other areas. Keep this migration-specific binding in PAM's chat.
      const rows = await db.$queryRaw<
        { id: number; contact_id: number }[]
      >(Prisma.sql`
      WITH historical AS (
        SELECT c.id, c.whatsapp_user_id AS old_user_id
        FROM conversations c
        JOIN contacts ct ON ct.id = c.contact_id
        WHERE c.area = 'pam' AND c.whatsapp_line_id = ${line.id}
          AND c.whatsapp_phone_number_id = ${NEW_PAM_PHONE_ID}
          AND ct.area = 'pam' AND ct.active
          AND ct.whatsapp_user_id = c.whatsapp_user_id
          AND c.whatsapp_user_id <> ${userId}
          AND EXISTS (
            SELECT 1 FROM chat_messages old_message
            WHERE old_message.conversation_id = c.id
              AND old_message.direction = 'inbound'
              AND old_message.raw_payload->>'from_user_id' = c.whatsapp_user_id
              AND old_message.raw_payload #>> '{_mali_routing,phone_number_id}' = ${OLD_PAM_PHONE_ID}
              AND (${identityMatch})
          )
          AND NOT EXISTS (
            SELECT 1 FROM chat_messages current_message
            WHERE current_message.conversation_id = c.id
              AND current_message.direction = 'inbound'
              AND current_message.raw_payload->>'from_user_id' = c.whatsapp_user_id
              AND current_message.raw_payload #>> '{_mali_routing,phone_number_id}' = ${NEW_PAM_PHONE_ID}
          )
          AND NOT EXISTS (
            SELECT 1 FROM contacts claimed
            WHERE claimed.area = 'pam' AND claimed.whatsapp_user_id = ${userId}
          )
          AND NOT EXISTS (
            SELECT 1 FROM conversations claimed
            WHERE claimed.whatsapp_line_id = ${line.id} AND claimed.whatsapp_user_id = ${userId}
          )
        FOR UPDATE OF c
      ), rebound_chat AS (
        UPDATE conversations c
        SET whatsapp_user_id = ${userId}, updated_at = now()
        FROM historical
        WHERE c.id = historical.id
        RETURNING c.id, c.business_area_id, c.contact_id, historical.old_user_id
      ), recorded AS (
        INSERT INTO whatsapp_identity_events
          (business_area_id, area, event_type, previous_user_id, new_user_id, raw_payload)
        SELECT business_area_id, 'pam', 'pam_cutover_rebind', old_user_id, ${userId},
               jsonb_build_object('conversation_id', id, 'contact_id', contact_id)
        FROM rebound_chat
      )
      SELECT id, contact_id FROM rebound_chat
    `);
      if (rows[0]) {
        return { contactId: rows[0].contact_id, reboundChatId: rows[0].id };
      }
    } catch (error) {
      // Another webhook may claim the ID before this statement finishes.
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2010' ||
        error.meta?.code !== '23505'
      ) {
        throw error;
      }
    }
  }

  // A fresh statement also sees bindings committed by a concurrent delivery.
  const rows = await db.$queryRaw<{ contact_id: number }[]>(Prisma.sql`
    SELECT c.contact_id
    FROM conversations c
    JOIN contacts ct ON ct.id = c.contact_id AND ct.area = 'pam' AND ct.active
    WHERE c.area = 'pam' AND c.whatsapp_line_id = ${line.id}
      AND c.whatsapp_user_id = ${userId}
      AND EXISTS (
        SELECT 1 FROM whatsapp_identity_events event
        WHERE event.area = 'pam' AND event.event_type = 'pam_cutover_rebind'
          AND event.new_user_id = ${userId}
          AND event.raw_payload @> jsonb_build_object('conversation_id', c.id, 'contact_id', ct.id)
      )
  `);
  return rows[0] ? { contactId: rows[0].contact_id } : null;
}
