'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface CmsRenderEmbeds {
  blocks: Record<string, ReactNode>;
  templates: Record<string, ReactNode>;
}

export interface CmsRenderAsset {
  url: string;
  mimeType?: string;
  filename?: string;
  label?: string | null;
  visibility?: 'public' | 'private';
}

/**
 * The page being rendered, as the server saw the request: its path and its
 * query parameters. A block that posts a plain form back to the page (feature
 * 163, `newsletter.Signup`) reads it for its `returnTo` and for the outcome the
 * handler put on the URL, so the outcome is in the server HTML and a visitor
 * without JavaScript sees it.
 */
export interface CmsRenderLocation {
  /** The path, starting with `/`, without the query. */
  path: string;
  /** The query parameters; a repeated key keeps its first value. */
  query: Readonly<Record<string, string>>;
}

/**
 * The words a carousel speaks to assistive technology, in the rendered page's
 * language (feature 163, T095). Strings, with `{n}` and `{m}` placeholders,
 * because the storefront's server component hands them to client components
 * and a function does not cross that boundary. An absent entry is English.
 */
export interface CmsCarouselLabelText {
  carousel?: string;
  previous?: string;
  next?: string;
  /** `{n}` of `{m}`: a slide's name. */
  slide?: string;
  /** `{n}`: a dot of a fade carousel. */
  goToSlide?: string;
  /** `{n}`: a dot of a sliding carousel. */
  goToPage?: string;
  pause?: string;
  play?: string;
  /** T131: the filter bar's accessible name. */
  filter?: string;
  /** T131: the filter's "All" button, unless the block sets its own. */
  filterAll?: string;
  /** T131: `{n}` of `{m}` items shown, announced after a filter change. */
  filterCount?: string;
}

export interface CmsRenderContextValue {
  embeds: CmsRenderEmbeds;
  assets: Record<string, CmsRenderAsset>;
  /** API origin for rebasing host-relative `/assets/file/...` URLs. */
  mediaBaseUrl?: string;
  /** The rendered page's location; absent in the editor and wherever it is not known. */
  location?: CmsRenderLocation;
  /** The page language's carousel words; absent: English. */
  carouselLabels?: CmsCarouselLabelText;
  /**
   * Puts the page language's prefix on an internal storefront path (feature 167,
   * FR-020); absent — in the editor — paths are rendered as they are.
   */
  localizePath?: (path: string) => string;
}

const emptyValue: CmsRenderContextValue = {
  embeds: { blocks: {}, templates: {} },
  assets: {},
};

export const CmsRenderContext = createContext<CmsRenderContextValue>(emptyValue);

export function CmsRenderProvider({
  embeds,
  assets = {},
  mediaBaseUrl,
  location,
  carouselLabels,
  localizePath,
  children,
}: {
  embeds: CmsRenderEmbeds;
  assets?: Record<string, CmsRenderAsset>;
  mediaBaseUrl?: string;
  location?: CmsRenderLocation;
  carouselLabels?: CmsCarouselLabelText;
  localizePath?: (path: string) => string;
  children: ReactNode;
}) {
  return (
    <CmsRenderContext.Provider
      value={{
        embeds,
        assets,
        ...(mediaBaseUrl !== undefined ? { mediaBaseUrl } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(carouselLabels !== undefined ? { carouselLabels } : {}),
        ...(localizePath !== undefined ? { localizePath } : {}),
      }}
    >
      {children}
    </CmsRenderContext.Provider>
  );
}

export function useCmsRenderEmbeds(): CmsRenderEmbeds {
  return useContext(CmsRenderContext).embeds;
}

export function useCmsRenderAssets(): Record<string, CmsRenderAsset> {
  return useContext(CmsRenderContext).assets;
}

export function useCmsRenderMediaBaseUrl(): string | undefined {
  return useContext(CmsRenderContext).mediaBaseUrl;
}

export function useCmsRenderLocation(): CmsRenderLocation | undefined {
  return useContext(CmsRenderContext).location;
}

export function useCmsRenderCarouselLabels(): CmsCarouselLabelText | undefined {
  return useContext(CmsRenderContext).carouselLabels;
}

const identity = (path: string): string => path;

/** The page language's path localizer (feature 167), or the identity where none was provided. */
export function useCmsRenderLocalizePath(): (path: string) => string {
  return useContext(CmsRenderContext).localizePath ?? identity;
}
