/**
 * Feature 155 — the first tag of an `Accept-Language` header, or `undefined`:
 * the language a build names a product below its minimum in. Absent, the
 * record's own fallback chain. Read off the request's header, never its body.
 */
export function preferredLanguageOf(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  const first = raw?.split(',')[0]?.split(';')[0]?.trim();
  return first ? first : undefined;
}
