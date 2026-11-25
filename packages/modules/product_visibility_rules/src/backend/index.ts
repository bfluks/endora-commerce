import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import {
  CATALOGUE_PRICES_CHANGED_EVENT,
  type AdminProductVisibilityPort,
  type AdminRolePort,
  type AuditReferenceRegistryPort,
  type CatalogProductReadPort,
  type CatalogueReferencePricePort,
  type CurrencyReadPort,
  type PermissionReadPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  effectiveState,
  enterSystemScope,
  lazyPort,
  type ModuleContext,
  type RequireAdminFactory,
} from '@endora-commerce/platform/kernel';
import { registerProductVisibilityAuditReferences } from './services/audit-references.js';
import { AdminVisibilityScopeService } from './services/admin-visibility-scope.js';
import { handleCataloguePricesChanged } from './services/catalogue-price-change-feed.js';
import { CataloguePriceFlags } from './services/catalogue-price-flags.js';
import type { CataloguePriceFlagsScheduler } from './services/catalogue-price-flags-scheduler.js';
import { createFlagsProducer, startFlagsWorker, type FlagsProducer } from './workers/catalogue-price-flags-worker.js';
import { VisibilityConfigService } from './services/visibility-config.service.js';
import { registerProductVisibilityAdminRoutes } from './routes.admin.js';
import { CataloguePriceDesignation } from './entities/catalogue-price-designation.entity.js';
import { CataloguePriceGeneration } from './entities/catalogue-price-generation.entity.js';
import { CataloguePriceStaleProduct } from './entities/catalogue-price-stale-product.entity.js';
import { ProductCataloguePrice } from './entities/product-catalogue-price.entity.js';
import { ProductRule } from './entities/product-rule.entity.js';
import { VariantCataloguePrice } from './entities/variant-catalogue-price.entity.js';
import { VisibilityCategoryCondition } from './entities/visibility-category-condition.entity.js';
import { VisibilityCategory } from './entities/visibility-category.entity.js';
import { VisibilityRoleMapping } from './entities/visibility-role-mapping.entity.js';
import { WebsiteRuleAdmission } from './entities/website-rule-admission.entity.js';
import { WebsiteRuleAttachment } from './entities/website-rule-attachment.entity.js';
import { WebsiteRulePreviewChange } from './entities/website-rule-preview-change.entity.js';
import { WebsiteRulePreview } from './entities/website-rule-preview.entity.js';
import { WebsiteRuleStaleProduct } from './entities/website-rule-stale-product.entity.js';

/** What `product_visibility_rules` resolves from the container, and the names it owns. */
export interface ProductVisibilityRulesCradle {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly adminContextResolver: (request: FastifyRequest) => { adminUserId: string };
  /** The composition's queue connection, when it has one, and whether this process consumes queues. */
  readonly moduleQueueRedis: Redis | undefined;
  readonly processRunsWorkers: boolean;
  readonly productVisibilityFlags: CataloguePriceFlags;
  readonly productVisibilityFlagsProducer: FlagsProducer;
  /** T023 — where a designation change asks for its currency's flag rebuild: a durable request, then a pass. */
  readonly productVisibilityFlagsScheduler: CataloguePriceFlagsScheduler;
  readonly productVisibilityScope: AdminVisibilityScopeService;
  readonly productVisibilityConfig: VisibilityConfigService;
}

/**
 * `product_visibility_rules` — composition (`specs/conventions/module-composition.md`).
 *
 * The configuration (Phase 3): the service behind `/api/v1/admin/product-visibility`, its routes
 * (gated on the module's presence by `ctx.routes`, FR-073, FR-077) and its audit references. The
 * admin scope (Phase 4): the catalogue-price flags, their worker, the price change feed and
 * `adminProductVisibilityPort`. Ports of other modules are resolved per call with `lazyPort`,
 * never captured.
 */
