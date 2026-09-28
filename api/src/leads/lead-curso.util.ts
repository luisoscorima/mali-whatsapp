function normalizeLeadQuestion(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[¿?¡!.,;:'"`()[\]{}]/g, ' ')
    .replace(/[_/\\|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cada formulario trae una sola pregunta, de curso o de programa. */
function mentionsCursoOPrograma(normKey: string): boolean {
  return /(?:^|\s)(?:cursos?|programas?)(?:\s|$)/.test(normKey);
}

/** Respuesta de la única pregunta de curso o programa. */
export function pickCursoFromAnswers(
  raw: Record<string, string>,
): string | undefined {
  for (const [key, value] of Object.entries(raw)) {
    const text = value.trim();
    if (text && mentionsCursoOPrograma(normalizeLeadQuestion(key))) return text;
  }
  return undefined;
}

function answersRecord(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const text = Array.isArray(raw)
      ? String(raw[0] ?? '').trim()
      : typeof raw === 'string' || typeof raw === 'number'
        ? String(raw).trim()
        : '';
    if (key.trim() && text) out[key] = text;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function answersFromFieldData(value: unknown): Record<string, string> | null {
  if (Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const row = item as { name?: unknown; values?: unknown };
      const key = String(row.name ?? '').trim();
      const values = row.values;
      const text = Array.isArray(values) ? String(values[0] ?? '').trim() : '';
      if (key && text) out[key] = text;
    }
    return Object.keys(out).length > 0 ? out : null;
  }
  return answersRecord(value);
}

/** `payload.curso` si ya está, o la pregunta de curso dentro de `mapped` / `field_data`. */
export function cursoFromOriginPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return '';
  }
  const row = payload as Record<string, unknown>;
  const direct = typeof row.curso === 'string' ? row.curso.trim() : '';
  if (direct) return direct;
  const mapped = answersRecord(row.mapped);
  const fromMapped = mapped ? pickCursoFromAnswers(mapped) : undefined;
  if (fromMapped) return fromMapped;
  const fields = answersFromFieldData(row.field_data);
  return (fields && pickCursoFromAnswers(fields)) || '';
}

/** Payload con `curso` escrito, si faltaba y la pregunta lo trae. Si no hay nada que guardar, null. */
export function payloadCursoPatch(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.curso === 'string' && row.curso.trim()) return null;
  const curso = cursoFromOriginPayload({ ...row, curso: '' });
  if (!curso) return null;
  return { ...row, curso };
}

/** Añade `curso` al payload de la respuesta cuando se puede inferir y aún no está. */
export function payloadWithStandardCurso<T>(payload: T): T {
  const curso = cursoFromOriginPayload(payload);
  if (!curso || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  const current = String((payload as { curso?: unknown }).curso ?? '').trim();
  if (current) return payload;
  return { ...(payload as Record<string, unknown>), curso } as T;
}
