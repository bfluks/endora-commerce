import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupCatalogVisibilityFixture, type CatalogVisibilityFixture } from '../../helpers/catalog-visibility-fixture.js';
import { ADMIN, call, roleWith, type TestRole } from '../product_visibility_rules/fixtures.js';

/**
 * Spec 193 (FR-094, FR-033, SC-009) QA addition — does a restricted administrator learn how many rows a
 * price book holds for products they cannot see? The row export counts only visible rows
 * (`meta.totalCount`, covered by `book-export-visibility.test.ts`); this checks the two other places the
 * same number is published: the book header (`GET /price-books/:id` -> `rowCount`) and the list summary
 * (`GET /price-books` -> `rowCount`). Both are computed by `count(*)` over `price_list_matrix_entries`
 * with no visibility predicate (price-book-reads.ts).
 */
describe('price book header and list row count for a restricted administrator (spec 193, FR-094)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let editor: TestRole;
  const BASE = '/api/v1/admin/price-books';
  let bookId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    editor = await roleWith(h, ['rfqs:handle', 'catalog:read', 'price_lists:read', 'price_lists:write'], 'cvh');
    const mapped = await call(h, 'PUT', `/role-mappings/${editor.roleId}`, { payload: { target: { kind: 'category', categoryId: fx.categoryId } } });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
    const book = await fx.f.book({
      audience: 'everyone',
      rows: [
        { product: { id: fx.visible.id }, fixed: '90' },
        { product: { id: fx.hidden.id }, fixed: '40' },
        { product: { id: fx.hidden.id }, variant: fx.hidden.variantId, fixed: '41' },
        { product: { id: fx.configurable.id }, variant: fx.configurable.visibleVariant, fixed: '45' },
        { product: { id: fx.configurable.id }, variant: fx.configurable.hiddenVariant, fixed: '46' },
      ],
    });
    bookId = book.id;
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  const exportTotal = async (cookies: Record<string, string>) =>
    ((await h.app.inject({ method: 'GET', url: `${BASE}/${bookId}/rows?pageSize=1000`, cookies })).json() as { meta: { totalCount: number } }).meta.totalCount;

  it('control: the platform administrator sees every row in the header and in the export', async () => {
    const header = (await h.app.inject({ method: 'GET', url: `${BASE}/${bookId}`, cookies: ADMIN })).json() as { data: { rowCount: number } };
    expect(header.data.rowCount).toBe(5);
    expect(await exportTotal(ADMIN)).toBe(5);
  });

  // KNOWN DEFECT (QA, spec 193 checkpoint 1): header rowCount is count(*) over price_list_matrix_entries with no
  // visibility predicate; a restricted admin gets 5, the export lists 2. Flip to `it` when the count is narrowed.
  it.fails('the book header shows a restricted administrator the count of the rows they can list, not the hidden ones', async () => {
    const listed = await exportTotal(editor.cookies);
    const header = (await h.app.inject({ method: 'GET', url: `${BASE}/${bookId}`, cookies: editor.cookies })).json() as { data: { rowCount: number } };
    expect(header.data.rowCount).toBe(listed);
  });

  it.fails('the book list summary shows a restricted administrator the count of the rows they can list', async () => {
    const listed = await exportTotal(editor.cookies);
    const res = await h.app.inject({ method: 'GET', url: `${BASE}?pageSize=100`, cookies: editor.cookies });
    const summary = (res.json() as { data: Array<{ id: string; rowCount: number }> }).data.find((b) => b.id === bookId);
    expect(summary?.rowCount).toBe(listed);
  });
});
