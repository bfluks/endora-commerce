import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  PRODUCT_VISIBILITY_AUDIT_READ_PERMISSION,
  type AdminProductVisibilityScope,
  type AdminRolePort,
  type CatalogueReferencePricePort,
  type CurrencyReadPort,
  type DesignationNotInForceReason,
  type PermissionReadPort,
  type ProductVisibilityCategory,
  type ProductVisibilityCategoryCreateBody,
  type ProductVisibilityCategoryUpdateBody,
  type ProductVisibilityDesignationBody,
  type ProductVisibilityDesignationOptionsResponse,
  type ProductVisibilityDesignationResponse,
  type ProductVisibilityMappingTarget,
  type ProductVisibilityOverviewResponse,
  type ProductVisibilityRoleMappingResponse,
  type VisibilityCondition,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import {
  categoryCreateCommand,
  categoryDeleteCommand,
  categoryUpdateCommand,
  designationClearCommand,
  designationSetCommand,
  roleMappingSetCommand,
  type CategoryResult,
} from '../commands/config-commands.js';
import { CataloguePriceDesignation } from '../entities/catalogue-price-designation.entity.js';
import { CataloguePriceGeneration } from '../entities/catalogue-price-generation.entity.js';
import { ProductRule } from '../entities/product-rule.entity.js';
import { VisibilityCategoryCondition } from '../entities/visibility-category-condition.entity.js';
import { VisibilityCategory } from '../entities/visibility-category.entity.js';
import { VisibilityRoleMapping } from '../entities/visibility-role-mapping.entity.js';
import { WebsiteRuleAttachment } from '../entities/website-rule-attachment.entity.js';
import type { CataloguePriceFlagsScheduler } from './catalogue-price-flags-scheduler.js';
import { isRoleMappable, roleEffect, roleScopeKind } from './role-visibility.js';

/** RQ-1 A — the reasons a designation is refused; `not_active` and `outside_schedule` are accepted. */
const REFUSING_REASONS: ReadonlySet<DesignationNotInForceReason> = new Set([
  'not_found',
  'currency_mismatch',
  'not_regular',
  'audience_restricted',
  'not_on_channel',
]);

export interface VisibilityConfigDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: { run<T>(command: Command<T>): Promise<T> };
  /** Ports of other modules, resolved per call (`lazyPort`), never captured. */
  readonly currencies: () => CurrencyReadPort;
  readonly roles: () => Pick<AdminRolePort, 'list' | 'getById'>;
  readonly permissions: () => Pick<PermissionReadPort, 'resolveRole'>;
  readonly prices: () => Pick<CatalogueReferencePricePort, 'designationStatus' | 'designationStatuses' | 'designatableBooks'>;
  readonly flagsScheduler: CataloguePriceFlagsScheduler;
}

function toTarget(row: VisibilityRoleMapping): ProductVisibilityMappingTarget {
  return row.target === 'category' && row.visibilityCategoryId
    ? { kind: 'category', categoryId: row.visibilityCategoryId }
    : { kind: 'unrestricted' };
}

/**
 * The configuration of `product_visibility_rules` (`specs/193-product-visibility-rules/` US2;
 * FR-010 – FR-014, FR-020 – FR-026, FR-086, RQ-1 A). Validates against the modules that own
 * what a write names — currencies, roles, price books — then runs one audited Command per write
 * (FR-070). Nothing is cached: a change applies to the next request (FR-060).
 */
export class VisibilityConfigService {
  constructor(private readonly deps: VisibilityConfigDeps) {}

  /**
   * TM-4 c — the kind of scope an administrator acts under, from their one role (FR-021) and
   * its stored mapping (R-13). A role refusal is never read as unrestricted (TM-3 (4)).
   */
  async scopeKindOf(adminUserId: string): Promise<AdminProductVisibilityScope['kind']> {
    const resolution = await this.deps.permissions().resolveRole(adminUserId);
    if (!resolution.role) return 'no_category';
    const row = await this.deps.emFactory().findOne(VisibilityRoleMapping, { adminRoleId: resolution.role.id });
    return roleScopeKind(resolution.role, row ? toTarget(row) : null).kind;
  }

