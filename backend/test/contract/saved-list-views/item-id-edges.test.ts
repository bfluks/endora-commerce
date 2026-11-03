import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * `specs/147-saved-views/` QA — the item routes of every list answer a view id
 * that names no view with the same 404 `NOT_FOUND`, whether it is a well-formed
 * UUID that was just deleted (the Admin UI's "gone" path) or not a UUID at all.
 * A malformed id is indistinguishable from an absent one, and never a 500.
 */
const LISTS = [
  { label: 'orders', url: '/api/v1/admin/orders/list-views', body: { sort: { field: 'placedAt', dir: 'desc' } } },
  { label: 'catalog', url: '/api/v1/admin/catalog/products/list-views', body: {} },
  { label: 'quote_requests', url: '/api/v1/admin/quote-requests/list-views', body: {} },
  { label: 'tasks', url: '/api/v1/admin/tasks/list-views', body: {} },
];

describe('saved view item routes — missing ids (spec 147 QA)', () => {
  let h: BackendServerHandle;
  const admin = { cookies: { b2b_session: 'stub-admin-session' } };
  const run = randomUUID().slice(0, 8);

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe.each(LISTS)('$label', ({ url, body }) => {
    it('answers DELETE of an already-deleted view with 404', async () => {
      const created = await h.app.inject({
        method: 'POST',
        url,
        ...admin,
        payload: { name: `Gone ${run}`, shared: false, filters: {}, ...body },
      });
      expect(created.statusCode).toBe(201);
      const id = (created.json() as { data: { id: string } }).data.id;
      expect((await h.app.inject({ method: 'DELETE', url: `${url}/${id}`, ...admin })).statusCode).toBe(200);
      const again = await h.app.inject({ method: 'DELETE', url: `${url}/${id}`, ...admin });
      expect(again.statusCode).toBe(404);
      const patched = await h.app.inject({ method: 'PATCH', url: `${url}/${id}`, ...admin, payload: { shared: true } });
      expect(patched.statusCode).toBe(404);
    });

    it.each(['DELETE', 'PATCH'] as const)('answers %s of a non-UUID id with the not-found 404', async (method) => {
      const res = await h.app.inject({
        method,
        url: `${url}/not-a-uuid`,
        ...admin,
        ...(method === 'PATCH' ? { payload: { shared: true } } : {}),
      });
      expect(res.statusCode).toBe(404);
      expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
    });
  });
});
