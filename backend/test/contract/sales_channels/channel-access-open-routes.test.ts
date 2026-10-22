import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  CHANNEL_ACCESS_OPEN_ROUTES,
  CHANNEL_ACCESS_OPEN_UNDOCUMENTED_ROUTES,
} from '../../helpers/channel-access-open-routes.js';
import { setChannelAnonymousAccess } from '../../helpers/sales-channel-access.js';

/**
 * Feature 154 — the routes reachable whatever the sales-channel access rule
 * decides, asked of the running server (`contracts/channel-access-rule.md` §4,
 * FR-006).
 *
 * The system-default channel is closed to anonymous visitors, and every
 * non-administrative `/api/v1/*` route the composed server mounts is called
 * anonymously with no channel signal. A route that does not declare
 * `salesChannelAccess: 'open'` is refused by the access step in `onRequest` —
 * before its guards, its schema and its handler — with
 * `SALES_CHANNEL_SIGN_IN_REQUIRED`; anything else it answers means it declared
 * the option. That set is compared with the ledger both ways.
 *
 * Asking the server rather than reading source is deliberate: it sees a route
 * however it is mounted, an overlay's included, and it cannot be satisfied by
 * a declaration the hook does not actually honour.
 */

const NIL_ID = '00000000-0000-4000-8000-00000000dead';

function isRefusal(body: string): boolean {
  try {
    return (
      (JSON.parse(body) as { error?: { code?: string } }).error?.code ===
      ERROR_CODES.SALES_CHANNEL_SIGN_IN_REQUIRED
    );
  } catch {
    return false;
  }
}

describe('channel-access open routes', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelAnonymousAccess(h, 'default', false);
  });

  afterAll(async () => {
    await setChannelAnonymousAccess(h, 'default', true);
    await teardownBackendServer(h);
  });

  it('the routes answering on a closed channel are exactly the ledgered ones', async () => {
    // The document is itself an open route, so the closed channel does not
    // stop it; who may read it is its own gate, which the platform
    // administrator passes.
    const docRes = await h.app.inject({
      method: 'GET',
      url: '/api/v1/_openapi.json',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(docRes.statusCode).toBe(200);
    const document = docRes.json() as { paths: Record<string, Record<string, unknown>> };

    const probed: string[] = [];
    const open: string[] = [];
    for (const [path, methods] of Object.entries(document.paths)) {
      if (!path.startsWith('/api/v1/')) continue;
      if (path.startsWith('/api/v1/admin/')) continue;
      // Not resolved at all, so outside the rule (`shouldResolve`).
      if (path === '/api/v1/_health' || path.startsWith('/api/v1/_health/')) continue;
      for (const method of Object.keys(methods)) {
        const key = `${method.toUpperCase()} ${path.replace(/\{([^}]+)\}/g, ':$1')}`;
        probed.push(key);
        const res = await h.app.inject({
          method: method.toUpperCase() as 'GET',
          url: path.replace(/\{[^}]+\}/g, NIL_ID),
        });
        if (!isRefusal(res.body)) open.push(key);
      }
    }

    console.info(`[channel-access-open-routes] read: routes=${probed.length} open=${open.length}`);
    expect(probed.length).toBeGreaterThan(Object.keys(CHANNEL_ACCESS_OPEN_ROUTES).length);
    expect(
      open.filter((key) => !(key in CHANNEL_ACCESS_OPEN_ROUTES)).sort(),
      'routes reachable on a closed channel with no ledger entry',
    ).toEqual([]);
    expect(
      Object.keys(CHANNEL_ACCESS_OPEN_ROUTES)
        .filter((key) => !open.includes(key))
        .sort(),
      'ledger entries the server refuses on a closed channel',
    ).toEqual([]);
  });

  it('the routes the document does not describe answer on a closed channel too', async () => {
    for (const key of Object.keys(CHANNEL_ACCESS_OPEN_UNDOCUMENTED_ROUTES)) {
      const [method, url] = key.split(' ') as ['GET', string];
      const res = await h.app.inject({ method, url });
      expect(isRefusal(res.body), key).toBe(false);
      // What answers is the route itself: 200, or its own guard's refusal
      // where the ledger says the route is gated on something else.
      expect(res.statusCode, key).toBe(
        CHANNEL_ACCESS_OPEN_UNDOCUMENTED_ROUTES[key]?.anonymousStatus ?? 200,
      );
    }
  });

  it('every ledger entry gives an owner and a reason', () => {
    for (const [key, entry] of Object.entries({
      ...CHANNEL_ACCESS_OPEN_ROUTES,
      ...CHANNEL_ACCESS_OPEN_UNDOCUMENTED_ROUTES,
    })) {
      expect(entry.owner, key).not.toBe('');
      expect(entry.reason.length, key).toBeGreaterThan(10);
    }
  });
});
