export const E164_NO_PLUS_REGEX = /^[1-9][0-9]{7,14}$/;
export const MAX_CONTACT_NAME_LEN = 120;
export const DEFAULT_PE_PREFIX = '51';
export const PERU_LOCAL_MOBILE = /^9[0-9]{8}$/;

export type ValidatedContactCore = {
  name: string;
  last_name: string;
  phone: string;
  segments: string[];
};

export function normalizeDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizePhone(value: unknown): string {
  return normalizeDigits(value);
}

function normalizeSegmentInput(segmentInput: unknown): string[] {
  if (Array.isArray(segmentInput)) {
    return [
      ...new Set(
        segmentInput.map((s) => String(s ?? '').trim()).filter(Boolean),
      ),
    ];
  }
  const raw = String(segmentInput ?? '').trim();
  if (!raw) return [];
  if (raw.includes(';') || raw.includes(',')) {
    return [
      ...new Set(
        raw
          .split(/[;,]/)
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ];
  }
  return [raw];
}

export function validateContactCore(
  name: unknown,
  lastName: unknown,
  phone: unknown,
  segmentInput: unknown,
  segmentSet: Set<string>,
  minSegments = 1,
): { ok: true; value: ValidatedContactCore } | { ok: false; message: string } {
  const normalizedName = String(name ?? '').trim();
  const normalizedLastName = String(lastName ?? '').trim();
  const normalizedPhone = normalizePhone(phone);
  const segments = normalizeSegmentInput(segmentInput);

  if (!normalizedName || normalizedName.length > MAX_CONTACT_NAME_LEN) {
    return {
      ok: false,
      message: `Nombre inválido (1-${MAX_CONTACT_NAME_LEN} caracteres)`,
    };
  }
  if (normalizedLastName.length > MAX_CONTACT_NAME_LEN) {
    return {
      ok: false,
      message: `Apellido inválido (máx. ${MAX_CONTACT_NAME_LEN} caracteres)`,
    };
  }
  if (!E164_NO_PLUS_REGEX.test(normalizedPhone)) {
    return {
      ok: false,
      message: 'Teléfono inválido. Usa formato E.164 sin +',
    };
  }
  if (segments.length < minSegments) {
    return {
      ok: false,
      message:
        minSegments === 0 ? 'Segmentos inválidos' : 'Indica al menos un segmento',
    };
  }
  for (const slug of segments) {
    if (!segmentSet.has(slug)) {
      return { ok: false, message: `Segmento inválido: ${slug}` };
    }
  }

  return {
    ok: true,
    value: {
      name: normalizedName,
      last_name: normalizedLastName,
      phone: normalizedPhone,
      segments,
    },
  };
}

export type ContactInputBody = {
  name?: string;
  last_name?: string;
  phone?: string;
  phone_prefix?: string;
  phone_local?: string;
  segments?: string[];
  segment?: string;
};

export function validateContactInput(
  body: ContactInputBody,
  segmentSet: Set<string>,
  opts: { minSegments?: number } = {},
): { ok: true; value: ValidatedContactCore } | { ok: false; message: string } {
  const segmentField =
    body.segments && body.segments.length > 0
      ? body.segments
      : body.segment
        ? normalizeSegmentInput(body.segment)
        : [];

  const hasLocal =
    body.phone_local !== undefined && String(body.phone_local).trim() !== '';
  if (hasLocal) {
    const prefix = normalizeDigits(body.phone_prefix) || DEFAULT_PE_PREFIX;
    const local = normalizeDigits(body.phone_local);
    const full = prefix + local;
    if (prefix === DEFAULT_PE_PREFIX) {
      if (!PERU_LOCAL_MOBILE.test(local)) {
        return {
          ok: false,
          message:
            'Número móvil Perú: 9 dígitos empezando por 9 (sin código de país en el campo número)',
        };
      }
    } else if (!E164_NO_PLUS_REGEX.test(full)) {
      return {
        ok: false,
        message: 'Teléfono inválido para el prefijo indicado',
      };
    }
    return validateContactCore(
      body.name,
      body.last_name,
      full,
      segmentField,
      segmentSet,
      opts.minSegments ?? 1,
    );
  }

  return validateContactCore(
    body.name,
    body.last_name,
    body.phone,
    segmentField,
    segmentSet,
    opts.minSegments ?? 1,
  );
}

export function firstSegmentForLegacyColumn(segments: string[]): string | null {
  if (!segments.length) return null;
  return [...segments].sort()[0] ?? null;
}

export function splitPhoneForForm(phone: string): {
  prefix: string;
  local: string;
} {
  const digits = normalizePhone(phone);
  if (digits.startsWith(DEFAULT_PE_PREFIX) && PERU_LOCAL_MOBILE.test(digits.slice(2))) {
    return { prefix: DEFAULT_PE_PREFIX, local: digits.slice(2) };
  }
  return { prefix: DEFAULT_PE_PREFIX, local: digits };
}
