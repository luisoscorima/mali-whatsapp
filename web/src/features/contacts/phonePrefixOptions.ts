export type PhonePrefixOption = {
  value: string
  iso: string
  label: string
}

/** Mismos países que el widget Educación (MALI ONE). */
export const PHONE_PREFIX_OPTIONS: PhonePrefixOption[] = [
  { value: '51', iso: 'pe', label: 'Perú' },
  { value: '54', iso: 'ar', label: 'Argentina' },
  { value: '591', iso: 'bo', label: 'Bolivia' },
  { value: '56', iso: 'cl', label: 'Chile' },
  { value: '57', iso: 'co', label: 'Colombia' },
  { value: '593', iso: 'ec', label: 'Ecuador' },
  { value: '52', iso: 'mx', label: 'México' },
  { value: '34', iso: 'es', label: 'España' },
  { value: '1', iso: 'us', label: 'Estados Unidos' },
]

export const DEFAULT_PHONE_PREFIX = '51'

const PREFIX_VALUES_DESC = [...PHONE_PREFIX_OPTIONS]
  .map((o) => o.value)
  .sort((a, b) => b.length - a.length)

export function flagSrc(iso: string): string {
  return `/flags/${iso}.png`
}

export function findPhonePrefixOption(value: string): PhonePrefixOption | undefined {
  return PHONE_PREFIX_OPTIONS.find((o) => o.value === value)
}

export function splitPhoneForForm(phone: string): {
  prefix: string
  local: string
} {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits) {
    return { prefix: DEFAULT_PHONE_PREFIX, local: '' }
  }

  for (const prefix of PREFIX_VALUES_DESC) {
    if (digits.startsWith(prefix) && digits.length > prefix.length) {
      return { prefix, local: digits.slice(prefix.length) }
    }
  }

  if (/^9[0-9]{8}$/.test(digits)) {
    return { prefix: DEFAULT_PHONE_PREFIX, local: digits }
  }

  return { prefix: DEFAULT_PHONE_PREFIX, local: digits }
}

export function digitsOnly(value: string): string {
  return String(value ?? '').replace(/\D/g, '')
}

export function validatePhoneLocal(prefix: string, local: string): string | null {
  const prefixDigits = digitsOnly(prefix)
  const localDigits = digitsOnly(local)
  if (!localDigits) return 'Ingresa el número de celular.'
  if (prefixDigits === DEFAULT_PHONE_PREFIX) {
    if (!/^9\d{8}$/.test(localDigits)) {
      return 'Celular peruano: 9 dígitos, empieza en 9.'
    }
    return null
  }
  if (localDigits.length < 7 || localDigits.length > 15) {
    return 'Número de celular inválido.'
  }
  return null
}
