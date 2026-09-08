/** Utilidades de match texto/ref para links WHATSAPP de MALI ONE. */

export const WHATSAPP_REF_IN_BODY_RE =
  /\bref:([a-zA-Z0-9_-]+)\s*$/i;

export const WHATSAPP_REF_SUFFIX_RE =
  /\s*[·•\-–—]?\s*ref:[a-zA-Z0-9_-]+\s*$/i;

export type MaliOneWhatsappCatalogItem = {
  slug: string;
  text: string;
  text_normalized: string;
  tags: string[];
  phone: string;
};

export type MaliOneLinkMatch = {
  slug: string;
  tags: string[];
  match: 'ref' | 'text';
  ambiguous: boolean;
};

export function extractWhatsappRefSlug(body: string): string | null {
  const match = String(body ?? '').match(WHATSAPP_REF_IN_BODY_RE);
  return match?.[1] ? String(match[1]) : null;
}

export function stripWhatsappRef(text: string): string {
  return String(text ?? '')
    .replace(WHATSAPP_REF_SUFFIX_RE, '')
    .trim();
}

export function normalizeWhatsappText(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 1) `ref:slug` en el cuerpo → match exacto.
 * 2) Texto normalizado (sin ref) vs catálogo.
 * Si varios links comparten el mismo texto → primer slug estable + ambiguous.
 */
export function matchMaliOneWhatsappLink(
  bodyText: string,
  catalog: readonly MaliOneWhatsappCatalogItem[],
): MaliOneLinkMatch | null {
  if (!catalog.length) return null;
  const body = String(bodyText ?? '').trim();
  if (!body) return null;

  const refSlug = extractWhatsappRefSlug(body);
  if (refSlug) {
    const bySlug = catalog.find((item) => item.slug === refSlug);
    return {
      slug: bySlug?.slug ?? refSlug,
      tags: bySlug?.tags ?? [],
      match: 'ref',
      ambiguous: false,
    };
  }

  if (!catalog.length) return null;
  const normalized = normalizeWhatsappText(stripWhatsappRef(body));
  if (!normalized || normalized.length < 12) return null;

  const hits = catalog.filter(
    (item) =>
      item.text_normalized &&
      (item.text_normalized === normalized ||
        normalized.startsWith(item.text_normalized) ||
        item.text_normalized.startsWith(normalized)),
  );
  if (!hits.length) return null;

  // Prefer exact normalized match; then longest catalog text; then slug asc.
  hits.sort((a, b) => {
    const aExact = a.text_normalized === normalized ? 0 : 1;
    const bExact = b.text_normalized === normalized ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    if (b.text_normalized.length !== a.text_normalized.length) {
      return b.text_normalized.length - a.text_normalized.length;
    }
    return a.slug.localeCompare(b.slug);
  });

  const best = hits[0];
  const sameText = hits.filter(
    (h) => h.text_normalized === best.text_normalized,
  );
  return {
    slug: best.slug,
    tags: best.tags,
    match: 'text',
    ambiguous: sameText.length > 1,
  };
}
