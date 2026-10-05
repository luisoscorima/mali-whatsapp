/**
 * Identidades complementarias: un contacto solo-BSUID y otro solo-phone
 * (misma área). Se pueden fusionar con seguridad. BSUID gana como canónico.
 */

export type IdentityFields = {
  id: number;
  phone?: string | null;
  whatsapp_user_id?: string | null;
};

export type IdentityConflictKind = 'none' | 'hard' | 'complementary';

function hasBsuid(row: IdentityFields | null | undefined): boolean {
  return Boolean(String(row?.whatsapp_user_id ?? '').trim());
}

function hasPhone(row: IdentityFields | null | undefined): boolean {
  return Boolean(String(row?.phone ?? '').trim());
}

/** Canónico = el que tiene BSUID; drop = el que solo tiene teléfono. */
export function pickComplementaryKeepDrop<T extends IdentityFields>(
  a: T,
  b: T,
): { keep: T; drop: T } | null {
  if (a.id === b.id) return null;

  const aBsuid = hasBsuid(a);
  const bBsuid = hasBsuid(b);
  const aPhone = hasPhone(a);
  const bPhone = hasPhone(b);

  // Solo BSUID + solo phone
  if (aBsuid && !aPhone && bPhone && !bBsuid) return { keep: a, drop: b };
  if (bBsuid && !bPhone && aPhone && !aBsuid) return { keep: b, drop: a };

  // BSUID ya tiene ese mismo phone; el otro es residual solo-phone
  if (
    aBsuid &&
    aPhone &&
    bPhone &&
    !bBsuid &&
    String(a.phone).trim() === String(b.phone).trim()
  ) {
    return { keep: a, drop: b };
  }
  if (
    bBsuid &&
    bPhone &&
    aPhone &&
    !aBsuid &&
    String(b.phone).trim() === String(a.phone).trim()
  ) {
    return { keep: b, drop: a };
  }

  return null;
}

export function isComplementaryIdentityPair(
  a: IdentityFields,
  b: IdentityFields,
): boolean {
  return pickComplementaryKeepDrop(a, b) != null;
}

/**
 * BSUID is the strongest match.
 * - complementary: dos contactos/convs distintos pero identidades huecas → mergeable
 * - hard: colisión real (p. ej. phone ya ligado a otro BSUID)
 */
export function chooseWhatsAppIdentityMatch<T extends IdentityFields>(
  byUserId: T | null,
  byPhone: T | null,
  incomingUserId?: string | null,
): { match: T | null; conflict: IdentityConflictKind } {
  if (
    incomingUserId &&
    byPhone &&
    hasBsuid(byPhone) &&
    String(byPhone.whatsapp_user_id).trim() !== String(incomingUserId).trim()
  ) {
    return { match: byUserId, conflict: 'hard' };
  }

  if (byUserId && byPhone && byUserId.id !== byPhone.id) {
    if (isComplementaryIdentityPair(byUserId, byPhone)) {
      const pair = pickComplementaryKeepDrop(byUserId, byPhone)!;
      return { match: pair.keep, conflict: 'complementary' };
    }
    return { match: byUserId, conflict: 'hard' };
  }

  return {
    match: byUserId ?? byPhone,
    conflict: 'none',
  };
}