export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    productVisibilityFlags: ctx
      .asFunction(
        ({ emFactory }: ProductVisibilityRulesCradle) =>
          new CataloguePriceFlags({
            emFactory,
            prices: () => lazyPort<CatalogueReferencePricePort>(ctx, 'catalogueReferencePricePort'),
            listProductIds: async () =>
              (await lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort').listPricingRefs()).map((p) => p.id),
            activeCurrencies: async () => (await lazyPort<CurrencyReadPort>(ctx, 'currencyReadPort').listActive()).map((c) => c.code),
          }),
      )
      .singleton(),
    productVisibilityFlagsProducer: ctx
      .asFunction(({ moduleQueueRedis }: ProductVisibilityRulesCradle) => createFlagsProducer(moduleQueueRedis))
      .singleton(),
    productVisibilityFlagsScheduler: ctx
      .asFunction(
        ({ productVisibilityFlags, productVisibilityFlagsProducer }: ProductVisibilityRulesCradle): CataloguePriceFlagsScheduler => ({
          async requestCurrencyRebuild(currencyCode) {
            await productVisibilityFlags.requestRebuild([currencyCode]);
            await productVisibilityFlagsProducer.enqueuePass();
          },
        }),
      )
      .singleton(),
    productVisibilityScope: ctx
      .asFunction(
        () =>
          new AdminVisibilityScopeService({
            emFactory: () => ctx.cradle<ProductVisibilityRulesCradle>().emFactory(),
            permissions: () => lazyPort<PermissionReadPort>(ctx, 'permissionService'),
            currencies: () => lazyPort<CurrencyReadPort>(ctx, 'currencyReadPort'),
            prices: () => lazyPort<CatalogueReferencePricePort>(ctx, 'catalogueReferencePricePort'),
          }),
      )
      .singleton(),
    productVisibilityConfig: ctx
      .asFunction(
        ({ emFactory, commandBus, productVisibilityFlagsScheduler }: ProductVisibilityRulesCradle) =>
          new VisibilityConfigService({
            emFactory,
            commandBus,
            currencies: () => lazyPort<CurrencyReadPort>(ctx, 'currencyReadPort'),
            roles: () => lazyPort<AdminRolePort>(ctx, 'adminRolePort'),
            prices: () => lazyPort<CatalogueReferencePricePort>(ctx, 'catalogueReferencePricePort'),
            flagsScheduler: productVisibilityFlagsScheduler,
          }),
      )
      .singleton(),
  });

  /**
   * Container name: `adminProductVisibilityPort` (T034). Consumers (`catalog`, `price_lists`,
   * later `orders`, `quote_requests`) declare it `degrades-without`, probe
   * `effectiveState.isPresent('product_visibility_rules')` before resolving, and treat absent as
   * unrestricted; a call made while present is never caught. A SQL fragment is embedded inside
   * parentheses with its params in order; neither a scope nor a fragment is cached across
   * requests (FR-060, TM-8).
   */
  ctx.di.providePort<AdminProductVisibilityPort>(
    'adminProductVisibilityPort',
    ctx.asFunction(({ productVisibilityScope }: ProductVisibilityRulesCradle) => productVisibilityScope).singleton(),
  );

  ctx.routes(async (app) => {
    const { requireAdmin, productVisibilityConfig, productVisibilityScope } = ctx.cradle<ProductVisibilityRulesCradle>();
    await registerProductVisibilityAdminRoutes(app, {
      requireAdmin,
      resolveAdminUserId: (request) => ctx.cradle<ProductVisibilityRulesCradle>().adminContextResolver(request).adminUserId,
      callerScopeKind: async (adminUserId) => (await productVisibilityScope.resolveScope(adminUserId)).kind,
      config: productVisibilityConfig,
    });
  });

  /**
   * T028, T030 — the flags worker (`product_visibility_rules.flags`), its two-minute drift poll
   * and its nightly reconcile, attached with `ctx.worker` so they stop with the module.
   */
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<ProductVisibilityRulesCradle>();
    app.addHook('onClose', () => cradle.productVisibilityFlagsProducer.close());
    await startFlagsWorker({
      processRunsWorkers: cradle.processRunsWorkers,
      moduleQueueRedis: cradle.moduleQueueRedis,
      work: cradle.productVisibilityFlags,
      producer: cradle.productVisibilityFlagsProducer,
      log: ctx.log,
      attach: (worker) => ctx.worker(worker, { logger: app.log }),
      onClose: (close) => app.addHook('onClose', close),
    });
  });

  /**
   * T029 — a price change marks the products it names, or asks for a whole rebuild (R-6). The
   * marks are durable before the handler returns (TM-7 (5)); the pass is then asked for.
   * `ctx.subscribe`, so nothing runs while the module is off.
   */
  ctx.subscribe(CATALOGUE_PRICES_CHANGED_EVENT, async (payload: unknown) => {
    const { productVisibilityFlags, productVisibilityFlagsProducer } = ctx.cradle<ProductVisibilityRulesCradle>();
    await enterSystemScope('product_visibility_rules: mark catalogue-price changes', async () => {
      await handleCataloguePricesChanged(payload, productVisibilityFlags);
      await productVisibilityFlagsProducer.enqueuePass();
    });
  });

  /**
   * T031 — a **work** boot hook: give every active currency its flag generation and ask for a
   * pass. Presence is decided first, outside any `try` (`module-activation.md`): while off it
   * does nothing, and the drift poll does the same within two minutes of a re-enable.
   */
  ctx.onBoot(async () => {
    if (!effectiveState.isPresent('product_visibility_rules')) return;
    const { productVisibilityFlags, productVisibilityFlagsProducer } = ctx.cradle<ProductVisibilityRulesCradle>();
    await enterSystemScope('product_visibility_rules: bootstrap catalogue-price flags', async () => {
      if ((await productVisibilityFlags.ensureActiveCurrencies()).length > 0) await productVisibilityFlagsProducer.enqueuePass();
    });
  });

  /**
   * T022 — what an audit row of this module is called, and where the admin app shows it. A
   * **contribution** hook into an ungated registry: no presence probe (D-67/D-68); the
   * registry drops the entry while the module is absent.
   */
  ctx.onBoot(() => {
    registerProductVisibilityAuditReferences(
      lazyPort<AuditReferenceRegistryPort>(ctx, 'auditReferenceRegistry'),
      ctx.cradle<ProductVisibilityRulesCradle>().emFactory,
    );
  });
}

export const entities = [
  VisibilityCategory,
  VisibilityCategoryCondition,
  VisibilityRoleMapping,
  CataloguePriceDesignation,
  ProductRule,
  WebsiteRuleAttachment,
  CataloguePriceGeneration,
  ProductCataloguePrice,
  VariantCataloguePrice,
  CataloguePriceStaleProduct,
  WebsiteRulePreview,
  WebsiteRulePreviewChange,
  WebsiteRuleAdmission,
  WebsiteRuleStaleProduct,
];
