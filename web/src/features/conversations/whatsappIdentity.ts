const BSUID_PATTERN = /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/

export function isWhatsAppBsuid(value: string | null): boolean {
  return BSUID_PATTERN.test(String(value ?? '').trim())
}

export function isContactPhone(value: string | null): boolean {
  return /^[1-9][0-9]{7,14}$/.test(value ?? '')
}

export function chatSecondaryLabel(phone: string | null): string {
  return phone && !isWhatsAppBsuid(phone) ? phone : 'Número privado'
}

export function chatDisplayName(input: {
  phone: string | null
  contactName?: string | null
  profileName?: string | null
  username?: string | null
}): string {
  const contactName = String(input.contactName ?? '').trim()
  if (contactName) return contactName
  const username = String(input.username ?? '').trim().replace(/^@/, '')
  if (!input.phone && username) return `@${username}`
  const profileName = String(input.profileName ?? '').trim()
  return profileName || input.phone || 'Usuario de WhatsApp'
}
