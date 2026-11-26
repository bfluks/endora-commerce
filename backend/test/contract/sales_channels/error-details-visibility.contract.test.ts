import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  attachRuleBySql,
  bridgeProduct,
  clearWebsiteRules,
  createChannel,
  createProduct,
} from '../../integration/product_visibility_rules/website-rule-fixtures.js';

/**
 * Spec 193 T065 — the `sales_channels` part of the FR-082 sweep (N8): no error answer of the
 * channel-side membership routes, or of a channel delete, names a product other than the one the
 * request addressed — a product the caller's visibility scope may hide.
 *
 * Sweep evidence (recorded for the PR): every `HttpError` in
 * `packages/modules/sales_channels/src/backend/**` and the kernel membership service carries
 * either a field name, a channel id / code, counts, or the **addressed** entity id
 * (`ENTITY_WOULD_HAVE_ZERO_CHANNELS` on a membership remove: `[{ path: 'entityId', issue: <the
 * addressed id> }]`). The one answer that listed other products — the channel delete's orphan
 * sample — reports counts per entity type since T100. This test pins those shapes, so a later
 * regression that adds an id fails.
 */
const COOKIE = { cookie: 'b2b_session=stub-admin-session' };

describe('sales_channels refusals name no product but the addressed one (spec 193, T065, FR-082)', () => {
  let h: BackendServerHandle;
  let channel: string;
  let code: string;
  let addressed: string;
  const others: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    await clearWebsiteRules(h);
    channel = await createChannel(h, 'ed-vis');
    code = (await h.orm.em.fork().getConnection().execute<Array<{ code: string }>>(`select "code" from "sales_channels" where "id" = ?`, [channel]))[0]!.code;
    addressed = await createProduct(h, { color: 'red' });
    await bridgeProduct(h, channel, addressed);
    for (let i = 0; i < 3; i += 1) {
      const p = await createProduct(h, { color: 'green' });
      await bridgeProduct(h, channel, p);
      others.push(p);
    }
  }, 5 * 60_000);

  afterAll(async () => {
    await clearWebsiteRules(h);
    await teardownBackendServer(h);
  });

  function expectNoOtherProduct(raw: string): void {
    for (const id of others) expect(raw).not.toContain(id);
  }

  it('DELETE of a last membership names only the addressed product', async () => {
    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/sales-channels/${code}/product/${addressed}`, headers: COOKIE });
    expect(res.statusCode).toBe(422);
    const error = (res.json() as { error: { code: string; details: unknown } }).error;
    expect(error.code).toBe(ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS);
    expect(error.details).toEqual([{ path: 'entityId', issue: addressed }]);
    expectNoOtherProduct(res.body);
  });

  it('a channel delete that would orphan products reports counts, never ids', async () => {
    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/sales-channels/${code}`, headers: COOKIE });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { error: { details: unknown } }).error.details).toEqual([{ path: 'product', issue: String(others.length + 1) }]);
    expectNoOtherProduct(res.body);
    expect(res.body).not.toContain(addressed);
  });

  it('a governed refusal names the channel and the rule, never a product', async () => {
    await attachRuleBySql(h, [channel], 'Visible rule');
    const put = await h.app.inject({ method: 'PUT', url: `/api/v1/admin/sales-channels/${code}/product/${addressed}`, headers: COOKIE });
    expect(put.statusCode).toBe(409);
    expect((put.json() as { error: { details: unknown } }).error.details).toEqual({ channelId: channel, rule: 'Visible rule' });
    expectNoOtherProduct(put.body);
    const fallback = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/sales-channels/${code}?fallbackToDefault=true`, headers: COOKIE });
    expectNoOtherProduct(fallback.body);
    await clearWebsiteRules(h);
  });

  it('an unknown channel or entity type names nothing it was not given', async () => {
    const unknownChannel = await h.app.inject({ method: 'PUT', url: `/api/v1/admin/sales-channels/no-such-channel/product/${addressed}`, headers: COOKIE });
    expect(unknownChannel.statusCode).toBe(404);
    expectNoOtherProduct(unknownChannel.body);
    const unknownType = await h.app.inject({ method: 'PUT', url: `/api/v1/admin/sales-channels/${code}/widget/${addressed}`, headers: COOKIE });
    expect(unknownType.statusCode).toBe(404);
    expectNoOtherProduct(unknownType.body);
  });
});
