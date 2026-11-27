import { CMS_STOREFRONT_CACHE_TAGS, type CmsBrandTokens } from '@endora-commerce/contracts';
import { unstable_rethrow } from 'next/navigation';
import { apiGet, type RequestContext } from './client';

/**
 * The brand tokens of the request's sales channel — feature 163
 * (`specs/163-page-builder-marketing-pages/` research R-3, contract §1).
 *
 * Read once per request in `getServerContext()`, in parallel with the channel,
 * and written into `<style id="cmsb">` by `StorefrontDocument`. Kept in the
 * Data Cache under `cms:brand`, which the backend revalidates on every brand
 * write and on the `cms-brand` cache flush; the TTL is the backstop.
 *
 * `null` means "render without brand tokens": the page builder's stylesheet
 * then falls back to today's literals, so a missing brand never breaks a page.
 * That is the answer while `cms` is off (the route does not answer: 404) and on
 * any other failed read — a brand is presentation, and an unreachable backend
 * is reported by the reads that carry data.
 */
export async function getBrandTokens(ctx: RequestContext = {}): Promise<CmsBrandTokens | null> {
  try {
    const res = await apiGet<{ data: CmsBrandTokens }>('/api/v1/storefront/cms/brand-tokens', ctx, {
      revalidate: 300,
      tags: [CMS_STOREFRONT_CACHE_TAGS.brand],
    });
    return res.data ?? null;
  } catch (err) {
    // Next's own control-flow errors (a dynamic-rendering bailout) are not a failed read.
    unstable_rethrow(err);
    return null;
  }
}
