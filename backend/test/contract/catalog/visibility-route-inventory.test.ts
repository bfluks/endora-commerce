import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  productFingerprint,
  setupCatalogVisibilityFixture,
  type CatalogVisibilityFixture,
} from '../../helpers/catalog-visibility-fixture.js';
import { ADMIN } from '../../integration/product_visibility_rules/fixtures.js';

/**
 * Spec 193 T036 (TM-1, TM-5; research R-7) — **a hidden product answers exactly as a product
 * that does not exist**, on every `/api/v1/admin/catalog/**` route, asked of the running server.
 *
 * The route table is the one Fastify built (the OpenAPI document), so a route added later is
 * covered by construction: it is either exercised here as a by-id route, covered by a named
 * collection test, or on {@link PRODUCT_FREE} with the reason it carries no product. The three
 * lists are two-way — an entry naming no mounted route fails too.
 *
 * Per by-id route and method, and per request shape (valid, schema-invalid body, schema-invalid
 * query, semantically invalid body where the route has one, HEAD on a GET), a restricted
 * administrator asking for the hidden product gets the **same envelope** as for a random id
 * that names nothing: status, `error.code`, message, `details`, and every header but the request
 * id and the date. Nothing is written to the hidden product, and a spy pre-interceptor on a
 * product route never sees its id. The platform administrator's answers are unchanged.
 */

const PREFIX = '/api/v1/admin/catalog/';
const SPY_MODULE = 'visibility_spy_fixture';

/**
 * Routes that carry no product, with why. Reviewed: an aggregate that counts products
 * (category / attribute-set `productCount`, attribute usage) is **not** here — those are
 * narrowed in Phase 5b (T047) and listed under {@link COLLECTION_ROUTES}.
 */
const PRODUCT_FREE: Readonly<Record<string, string>> = {
  'GET /api/v1/admin/catalog/attachment-types': 'attachment type dictionary',
  'POST /api/v1/admin/catalog/attachment-types': 'attachment type dictionary',
  'PATCH /api/v1/admin/catalog/attachment-types/:id': 'attachment type dictionary',
  'DELETE /api/v1/admin/catalog/attachment-types/:id': 'attachment type dictionary',
  'GET /api/v1/admin/catalog/attributes': 'attribute definitions',
  'POST /api/v1/admin/catalog/attributes': 'attribute definitions',
  'GET /api/v1/admin/catalog/attributes/by-flag': 'attribute definitions',
  'GET /api/v1/admin/catalog/attributes/:idOrKey': 'attribute definition',
  'PATCH /api/v1/admin/catalog/attributes/:idOrKey': 'attribute definition',
  'DELETE /api/v1/admin/catalog/attributes/:idOrKey': 'attribute definition (an in-use refusal is narrowed in T047)',
  'GET /api/v1/admin/catalog/attributes/:attributeId/options': 'attribute options',
  'POST /api/v1/admin/catalog/attributes/:attributeId/options': 'attribute options',
  'PATCH /api/v1/admin/catalog/attributes/:attributeId/options/:optionId': 'attribute options',
  'DELETE /api/v1/admin/catalog/attributes/:attributeId/options/:optionId': 'attribute options',
  'POST /api/v1/admin/catalog/attribute-sets': 'attribute set definition',
  'PATCH /api/v1/admin/catalog/attribute-sets/:id': 'attribute set definition',
  'POST /api/v1/admin/catalog/attribute-sets/:id/attributes': 'attribute set membership',
  'DELETE /api/v1/admin/catalog/attribute-sets/:id/attributes/:attributeId': 'attribute set membership',
  'POST /api/v1/admin/catalog/categories': 'category tree',
  'PATCH /api/v1/admin/catalog/categories/:id': 'category tree',
  'DELETE /api/v1/admin/catalog/categories/:id': 'category tree',
  'GET /api/v1/admin/catalog/categories/:id/content': 'category page content',
  'PUT /api/v1/admin/catalog/categories/:id/content': 'category page content',
  'GET /api/v1/admin/catalog/products/list-views': 'saved views of the list (filters, not products)',
  'POST /api/v1/admin/catalog/products/list-views': 'saved views of the list (filters, not products)',
  'PATCH /api/v1/admin/catalog/products/list-views/:id': 'saved views of the list (filters, not products)',
  'DELETE /api/v1/admin/catalog/products/list-views/:id': 'saved views of the list (filters, not products)',
  'POST /api/v1/admin/catalog/products': 'creates a product; nothing existing is read',
};

/**
 * Routes that answer about many products, each exercised by the named test (Phase 5a / 5b). The
 * inventory holds that they are mounted and accounted for; the named file holds the narrowing.
 */
