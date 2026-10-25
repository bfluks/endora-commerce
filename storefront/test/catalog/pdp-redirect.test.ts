import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductKeyResolution } from '@endora-commerce/contracts';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * Feature 163, Phase 17 (T109) — the product page resolves the key it was opened
 * by before it reads the product
 * (`specs/163-product-data-scopes/contracts/url-keys-and-redirects.md` §4, §6;
 * FR-071, FR-074).
 *
 * - `kind: 'redirect'` answers a permanent redirect to the resolve answer's
 *   `path`, verbatim: the backend built it with `productPath()`, and the
 *   storefront — which does not know the channel's default language — composes
 *   no product URL of its own;
 * - `kind: 'product'` reads the product **by id**, so the page shows the product
 *   the key resolved to and never a second lookup by key;
 * - not-found from the resolve answers the page's not-found;
 * - canonical and alternate-language links are the PDP response's `paths`, as
 *   they came.
 *
 * `next/navigation`'s `permanentRedirect` and `notFound` throw in Next; the stubs
 * below throw the same way so the control flow under test is the real one.
 */

class RedirectSignal extends Error {
  constructor(readonly path: string) {
    super(`redirect ${path}`);
  }
}
class NotFoundSignal extends Error {}

const navigation = vi.hoisted(() => ({
  permanentRedirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock('next/navigation', () => navigation);

const catalogApi = vi.hoisted(() => ({
  resolveProductKey: vi.fn(),
  getProductBySlug: vi.fn(),
}));
vi.mock('../../lib/api/catalog', () => catalogApi);

const { productIdForKey, alternateLanguages, requestedLanguage } = await import('../../app/(catalog)/p/[slug]/resolution');

const ctx = { salesChannelCode: 'b2b', locale: 'pl-PL' };

beforeEach(() => {
  navigation.permanentRedirect.mockReset().mockImplementation((path: string) => {
    throw new RedirectSignal(path);
  });
  navigation.notFound.mockReset().mockImplementation(() => {
    throw new NotFoundSignal();
  });
  catalogApi.resolveProductKey.mockReset();
  catalogApi.getProductBySlug.mockReset();
});

describe('productIdForKey', () => {
  it('redirects permanently to the path the backend built, verbatim', async () => {
    const answer: ProductKeyResolution = {
      kind: 'redirect',
      key: 'wiertarka',
      languageCode: 'pl-PL',
      path: '/p/wiertarka?lang=pl-PL',
    };
    catalogApi.resolveProductKey.mockResolvedValue(answer);

    await expect(productIdForKey('drill', ctx)).rejects.toEqual(new RedirectSignal('/p/wiertarka?lang=pl-PL'));
    expect(catalogApi.resolveProductKey).toHaveBeenCalledWith('drill', ctx);
    expect(navigation.permanentRedirect).toHaveBeenCalledWith('/p/wiertarka?lang=pl-PL');
  });

  it('answers the product id the key resolved to', async () => {
    catalogApi.resolveProductKey.mockResolvedValue({
      kind: 'product',
      productId: '0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d',
      key: 'wiertarka',
    } satisfies ProductKeyResolution);

    await expect(productIdForKey('wiertarka', ctx)).resolves.toBe('0b7c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d');
    expect(navigation.permanentRedirect).not.toHaveBeenCalled();
  });

  it('answers not-found when the key resolves to nothing', async () => {
    catalogApi.resolveProductKey.mockRejectedValue(new StorefrontApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found.'));

    await expect(productIdForKey('impact-drill', ctx)).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it('lets any other failure through (a 410 is the error page, as before)', async () => {
    const gone = new StorefrontApiError(410, 'PRODUCT_ARCHIVED', 'Product is inactive.');
    catalogApi.resolveProductKey.mockRejectedValue(gone);

    await expect(productIdForKey('old-drill', ctx)).rejects.toBe(gone);
    expect(navigation.notFound).not.toHaveBeenCalled();
  });
});

describe('alternateLanguages', () => {
  it('maps each alternate the backend sent to its language, verbatim', () => {
    expect(
      alternateLanguages({
        canonical: '/p/wiertarka?lang=pl-PL',
        alternates: [
          { languageCode: 'en-US', path: '/p/drill' },
          { languageCode: 'pl-PL', path: '/p/wiertarka?lang=pl-PL' },
        ],
      }),
    ).toEqual({ 'en-US': '/p/drill', 'pl-PL': '/p/wiertarka?lang=pl-PL' });
  });

  it('lists no alternates when the product has none for the anonymous audience', () => {
    expect(alternateLanguages({ canonical: '/p/drill', alternates: [] })).toBeUndefined();
  });
});

describe('requestedLanguage', () => {
  it('passes a well-formed `?lang` on and drops anything else', () => {
    expect(requestedLanguage('pl-PL')).toBe('pl-PL');
    expect(requestedLanguage('de')).toBe('de');
    expect(requestedLanguage(undefined)).toBeNull();
    expect(requestedLanguage(['pl-PL', 'en-US'])).toBeNull();
    expect(requestedLanguage('pl-PL\r\nx: y')).toBeNull();
  });
});

describe('the product page composes no product URL of its own', () => {
  const dir = resolve(import.meta.dirname, '../../app/(catalog)/p/[slug]');
  const page = readFileSync(resolve(dir, 'page.tsx'), 'utf8');
  const seo = readFileSync(resolve(dir, 'seo.ts'), 'utf8');

  it('resolves the key before reading, in the page and in its metadata', () => {
    expect(page).toMatch(/productIdForKey\(slug, ctx\)/);
    expect(page).toMatch(/resolveProductKey\(slug, anonymous\)/);
    expect(page).toMatch(/getProductBySlug\(productId, ctx\)/);
    expect(page).toMatch(/canonical: product\.paths\.canonical/);
  });

  it('holds no `/p/` path literal and no canonical built from the route pattern', () => {
    for (const source of [page, seo]) {
      // The route declaration (`'/p/[slug]'`) is a pattern, not a URL.
      expect(source).not.toMatch(/['"`]\/p\/(?!\[slug\])/);
      expect(source).not.toMatch(/canonicalPath\(/);
    }
  });
});
