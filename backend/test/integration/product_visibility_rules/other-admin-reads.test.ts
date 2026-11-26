import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  setupCatalogVisibilityFixture,
  type CatalogVisibilityFixture,
} from '../../helpers/catalog-visibility-fixture.js';
import { ADMIN, call, roleWith, type TestRole } from './fixtures.js';

/**
 * Spec 193 T051 — the other admin product reads (FR-083 – FR-085, SC-009), one block per narrowed
 * or refused row of the signed-off table (OQ-H).
 */
describe('other admin product reads — narrowed by the visibility category (spec 193, T051)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let reader: TestRole;
  let bookId: string;

  const get = async (url: string, cookies: Record<string, string>) => {
    const res = await h.app.inject({ method: 'GET', url, cookies });
    return { status: res.statusCode, body: res.body ? res.json() : null, raw: res.body };
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    reader = await roleWith(h, ['rfqs:handle', 'price_lists:read', 'catalog:read', 'inventory:read'], 'cvo');
    const mapped = await call(h, 'PUT', `/role-mappings/${reader.roleId}`, { payload: { target: { kind: 'category', categoryId: fx.categoryId } } });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
    const book = await fx.f.book({
      audience: 'everyone',
      rows: [
        { product: { id: fx.visible.id }, fixed: '91' },
        { product: { id: fx.hidden.id }, fixed: '41' },
      ],
    });
    bookId = book.id;
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  describe('FR-084 — price history', () => {
    const history = () => `/api/v1/admin/price-books/${bookId}/price-history`;

    it('a hidden product\'s history answers as a product with none', async () => {
      const admin = await get(`${history()}/products/${fx.hidden.id}`, ADMIN);
      expect(admin.status, admin.raw).toBe(200);
      expect(admin.body.data.length).toBeGreaterThan(0);
      const hidden = await get(`${history()}/products/${fx.hidden.id}`, reader.cookies);
      const absent = await get(`${history()}/products/00000000-0000-4000-8000-0000000000ee`, reader.cookies);
      expect(hidden.status, hidden.raw).toBe(200);
      expect(hidden.body).toEqual(absent.body);
      const visible = await get(`${history()}/products/${fx.visible.id}`, reader.cookies);
      expect(visible.body.data.length).toBeGreaterThan(0);
    });

    it('a change\'s lines leave out a hidden product\'s lines', async () => {
      const changes = await get(`${history()}?limit=50`, ADMIN);
      expect(changes.status, changes.raw).toBe(200);
      const productIdsOf = (body: { data: Array<{ selection: { productId: string | null } }> }) =>
        body.data.map((l) => l.selection.productId);
      let seenHidden = false;
      for (const change of changes.body.data as Array<{ id: string }>) {
        const admin = await get(`${history()}/${change.id}/lines?limit=100`, ADMIN);
        const restricted = await get(`${history()}/${change.id}/lines?limit=100`, reader.cookies);
        expect(restricted.status, restricted.raw).toBe(200);
        if (productIdsOf(admin.body).includes(fx.hidden.id)) seenHidden = true;
        expect(productIdsOf(restricted.body)).not.toContain(fx.hidden.id);
        expect(productIdsOf(restricted.body)).toEqual(productIdsOf(admin.body).filter((id) => id !== fx.hidden.id));
      }
      expect(seenHidden, 'the fixture wrote a line for the hidden product').toBe(true);
    });
  });

  // Not built yet (Phase 5c, T052 / T054): each row of the signed-off table still to be narrowed.
  it.todo('FR-083 — inventory admin lists with counts and paging, and the set-stock assistant tool');
  it.todo('FR-085 — products export / import refused 403 for a non-unrestricted scope');
});
