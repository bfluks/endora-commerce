import {
  patchProductScopesRequestSchema,
  type CatalogCategoryWritePort,
  type CatalogProductScopeWritePort,
  type CatalogProductWritePort,
  type CatalogPromoAttributePort,
  type PatchProductScopesRequest,
  type ProductScopeWriteInput,
} from '@endora-commerce/contracts';
import type { ProductScopesService } from './product-scopes.service.js';
import type { UrlKeyService } from './url-key.service.js';
import type { CatalogAdminService } from './catalog-admin.service.js';
import type { CatalogQueryService } from './catalog-query.service.js';
import type { CategoryAdminService } from './category-admin.service.js';
import { toCatalogCategoryRecord } from './catalog-category-read.service.js';
import {
  toCatalogProductRecord,
  toCatalogProductVariantRecord,
} from './catalog-product-read.service.js';

/**
 * The published write surface of `catalog` (feature 075, Phase P).
 *
 * Each adapter here does exactly two things: it narrows a large admin service
 * to the methods a consumer measurably calls, and it maps the entities those
 * methods return into records. `CatalogAdminService` is 1900 lines and
 * `pim_ergonode` calls ten of its methods; publishing the class would publish
 * the other hundred and freeze them.
 *
 * The services arrive as getters rather than values so the adapter resolves
 * them from the container per call — they are this module's own gated ports,
 * and a singleton may not hold a gate.
 */

export function createCatalogProductWritePort(
  getService: () => CatalogAdminService,
): CatalogProductWritePort {
  return {
    async createProduct(req, auditCtx) {
      return toCatalogProductRecord(await getService().createProduct(req, auditCtx));
    },
    async updateProduct(id, req) {
      return toCatalogProductRecord(await getService().updateProductAudited(id, req));
    },
    listAttributes: () => getService().listAttributes(),
    listAttributesByFlag: (flag) => getService().listAttributesByFlag(flag),
    createAttribute: (req) => getService().createAttribute(req),
    updateAttributeByIdOrKey: (idOrKey, req, auditCtx) =>
      getService().updateAttributeByIdOrKey(idOrKey, req, auditCtx),
    addAttributeOption: (attributeIdOrKey, input) =>
      getService().addAttributeOption(attributeIdOrKey, input),
    patchAttributeOption: (optionId, input) => getService().patchAttributeOption(optionId, input),
    async createVariant(parentProductId, req) {
      return toCatalogProductVariantRecord(await getService().createVariant(parentProductId, req));
    },
    async updateVariant(parentProductId, variantId, req) {
      return toCatalogProductVariantRecord(
        await getService().updateVariant(parentProductId, variantId, req),
      );
    },
    deleteVariant: (parentProductId, variantId) =>
      getService().deleteVariant(parentProductId, variantId),
  };
}

export function createCatalogCategoryWritePort(
  getService: () => CategoryAdminService,
): CatalogCategoryWritePort {
  return {
    async listAll() {
      return (await getService().listAll()).map(toCatalogCategoryRecord);
    },
    async create(input) {
      return toCatalogCategoryRecord(await getService().create(input));
    },
    async update(id, input) {
      return toCatalogCategoryRecord(await getService().update(id, input));
    },
    setInventoryThresholds: (id, patch) => getService().setInventoryThresholds(id, patch),
  };
}

/**
 * `promotions` builds its rule editor from two questions and reaches
 * `CatalogQueryService` — the 1400-line storefront query service — for them.
 */
export function createCatalogPromoAttributePort(
  getService: () => CatalogQueryService,
): CatalogPromoAttributePort {
  return {
    promoRuleAttributeKeys: () => getService().promoRuleAttributeKeys(),
    getAttributeWithOptions: (key) => getService().getAttributeWithOptions(key),
  };
}

/**
 * Feature 163 (R17, `contracts/url-keys-and-redirects.md` §5) — the scoped write
 * of a connector or an importer.
 *
 * It writes only the scopes the input names, so a connector writing global values
 * removes no operator override (FR-091). Status, window, audience and order rules
 * go through `ProductScopesService` — the operator's Command, its validation
 * (FR-014: a value for a channel the product is not in is refused) and its event;
 * URL keys through `UrlKeyService` in import mode, where a key another product
 * holds is not written and is reported, and a redirect is never taken over
 * (FR-093). No completeness gate runs on this path (A-6).
 */
export function createCatalogProductScopeWritePort(
  getScopes: () => ProductScopesService,
  getUrlKeys: () => UrlKeyService,
): CatalogProductScopeWritePort {
  return {
    async applyScopes(productId, input, options) {
      const request = toScopesPatch(input);
      if (request.channels.length > 0 || request.global !== undefined) {
        // The write alone (checkpoint C code review, N2): an integration reads nothing
        // back, and passes no completeness mode — it is never gated (A-6).
        await getScopes().writeStatus(productId, request);
      }
      const urlKeys = input.urlKeys?.length ? await getUrlKeys().importKeys(productId, input.urlKeys, options.source) : [];
      return { urlKeys };
    },
  };
}

const isoOrNull = (value: Date | null): string | null => (value === null ? null : value.toISOString());

/** The input as the scopes PATCH body: one entry per channel named, only the keys named. */
export function toScopesPatch(input: ProductScopeWriteInput): PatchProductScopesRequest {
  const channels = new Map<string, PatchProductScopesRequest['channels'][number]>();
  const entry = (channelId: string): PatchProductScopesRequest['channels'][number] => {
    let found = channels.get(channelId);
    if (!found) {
      found = { channelId };
      channels.set(channelId, found);
    }
    return found;
  };
  let global: PatchProductScopesRequest['global'];
  for (const status of input.status ?? []) {
    const target = entry(status.channelId);
    if (status.languageCode === null) {
      target.status = status.value;
    } else {
      target.languageStatuses = [
        ...(target.languageStatuses ?? []),
        { languageCode: status.languageCode, status: status.value },
      ];
    }
  }
  for (const window of input.window ?? []) {
    if (window.channelId === null) {
      // The global window is a pair; "use inherited" has no meaning there, so `null` opens both ends.
      global = { publishFrom: isoOrNull(window.value?.from ?? null), publishUntil: isoOrNull(window.value?.until ?? null) };
    } else {
      entry(window.channelId).window =
        window.value === null ? null : { from: isoOrNull(window.value.from), until: isoOrNull(window.value.until) };
    }
  }
  for (const audience of input.audience ?? []) {
    entry(audience.channelId).audience = audience.value;
  }
  for (const rules of input.orderRules ?? []) {
    const target = entry(rules.channelId);
    if (rules.minOrderQuantity !== undefined) target.minOrderQuantity = rules.minOrderQuantity;
    if (rules.returnable !== undefined) target.returnable = rules.returnable;
  }
  return patchProductScopesRequestSchema.parse({
    channels: [...channels.values()],
    ...(global !== undefined ? { global } : {}),
  });
}
