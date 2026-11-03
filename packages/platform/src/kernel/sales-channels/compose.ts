import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { EventBus } from '../../events/bus.js';
import type { AuditPort } from '../ports/audit.js';
import { inProcessCaches } from '../cache/in-process-cache-registry.js';
import {
  SALES_CHANNELS_CACHE_NAMESPACE,
  SalesChannelsCache,
} from './sales-channels-cache.js';
import { SalesChannelResolverService } from './sales-channel-resolver.service.js';
import { SalesChannelMembershipService } from './sales-channel-membership.service.js';
import { channelBridges, type ChannelBridgeRegistry } from './channel-bridge-registry.js';
import { registerSalesChannelResolverMiddleware } from './sales-channel-resolver.middleware.js';
import {
  SALES_CHANNEL_ACCESS_CACHE_NAMESPACE,
  SalesChannelAccessCache,
} from './sales-channel-access-cache.js';
import { SalesChannelAccessPolicy } from './sales-channel-access-policy.js';

/**
 * The sales-channel resolution machinery, composed as kernel infrastructure
 * rather than as part of the `sales_channels` module (feature 072, T110).
 *
 * The split follows what the code already was after T019 moved these files
 * into `kernel/`: resolving which channel a request belongs to is something
 * every channel-scoped read depends on (Principle XII), and it has to keep
 * working whether or not an operator wants the channel *administration*
 * screens. Gating the middleware behind the module would mean switching
 * `sales_channels` off leaves every storefront request with no resolved
 * channel — not a smaller platform, a broken one.
 *
 * So the module keeps what is genuinely its own — the admin CRUD service, its
 * routes, its migrations and its settings — and this function composes the
 * rest for a composition root.
 */
export interface SalesChannelsKernelOptions {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly redis: Redis;
  /**
   * Feature 154 — the subscriber-mode connection the access cache listens on
   * for `b2b:sales-channel-access:changed`, armed when the resolver plugin is
   * mounted. Absent, other processes' assignment changes reach this one within
   * the LRU window.
   */
  readonly redisSubscriber?: Redis;
  readonly auditLogService?: AuditPort;
  /**
   * The bridge registry the owning modules contribute into (feature 120,
   * FR-015). Defaults to the process-level one, which is what every
   * composition root in this repository uses; a caller supplies its own only
   * to compose an isolated platform.
   */
  readonly bridgeRegistry?: ChannelBridgeRegistry;
  /**
   * Forwarded to the resolver middleware. Defaults to `false` so admin routes
   * keep working without `X-Sales-Channel`.
   */
  readonly strictAdmin?: boolean;
}

export interface SalesChannelsKernel {
  readonly cache: SalesChannelsCache;
  readonly resolver: SalesChannelResolverService;
  readonly membershipService: SalesChannelMembershipService;
  /**
   * Feature 154 — the per-Organization permitted-channel cache. A composition
   * root contributes it as `salesChannelAccessCache` (narrowed by its readers
   * to the invalidating half) and arms its cross-process subscription with
   * {@link SalesChannelAccessCache.watch}.
   */
  readonly accessCache: SalesChannelAccessCache;
  /**
   * Feature 154 — the access rule, run by the resolver middleware and
   * contributed as `salesChannelAccessPort` for the sign-in paths.
   */
  readonly accessPolicy: SalesChannelAccessPolicy;
  /**
   * The channel-bridge contribution registry (feature 120, FR-015).
   *
   * A composition root contributes it to the container as
   * `salesChannelBridgeRegistry`, which is the name each owning module resolves
   * from its boot hook to declare the one bridge it owns. The platform holds no
   * map of its own: a member no module registered refuses rather than reaching
   * a relation an instance that omits that module does not have.
   */
  readonly bridgeRegistry: ChannelBridgeRegistry;
  /**
   * Withdraws this process's cache from the operator-facing clear. Released
   * for tests; in production it lives until process exit.
   */
  readonly cacheRegistration: { readonly dispose: () => void };
  /** The resolver middleware, mounted by the root and never module-gated. */
  readonly plugin: (app: FastifyInstance) => Promise<void>;
}

export function composeSalesChannelsKernel(
  options: SalesChannelsKernelOptions,
): SalesChannelsKernel {
  const cache = new SalesChannelsCache(options.redis);
  const resolver = new SalesChannelResolverService(options.emFactory, cache);
  const bridgeRegistry = options.bridgeRegistry ?? channelBridges;
  // Built before the membership service, which drops it as part of every write
  // of an Organization's channels; its loader reads through that same service,
  // late-bound, so neither has to exist first.
  let membershipService!: SalesChannelMembershipService;
  const accessCache = new SalesChannelAccessCache(options.redis, (organizationId) =>
    membershipService.listChannelIdsForEntity('organization', organizationId),
  );
  membershipService = new SalesChannelMembershipService(
    options.emFactory,
    options.eventBus,
    options.auditLogService,
    bridgeRegistry,
    accessCache,
  );
  const accessPolicy = new SalesChannelAccessPolicy(accessCache, (id) => resolver.getById(id));
  /**
   * The one thing composing the cache still has to *do*: announce it to the
   * operator-facing "clear cache" action (issue #33). The clear runs in this
   * process and has to reach the object that owns both layers, or it drops the
   * Redis keys while every warm process keeps serving — and re-pinning — the
   * channel it had already resolved.
   *
   * It used to ride on `attachSalesChannelsCacheInvalidator`, which also
   * subscribed to `sales_channels.identity_changed` and
   * `sales_channels.lifecycle_changed`. Those subscriptions are gone (D-93);
   * the registration is not, because it never had anything to do with the bus.
   */
  const unregister = inProcessCaches.register(SALES_CHANNELS_CACHE_NAMESPACE, cache);
  const unregisterAccess = inProcessCaches.register(
    SALES_CHANNEL_ACCESS_CACHE_NAMESPACE,
    accessCache,
  );

  return {
    cache,
    resolver,
    membershipService,
    accessCache,
    accessPolicy,
    bridgeRegistry,
    cacheRegistration: {
      dispose: () => {
        unregister();
        unregisterAccess();
      },
    },
    plugin: async (app) => {
      // Never fatal: a lost notification channel means stale for the LRU
      // window, not open.
      if (options.redisSubscriber) await accessCache.watch(options.redisSubscriber);
      await registerSalesChannelResolverMiddleware(app, {
        resolver,
        accessPolicy,
        ...(options.strictAdmin !== undefined ? { strictAdmin: options.strictAdmin } : {}),
        // Feature 062 — audit sink for bound-key channel-mismatch refusals.
        ...(options.auditLogService !== undefined
          ? { auditLogService: options.auditLogService }
          : {}),
      });
    },
  };
}
