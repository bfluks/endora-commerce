import type { CmsRenderLocation } from '@endora-commerce/cms-components/components/render-context';

/** A page's `searchParams`, as Next hands them to a page component. */
export type PageSearchParams = Record<string, string | string[] | undefined>;

/**
 * The rendered page's location for the Page Builder render context (feature
 * 163): its path and its query, a repeated key keeping its first value. A
 * block that posts a plain form back to the page reads it, so the outcome on
 * the URL is in the server HTML (`newsletter.Signup`).
 */
export function cmsRenderLocation(path: string, searchParams: PageSearchParams = {}): CmsRenderLocation {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') query[key] = first;
  }
  return { path: path.startsWith('/') ? path : `/${path}`, query };
}
