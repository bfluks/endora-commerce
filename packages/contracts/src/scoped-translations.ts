import { z } from 'zod';

/**
 * Feature 163 (`specs/163-product-data-scopes/`; FR-077–FR-079, research R15, R16) —
 * the per-language texts of a product's gallery images, attachments and packaging
 * units, and the one language comparison every scope read uses.
 *
 * Its own file because both `catalog.ts` (the admin shapes that carry these maps) and
 * `product-scopes.ts` (the scope rule) need it, and `product-scopes.ts` imports
 * `catalog.ts` — never the reverse. `product-scopes.ts` re-exports what lives here.
 */

/**
 * Whether two language tags name the same language as a channel spells it — compared
 * case-insensitively (`de-DE` = `de-de`), never by base language. `null` / `undefined`
 * (no language: a channel-only or global row) equals only itself. The one comparison
 * every scope, key and value read uses (checkpoint C code review, N3).
 */
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  return a.toLowerCase() === b.toLowerCase();
}

/** A stored per-language text map: `{ "<lang>": "<text>" }`. */
export type TranslationMap = Readonly<Record<string, string>>;

/**
 * The text at `languageCode` when it is there and not blank, else `null` — the
 * caller then takes the global value (the asset's alt text, the attachment's or the
 * packaging unit's own name). Keys are matched with {@link sameLanguage}.
 */
export function translationAt(
  translations: TranslationMap | null | undefined,
  languageCode: string | null | undefined,
): string | null {
  if (!translations || languageCode == null) return null;
  for (const [code, text] of Object.entries(translations)) {
    if (sameLanguage(code, languageCode) && typeof text === 'string' && text.trim() !== '') return text;
  }
  return null;
}

/**
 * A packaging unit's name at `languageCode` (FR-079): its translation there, else its
 * global name. The basket and quote-request snapshots take it in the line's scope
 * language and never re-resolve it, so a placed line keeps the name it was placed with.
 */
export function effectivePackagingUnitName(
  unit: { name: string; nameTranslations?: TranslationMap | null },
  languageCode: string | null | undefined,
): string {
  return translationAt(unit.nameTranslations, languageCode) ?? unit.name;
}

/** The language key of a translation map: the BCP-47 shape the scope writes accept (`pl`, `pl-PL`). */
const translationLanguageSchema = z
  .string()
  .max(16)
  .regex(/^[a-z]{2,3}(-[a-z]{2})?$/i, 'BCP-47 language tag');

/** The most languages one translation map of a write carries. */
export const TRANSLATION_MAP_MAX_LANGUAGES = 64;

/**
 * A write of a translation map: the named languages are set, an empty string removes
 * that language, and a language the map does not name is left as it is.
 */
export function translationMapPatchSchema(maxLength: number) {
  return z
    .record(translationLanguageSchema, z.string().max(maxLength))
    .refine((map) => Object.keys(map).length <= TRANSLATION_MAP_MAX_LANGUAGES, {
      message: `At most ${TRANSLATION_MAP_MAX_LANGUAGES} languages.`,
    });
}

/**
 * `stored` with `patch` applied ({@link translationMapPatchSchema}): a language is
 * matched with {@link sameLanguage} and keeps the spelling it was stored with; an
 * empty or blank text removes it.
 */
export function applyTranslationPatch(
  stored: TranslationMap | null | undefined,
  patch: TranslationMap,
): Record<string, string> {
  const next: Record<string, string> = { ...(stored ?? {}) };
  for (const [code, text] of Object.entries(patch)) {
    const existing = Object.keys(next).find((key) => sameLanguage(key, code));
    if (existing !== undefined) delete next[existing];
    if (text.trim() !== '') next[existing ?? code] = text;
  }
  return next;
}
