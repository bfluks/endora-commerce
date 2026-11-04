import { useMemo } from 'react';
import { useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { SUPPORTED_LANGUAGES, type LocalizedLabel } from '@endora-commerce/contracts';

/**
 * The languages a label is written in: the platform's supported languages
 * (`SUPPORTED_LANGUAGES`), the set the admin is offered in — never a list
 * written here (issue #447). A language added to the platform gets its input
 * in every label section without a change to this module.
 */
export const LABEL_LANGUAGES: readonly string[] = SUPPORTED_LANGUAGES;

/** `label` with every language in `texts` set from the form's inputs; an empty input removes the language. */
export function withLanguages(label: LocalizedLabel, texts: Readonly<Record<string, string>>): LocalizedLabel {
  const next: LocalizedLabel = { ...label };
  for (const [language, raw] of Object.entries(texts)) {
    const text = raw.trim();
    if (text === '') delete next[language];
    else next[language] = text;
  }
  return next;
}

/** One input value per label language, read from a stored label. */
export function labelTexts(label: LocalizedLabel): Record<string, string> {
  return Object.fromEntries(LABEL_LANGUAGES.map((language) => [language, label[language] ?? '']));
}

/** Whether two labels hold the same text for every language. */
export function sameLabel(a: LocalizedLabel, b: LocalizedLabel): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => a[key] === b[key]);
}

/**
 * Names a language in the operator's own admin language (`pl` → "Polish" for
 * an English reader, "polski" for a Polish one), so a new platform language
 * needs no bundle key to get a labelled input.
 */
export function useLanguageName(): (language: string) => string {
  const { language: uiLanguage } = useTranslationContext();
  return useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = new Intl.DisplayNames([uiLanguage], { type: 'language' });
    } catch {
      names = null;
    }
    return (language: string): string => names?.of(language) ?? language;
  }, [uiLanguage]);
}