  async overview(): Promise<ProductVisibilityOverviewResponse> {
    const em = this.deps.emFactory();
    const [currencies, roles, categories, conditions, mappings, designations, generations, rules, attachments] = await Promise.all([
      this.deps.currencies().list(),
      this.deps.roles().list(),
      em.find(VisibilityCategory, {}, { orderBy: { name: 'asc' } }),
      em.find(VisibilityCategoryCondition, {}),
      em.find(VisibilityRoleMapping, {}),
      em.find(CataloguePriceDesignation, {}),
      em.find(CataloguePriceGeneration, {}),
      em.find(ProductRule, {}, { orderBy: { name: 'asc' } }),
      em.find(WebsiteRuleAttachment, {}),
    ]);
    const liveRoleIds = new Set(roles.map((r) => r.id));
    const mappingByRole = new Map(mappings.filter((m) => liveRoleIds.has(m.adminRoleId)).map((m) => [m.adminRoleId, m]));
    const designationByCurrency = new Map(designations.map((d) => [d.currencyCode, d]));
    const statuses = await this.deps.prices().designationStatuses(
      designations.map((d) => ({ currencyCode: d.currencyCode, priceListId: d.priceListId, salesChannelId: d.salesChannelId })),
    );
    const statusByCurrency = new Map(designations.map((d, i) => [d.currencyCode, statuses[i] ?? null]));
    const generationByCurrency = new Map(generations.map((g) => [g.currencyCode, g]));

    // FR-012 — every active currency, and an inactive one while a condition or a designation names it.
    const used = new Set<string>([...conditions.map((c) => c.currencyCode), ...designations.map((d) => d.currencyCode)]);
    const listed = currencies.filter((c) => c.isActive || used.has(c.code));
    const known = new Set(listed.map((c) => c.code));
    const unknownUsed = [...used].filter((code) => !known.has(code)).sort();

    return {
      currencies: [
        ...listed.map((c) => ({ code: c.code, active: c.isActive })),
        ...unknownUsed.map((code) => ({ code, active: false })),
      ].map(({ code, active }) => {
        const designation = designationByCurrency.get(code);
        const generation = generationByCurrency.get(code);
        return {
          code,
          active,
          designation: designation ? { priceListId: designation.priceListId, salesChannelId: designation.salesChannelId } : null,
          designationStatus: designation ? (statusByCurrency.get(code) ?? null) : null,
          servedGeneration: generation?.servedGeneration ?? null,
          building: generation?.buildingGeneration !== null && generation?.buildingGeneration !== undefined,
        };
      }),
      categories: categories.map((c) =>
        this.#categoryDto(
          c,
          conditions.filter((x) => x.visibilityCategoryId === c.id),
          [...mappingByRole.values()].filter((m) => m.visibilityCategoryId === c.id).map((m) => m.adminRoleId),
        ),
      ),
      roles: roles.map((role) => {
        const row = mappingByRole.get(role.id);
        const target = row ? toTarget(row) : null;
        const effect = roleEffect(role, target);
        const restricted = effect === 'mapped' || effect === 'sees_no_products';
        return {
          roleId: role.id,
          code: role.code,
          name: role.name,
          effect,
          ...(target?.kind === 'category' ? { categoryId: target.categoryId } : {}),
          warnings: restricted && role.permissions.includes(PRODUCT_VISIBILITY_AUDIT_READ_PERMISSION) ? ['audit_logs_read' as const] : [],
        };
      }),
      productRules: rules.map((r) => ({ id: r.id, name: r.name, version: r.version })),
      websiteRuleAttachments: attachments.map((a) => ({
        salesChannelId: a.salesChannelId,
        productRuleId: a.productRuleId,
        attachedAt: a.attachedAt.toISOString(),
      })),
    };
  }

  async createCategory(body: ProductVisibilityCategoryCreateBody): Promise<ProductVisibilityCategory> {
    await this.#assertCurrencies(body.conditions, []);
    const { category, conditions } = await this.deps.commandBus.run(categoryCreateCommand(body));
    return this.#categoryDto(category, conditions, []);
  }

  async updateCategory(
    id: string,
    body: ProductVisibilityCategoryUpdateBody,
    expectedVersion: number | undefined,
  ): Promise<ProductVisibilityCategory> {
    const em = this.deps.emFactory();
    if (body.conditions) {
      const stored = await em.find(VisibilityCategoryCondition, { visibilityCategoryId: id });
      await this.#assertCurrencies(body.conditions, stored.map((c) => c.currencyCode));
    }
    const result: CategoryResult = await this.deps.commandBus.run(categoryUpdateCommand(id, body, expectedVersion));
    const mapped = await em.find(VisibilityRoleMapping, { visibilityCategoryId: id });
    const live = new Set((await this.deps.roles().list()).map((r) => r.id));
    return this.#categoryDto(result.category, result.conditions, mapped.map((m) => m.adminRoleId).filter((r) => live.has(r)));
  }

  async deleteCategory(id: string, expectedVersion: number | undefined): Promise<void> {
    const live = new Set((await this.deps.roles().list()).map((r) => r.id));
    await this.deps.commandBus.run(categoryDeleteCommand(id, expectedVersion, live));
  }

  async setRoleMapping(roleId: string, target: ProductVisibilityMappingTarget | null): Promise<ProductVisibilityRoleMappingResponse> {
    const role = await this.deps.roles().getById(roleId);
    // FR-022, FR-026 — clearing a stored mapping stays possible; setting one never is.
    if (target !== null && !isRoleMappable(role)) {
      throw new HttpError(
        409,
        ERROR_CODES.ROLE_NOT_MAPPABLE,
        'This role always sees every product and cannot be mapped.',
        [{ path: 'roleId', issue: role.code }],
      );
    }
    const { target: stored } = await this.deps.commandBus.run(roleMappingSetCommand(role.id, target));
    return { roleId: role.id, target: stored };
  }

  async setDesignation(currencyCode: string, body: ProductVisibilityDesignationBody): Promise<ProductVisibilityDesignationResponse> {
    await this.#assertCurrencies([{ currencyCode }], [], 'currencyCode');
    const status = await this.deps.prices().designationStatus({ currencyCode, ...body });
    if (!status.inForce && REFUSING_REASONS.has(status.reason)) {
      throw new HttpError(
        422,
        ERROR_CODES.DESIGNATION_INVALID,
        'This price book cannot be the catalogue price of the currency.',
        [{ path: 'priceListId', issue: status.reason }],
      );
    }
    const { changed } = await this.deps.commandBus.run(designationSetCommand(currencyCode, body));
    // T023 — a new designation rebuilds the currency's flags; until then it contributes no
    // condition (TM-7 (4)).
    if (changed) await this.deps.flagsScheduler.requestCurrencyRebuild(currencyCode);
    return { currencyCode, designation: { ...body }, designationStatus: status };
  }

  async clearDesignation(currencyCode: string): Promise<ProductVisibilityDesignationResponse> {
    const { changed } = await this.deps.commandBus.run(designationClearCommand(currencyCode));
    if (changed) await this.deps.flagsScheduler.requestCurrencyRebuild(currencyCode);
    return { currencyCode, designation: null, designationStatus: null };
  }

  async designationOptions(currencyCode: string): Promise<ProductVisibilityDesignationOptionsResponse> {
    return { items: [...(await this.deps.prices().designatableBooks(currencyCode))] };
  }

  /**
   * FR-012 — a condition names an active currency. One already stored on the category stays
   * accepted after its currency is deactivated (it is shown inactive and never met).
   */
  async #assertCurrencies(
    conditions: ReadonlyArray<Pick<VisibilityCondition, 'currencyCode'>>,
    alreadyStored: readonly string[],
    pathOf: 'conditions' | 'currencyCode' = 'conditions',
  ): Promise<void> {
    const active = new Set((await this.deps.currencies().listActive()).map((c) => c.code));
    const stored = new Set(alreadyStored);
    const issues = conditions.flatMap((c, i) =>
      active.has(c.currencyCode) || stored.has(c.currencyCode)
        ? []
        : [{ path: pathOf === 'conditions' ? `conditions.${i}.currencyCode` : 'currencyCode', issue: 'not an active currency' }],
    );
    if (issues.length > 0) throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Only an active currency can be chosen.', issues);
  }

  #categoryDto(
    category: VisibilityCategory,
    conditions: ReadonlyArray<Pick<VisibilityCondition, 'currencyCode' | 'threshold'>>,
    mappedRoleIds: readonly string[],
  ): ProductVisibilityCategory {
    return {
      id: category.id,
      name: category.name,
      version: category.version,
      conditions: [...conditions]
        .map((c) => ({ currencyCode: c.currencyCode.trim(), threshold: c.threshold }))
        .sort((a, b) => (a.currencyCode + a.threshold).localeCompare(b.currencyCode + b.threshold)),
      mappedRoleIds: [...mappedRoleIds].sort(),
    };
  }
}
