import type { LocalizedLabel } from '@endora-commerce/contracts';

/** `label` with `en` and `pl` set from the editor's inputs; an empty input removes the language. */
export function withLanguages(label: LocalizedLabel, en: string, pl: string): LocalizedLabel {
  const next: LocalizedLabel = { ...label };
  for (const [language, text] of [['en', en.trim()], ['pl', pl.trim()]] as const) {
    if (text === '') delete next[language];
    else next[language] = text;
  }
  return next;
}

/** Whether two labels hold the same text for every language. */
export function sameLabel(a: LocalizedLabel, b: LocalizedLabel): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}

/**
 * A label in the operator's language: `label[language]`, then the base
 * language (`pl` for `pl-PL`), then `labelDefault` — the rule the detail
 * screens and the list filters use. Local until the kit publishes its own.
 */
export function resolveLabel(label: LocalizedLabel, labelDefault: string, language: string): string {
  const base = language.split('-')[0] ?? language;
  for (const candidate of [language, base]) {
    const value = Object.hasOwn(label, candidate) ? label[candidate] : undefined;
    if (typeof value === 'string' && value !== '') return value;
  }
  return labelDefault;
}
