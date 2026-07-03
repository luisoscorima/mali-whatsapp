export function splitPhoneForForm(phone: string): {
  prefix: string
  local: string
} {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.startsWith('51') && /^9[0-9]{8}$/.test(digits.slice(2))) {
    return { prefix: '51', local: digits.slice(2) }
  }
  return { prefix: '51', local: digits }
}
