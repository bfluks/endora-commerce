import { describe, expect, expectTypeOf, it } from 'vitest';
import Fastify, { type FastifyContextConfig } from 'fastify';
import './sales-channel-access-option.js';

/**
 * Feature 154 — a route may declare `config: { salesChannelAccess: 'open' }`,
 * and the resolver hook reads it from `request.routeOptions.config` in
 * `onRequest`, which only works because Fastify has matched the route by then.
 */
describe('salesChannelAccess route option', () => {
  it('is typed on the route config', () => {
    expectTypeOf<FastifyContextConfig['salesChannelAccess']>().toEqualTypeOf<'open' | undefined>();
    // @ts-expect-error — the only declared value is 'open'.
    const wrong: FastifyContextConfig = { salesChannelAccess: 'closed' };
    expect(wrong).toBeDefined();
  });

  it('is visible to an onRequest hook', async () => {
    const app = Fastify();
    const seen: Array<string | undefined> = [];
    app.addHook('onRequest', async (request) => {
      seen.push(request.routeOptions.config.salesChannelAccess);
    });
    app.get('/open', { config: { salesChannelAccess: 'open' } }, async () => ({ ok: true }));
    app.get('/gated', async () => ({ ok: true }));
    await app.inject({ method: 'GET', url: '/open' });
    await app.inject({ method: 'GET', url: '/gated' });
    await app.close();
    expect(seen).toEqual(['open', undefined]);
  });
});
