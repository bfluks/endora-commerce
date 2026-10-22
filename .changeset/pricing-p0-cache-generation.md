---
'@endora-commerce/mod-price-lists': minor
---

The pricing cache is invalidated after commit and across processes (D-287 P0).

- **Invalidate after commit.** Every audited `PriceListService` write (and `patch`) now clears the pricing cache once `CommandBus.run` has returned, i.e. after the transaction committed — it used to clear it inside the command's `run` callback, so a read racing the write could re-cache the pre-write price for the whole 60 s TTL. A write that changed nothing clears nothing. `PricingCache` gains a `generation` counter and `set(key, value, generation?)`: an answer whose resolution began before an invalidation is returned to its caller but not stored.
- **Cross-replica invalidation.** New `PricingGeneration` (`services/pricing-generation.ts`): a bump clears this process's LRU and publishes on the Redis channel `b2b:price_lists:pricing-generation`; every process subscribes on boot (through the composition's shared `redisSubscriber`) and clears its own LRU. Publishing is best-effort; a lost message degrades to the 60 s TTL, the previous behaviour. The module now resolves `redis` and `redisSubscriber` from the container; `priceListsModule` takes an optional `pricingGenerationPublisher`, and its handle exposes `pricingGeneration`.
- **The status sweeper invalidates.** `PriceListStatusWorker` takes the cache as a second constructor argument and clears it after a sweep that activated or expired at least one list (an idle tick clears nothing). The test-only `POST /api/v1/admin/price-lists-engine/internal/sweep` route now runs the module's own worker instance; `PricingRoutesDeps` gains `statusWorker`.
