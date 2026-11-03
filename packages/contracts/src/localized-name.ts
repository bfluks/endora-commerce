/**
 * Feature 155 (D3/D4, research R10) — a per-language JSONB value (a product's
 * `name`) in one language: the one picker every minimum refusal names a product
 * with, so the name is in the language the refusal's sentence is written in.
 *
 * The caller passes the language the response is answered in — on a request,
 * `request.responseLanguage()` from `@endora-commerce/platform/http` — never a tag
 * parsed out of `Accept-Language` on its own.
 *
 * Tries, skipping empty values:
 *   1. the exact key (`pl`, or `pl-PL` when that is what was asked for);
 *   2. the first key of the same primary language (`pl` → `pl-PL`, `pl-PL` → `pl`);
 *   3. `en-US`, then `en`;
 *   4. the first value;
 *   5. the empty string.
 *
 * Pure and dependency-free.
 */
export function pickLocalized(
  field: Readonly<Record<string, string>> | null | undefined,
  language: string | null | undefined,
): string {
  if (!field) return '';
  if (language) {
    const exact = field[language];
    if (exact) return exact;
    const primary = language.split('-', 1)[0]!.toLowerCase();
    for (const [key, value] of Object.entries(field)) {
      if (!value) continue;
      const lowered = key.toLowerCase();
      if (lowered === primary || lowered.startsWith(`${primary}-`)) return value;
    }
  }
  if (field['en-US']) return field['en-US'];
  if (field['en']) return field['en'];
  for (const value of Object.values(field)) {
    if (value) return value;
  }
  return '';
}
