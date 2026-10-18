/**
 * Walks the locale-fallback chain for a per-locale JSONB field (a product's
 * `name`). Tries:
 *   1. exact match on the preferred language (e.g. `pl-PL`)
 *   2. language-only match (`pl` → first `pl-*` key)
 *   3. `en-US`, then `en`
 *   4. first available value
 *   5. empty string
 *
 * Shared by the cart view, which names every line, and the minimum refusals,
 * which name the refused product in the request's language (feature 154, R10).
 */
export function pickLocalized(
  field: Record<string, string> | null | undefined,
  preferredLanguage: string | undefined,
): string {
  if (!field) return '';
  if (preferredLanguage && field[preferredLanguage]) return field[preferredLanguage];
  const langOnly = preferredLanguage?.split('-')[0];
  if (langOnly) {
    const match = Object.keys(field).find((k) => k === langOnly || k.startsWith(`${langOnly}-`));
    if (match) return field[match] ?? '';
  }
  if (field['en-US']) return field['en-US'];
  if (field['en']) return field['en'];
  const first = Object.values(field)[0];
  return first ?? '';
}

/**
 * The first tag of an `Accept-Language` header, or `undefined` when there is
 * none — the caller then walks the record's own fallback chain.
 */
export function parsePreferredLanguage(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return undefined;
  const first = raw.split(',')[0]?.trim();
  return first || undefined;
}
