export const SALIDA_OK_STATUSES = ['sent', 'delivered', 'read'] as const;
export const ERROR_STATUSES = ['error', 'failed', 'undelivered'] as const;

export const CAMPAIGN_LOG_STATUS_SQL = `LOWER(TRIM(COALESCE(cl.status, '')))`;

export function sqlInList(statuses: readonly string[]): string {
  return `(${statuses.map((s) => `'${s}'`).join(', ')})`;
}

export function campaignLogStatusColumnSql(column = 'status'): string {
  return `LOWER(TRIM(COALESCE(${column}, '')))`;
}

export function sqlCampaignLogIsError(column = 'status'): string {
  return `${campaignLogStatusColumnSql(column)} IN ${sqlInList(ERROR_STATUSES)}`;
}

export function sqlCampaignLogIsSalidaOk(column = 'status'): string {
  return `${campaignLogStatusColumnSql(column)} IN ${sqlInList(SALIDA_OK_STATUSES)}`;
}

/**
 * Ya hay un outbound de esta campaña en chat (Meta aceptó / se persistió).
 * Evita reintentos que generan un segundo wamid aunque el log figure en error.
 */
export function sqlNoSuccessfulCampaignChatForPhone(
  outerAlias = 'cl',
): string {
  return `NOT EXISTS (
    SELECT 1
    FROM chat_messages m
    INNER JOIN conversations conv ON conv.id = m.conversation_id
    WHERE conv.phone = ${outerAlias}.phone
      AND m.direction = 'outbound'
      AND m.message_type = 'campaign'
      AND NULLIF(BTRIM(m.raw_payload->>'campaign_id'), '') ~ '^[0-9]+$'
      AND (m.raw_payload->>'campaign_id')::int = ${outerAlias}.campaign_id
      AND m.wa_message_id IS NOT NULL
  )`;
}

export function normalizeLogStatus(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function isSalidaOkStatus(status: unknown): boolean {
  return (SALIDA_OK_STATUSES as readonly string[]).includes(
    normalizeLogStatus(status),
  );
}

export function isErrorStatus(status: unknown): boolean {
  return (ERROR_STATUSES as readonly string[]).includes(
    normalizeLogStatus(status),
  );
}
