/**
 * The route option `salesChannelAccess` (`specs/154-sales-channel-access/`,
 * `contracts/channel-access-rule.md` §4).
 *
 * The kernel's channel resolver decides every non-administrative API request
 * against its resolved channel: an anonymous request only on a channel open to
 * anonymous visitors, a customer request only on a channel assigned to the
 * customer's Organization. A route whose caller is not a shopping visitor of a
 * store — or must be reachable to become one: signing in, registering, reading
 * the channel's identity, a provider or e-mail callback — declares itself
 * reachable whatever that rule says:
 *
 * ```ts
 * app.post('/api/v1/auth/customer/login', { config: { salesChannelAccess: 'open' } }, handler);
 * ```
 *
 * The channel is still resolved for such a route (an unknown or inactive one
 * still refuses) and the route's own guards still apply. Fastify matches the
 * route before `onRequest`, which is why the resolver hook can read the option.
 *
 * Declared as an ambient augmentation, carried by the `./http` barrel for its
 * side effect exactly as `request-actor.ts` is, so every consumer of the
 * subpath may write the option without naming this file. Exports nothing.
 */
declare module 'fastify' {
  interface FastifyContextConfig {
    /** `'open'`: reachable whatever the sales-channel access rule decides. */
    salesChannelAccess?: 'open';
  }
}

export {};
