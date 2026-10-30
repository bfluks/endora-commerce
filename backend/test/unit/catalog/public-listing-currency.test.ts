import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRootContainer, registerErrorEnvelope, systemTenantContext } from '@endora-commerce/platform/composition';
import { enterPlatformScope } from '../../../src/kernel/scope.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { registerCatalogPublicRoutes } from '../../../../packages/modules/catalog/src/backend/routes.public.js';
import type { ListingPriceOrderPort, SearchListOutcome, SearchQueryPort } from '@endora-commerce/contracts';
import type { CatalogQueryService } from '../../../../packages/modules/catalog/src/backend/services/catalog-query.service.js';
import type { ProductLinkService } from '../../../../packages/modules/catalog/src/backend/services/product-link.service.js';

/**
 * Issue #249 (3) — the public catalogue reads are priced in the currency the
 * shopper selected, when the sales channel offers it.
 *
 * The storefront's switcher kept the choice in a cookie no catalogue read
 * carried, and the catalogue had no parameter to carry it in: every listing,
 * product page, product-link strip and price ordering was priced in the
 * channel's default currency. `?currency=` is that parameter. The route
 * resolves it once, against the channel's own currency list, and hands the
 * answer to every read and to the Meilisearch path alike — so a page cannot be
 * priced in one currency and ordered in another.
 *
 * The backends are recording stubs, mounted exactly as
 * `public-search-backend-presence.test.ts` mounts them: what is asserted is the
 * context the route builds, not the SQL a query service runs.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

const CHANNEL = {
  id: 'chan-1',
  code: 'default',
  name: { en: 'Default' },
  active: true,
  anonymousAccess: true,
  prefixDefaultLanguage: true,
  systemDefault: true,
  defaultLanguage: 'en',
  defaultCurrency: 'PLN',
  themeCode: null,
  logoAssetId: null,
  languages: ['en'],
  currencies: ['PLN', 'EUR'],
  version: 1,
};

const EMPTY_PAGE = { data: [], pagination: { hasMore: false, limit: 50, cursor: null } };

interface Recorded {
  listProducts: ReturnType<typeof vi.fn>;
  getProductByIdOrSlug: ReturnType<typeof vi.fn>;
  listForStorefront: ReturnType<typeof vi.fn>;
  searchListProducts: ReturnType<typeof vi.fn>;
  pageDisplayMode: ReturnType<typeof vi.fn>;
}

async function mount(): Promise<{ app: FastifyInstance; recorded: Recorded }> {
  const recorded: Recorded = {
    listProducts: vi.fn(async () => structuredClone(EMPTY_PAGE)),
    getProductByIdOrSlug: vi.fn(async () => ({ id: 'p1', primaryAssetUrl: 'x', assets: [] })),
    listForStorefront: vi.fn(async () => []),
    searchListProducts: vi.fn(
      async (): Promise<SearchListOutcome> => ({ status: 'ok', result: structuredClone(EMPTY_PAGE) }),
    ),
    pageDisplayMode: vi.fn(async () => 'net_only'),
  };
  const container = createRootContainer();
  const app = Fastify();
  registerErrorEnvelope(app);
  app.addHook('onRequest', (_request, reply, done) => {
    void enterPlatformScope(
      systemTenantContext('catalog public listing currency test'),
      () =>
        new Promise<void>((resolve) => {
          reply.raw.once('close', resolve);
          done();
        }),
      { channel: CHANNEL, container },
    );
  });
  await registerCatalogPublicRoutes(app, {
    queryService: {
      listProducts: recorded.listProducts,
      getProductByIdOrSlug: recorded.getProductByIdOrSlug,
    } as unknown as CatalogQueryService,
    searchQueryService: { listProducts: recorded.searchListProducts } as unknown as SearchQueryPort,
    productLinkService: { listForStorefront: recorded.listForStorefront } as unknown as ProductLinkService,
    listingPriceOrder: { pageDisplayMode: recorded.pageDisplayMode } as unknown as ListingPriceOrderPort,
  });
  await app.ready();
  return { app, recorded };
}

/** The `currency` the route put on the context it handed `fn`. */
function contextCurrency(fn: ReturnType<typeof vi.fn>, argIndex: number): unknown {
  const call = fn.mock.calls.at(-1) as unknown[] | undefined;
  return (call?.[argIndex] as { currency?: unknown } | undefined)?.currency;
}

describe('catalogue reads — the currency they are priced in', () => {
  let app: FastifyInstance;
  let recorded: Recorded;
  let originalBackend: string | undefined;

  beforeEach(async () => {
    originalBackend = process.env['CATALOG_SEARCH_BACKEND'];
    delete process.env['CATALOG_SEARCH_BACKEND'];
    registryCache.__setEnabledForTesting(ALL_IDS);
    ({ app, recorded } = await mount());
  });

  afterEach(async () => {
    await app.close();
    if (originalBackend === undefined) delete process.env['CATALOG_SEARCH_BACKEND'];
    else process.env['CATALOG_SEARCH_BACKEND'] = originalBackend;
  });

  it('prices a listing in the requested currency when the channel offers it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products?currency=eur' });

    expect(res.statusCode).toBe(200);
    expect(contextCurrency(recorded.listProducts, 1)).toBe('EUR');
  });

  it('prices it in the channel default when nothing was requested', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/catalog/products' });

    expect(contextCurrency(recorded.listProducts, 1)).toBe('PLN');
  });

  it('falls back to the channel default for a currency the channel does not offer', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products?currency=USD' });

    expect(res.statusCode, 'a stale cookie must not break the page').toBe(200);
    expect(contextCurrency(recorded.listProducts, 1)).toBe('PLN');
  });

  it('refuses a malformed currency with the validation envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products?currency=EURO' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(recorded.listProducts).not.toHaveBeenCalled();
  });

  it('asks the page display mode in the same currency the page is priced in', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/catalog/products?currency=EUR' });

    const [input] = recorded.pageDisplayMode.mock.calls.at(-1) as [{ context: { currencyCode?: string } }];
    expect(input.context.currencyCode).toBe('EUR');
  });

  it('prices the product page and its link strip in the requested currency', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/catalog/products/widget?currency=EUR' });
    expect(contextCurrency(recorded.getProductByIdOrSlug, 1)).toBe('EUR');

    await app.inject({ method: 'GET', url: '/api/v1/catalog/products/widget/links?currency=EUR' });
    expect(contextCurrency(recorded.listForStorefront, 1)).toBe('EUR');
  });

  it('hands the Meilisearch path the same currency as the Postgres one', async () => {
    process.env['CATALOG_SEARCH_BACKEND'] = 'meilisearch';

    await app.inject({ method: 'GET', url: '/api/v1/catalog/products?q=widget&currency=EUR' });

    expect(recorded.searchListProducts).toHaveBeenCalled();
    expect(contextCurrency(recorded.searchListProducts, 1)).toBe('EUR');
  });
});
