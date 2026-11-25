import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type {
  AdminRolePort,
  AuditReferenceRegistryPort,
  CatalogueReferencePricePort,
  CurrencyReadPort,
  PermissionReadPort,
} from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { lazyPort, type ModuleContext, type RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { registerProductVisibilityAuditReferences } from './services/audit-references.js';
import { loggingFlagsScheduler, type CataloguePriceFlagsScheduler } from './services/catalogue-price-flags-scheduler.js';
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
  /**
   * T023 — where a designation change asks for its currency's flag rebuild. A contribution
   * point, defaulted to a scheduler that logs: the flags worker arrives in Phase 4.
   */
  readonly productVisibilityFlagsScheduler: CataloguePriceFlagsScheduler;
  readonly productVisibilityConfig: VisibilityConfigService;
}

/**
 * `product_visibility_rules` — composition (`specs/conventions/module-composition.md`).
 *
 * Phase 3 (`specs/193-product-visibility-rules/` US2) composes the configuration: the
 * service behind `/api/v1/admin/product-visibility`, its routes (gated on the module's
 * presence by `ctx.routes`, FR-073, FR-077) and its audit references. Ports of other modules
 * are resolved per call with `lazyPort`, never captured.
 */
export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    productVisibilityFlagsScheduler: ctx.asFunction(() => loggingFlagsScheduler(ctx.log)).singleton(),
    productVisibilityConfig: ctx
      .asFunction(
        ({ emFactory, commandBus, productVisibilityFlagsScheduler }: ProductVisibilityRulesCradle) =>
          new VisibilityConfigService({
            emFactory,
            commandBus,
            currencies: () => lazyPort<CurrencyReadPort>(ctx, 'currencyReadPort'),
            roles: () => lazyPort<AdminRolePort>(ctx, 'adminRolePort'),
            permissions: () => lazyPort<PermissionReadPort>(ctx, 'permissionService'),
            prices: () => lazyPort<CatalogueReferencePricePort>(ctx, 'catalogueReferencePricePort'),
            flagsScheduler: productVisibilityFlagsScheduler,
          }),
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    const { requireAdmin, productVisibilityConfig } = ctx.cradle<ProductVisibilityRulesCradle>();
    await registerProductVisibilityAdminRoutes(app, {
      requireAdmin,
      resolveAdminUserId: (request) => ctx.cradle<ProductVisibilityRulesCradle>().adminContextResolver(request).adminUserId,
      callerScopeKind: (adminUserId) => productVisibilityConfig.scopeKindOf(adminUserId),
      config: productVisibilityConfig,
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
