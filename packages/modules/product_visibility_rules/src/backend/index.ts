import type { ModuleContext } from '@endora-commerce/platform/kernel';
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

/**
 * `product_visibility_rules` — composition (`specs/conventions/module-composition.md`).
 *
 * Spec 193 Phase 1 lands the schema and the manifest only; services, routes, workers,
 * subscribers and ports are registered here by the phases that build them.
 */
export function registerModule(_ctx: ModuleContext): void {
  // Nothing is composed yet.
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
