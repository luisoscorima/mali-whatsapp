/**
 * Botones WhatsApp del sitio (WordPress wa.me), no widget ni CTWA Ads.
 * Preferir `ref:web_*`; texto canónico solo como puente.
 */

import {
  extractWhatsappRefSlug,
  normalizeWhatsappText,
  stripWhatsappRef,
} from './mali-one-link-match.util';

/** Slugs estables: `web`, `web_ca`, `web_ep`, `web_oratoria`, … */
export const WEB_BUTTON_REF_RE = /^web(?:[_-][a-z0-9_-]+)?$/i;

/** Prefijo histórico dominante en prod (WP). */
export const WEB_BUTTON_TEXT_ANCHOR =
  'hola mali educacion! vengo desde la web';

export type WebButtonMatch = {
  slug: string;
  match: 'ref' | 'text';
  curso: string | null;
  source_label: string;
};

export function isWebButtonRefSlug(slug: string): boolean {
  return WEB_BUTTON_REF_RE.test(String(slug ?? '').trim());
}

export function extractCursoFromWebPrefill(body: string): string | null {
  const raw = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const course = raw.match(
    /sobre el curso\s+(.+?)(?=\s*,\s*por favor|\s*\.|$)/i,
  );
  if (course?.[1]) return course[1].trim().slice(0, 200) || null;
  if (/sobre los cursos de arte/i.test(raw)) return 'cursos de arte';
  if (/extensi[oó]n profesional/i.test(raw)) {
    return 'programas y cursos de extensión profesional';
  }
  return null;
}

/**
 * 1) `ref:web…` → Web (aunque el copy cambie).
 * 2) Otro `ref:` → null (lo evalúa mali_one_link).
 * 3) Texto con ancla «Hola MALI Educación! Vengo desde la web» → Web.
 */
export function matchWebButtonWhatsapp(
  bodyText: string,
): WebButtonMatch | null {
  const body = String(bodyText ?? '').trim();
  if (!body) return null;

  const refSlug = extractWhatsappRefSlug(body);
  if (refSlug) {
    if (!isWebButtonRefSlug(refSlug)) return null;
    const stripped = stripWhatsappRef(body);
    const curso = extractCursoFromWebPrefill(stripped);
    return {
      slug: refSlug,
      match: 'ref',
      curso,
      source_label: curso || refSlug,
    };
  }

  const normalized = normalizeWhatsappText(stripWhatsappRef(body));
  if (!normalized.includes(WEB_BUTTON_TEXT_ANCHOR)) return null;

  const curso = extractCursoFromWebPrefill(body);
  return {
    slug: 'web_prefill',
    match: 'text',
    curso,
    source_label: curso || 'Botón web',
  };
}
