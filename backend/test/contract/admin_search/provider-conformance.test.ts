import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdminI18nTranslatePort, AdminSearchProvider } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import {
  ensureAdminWithRole,
  providerQuery,
  runToken,
  searchAsPlatform,
} from '../../helpers/admin-search-fixtures.js';

/**
 * `specs/150-admin-global-search/contracts/provider-contract.md` §5 (T050) —
 * what every provider in the composed registry is held to.
 *
 * The table is the seven record types this feature ships, one row each, with
 * the GET route of the type's own admin list, and the record types later
 * features contribute (`specs/163-projects-and-tasks/`: Projects and Tasks). A
 * provider registered without a row fails the first case, so a new record type
 * arrives with its row:
 *
 * | Entity type                    | List route (gate)                              | Route file                                              |
 * | ------------------------------ | ---------------------------------------------- | ------------------------------------------------------- |
 * | `orders.order`                 | `/api/v1/admin/orders` (`orders:read`)         | `packages/modules/orders/src/backend/routes.ts`         |
 * | `quote_requests.quote_request` | `/api/v1/admin/quote-requests` (`rfqs:handle`) | `packages/modules/quote_requests/src/backend/routes.admin.ts` |
 * | `crm.opportunity`              | `/api/v1/admin/crm/opportunities` (`crm:read`) | `packages/modules/crm/src/backend/routes/routes.opportunities.ts` |
 * | `organizations.organization`   | `/api/v1/admin/organizations` (any of `customers:read`, `customers:manage`) | `packages/modules/organizations/src/backend/routes.admin.ts` |
 * | `customers.customer`           | `/api/v1/admin/customers` (`customers:read`)   | `packages/modules/customers/src/backend/routes.admin.ts` |
 * | `catalog.product`              | `/api/v1/admin/catalog/products` (`catalog:read`) | `packages/modules/catalog/src/backend/routes.admin.ts` |
 * | `catalog.category`             | `/api/v1/admin/catalog/categories` (`catalog:read`) | `packages/modules/catalog/src/backend/routes.admin.ts` |
 * | `projects.project`             | `/api/v1/admin/projects` (`projects:read`)     | `packages/modules/projects/src/backend/routes/routes.projects.ts` |
 * | `tasks.task`                   | `/api/v1/admin/tasks` (`tasks:read`)           | `packages/modules/tasks/src/backend/routes/routes.tasks.ts` |
 *
 * The gate is measured, not read: an admin holding exactly the provider's
 * `requiredPermission` opens the list (and is offered the type), and one
 * holding none of it is refused the list (and is not offered the type).
 */
const LIST_ROUTE: Readonly<Record<string, string>> = {
  'orders.order': '/api/v1/admin/orders',
  'quote_requests.quote_request': '/api/v1/admin/quote-requests',
  'crm.opportunity': '/api/v1/admin/crm/opportunities',
  'organizations.organization': '/api/v1/admin/organizations',
  'customers.customer': '/api/v1/admin/customers',
  'catalog.product': '/api/v1/admin/catalog/products',
  'catalog.category': '/api/v1/admin/catalog/categories',
  'projects.project': '/api/v1/admin/projects',
  'tasks.task': '/api/v1/admin/tasks',
};

describe('admin global search — provider conformance (spec 150, provider-contract §5)', () => {
  let h: BackendServerHandle;
  let providers: AdminSearchProvider[];
  const T = runToken();
  const cookiesAdded: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    providers = (h.container.resolve('adminSearchProviderRegistry') as { all(): AdminSearchProvider[] }).all();
  });

  afterAll(async () => {
    for (const cookie of cookiesAdded) delete ADMIN_COOKIES[cookie];
    await teardownBackendServer(h);
  });

  /** A session for a new admin on a role holding exactly `permissions`. */
  async function sessionWith(permissions: readonly string[]): Promise<Record<string, string>> {
    const adminUserId = randomUUID();
    await ensureAdminWithRole(h, adminUserId, `gs_conf_${randomUUID().slice(0, 8)}`, permissions);
    const cookie = `stub-gs-conformance-${adminUserId}`;
    ADMIN_COOKIES[cookie] = { adminUserId };
    cookiesAdded.push(cookie);
    return { b2b_session: cookie };
  }

  async function offered(cookies: Record<string, string>): Promise<string[]> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/global-search/capability?language=en',
      cookies,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { entityTypes: Array<{ entityType: string }> } }).data.entityTypes.map(
      (e) => e.entityType,
    );
  }

  it('ships exactly the record types of the table, in the fixed group order (FR-003)', () => {
    expect(providers.map((p) => p.entityType)).toEqual([
      'orders.order',
      'quote_requests.quote_request',
      'crm.opportunity',
      'organizations.organization',
      'customers.customer',
      'catalog.product',
      'catalog.category',
      'projects.project',
      'tasks.task',
    ]);
  });

  it.each(Object.keys(LIST_ROUTE))('%s: every label resolves in en and pl (FR-032)', async (entityType) => {
    const provider = providers.find((p) => p.entityType === entityType)!;
    const i18n = h.container.resolve('adminI18nService') as AdminI18nTranslatePort;
    for (const language of ['en', 'pl'] as const) {
      for (const key of [provider.labelKey, ...provider.fields.map((f) => f.labelKey)]) {
        const label = await i18n.translate(provider.moduleId, key, language);
        expect(label, `${language} ${provider.moduleId}.${key}`).not.toBe(`${provider.moduleId}.${key}`);
      }
    }
  });

  it.each(Object.keys(LIST_ROUTE))(
    "%s: requiredPermission is the code its own list route enforces (FR-014)",
    async (entityType) => {
      const provider = providers.find((p) => p.entityType === entityType)!;
      const codes = typeof provider.requiredPermission === 'string' ? [provider.requiredPermission] : provider.requiredPermission;
      for (const code of codes) {
        const holder = await sessionWith([code]);
        const list = await h.app.inject({ method: 'GET', url: LIST_ROUTE[entityType]!, cookies: holder });
        expect(list.statusCode, `${code} opens ${LIST_ROUTE[entityType]}`).toBe(200);
        expect(await offered(holder)).toContain(entityType);
      }
      const stranger = await sessionWith(['settings:read']);
      const refused = await h.app.inject({ method: 'GET', url: LIST_ROUTE[entityType]!, cookies: stranger });
      expect(refused.statusCode).toBe(403);
      expect(await offered(stranger)).not.toContain(entityType);
    },
  );

  it.each(Object.keys(LIST_ROUTE))('%s: wildcards are literal and the limit holds (FR-012, FR-004)', async (entityType) => {
    const provider = providers.find((p) => p.entityType === entityType)!;
    const allFields = provider.fields.map((f) => f.code);
    // A text made of wildcards and a token no record carries: matched
    // literally, it matches nothing; read as a pattern, it would match all.
    for (const text of [`%_%${T}`, `\\%${T}`, `___${T}`]) {
      const result = await searchAsPlatform(provider, providerQuery(text, allFields));
      expect(result.hits, text).toEqual([]);
    }
    const defaults = provider.fields.filter((f) => f.defaultSelected).map((f) => f.code);
    for (const limit of [1, 2]) {
      const result = await searchAsPlatform(provider, providerQuery('a', defaults, { limit }));
      expect(result.hits.length).toBeLessThanOrEqual(limit);
      if (result.hits.length < limit) expect(result.hasMore).toBe(false);
    }
  });
});
