import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
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

const { productIdForKey, productById, alternateLanguages, requestedLanguage } = await import('../../app/(catalog)/p/[slug]/resolution');

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

  it.each(['//evil.example/p/x', 'https://evil.example/p/x', '/\\evil.example', '/cart', 'p/x', '/p//evil.example'])(
    'never redirects off the product pages: %s is not-found (checkpoint E security review, I3)',
    async (path) => {
      catalogApi.resolveProductKey.mockResolvedValue({ kind: 'redirect', key: 'k', languageCode: 'pl-PL', path });
      await expect(productIdForKey('drill', ctx)).rejects.toBeInstanceOf(NotFoundSignal);
      expect(navigation.permanentRedirect).not.toHaveBeenCalled();
    },
  );

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

  it('answers not-found for an archived product’s 410, never the error page (T155, B4)', async () => {
    catalogApi.resolveProductKey.mockRejectedValue(new StorefrontApiError(410, 'PRODUCT_ARCHIVED', 'Product is archived.'));

    await expect(productIdForKey('old-drill', ctx)).rejects.toBeInstanceOf(NotFoundSignal);
    expect(navigation.notFound).toHaveBeenCalledTimes(1);
  });

  it('lets any other failure through to the error page', async () => {
    const failure = new StorefrontApiError(500, 'INTERNAL', 'Something went wrong.');
    catalogApi.resolveProductKey.mockRejectedValue(failure);

    await expect(productIdForKey('drill', ctx)).rejects.toBe(failure);
    expect(navigation.notFound).not.toHaveBeenCalled();
  });
});

describe('productById (T155, B4)', () => {
  it('answers the product read by id', async () => {
    const product = { id: 'p-1' };
    catalogApi.getProductBySlug.mockResolvedValue(product);
    await expect(productById('p-1', ctx)).resolves.toBe(product);
    expect(catalogApi.getProductBySlug).toHaveBeenCalledWith('p-1', ctx);
  });

  it.each([404, 410])('answers not-found for a %i (gone between the resolve and the read)', async (status) => {
    catalogApi.getProductBySlug.mockRejectedValue(new StorefrontApiError(status, 'PRODUCT_NOT_FOUND', 'Product not found.'));
    await expect(productById('p-1', ctx)).rejects.toBeInstanceOf(NotFoundSignal);
  });

  it('lets any other failure through to the error page', async () => {
    const failure = new StorefrontApiError(500, 'INTERNAL', 'Something went wrong.');
    catalogApi.getProductBySlug.mockRejectedValue(failure);
    await expect(productById('p-1', ctx)).rejects.toBe(failure);
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
    expect(page).toMatch(/productById\(productId, ctx\)/);
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

/**
 * Final QA review Q-M7 (L-1) — the product page alone lets `?lang=` choose the request's
 * language: both its metadata and its body hand `requestedLanguage(search.lang)` to the
 * server context, and no other caller passes a language override.
 */
describe('only the product page passes the `?lang` override to the server context (Q-M7, L-1)', () => {
  const root = resolve(import.meta.dirname, '../..');
  const pagePath = resolve(root, 'app/(catalog)/p/[slug]/page.tsx');
  const page = readFileSync(pagePath, 'utf8');
  const OVERRIDE = 'getServerContext({ langOverride: requestedLanguage(search.lang) })';

  function body(source: string, signature: RegExp): string {
    const start = source.search(signature);
    expect(start).toBeGreaterThanOrEqual(0);
    const next = source.slice(start + 1).search(/\nexport (default )?async function /);
    return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
  }

  it('generateMetadata and the page both pass requestedLanguage(search.lang)', () => {
    expect(body(page, /export async function generateMetadata\(/)).toContain(OVERRIDE);
    expect(body(page, /export default async function ProductPage\(/)).toContain(OVERRIDE);
    expect(page.split('langOverride').length - 1).toBe(2);
  });

  it('no other storefront source passes langOverride', () => {
    const skip = new Set(['node_modules', '.next', 'test', 'dist', 'coverage', 'public']);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (full === pagePath) continue;
          const text = readFileSync(full, 'utf8');
          // A call passes it as `langOverride: …` or as the shorthand `{ langOverride }`;
          // the declaration in `lib/server-context.ts` (`langOverride?:`) passes nothing.
          if (/[{,]\s*langOverride\s*[:,}]/.test(text)) offenders.push(relative(root, full));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

/**
 * T155 finding §1.5 (B3) — with `?lang=` the product page is written in the
 * override's language while the root layout, which cannot read the query and
 * by L-1 must not take the override, stamps `<html lang>` in the cookie's or the
 * header's. The page marks its own content's language instead (WCAG 2.2 SC 3.1.2,
 * Language of Parts): its outermost element carries `lang={locale}`, the
 * language the page resolved with the override.
 */
describe('the product page marks the language its content is written in (T155, B3)', () => {
  const page = readFileSync(resolve(import.meta.dirname, '../../app/(catalog)/p/[slug]/page.tsx'), 'utf8');

  // Source-level, as the rest of this file: rendering `ProductPage` means standing up
  // every read it makes (resolve, product, stock, price, quote settings, one-click, the
  // session) for one attribute, and the page's own suites already read its source.
  it('its outermost element carries the resolved locale as `lang`', () => {
    const body = page.slice(page.search(/export default async function ProductPage\(/));
    const outermost = body.slice(body.indexOf('return (')).match(/return \(\s*<div([^>]*)>/);
    expect(outermost?.[1]).toContain('lang={locale}');
  });
});
