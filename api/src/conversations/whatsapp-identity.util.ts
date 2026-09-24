/** BSUID is the strongest match. A conflicting phone must never merge records. */
export function chooseWhatsAppIdentityMatch<T extends { id: number; whatsapp_user_id?: string | null }>(
  byUserId: T | null,
  byPhone: T | null,
  incomingUserId?: string | null,
): { match: T | null; conflict: boolean } {
  if (incomingUserId && byPhone?.whatsapp_user_id && byPhone.whatsapp_user_id !== incomingUserId) {
    return { match: byUserId, conflict: true };
  }
  return {
    match: byUserId ?? byPhone,
    conflict: Boolean(byUserId && byPhone && byUserId.id !== byPhone.id),
  };
}
