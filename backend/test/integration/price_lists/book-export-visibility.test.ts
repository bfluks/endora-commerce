import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import {
  setupCatalogVisibilityFixture,
  type CatalogVisibilityFixture,
} from '../../helpers/catalog-visibility-fixture.js';
import { ADMIN, call, roleWith, type TestRole } from '../product_visibility_rules/fixtures.js';

/**
 * Spec 193 T102 (FR-094, owner ruling 2026-11-26) — a price book's row export and its `replace`
 * write for a restricted administrator.
 *
 * The export (`GET …/rows`) lists only rows of visible products and, of a visible configurable
 * product, its qualifying variants; its count is of those rows. A `replace` from a restricted
 * user deletes only the **visible** rows missing from the file: rows of hidden products are kept,
 * and neither the dry-run's diff nor its counts reveal them. Merge, upsert by id and explicit
 * `delete` stay unrestricted (FR-038); an error never names a hidden row (FR-082). Unrestricted
 * users, and everyone while the module is off, behave as before.
 */
describe('price book row export and replace — narrowed by the visibility category (spec 193, T102)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let editor: TestRole;

  interface Row {
    id: string;
    selection: { productId: string | null; variantId: string | null };
    minQuantity: number;
    maxQuantity: number | null;
    price: unknown;
  }
  const BASE = '/api/v1/admin/price-books';

  /** A fresh book: a visible product's row, a hidden product's rows, and both variants of the configurable one. */
  const makeBook = async () => {
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
    return book.id;
  };
  const exportRows = async (bookId: string, cookies: Record<string, string>, query = 'pageSize=1000') => {
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/${bookId}/rows?${query}`, cookies });
    return { status: res.statusCode, body: res.json() as { data: Row[]; meta: { totalCount: number } }, raw: res.body };
  };
  const versionOf = async (bookId: string) => {
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/${bookId}`, cookies: ADMIN });
    return (res.json() as { data: { version: number } }).data.version;
  };
  const upsertOf = (row: Row) => ({
    id: row.id,
    selection: {
      ...(row.selection.productId ? { productId: row.selection.productId } : {}),
      ...(row.selection.variantId ? { variantId: row.selection.variantId } : {}),
    },
    minQuantity: row.minQuantity,
    maxQuantity: row.maxQuantity,
    price: row.price,
  });
  const write = async (bookId: string, cookies: Record<string, string>, payload: Record<string, unknown>, dryRun = false) => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `${BASE}/${bookId}/rows${dryRun ? '?dryRun=true' : ''}`,
      cookies,
      payload: { ...payload, expectedVersion: await versionOf(bookId) },
    });
    return { status: res.statusCode, body: res.json(), raw: res.body };
  };
  const isVisibleProductRow = (row: Row) => row.selection.productId === fx.visible.id && row.selection.variantId === null;
  /** The visible configurable product's qualifying variant row: what a narrowed file keeps. */
  const isQualifyingVariantRow = (row: Row) =>
    row.selection.productId === fx.configurable.id && row.selection.variantId === fx.configurable.visibleVariant;
  /** The narrowed file, built from the platform administrator's export so the test does not lean on the restricted one. */
  const narrowedFile = async (bookId: string) => (await exportRows(bookId, ADMIN)).body.data.filter(isQualifyingVariantRow);
  const hiddenMarks = () => [fx.hidden.id, fx.hidden.variantId, fx.hidden.sku, fx.configurable.hiddenVariant];

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    editor = await roleWith(h, ['rfqs:handle', 'catalog:read', 'price_lists:read', 'price_lists:write'], 'cvx');
    const mapped = await call(h, 'PUT', `/role-mappings/${editor.roleId}`, { payload: { target: { kind: 'category', categoryId: fx.categoryId } } });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  it('(1) a restricted export omits hidden products\' rows and labels, and counts only what it lists', async () => {
    const bookId = await makeBook();
    const admin = await exportRows(bookId, ADMIN);
    expect(admin.status, admin.raw).toBe(200);
    expect(admin.body.meta.totalCount).toBe(5);

    const res = await exportRows(bookId, editor.cookies);
    expect(res.status, res.raw).toBe(200);
    const listed = res.body.data.map((r) => `${r.selection.productId}/${r.selection.variantId}`).sort();
    expect(listed).toEqual([`${fx.visible.id}/null`, `${fx.configurable.id}/${fx.configurable.visibleVariant}`].sort());
    expect(res.body.meta.totalCount).toBe(2);
    for (const mark of hiddenMarks()) expect(res.raw).not.toContain(mark);

    const searched = await exportRows(bookId, editor.cookies, `search=${encodeURIComponent(fx.hidden.sku)}`);
    expect(searched.status, searched.raw).toBe(200);
    expect(searched.body.data).toEqual([]);
    expect(searched.body.meta.totalCount).toBe(0);
  });

  it('(2) a restricted replace with a narrowed file keeps hidden rows and deletes visible rows missing from it', async () => {
    const bookId = await makeBook();
    const before = await exportRows(bookId, ADMIN);
    const file = await narrowedFile(bookId);
    const res = await write(bookId, editor.cookies, { mode: 'replace', upsert: file.map(upsertOf) });
    expect(res.status, res.raw).toBe(200);
    for (const mark of hiddenMarks()) expect(res.raw).not.toContain(mark);

    const after = await exportRows(bookId, ADMIN);
    const expected = before.body.data.filter((r) => !isVisibleProductRow(r)).map((r) => r.id).sort();
    expect(after.body.data.map((r) => r.id).sort()).toEqual(expected);
    expect(after.body.meta.totalCount).toBe(4);
  });

  it('(3) the dry-run of that replace shows no hidden deletion and its counts do not reveal hidden rows', async () => {
    const bookId = await makeBook();
    const visibleRow = (await exportRows(bookId, ADMIN)).body.data.find(isVisibleProductRow)!;
    const file = await narrowedFile(bookId);
    const res = await write(bookId, editor.cookies, { mode: 'replace', upsert: file.map(upsertOf) }, true);
    expect(res.status, res.raw).toBe(200);
    const plan = res.body.data as {
      diff: { added: unknown[]; changed: unknown[]; removed: Array<{ id: string }>; unchangedCount: number };
      errors: unknown[];
    };
    expect(plan.errors).toEqual([]);
    expect(plan.diff.removed.map((r) => r.id)).toEqual([visibleRow.id]);
    expect(plan.diff.added).toEqual([]);
    expect(plan.diff.changed).toEqual([]);
    expect(plan.diff.unchangedCount).toBe(1);
    for (const mark of hiddenMarks()) expect(res.raw).not.toContain(mark);
    // Nothing was written.
    expect((await exportRows(bookId, ADMIN)).body.meta.totalCount).toBe(5);
  });

  it('FR-082: an overlap with a hidden row is refused without naming that row', async () => {
    const bookId = await makeBook();
    const hiddenRow = (await exportRows(bookId, ADMIN)).body.data.find(
      (r) => r.selection.productId === fx.hidden.id && r.selection.variantId === null,
    )!;
    const payload = {
      mode: 'merge',
      upsert: [{ selection: { productId: fx.hidden.id }, minQuantity: 2, maxQuantity: null, price: { type: 'fixed', amount: '39' } }],
    };
    const preview = await write(bookId, editor.cookies, payload, true);
    expect(preview.status, preview.raw).toBe(200);
    expect((preview.body.data.errors as Array<{ reason: string }>).map((e) => e.reason)).toContain('rows_overlap');
    expect(preview.raw).not.toContain(hiddenRow.id);
    const refused = await write(bookId, editor.cookies, payload);
    expect(refused.status, refused.raw).toBe(409);
    expect(refused.raw).not.toContain(hiddenRow.id);
    // The platform administrator is told which row it overlaps, as before.
    const admin = await write(bookId, ADMIN, payload, true);
    expect(admin.raw).toContain(hiddenRow.id);
  });

  it('FR-038: merge, upsert by id and explicit delete stay unrestricted', async () => {
    const bookId = await makeBook();
    const hiddenRow = (await exportRows(bookId, ADMIN)).body.data.find(
      (r) => r.selection.productId === fx.hidden.id && r.selection.variantId === null,
    )!;
    const res = await write(bookId, editor.cookies, { mode: 'merge', upsert: [], delete: [hiddenRow.id] });
    expect(res.status, res.raw).toBe(200);
    expect((await exportRows(bookId, ADMIN)).body.data.map((r) => r.id)).not.toContain(hiddenRow.id);
  });

  it('(4) an unrestricted replace deletes every row missing from the file, as before', async () => {
    const bookId = await makeBook();
    const file = await narrowedFile(bookId);
    const preview = await write(bookId, ADMIN, { mode: 'replace', upsert: file.map(upsertOf) }, true);
    expect(preview.status, preview.raw).toBe(200);
    expect((preview.body.data.diff.removed as unknown[]).length).toBe(4);
    const res = await write(bookId, ADMIN, { mode: 'replace', upsert: file.map(upsertOf) });
    expect(res.status, res.raw).toBe(200);
    const after = await exportRows(bookId, ADMIN);
    expect(after.body.data.map((r) => r.id)).toEqual(file.map((r) => r.id));
  });

  it('(5) module off: the export and the replace are the platform administrator\'s', async () => {
    for (const axis of ['deactivated', 'platform-unavailable'] as const) {
      const bookId = await makeBook();
      const admin = await exportRows(bookId, ADMIN);
      const offExport = await withModuleOff('product_visibility_rules', axis, () => exportRows(bookId, editor.cookies));
      expect(offExport.status, offExport.raw).toBe(200);
      expect(offExport.body).toEqual(admin.body);

      const file = admin.body.data.filter((r) => !isVisibleProductRow(r) && r.selection.productId !== fx.hidden.id);
      const res = await withModuleOff('product_visibility_rules', axis, async () => {
        const preview = await write(bookId, editor.cookies, { mode: 'replace', upsert: file.map(upsertOf) }, true);
        expect(preview.status, preview.raw).toBe(200);
        expect((preview.body.data.diff.removed as unknown[]).length).toBe(3);
        return write(bookId, editor.cookies, { mode: 'replace', upsert: file.map(upsertOf) });
      });
      expect(res.status, res.raw).toBe(200);
      expect((await exportRows(bookId, ADMIN)).body.data.map((r) => r.id).sort()).toEqual(file.map((r) => r.id).sort());
    }
  });
});
