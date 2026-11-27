import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import {
  CATALOG_HOOKABLE_ACTIONS,
  CATALOGUE_PRICES_CHANGED_EVENT,
  type AdminProductVisibilityPort,
  type AdminRolePort,
  type AuditReferenceRegistryPort,
  type CatalogAttributeReadPort,
  type CatalogProductReadPort,
  type CatalogueReferencePricePort,
  type CurrencyReadPort,
  type PermissionReadPort,
  type ProductRuleGovernancePort,
  type ProductStatusHookData,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import {
  effectiveState,
  enterSystemScope,
  lazyPort,
  type ChannelMembershipGovernorRegistryPort,
  type ModuleContext,
  type RequireAdminFactory,
  type SalesChannelMembershipPort,
  type SalesChannelResolutionPort,
} from '@endora-commerce/platform/kernel';
import type { EventBus } from '@endora-commerce/platform/events';
import { registerProductVisibilityAuditReferences } from './services/audit-references.js';
import { AdminVisibilityScopeService } from './services/admin-visibility-scope.js';
import { handleCataloguePricesChanged } from './services/catalogue-price-change-feed.js';
import { CataloguePriceFlags } from './services/catalogue-price-flags.js';
import type { CataloguePriceFlagsScheduler } from './services/catalogue-price-flags-scheduler.js';
import { createFlagsProducer, startFlagsWorker, type FlagsProducer } from './workers/catalogue-price-flags-worker.js';
import { VisibilityConfigService } from './services/visibility-config.service.js';
import { WebsiteRuleGovernorHandle } from './services/membership-governor.js';
import { WebsiteRuleService } from './services/website-rule.service.js';
import { ProductRuleGovernance } from './services/product-rule-governance.js';
import {
  createPresenceEpochs,
  createWebsiteRuleProducer,
  recordPresenceTransitions,
  startWebsiteRuleWorker,
  type WebsiteRuleProducer,
} from './workers/website-rule-worker.js';
import { registerWebsiteRuleAdminRoutes } from './routes.website-rules.js';
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
  /** The platform's connection, where the website rule records presence changes every process sees. */
  readonly redis: Redis | undefined;
  readonly processRunsWorkers: boolean;
  readonly productVisibilityFlags: CataloguePriceFlags;
  readonly productVisibilityFlagsProducer: FlagsProducer;
  /** Where a designation change asks for its currency's flag rebuild: a durable request, then a pass. */
  readonly productVisibilityFlagsScheduler: CataloguePriceFlagsScheduler;
  readonly productVisibilityScope: AdminVisibilityScopeService;
  readonly productVisibilityConfig: VisibilityConfigService;
  readonly eventBus: EventBus;
  /** Phase 6 — the website rule and its queue producer. */
  readonly productVisibilityWebsiteRulesProducer: WebsiteRuleProducer;
  readonly productVisibilityWebsiteRules: WebsiteRuleService;
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
  /**
   * The website rule's governor write token lives in this closure, handed to the
   * website-rule service below and never registered in the container.
   */
  const websiteRuleGovernor = new WebsiteRuleGovernorHandle();

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
    // The website rule. The governor's write token reaches the service
    // through this closure (`websiteRuleGovernor`), never through the container (TM-10).
    productVisibilityWebsiteRulesProducer: ctx
      .asFunction(({ moduleQueueRedis }: ProductVisibilityRulesCradle) => createWebsiteRuleProducer(moduleQueueRedis))
      .singleton(),
    productVisibilityWebsiteRules: ctx
      .asFunction(
        ({ emFactory, commandBus, eventBus, productVisibilityWebsiteRulesProducer }: ProductVisibilityRulesCradle) =>
          new WebsiteRuleService({
            emFactory,
            commandBus,
            eventBus,
            membership: () => lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
            channels: () => lazyPort<SalesChannelResolutionPort>(ctx, 'salesChannelResolutionPort'),
            products: () => lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            attributes: () => lazyPort<CatalogAttributeReadPort>(ctx, 'catalogAttributeReadPort'),
            prices: () => lazyPort<CatalogueReferencePricePort>(ctx, 'catalogueReferencePricePort'),
            governor: websiteRuleGovernor,
            jobs: productVisibilityWebsiteRulesProducer,
          }),
      )
      .singleton(),
  });

  /**
   * Container name: `adminProductVisibilityPort`. Consumers (`catalog`, `price_lists`,
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

  /**
   * Container name: `productRuleGovernancePort` (FR-055). A connector declaring it
   * `degrades-without` probes presence first and reads absent as "nothing governed", as the
   * kernel does; a call made while off answers 503 `MODULE_DISABLED` (the `providePort` gate).
   */
  ctx.di.providePort<ProductRuleGovernancePort>(
    'productRuleGovernancePort',
    ctx
      .asFunction(
        ({ productVisibilityWebsiteRules }: ProductVisibilityRulesCradle) =>
          new ProductRuleGovernance({
            rules: productVisibilityWebsiteRules,
            membership: () => lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
            products: () => lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
          }),
      )
      .singleton(),
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

  /** The product-rule and website-rule routes, gated like the configuration's. */
  ctx.routes(async (app) => {
    const { requireAdmin, productVisibilityScope, productVisibilityWebsiteRules } = ctx.cradle<ProductVisibilityRulesCradle>();
    await registerWebsiteRuleAdminRoutes(app, {
      requireAdmin,
      resolveAdminUserId: (request) => ctx.cradle<ProductVisibilityRulesCradle>().adminContextResolver(request).adminUserId,
      callerScopeKind: async (adminUserId) => (await productVisibilityScope.resolveScope(adminUserId)).kind,
      websiteRules: productVisibilityWebsiteRules,
    });
  });

  /**
   * The website-rule worker (previews, snapshots, the steady state), stopped with the module; and,
   * in every process, the recorder of this module's presence changes the worker reconciles after
   * (R-15). Registration runs whatever the presence, and the recorder is ungated on purpose: it is
   * what remembers that the gated subscribers were silent here.
   */
  ctx.routes(async (app) => {
    const cradle = ctx.cradle<ProductVisibilityRulesCradle>();
    const epochs = createPresenceEpochs(cradle.redis);
    const stopRecording = recordPresenceTransitions({
      isPresent: () => effectiveState.isPresent('product_visibility_rules'),
      onPresenceInstalled: (listener) => effectiveState.onPresenceInstalled(listener),
      bump: () => epochs.bumpPresenceEpoch(),
      log: ctx.log,
    });
    app.addHook('onClose', async () => stopRecording());
    app.addHook('onClose', () => cradle.productVisibilityWebsiteRulesProducer.close());
    await startWebsiteRuleWorker({
      processRunsWorkers: cradle.processRunsWorkers,
      moduleQueueRedis: cradle.moduleQueueRedis,
      work: cradle.productVisibilityWebsiteRules,
      epochs,
      log: ctx.log,
      attach: (worker) => ctx.worker(worker, { logger: app.log }),
      onClose: (close) => app.addHook('onClose', close),
    });
  });

  /**
   * A product created, changed, archived or deleted is marked for re-evaluation on
   * every governed channel; the mark is durable before the debounced evaluation is asked for.
   * `ctx.subscribe`, so nothing runs while the module is off (the hourly reconcile after a
   * re-enable covers what happened meanwhile).
   */
  for (const event of ['product.created.v1', 'product.updated.v1', 'product.archived.v1', 'product.deleted.v1']) {
    ctx.subscribe(event, async (payload: unknown) => {
      const productId = (payload as { productId?: unknown } | null)?.productId;
      if (typeof productId !== 'string') return;
      const { productVisibilityWebsiteRules, productVisibilityWebsiteRulesProducer } = ctx.cradle<ProductVisibilityRulesCradle>();
      await enterSystemScope('product_visibility_rules: mark products for the website rule', async () => {
        await productVisibilityWebsiteRules.markProducts([productId]);
        await productVisibilityWebsiteRulesProducer.enqueueEvaluate();
      });
    });
  }

  /**
   * The reactivation hook on every catalog status writer, in the
   * writer's transaction: a product that becomes active again on a governed channel leaves it with
   * the governor token and is marked, so it is back only once the rule re-admits it. The bus skips
   * the hook while this module is off (FR-073).
   */
  const reactivation = ({ em, data }: { em: EntityManager; data: ProductStatusHookData }) =>
    ctx.cradle<ProductVisibilityRulesCradle>().productVisibilityWebsiteRules.applyStatusWrite(em, data);
  ctx.commandHooks([
    { id: 'reactivation-product-update', on: CATALOG_HOOKABLE_ACTIONS.productUpdate, phase: 'beforeCommit', handler: reactivation },
    { id: 'reactivation-product-restore', on: CATALOG_HOOKABLE_ACTIONS.productRestore, phase: 'beforeCommit', handler: reactivation },
    { id: 'reactivation-bulk-update-undo', on: CATALOG_HOOKABLE_ACTIONS.productBulkUpdateUndo, phase: 'beforeCommit', handler: reactivation },
    { id: 'reactivation-scopes-update', on: CATALOG_HOOKABLE_ACTIONS.productScopesUpdate, phase: 'beforeCommit', handler: reactivation },
    { id: 'reactivation-scoped-values-save', on: CATALOG_HOOKABLE_ACTIONS.productScopedValuesSave, phase: 'beforeCommit', handler: reactivation },
    { id: 'reactivation-scoped-values-import', on: CATALOG_HOOKABLE_ACTIONS.productScopedValuesImport, phase: 'beforeCommit', handler: reactivation },
  ]);

  /**
   * A sales channel deleted while governed leaves its attachment and admissions rows; they
   * are swept on every lifecycle change of a channel (a delete emits `sales_channels.lifecycle_changed`;
   * no dedicated delete event exists, and its payload — `channelCode` only — is not read: the sweep
   * asks which attached channels still resolve). Events missed while off are swept by the hourly
   * reconcile.
   */
  ctx.subscribe('sales_channels.lifecycle_changed', async () => {
    const { productVisibilityWebsiteRules } = ctx.cradle<ProductVisibilityRulesCradle>();
    await enterSystemScope('product_visibility_rules: sweep website-rule rows of deleted channels', async () => {
      const swept = await productVisibilityWebsiteRules.sweepDeletedChannels();
      if (swept.length > 0) ctx.log.info({ salesChannelIds: swept }, 'product_visibility_rules: swept website-rule rows of deleted sales channels');
    });
  });

  /**
   * The flags worker (`product_visibility_rules.flags`), its two-minute drift poll
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
   * A price change marks the products it names, or asks for a whole rebuild (R-6). The
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
   * A **work** boot hook: give every active currency its flag generation and ask for a
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
   * The website rule's channel-membership governor. A **contribution** hook: no
   * presence probe — the registry is sealed after boot and asks `isPresent` per mutation, so a
   * module switched on later governs from its next write and one switched off governs nothing.
   */
  ctx.onBoot(() => {
    websiteRuleGovernor.register(lazyPort<ChannelMembershipGovernorRegistryPort>(ctx, 'salesChannelMembershipGovernors'));
  });

  /**
   * What an audit row of this module is called, and where the admin app shows it. A
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
