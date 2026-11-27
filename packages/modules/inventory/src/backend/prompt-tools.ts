import {
  SearchWarehousesParamsSchema,
  SetStockLevelParamsSchema,
  type CatalogCategoryReadPort,
  type CatalogProductReadPort,
  type PromptActionTool,
  type SearchWarehousesParams,
  type SetStockLevelParams,
  type ToolContext,
  isUuidShape,
} from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '@endora-commerce/platform/http';
import type { EventBus } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { StockLevel } from './entities/stock-level.entity.js';
import { Warehouse } from './entities/warehouse.entity.js';
import { StockLevelService } from './services/stock-level-service.js';
import { WarehouseService } from './services/warehouse-service.js';
import type { InventoryProductVisibility } from './services/admin-product-visibility.js';

/**
 * Inventory's contribution to the prompt-assistant tool catalogue
 * (feature 043, data-model §4): the warehouse resolver and the flagship
 * `set_stock_level` mutation. The mutation's preview is server-computed
 * from the same rows the execution will touch (FR-004), and execution
 * rides `StockLevelService.setOnHand` — the exact path of the manual
 * inventory screen, including its `stock_level.adjust` audit row.
 */

export interface InventoryPromptToolsDeps {
  emFactory: () => EntityManager;
  /** `catalogProductReadPort`, owned by `catalog` (feature 075, Phase C). */
  catalogProducts: CatalogProductReadPort;
  /** `catalogCategoryReadPort`, owned by `catalog` — read by the stock service. */
  catalogCategories: CatalogCategoryReadPort;
  eventBus?: EventBus;
  auditLogService?: AuditPort;
  /**
   * Spec 193 (T052, FR-081) — the invoking administrator's product visibility,
   * resolved per call: a hidden product is answered as a missing one and never
   * written. Absent (fixtures), nothing is narrowed.
   */
  productVisibility?: InventoryProductVisibility;
}

const RESULT_LIMIT = 20;

const productNotFound = () => new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');

export function inventoryPromptTools(deps: InventoryPromptToolsDeps): PromptActionTool[] {
  const warehouseService = new WarehouseService(deps.emFactory);
  const stockLevelService = new StockLevelService(
    deps.emFactory,
    deps.catalogProducts,
    deps.catalogCategories,
    deps.eventBus,
    deps.auditLogService,
  );
  /** Whether the product is hidden from the invoking administrator (FR-081). */
  const hiddenFrom = async (adminUserId: string, productId: string): Promise<boolean> =>
    deps.productVisibility
      ? deps.productVisibility.productHidden(await deps.productVisibility.scopeFor(adminUserId), productId)
      : false;

  const searchWarehouses: PromptActionTool<SearchWarehousesParams> = {
    id: 'inventory.search_warehouses',
    moduleId: 'inventory',
    kind: 'resolver',
    description:
      'Search warehouses by a name or code fragment (case-insensitive). Returns up to 20 matches as {id, label, code, active}.',
    requiredPermission: 'catalog:read',
    paramsSchema: SearchWarehousesParamsSchema,
    execute: async (params) => {
      const { items } = await warehouseService.list({ pageSize: 200 });
      const needle = params.q.toLowerCase();
      return items
        .filter(
          (w) =>
            w.name.toLowerCase().includes(needle) || w.code.toLowerCase().includes(needle),
        )
        .slice(0, RESULT_LIMIT)
        .map((w) => ({ id: w.id, label: w.name, code: w.code, active: w.active }));
    },
  };

  const setStockLevel: PromptActionTool<SetStockLevelParams> = {
    id: 'inventory.set_stock_level',
    moduleId: 'inventory',
    kind: 'mutation',
    description:
      'Set the ABSOLUTE on-hand stock quantity of a product in a warehouse. Resolve the product via catalog.search_products and the warehouse via inventory.search_warehouses first. This is captured into a plan the operator must confirm; it is not executed immediately.',
    requiredPermission: 'catalog:write',
    paramsSchema: SetStockLevelParamsSchema,
    preview: async (params, ctx: ToolContext) => {
      // D-75 — this module's own fork, not the caller's manager. A preview
      // reads committed rows only, so a fresh fork sees exactly what the
      // request's manager saw.
      const em = deps.emFactory();
      const product = await deps.catalogProducts.findById(params.productId);
      if (!product || (await hiddenFrom(ctx.adminUserId, product.id))) throw productNotFound();
      if (!isUuidShape(params.warehouseId)) throw new HttpError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
      const warehouse = await em.findOne(Warehouse, { id: params.warehouseId });
      if (!warehouse) throw new HttpError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found.');
      const level = await em.findOne(StockLevel, {
        productId: params.productId,
        warehouseId: params.warehouseId,
        variantId: null,
      });
      const current = level?.onHand ?? 0;
      return {
        headline: `Set stock of "${(product.name || product.sku)}" in warehouse "${warehouse.name}" to ${params.quantity}`,
        current: { onHand: current },
        affectedCount: 1,
        sample: [{ id: product.id, label: (product.name || product.sku) }],
      };
    },
    execute: async (params, ctx: ToolContext) => {
      // Spec 193 (FR-081, TM-3 (2)) — checked again at execution, for the invoking admin.
      if (await hiddenFrom(ctx.adminUserId, params.productId)) throw productNotFound();
      const result = await stockLevelService.setOnHand(
        {
          productId: params.productId,
          warehouseId: params.warehouseId,
          onHand: params.quantity,
        },
        {
          actorAdminUserId: ctx.adminUserId,
          ipAddress: ctx.auditCtx.ipAddress ?? null,
          userAgent: ctx.auditCtx.userAgent ?? null,
          requestId: ctx.auditCtx.requestId ?? null,
        },
      );
      return { before: result.before, after: result.after };
    },
  };

  return [searchWarehouses as PromptActionTool, setStockLevel as PromptActionTool];
}
