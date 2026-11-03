import { describe, expect, it } from 'vitest';
import {
  cmsLocalizedPage,
  cmsPageDetailSchema,
  cmsPageIndexEntrySchema,
  cmsPageUrl,
  cmsResolvedPageSchema,
  createCmsPageRequestSchema,
  patchCmsPageRequestSchema,
} from './index.js';

/**
 * `specs/163-page-builder-marketing-pages/` R24 (issue #521) — a CMS page's
 * name, slug and description per language. The page's own fields stay the
 * default; a language overrides any of them, and an empty override inherits.
 */
const base = {
  name: 'About us',
  slug: 'about-us',
  description: 'Who we are',
  languages: ['en-US', 'pl-PL'],
  translations: {} as Record<string, { name?: string; slug?: string; description?: string }>,
};

describe('cmsLocalizedPage (R24)', () => {
  it('answers the page fields in a language without an override', () => {
    expect(cmsLocalizedPage(base, 'pl-PL')).toEqual({
      name: 'About us',
      slug: 'about-us',
      description: 'Who we are',
    });
  });

  it('takes each overridden field of the language, and inherits the others', () => {
    const page = { ...base, translations: { 'pl-PL': { name: 'O nas', slug: 'o-nas' } } };
    expect(cmsLocalizedPage(page, 'pl-PL')).toEqual({ name: 'O nas', slug: 'o-nas', description: 'Who we are' });
    expect(cmsLocalizedPage(page, 'en-US')).toEqual({ name: 'About us', slug: 'about-us', description: 'Who we are' });
  });

  it('treats a blank override as inherited', () => {
    const page = { ...base, translations: { 'pl-PL': { name: '  ', slug: '', description: '' } } };
    expect(cmsLocalizedPage(page, 'pl-PL')).toEqual({ name: 'About us', slug: 'about-us', description: 'Who we are' });
  });

  it('ignores an override of a language the page no longer declares', () => {
    const page = { ...base, languages: ['en-US'], translations: { 'pl-PL': { slug: 'o-nas' } } };
    expect(cmsLocalizedPage(page, 'pl-PL').slug).toBe('about-us');
  });

  it('reads a page stored before the field existed', () => {
    const { translations: _omitted, ...legacy } = base;
    expect(cmsLocalizedPage(legacy, 'pl-PL').slug).toBe('about-us');
  });
});

describe('cmsPageUrl (R24, under the feature 167 language prefix)', () => {
  const channel = (prefixDefaultLanguage: boolean) => ({
    languages: ['pl-PL', 'en-US'],
    defaultLanguage: 'pl-PL',
    prefixDefaultLanguage,
  });

  it('is the bare path in the default language of a channel that does not prefix it', () => {
    expect(cmsPageUrl({ path: 'o-nas', languageCode: 'pl-PL', channel: channel(false) })).toBe('/o-nas');
  });

  it('carries the language as its path prefix, never ?lang=', () => {
    expect(cmsPageUrl({ path: 'about-us', languageCode: 'en-US', channel: channel(false) })).toBe('/en/about-us');
    expect(cmsPageUrl({ path: 'o-nas', languageCode: 'pl-PL', channel: channel(true) })).toBe('/pl/o-nas');
  });

  it('normalises the slashes of a nested path', () => {
    expect(cmsPageUrl({ path: '/services/consulting/', languageCode: 'pl-PL', channel: channel(false) })).toBe(
      '/services/consulting',
    );
  });

  it('answers the language home for an empty path', () => {
    expect(cmsPageUrl({ path: '', languageCode: 'en-US', channel: channel(true) })).toBe('/en');
  });
});

describe('page shapes carry translations (R24)', () => {
  const request = {
    name: 'About us',
    slug: 'about-us',
    salesChannelIds: ['11111111-1111-4111-8111-111111111111'],
    languages: ['en-US', 'pl-PL'],
  };

  it('accepts per-language name, slug and description on create and patch', () => {
    const translations = { 'pl-PL': { name: 'O nas', slug: 'o-nas', description: 'Kim jesteśmy' } };
    expect(createCmsPageRequestSchema.parse({ ...request, translations }).translations).toEqual(translations);
    expect(patchCmsPageRequestSchema.parse({ translations }).translations).toEqual(translations);
  });

  it('refuses a language slug outside the slug grammar', () => {
    const parsed = createCmsPageRequestSchema.safeParse({ ...request, translations: { 'pl-PL': { slug: 'O Nas' } } });
    expect(parsed.success).toBe(false);
  });

  it('keeps translations optional on create', () => {
    expect(createCmsPageRequestSchema.parse(request).translations).toBeUndefined();
  });

  it('answers translations on the detail', () => {
    const shape = cmsPageDetailSchema.shape.translations;
    expect(shape.parse({ 'pl-PL': { slug: 'o-nas' } })).toEqual({ 'pl-PL': { slug: 'o-nas' } });
  });

  it('lets a resolved page and an index entry carry their language URLs', () => {
    const urls = { url: '/o-nas', alternates: [{ language: 'en-US', url: '/about-us?lang=en-US' }] };
    expect(cmsResolvedPageSchema.shape.url.parse(urls.url)).toBe('/o-nas');
    expect(cmsResolvedPageSchema.shape.alternates.parse(urls.alternates)).toEqual(urls.alternates);
    expect(
      cmsPageIndexEntrySchema.parse({ slug: 'about-us', path: 'o-nas', updatedAt: '2026-10-29T00:00:00.000Z', ...urls }),
    ).toMatchObject(urls);
  });
});
