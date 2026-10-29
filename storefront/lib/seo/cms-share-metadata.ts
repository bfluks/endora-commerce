import type { Metadata } from 'next';
import type { CmsResolvedPage } from '@endora-commerce/contracts';

/**
 * Sharing metadata for a CMS page
 * (`specs/163-page-builder-marketing-pages/` T086; spec US9, FR-033–FR-034;
 * research R-18, R-19).
 *
 * - The image is `share.imageUrl`, which the backend has already resolved —
 *   the page's own image, else the deployment default for the channel.
 * - `og:locale` is the served language and `og:locale:alternate` the page's
 *   other languages. There is no `hreflang`: one storefront URL serves every
 *   language, and alternates all pointing at it are an error to a search engine
 *   (R-19, ruling Q1). `<html lang>` is set by the root layout.
 *
 * Shared by the CMS route and the CMS-backed home page, so `/` announces the
 * same card as the page it renders.
 */

/** BCP 47 (`en-US`) to Open Graph's `ll_CC` (`en_US`). */
export function openGraphLocale(language: string): string {
  return language.replace('-', '_');
}

export interface CmsSocialMetadata {
  readonly title: string;
  readonly openGraph: NonNullable<Metadata['openGraph']>;
  readonly twitter: NonNullable<Metadata['twitter']>;
}

export function cmsSocialMetadata(page: CmsResolvedPage, canonical: string): CmsSocialMetadata {
  const title = page.meta.title ?? page.name;
  const description = page.meta.description ?? undefined;
  // `?? null` / `?? [page.language]` cover a response cached before the fields existed.
  const imageUrl = page.share?.imageUrl ?? null;
  const alternates = (page.languages ?? [page.language])
    .filter((language) => language !== page.language)
    .map(openGraphLocale);

  return {
    title,
    openGraph: {
      type: 'website',
      url: canonical,
      title,
      ...(description ? { description } : {}),
      locale: openGraphLocale(page.language),
      ...(alternates.length > 0 ? { alternateLocale: alternates } : {}),
      ...(imageUrl ? { images: [{ url: imageUrl }] } : {}),
    },
    twitter: imageUrl
      ? { card: 'summary_large_image', title, ...(description ? { description } : {}), images: [imageUrl] }
      : { card: 'summary', title, ...(description ? { description } : {}) },
  };
}