const COLLECTION_ROUTES: Readonly<Record<string, string>> = {
  'GET /api/v1/admin/catalog/products': 'test/integration/catalog/visibility-list.test.ts',
  'POST /api/v1/admin/catalog/products/resolve-ids': 'test/integration/catalog/visibility-list.test.ts',
  'POST /api/v1/admin/catalog/products/batch-by-id': 'test/integration/catalog/visibility-list.test.ts',
  'POST /api/v1/admin/catalog/products/bulk-update': 'test/integration/catalog/bulk-operations-visibility.test.ts',
  'GET /api/v1/admin/catalog/bulk-operations': 'test/integration/catalog/bulk-operations-visibility.test.ts',
  'GET /api/v1/admin/catalog/bulk-operations/:id': 'test/integration/catalog/bulk-operations-visibility.test.ts',
  'POST /api/v1/admin/catalog/bulk-operations/:id/undo': 'test/integration/catalog/bulk-operations-visibility.test.ts',
  'GET /api/v1/admin/catalog/categories': 'test/integration/catalog/visibility-aggregates.test.ts',
  'GET /api/v1/admin/catalog/attribute-sets': 'test/integration/catalog/visibility-aggregates.test.ts',
  'GET /api/v1/admin/catalog/attribute-sets/:id': 'test/integration/catalog/visibility-aggregates.test.ts',
  'DELETE /api/v1/admin/catalog/attribute-sets/:id': 'test/integration/catalog/visibility-aggregates.test.ts',
  'GET /api/v1/admin/catalog/attributes/:idOrKey/usage': 'test/integration/catalog/visibility-aggregates.test.ts',
  'GET /api/v1/admin/catalog/attributes/:idOrKey/scope-change-preview': 'test/integration/catalog/visibility-aggregates.test.ts',
};

/**
 * A body (or query) each by-id route accepts, so the request reaches the visibility guard. A
 * route not named here is asked with no body; a body route answering `400` to it is reported, so
 * the list cannot silently miss one.
 */
interface Sample {
  body?: unknown;
  query?: Record<string, string>;
  /** A body the schema accepts and the handler refuses on its own terms (`422`/`409`). */
  semantic?: unknown;
}
const NIL = () => randomUUID();
const SAMPLES: Readonly<Record<string, Sample>> = {
  'PATCH /api/v1/admin/catalog/products/:id': { body: { name: 'Renamed by a probe' }, semantic: { status: 'no-such-status' } },
  'PUT /api/v1/admin/catalog/products/:id/editor-preference': { body: { channelId: null, languageCode: null } },
  'POST /api/v1/admin/catalog/products/:productId/variants': { body: { sku: `PROBE-${Date.now()}`, variantAttributeValues: { color: 'red' } } },
  'PATCH /api/v1/admin/catalog/products/:productId/variants/:variantId': { body: { stockLevel: 3 } },
  'POST /api/v1/admin/catalog/products/:id/links': { body: { targetProductId: NIL(), kind: 'related' } },
  'POST /api/v1/admin/catalog/products/:id/grouped-items': { body: { childProductId: NIL(), defaultQuantity: 1 } },
  'POST /api/v1/admin/catalog/products/:id/bundle-slots': { body: { label: 'Probe', required: false } },
  'GET /api/v1/admin/catalog/products/:id': { query: { channelId: NIL(), languageCode: 'en-US' } },
};

interface MountedRoute {
  key: string;
  method: string;
  path: string;
}

interface Answer {
  status: number;
  body: unknown;
  headers: Record<string, unknown>;
}

const IGNORED_HEADERS = new Set(['date', 'x-request-id', 'request-id', 'connection', 'keep-alive']);

/**
 * The answer as compared. The ids the caller sent are replaced by placeholders: a route echoing
 * the id it was asked about tells the caller nothing it did not already know.
 */
function envelope(res: { statusCode: number; body: string; headers: Record<string, unknown> }, ids: readonly string[]): Answer {
  let text = res.body;
  for (const [i, id] of ids.entries()) text = text.split(id).join(`<id${i}>`);
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // not JSON: compared as text
  }
  if (body && typeof body === 'object' && 'error' in body) {
    const error = { ...(body as { error: Record<string, unknown> }).error };
    delete error['requestId'];
    body = { ...(body as object), error };
  }
  const headers: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(res.headers)) {
    if (IGNORED_HEADERS.has(name)) continue;
    // The length follows the echoed ids, which are not compared.
    if (name === 'content-length') continue;
    headers[name] = value;
  }
  return { status: res.statusCode, body, headers };
}

