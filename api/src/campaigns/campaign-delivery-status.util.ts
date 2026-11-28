import type { PrismaService } from '../prisma/prisma.service';

type DeliveryStatusPrisma = Pick<PrismaService, '$executeRaw' | '$queryRaw'>;

const FAILURE_STATUSES = ['failed', 'undelivered'] as const;

export function isCampaignDeliveryFailureStatus(
  status: string | null | undefined,
): boolean {
  return (FAILURE_STATUSES as readonly string[]).includes(
    String(status ?? '')
      .trim()
      .toLowerCase(),
  );
}

export function requireCampaignAcceptedMessageId(response: unknown): string {
  const payload =
    response && typeof response === 'object' && !Array.isArray(response)
      ? (response as Record<string, unknown>)
      : null;
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const first =
    messages[0] &&
    typeof messages[0] === 'object' &&
    !Array.isArray(messages[0])
      ? (messages[0] as Record<string, unknown>)
      : null;
  const id = typeof first?.id === 'string' ? first.id.trim() : '';
  if (!id) {
    throw new Error(
      'WhatsApp respondió sin wamid; el envío no puede marcarse sent',
    );
  }
  return id;
}

/**
 * Aplica un webhook de entrega sin permitir que un evento tardio convierta un
 * fallo terminal del mismo wamid en sent/delivered/read.
 */
export async function applyCampaignDeliveryWebhook(
  prisma: DeliveryStatusPrisma,
  messageId: string,
  mappedStatus: string,
  status: Record<string, unknown>,
): Promise<void> {
  const terminalFailure = isCampaignDeliveryFailureStatus(mappedStatus);
  const statusJson = JSON.stringify(status);

  // Un solo statement mantiene log y chat en la misma transacción implícita.
  // Orden normal: pending < sent < delivered < read. failed es terminal.
  await prisma.$executeRaw`
    WITH updated_campaign_logs AS (
      UPDATE campaign_logs
      SET status = ${mappedStatus},
          response = COALESCE(response, '{}'::jsonb) || ${statusJson}::jsonb
      WHERE whatsapp_message_id = ${messageId}
        AND (
          ${terminalFailure}
          OR LOWER(TRIM(COALESCE(status, ''))) NOT IN ('failed', 'undelivered')
        )
      RETURNING id
    )
    UPDATE chat_messages
    SET raw_payload = COALESCE(raw_payload, '{}'::jsonb)
      || jsonb_build_object('delivery_status', ${statusJson}::jsonb)
    WHERE wa_message_id = ${messageId}
      AND (
        ${terminalFailure}
        OR (
          LOWER(COALESCE(
            raw_payload->'delivery_status'->>'status',
            raw_payload->>'status',
            ''
          )) NOT IN ('failed', 'undelivered')
          AND CASE LOWER(COALESCE(
                raw_payload->'delivery_status'->>'status',
                raw_payload->>'status',
                ''
              ))
                WHEN 'read' THEN 4
                WHEN 'delivered' THEN 3
                WHEN 'sent' THEN 2
                WHEN 'accepted' THEN 2
                WHEN 'pending' THEN 1
                ELSE 0
              END
              < CASE ${mappedStatus}
                  WHEN 'read' THEN 4
                  WHEN 'delivered' THEN 3
                  WHEN 'sent' THEN 2
                  WHEN 'accepted' THEN 2
                  ELSE 1
                END
        )
      )
  `;
}

/**
 * Resuelve atómicamente un retry que ya tiene wamid. El UPDATE sobre el log
 * serializa contra el webhook: si cualquiera gana la carrera con failed, el
 * resultado final no puede volver a sent.
 */
export async function settleExistingCampaignWaWithoutResend(
  prisma: DeliveryStatusPrisma,
  input: {
    logId: number;
    waMessageId: string;
    nextAttempt: number;
  },
): Promise<'failed' | 'sent'> {
  const rows = await prisma.$queryRaw<{ status: string }[]>`
    UPDATE campaign_logs cl
    SET status = CASE
          WHEN LOWER(TRIM(COALESCE(cl.status, ''))) IN ('failed', 'undelivered')
            OR LOWER(TRIM(COALESCE(cl.response->>'status', ''))) IN ('failed', 'undelivered')
            OR EXISTS (
              SELECT 1
              FROM chat_messages m
              WHERE m.wa_message_id = ${input.waMessageId}
                AND LOWER(TRIM(COALESCE(
                  m.raw_payload->'delivery_status'->>'status',
                  m.raw_payload->>'status',
                  ''
                ))) IN ('failed', 'undelivered')
            )
          THEN 'failed'
          ELSE 'sent'
        END,
        whatsapp_message_id = ${input.waMessageId},
        attempt = ${input.nextAttempt},
        retryable = FALSE,
        last_retry_at = NOW()
    WHERE cl.id = ${input.logId}
    RETURNING status
  `;

  const status = String(rows[0]?.status || '')
    .trim()
    .toLowerCase();
  if (!status) {
    throw new Error(
      `Campaign log ${input.logId} no encontrado al resolver wamid`,
    );
  }
  return isCampaignDeliveryFailureStatus(status) ? 'failed' : 'sent';
}
