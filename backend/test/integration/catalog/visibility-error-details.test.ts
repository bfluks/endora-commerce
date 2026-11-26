import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  setupCatalogVisibilityFixture,
  type CatalogVisibilityFixture,
} from '../../helpers/catalog-visibility-fixture.js';
import { ADMIN } from '../product_visibility_rules/fixtures.js';

/**
 * Spec 193 T046 — FR-082, threat model TM-2, US1-18: a refusal that names another product names
 * it only when the caller may see it. `URL_KEY_TAKEN` for a key a hidden product holds says the
 * key and where it is taken, never the holder's id or name; the platform administrator's refusal
 * still names the holder.
 */
const C = '/api/v1/admin/catalog/products';

describe('catalog error details — a hidden holder is not named (spec 193, T046)', () => {
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let hiddenSlug: string;
  let hiddenName: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    const [row] = await h
      .em()
      .getConnection()
      .execute<Array<{ slug: string; name: string }>>(`select "slug", "name" from "products" where "id" = ?`, [fx.hidden.id]);
    if (!row) throw new Error('the hidden product is missing');
    hiddenSlug = row.slug;
    hiddenName = row.name;
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  const takeKey = async (cookies: Record<string, string>) => {
    const res = await h.app.inject({
      method: 'PUT',
      url: `${C}/${fx.visible.id}/url-keys`,
      cookies,
      payload: { globalKey: hiddenSlug },
    });
    return { status: res.statusCode, body: res.json(), raw: res.body };
  };

  it('URL_KEY_TAKEN names a hidden holder by key only for a restricted caller', async () => {
    const restricted = await takeKey(fx.restricted.cookies);
    expect(restricted.status, restricted.raw).toBe(409);
    expect(restricted.body.error.code).toBe('URL_KEY_TAKEN');
    const [conflict] = restricted.body.error.details.conflicts;
    expect(conflict.key).toBe(hiddenSlug);
    expect(conflict).not.toHaveProperty('heldByProductId');
    expect(conflict).not.toHaveProperty('heldByProductName');
    expect(restricted.raw).not.toContain(fx.hidden.id);
    expect(restricted.raw).not.toContain(hiddenName);
  });

  it('the platform administrator is still told who holds the key', async () => {
    const admin = await takeKey(ADMIN);
    expect(admin.status, admin.raw).toBe(409);
    const [conflict] = admin.body.error.details.conflicts;
    expect(conflict.heldByProductId).toBe(fx.hidden.id);
    expect(conflict.heldByProductName).toBe(hiddenName);
  });
});