describe('catalog admin routes — a hidden product answers as a non-existent one (spec 193, T036)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let mounted: MountedRoute[] = [];
  let baselineEnabled: string[] = [];
  const spySaw: string[] = [];
  const SPY_TARGETS = [
    'GET /api/v1/admin/catalog/products/:id',
    'PATCH /api/v1/admin/catalog/products/:id',
    'POST /api/v1/admin/catalog/products/:id/archive',
    'GET /api/v1/admin/catalog/products/:productId/variants',
  ];

  beforeAll(async () => {
    h = await setupBackendServer({
      configureInterceptors: (registry) => {
        registry.register({
          module: SPY_MODULE,
          id: 'visibility-spy',
          target: SPY_TARGETS,
          phase: 'pre',
          handler: async ({ params }) => {
            const p = params as Record<string, string>;
            spySaw.push(p['id'] ?? p['productId'] ?? '');
          },
        });
      },
    });
    baselineEnabled = registryCache.enabledIds();
    registryCache.__setEnabledForTesting([...baselineEnabled, SPY_MODULE]);
    fx = await setupCatalogVisibilityFixture(h);

    const document = (await h.app.inject({ method: 'GET', url: '/api/v1/_openapi.json', cookies: ADMIN })).json() as {
      paths: Record<string, Record<string, unknown>>;
    };
    for (const [path, methods] of Object.entries(document.paths)) {
      if (!path.startsWith(PREFIX)) continue;
      const colon = path.replace(/\{([^}]+)\}/g, ':$1');
      for (const method of Object.keys(methods)) {
        if (method === 'head' || method === 'options') continue;
        mounted.push({ key: `${method.toUpperCase()} ${colon}`, method: method.toUpperCase(), path: colon });
      }
    }
    // Deleting the product is asked last, so a route that wrongly deletes it cannot hide the rest.
    const last = (r: MountedRoute) => (r.key === 'DELETE /api/v1/admin/catalog/products/:id' ? 1 : 0);
    mounted = mounted.sort((a, b) => last(a) - last(b) || a.key.localeCompare(b.key));
  }, 5 * 60_000);

  afterAll(async () => {
    registryCache.__setEnabledForTesting(baselineEnabled);
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  /** A by-id route: its first path parameter after `/products/` is the product. */
  const isById = (route: MountedRoute) => /^\/api\/v1\/admin\/catalog\/products\/:(id|productId)(\/|$)/.test(route.path);

  it('every mounted catalog admin route is accounted for, and every list entry is mounted', () => {
    expect(mounted.length).toBeGreaterThan(40);
    const keys = new Set(mounted.map((r) => r.key));
    const unaccounted = mounted.filter((r) => !isById(r) && !(r.key in PRODUCT_FREE) && !(r.key in COLLECTION_ROUTES));
    expect(unaccounted.map((r) => r.key), 'catalog admin routes neither by-id, product-free nor a named collection').toEqual([]);
    const stale = [...Object.keys(PRODUCT_FREE), ...Object.keys(COLLECTION_ROUTES), ...Object.keys(SAMPLES)].filter((k) => !keys.has(k));
    expect(stale, 'list entries naming no mounted route').toEqual([]);
    const both = Object.keys(PRODUCT_FREE).filter((k) => k in COLLECTION_ROUTES || isById(mounted.find((r) => r.key === k)!));
    expect(both, 'a route listed twice').toEqual([]);
  });

  /** Fill the route's path: the product parameter with `productId`, every other one with a fresh id. */
  function urlOf(route: MountedRoute, productId: string, variantId?: string): string {
    let first = true;
    return route.path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
      if (first && (name === 'id' || name === 'productId')) {
        first = false;
        return productId;
      }
      if (name === 'variantId' && variantId) return variantId;
      if (name === 'attributeKey') return 'probe_key';
      if (name === 'kind') return 'related';
      return '00000000-0000-4000-8000-0000000000aa';
    });
  }

  async function ask(
    route: MountedRoute,
    url: string,
    cookies: Record<string, string>,
    shape: { method?: string; body?: unknown; query?: Record<string, string> },
    ids: readonly string[] = [],
  ): Promise<Answer> {
    const res = await h.app.inject({
      method: (shape.method ?? route.method) as 'GET',
      url,
      cookies,
      ...(shape.query ? { query: shape.query } : {}),
      ...(shape.body !== undefined ? { payload: shape.body as never } : {}),
    });
    return envelope(res as never, ids);
  }

  const shapesOf = (route: MountedRoute) => {
    const sample = SAMPLES[route.key] ?? {};
    const withBody = route.method !== 'GET' && route.method !== 'DELETE';
    const shapes: Array<{ name: string; method?: string; body?: unknown; query?: Record<string, string> }> = [
      { name: 'valid', ...(sample.body !== undefined ? { body: sample.body } : withBody ? { body: {} } : {}), ...(sample.query ? { query: sample.query } : {}) },
      { name: 'schema-invalid query', query: { page: 'not-a-number', pageSize: '-7', channelId: 'not-a-uuid', languageCode: '%%' }, ...(withBody ? { body: sample.body ?? {} } : {}) },
    ];
    if (withBody) shapes.push({ name: 'schema-invalid body', body: [1, 'two'] });
    if (sample.semantic !== undefined) shapes.push({ name: 'semantically invalid body', body: sample.semantic });
    if (route.method === 'GET') shapes.push({ name: 'HEAD', method: 'HEAD' });
    return shapes;
  };

  it.each(['restricted', 'noCategory'] as const)('%s: each by-id route answers the hidden product exactly as a non-existent one, and writes nothing', async (who) => {
    const caller = fx[who].cookies;
    const before = await productFingerprint(h, fx.hidden.id);
    const differences: string[] = [];
    const neverReached: string[] = [];
    for (const route of mounted.filter(isById)) {
      for (const shape of shapesOf(route)) {
        const [absentId, absentVariant] = [randomUUID(), randomUUID()];
        const hidden = await ask(route, urlOf(route, fx.hidden.id, fx.hidden.variantId), caller, shape, [fx.hidden.id, fx.hidden.variantId]);
        const absent = await ask(route, urlOf(route, absentId, absentVariant), caller, shape, [absentId, absentVariant]);
        try {
          expect(hidden).toEqual(absent);
        } catch {
          differences.push(`${route.key} [${shape.name}] hidden=${JSON.stringify(hidden).slice(0, 300)} absent=${JSON.stringify(absent).slice(0, 300)}`);
        }
        if (shape.name === 'valid' && absent.status === 400 && route.method !== 'GET') neverReached.push(route.key);
      }
    }
    expect(differences, 'routes whose hidden answer differs from the non-existent one').toEqual([]);
    expect(await productFingerprint(h, fx.hidden.id), 'the hidden product was written').toEqual(before);
    expect(spySaw.filter((id) => id === fx.hidden.id), 'a pre-interceptor saw the hidden id').toEqual([]);
    // A route whose sample never passes its schema never reaches the guard: give it a sample.
    expect(neverReached, 'by-id write routes with no valid sample').toEqual([]);
  }, 10 * 60_000);

  it('a hidden variant of a visible parent answers as a non-existent variant', async () => {
    const caller = fx.restricted.cookies;
    for (const route of mounted.filter((r) => r.path.includes(':variantId'))) {
      for (const shape of shapesOf(route)) {
        const absentVariant = randomUUID();
        const hidden = await ask(route, urlOf(route, fx.configurable.id, fx.configurable.hiddenVariant), caller, shape, [fx.configurable.hiddenVariant]);
        const absent = await ask(route, urlOf(route, fx.configurable.id, absentVariant), caller, shape, [absentVariant]);
        expect(hidden, `${route.key} [${shape.name}]`).toEqual(absent);
      }
    }
  });

  it('a non-UUID id answers the restricted caller as it answers the platform administrator', async () => {
    const differences: string[] = [];
    for (const route of mounted.filter(isById)) {
      const shape = shapesOf(route)[0]!;
      const restricted = await ask(route, urlOf(route, 'not-a-uuid'), fx.restricted.cookies, shape);
      const admin = await ask(route, urlOf(route, 'not-a-uuid'), ADMIN, shape);
      if (restricted.status !== admin.status || JSON.stringify(restricted.body) !== JSON.stringify(admin.body)) {
        differences.push(`${route.key} restricted=${restricted.status} admin=${admin.status}`);
      }
    }
    expect(differences).toEqual([]);
  });

  it('a visible product and the platform administrator are unchanged', async () => {
    const asRestricted = await h.app.inject({ method: 'GET', url: `${PREFIX}products/${fx.visible.id}`, cookies: fx.restricted.cookies });
    expect(asRestricted.statusCode, asRestricted.body).toBe(200);
    const asAdmin = await h.app.inject({ method: 'GET', url: `${PREFIX}products/${fx.hidden.id}`, cookies: ADMIN });
    expect(asAdmin.statusCode, asAdmin.body).toBe(200);
    const variants = await h.app.inject({ method: 'GET', url: `${PREFIX}products/${fx.hidden.id}/variants`, cookies: ADMIN });
    expect(variants.statusCode, variants.body).toBe(200);
    expect(spySaw).toContain(fx.hidden.id);
  });
});
