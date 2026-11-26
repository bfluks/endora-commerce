import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupCatalogVisibilityFixture, type CatalogVisibilityFixture } from '../../helpers/catalog-visibility-fixture.js';
import { ADMIN, call, roleWith, type TestRole } from '../product_visibility_rules/fixtures.js';

/**
 * Spec 193 (FR-082, owner ruling 2026-11-26) — a URL key held by a **hidden** product's redirect is,
 * to a restricted administrator, simply taken: `409 URL_KEY_TAKEN` by key and channel, exactly as a
 * key a hidden product holds as its current key. No takeover is offered, and a `confirmTakeover`
 * naming the key is refused the same way (the hidden product's redirect stays). The unrestricted
 * administrator keeps the takeover.
 */
describe('URL-key takeover from a hidden holder (spec 193, FR-082)', () => {
  const P = '/api/v1/admin/catalog/products';
  let h: BackendServerHandle;
  let fx: CatalogVisibilityFixture;
  let editor: TestRole;
  let channelId: string;

  const put = (productId: string, cookies: Record<string, string>, body: object) =>
    h.app.inject({ method: 'PUT', url: `${P}/${productId}/url-keys`, cookies, payload: body });
  const errorOf = (raw: string) => (JSON.parse(raw) as { error: { code: string; details: unknown } }).error;
  const redirectsOfHidden = (key: string) =>
    h.em().getConnection().execute<unknown[]>(`select 1 from product_url_redirects where product_id = ? and key = ?`, [fx.hidden.id, key]);
  /** The hidden product holds a fresh key at the channel, then moves away: the key is its redirect. */
  const hiddenRedirect = async (): Promise<string> => {
    const stamp = randomUUID().slice(0, 8);
    const oldKey = `pvr-old-${stamp}`;
    for (const key of [oldKey, `pvr-new-${stamp}`]) {
      const res = await put(fx.hidden.id, ADMIN, { channelKeys: [{ channelId, key }] });
      expect(res.statusCode, res.body).toBe(200);
    }
    expect(await redirectsOfHidden(oldKey)).not.toEqual([]);
    return oldKey;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = await setupCatalogVisibilityFixture(h);
    editor = await roleWith(h, ['rfqs:handle', 'catalog:read', 'catalog:write'], 'cvk');
    const mapped = await call(h, 'PUT', `/role-mappings/${editor.roleId}`, { payload: { target: { kind: 'category', categoryId: fx.categoryId } } });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(200);
    channelId = fx.f.channels.CH1.id;
    const conn = h.em().getConnection();
    for (const productId of [fx.visible.id, fx.hidden.id]) {
      await conn.execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?) on conflict do nothing`,
        [channelId, productId],
      );
    }
  }, 5 * 60_000);

  afterAll(async () => {
    await fx?.teardown();
    await teardownBackendServer(h);
  });

  const expectTakenNamingNothing = (res: { statusCode: number; body: string }, oldKey: string) => {
    expect(res.statusCode, res.body).toBe(409);
    const error = errorOf(res.body) as { code: string; details: { conflicts: Array<Record<string, unknown>> } };
    expect(error.code).toBe(ERROR_CODES.URL_KEY_TAKEN);
    expect(error.details.conflicts.length).toBeGreaterThan(0);
    for (const conflict of error.details.conflicts) {
      expect(Object.keys(conflict).sort()).toEqual(['channelId', 'key', 'languageCode']);
      expect(conflict).toMatchObject({ channelId, key: oldKey });
    }
    expect(res.body).not.toContain(fx.hidden.id);
    expect(res.body).not.toContain(fx.hidden.sku);
  };

  it('is offered no takeover: the key is taken, by key and channel only', async () => {
    const oldKey = await hiddenRedirect();
    expectTakenNamingNothing(await put(fx.visible.id, editor.cookies, { channelKeys: [{ channelId, key: oldKey }] }), oldKey);
  });

  it('a confirmTakeover naming the key is refused the same way and takes nothing over', async () => {
    const oldKey = await hiddenRedirect();
    expectTakenNamingNothing(
      await put(fx.visible.id, editor.cookies, { channelKeys: [{ channelId, key: oldKey }], confirmTakeover: [oldKey] }),
      oldKey,
    );
    expect(await redirectsOfHidden(oldKey)).not.toEqual([]);
  });

  it('control: the unrestricted administrator is offered the takeover, naming the holder', async () => {
    const oldKey = await hiddenRedirect();
    const res = await put(fx.visible.id, ADMIN, { channelKeys: [{ channelId, key: oldKey }] });
    expect(res.statusCode, res.body).toBe(409);
    expect(errorOf(res.body)).toMatchObject({
      code: ERROR_CODES.URL_KEY_REDIRECT_TAKEOVER_REQUIRED,
      details: { takeovers: [expect.objectContaining({ key: oldKey, losingProductId: fx.hidden.id })] },
    });
  });
});
