import { randomUUID } from 'node:crypto';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  ERROR_CODES,
  PRODUCT_VISIBILITY_AUDIT_ACTIONS as A,
  type ProductVisibilityMappingTarget,
  type VisibilityCondition,
} from '@endora-commerce/contracts';
import type { Command, CommandContext } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { CataloguePriceDesignation } from '../entities/catalogue-price-designation.entity.js';
import { VisibilityCategoryCondition } from '../entities/visibility-category-condition.entity.js';
import { VisibilityCategory } from '../entities/visibility-category.entity.js';
import { VisibilityRoleMapping } from '../entities/visibility-role-mapping.entity.js';

/**
 * The configuration Commands of `product_visibility_rules` (`specs/193-product-visibility-rules/`
 * FR-070, contracts/events-and-errors.md §3). Each is one `CommandBus.run`: one transaction,
 * one audit entry naming the actor, before and after. Every row here is platform-global
 * configuration (Principle XI, FR-075), so the audit state may carry its values
 * (`specs/conventions/audit-state.md` §5) — names, conditions, targets and book ids.
 * Validation against other modules (currencies, roles, books) is the caller's, before the
 * Command runs (`visibility-config.service.ts`); what a Command owns is its rows and their
 * invariants.
 */

type Em = CommandContext['em'];

/** The audit snapshot of a category. */
export type CategoryState = {
  readonly name: string;
  readonly version: number;
  readonly conditions: readonly VisibilityCondition[];
};

function sortConditions(conditions: readonly VisibilityCondition[]): VisibilityCondition[] {
  return [...conditions]
    .map((c) => ({ currencyCode: c.currencyCode.toUpperCase(), threshold: c.threshold }))
    .sort((a, b) => (a.currencyCode + a.threshold).localeCompare(b.currencyCode + b.threshold));
}

async function conditionsOf(em: Em, categoryId: string): Promise<VisibilityCondition[]> {
  const rows = await em.find(VisibilityCategoryCondition, { visibilityCategoryId: categoryId });
  return sortConditions(rows.map((r) => ({ currencyCode: r.currencyCode, threshold: r.threshold })));
}

function categoryState(category: VisibilityCategory, conditions: readonly VisibilityCondition[]): CategoryState {
  return { name: category.name, version: category.version, conditions: sortConditions(conditions) };
}

function nameTaken(): HttpError {
  return new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Another visibility category already has this name.', [
    { path: 'name', issue: 'already used by another visibility category' },
  ]);
}

/** Flush, turning the case-insensitive name index's refusal into the form's answer. */
async function flushNamed(em: Em): Promise<void> {
  try {
    await em.flush();
  } catch (error) {
    if (error instanceof UniqueConstraintViolationException) throw nameTaken();
    throw error;
  }
}

async function replaceConditions(em: Em, categoryId: string, conditions: readonly VisibilityCondition[]): Promise<void> {
  await em.nativeDelete(VisibilityCategoryCondition, { visibilityCategoryId: categoryId });
  for (const c of sortConditions(conditions)) {
    em.persist(
      em.create(VisibilityCategoryCondition, {
        id: randomUUID(),
        visibilityCategoryId: categoryId,
        currencyCode: c.currencyCode,
        threshold: c.threshold,
      }),
    );
  }
}

async function loadCategory(em: Em, id: string, expectedVersion: number | undefined): Promise<VisibilityCategory> {
  const category = await em.findOne(VisibilityCategory, { id });
  if (!category) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Visibility category not found.');
  if (expectedVersion !== undefined && category.version !== expectedVersion) {
    throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'The visibility category changed since it was read.', {
      currentVersion: category.version,
    });
  }
  return category;
}

export interface CategoryResult {
  readonly category: VisibilityCategory;
  readonly conditions: readonly VisibilityCondition[];
}

/** `product_visibility.category.create` — FR-010: a name and at least one condition. */
export function categoryCreateCommand(input: { name: string; conditions: readonly VisibilityCondition[] }): Command<CategoryResult> {
  const id = randomUUID();
  return {
    action: A.CATEGORY_CREATE,
    objectType: 'visibility_category',
    objectId: id,
    async run({ em }) {
      const category = em.create(VisibilityCategory, { id, name: input.name.trim() });
      em.persist(category);
      await flushNamed(em);
      await replaceConditions(em, id, input.conditions);
      await em.flush();
      const conditions = sortConditions(input.conditions);
      return { result: { category, conditions }, before: null, after: categoryState(category, conditions) };
    },
  };
}

/** `product_visibility.category.update` — rename and / or replace the conditions; moves `version`. */
export function categoryUpdateCommand(
  id: string,
  patch: { name?: string | undefined; conditions?: readonly VisibilityCondition[] | undefined },
  expectedVersion: number | undefined,
): Command<CategoryResult> {
  return {
    action: A.CATEGORY_UPDATE,
    objectType: 'visibility_category',
    objectId: id,
    async run({ em }) {
      const category = await loadCategory(em, id, expectedVersion);
      const beforeConditions = await conditionsOf(em, id);
      const before = categoryState(category, beforeConditions);
      const nextName = patch.name !== undefined ? patch.name.trim() : category.name;
      const nextConditions = patch.conditions !== undefined ? sortConditions(patch.conditions) : beforeConditions;
      const changedFields: string[] = [];
      if (nextName !== category.name) changedFields.push('name');
      if (JSON.stringify(nextConditions) !== JSON.stringify(beforeConditions)) changedFields.push('conditions');
      if (changedFields.length === 0) {
        return { result: { category, conditions: beforeConditions }, before, after: before, skipAudit: true };
      }
      category.name = nextName;
      category.version += 1;
      await flushNamed(em);
      if (changedFields.includes('conditions')) await replaceConditions(em, id, nextConditions);
      await em.flush();
      return {
        result: { category, conditions: nextConditions },
        before,
        after: { ...categoryState(category, nextConditions), changedFields },
      };
    },
  };
}

/**
 * `product_visibility.category.delete` — FR-013: refused, naming the roles, while a live role
 * is mapped to it. A mapping row left by a role `admin_roles` has since deleted matches
 * nothing (R-13) and goes with the category. `liveRoleIds` are the roles that exist now.
 */
export function categoryDeleteCommand(
  id: string,
  expectedVersion: number | undefined,
  liveRoleIds: ReadonlySet<string>,
): Command<{ id: string }> {
  return {
    action: A.CATEGORY_DELETE,
    objectType: 'visibility_category',
    objectId: id,
    async run({ em }) {
      const category = await loadCategory(em, id, expectedVersion);
      const before = categoryState(category, await conditionsOf(em, id));
      const mappings = await em.find(VisibilityRoleMapping, { visibilityCategoryId: id });
      const mapped = mappings.filter((m) => liveRoleIds.has(m.adminRoleId)).map((m) => m.adminRoleId).sort();
      if (mapped.length > 0) {
        throw new HttpError(
          409,
          ERROR_CODES.VISIBILITY_CATEGORY_IN_USE,
          'Roles are mapped to this visibility category; map them elsewhere first.',
          mapped.map((roleId) => ({ path: 'roleIds', issue: roleId })),
        );
      }
      if (mappings.length > 0) await em.nativeDelete(VisibilityRoleMapping, { visibilityCategoryId: id });
      await em.nativeDelete(VisibilityCategoryCondition, { visibilityCategoryId: id });
      em.remove(category);
      await em.flush();
      return { result: { id }, before, after: null };
    },
  };
}

/** The audit snapshot of a role's mapping. */
function mappingState(row: VisibilityRoleMapping | null): { target: ProductVisibilityMappingTarget | null } {
  if (!row) return { target: null };
  return {
    target:
      row.target === 'category' && row.visibilityCategoryId
        ? { kind: 'category', categoryId: row.visibilityCategoryId }
        : { kind: 'unrestricted' },
  };
}

/**
 * `product_visibility.role_mapping.set` — FR-020, FR-025 (I-2): a category, `unrestricted`, or
 * nothing (the row is deleted). Whether the role may be mapped at all (FR-022, FR-026) is
 * decided by the caller from `admin_roles`' answer; the category must exist.
 */
export function roleMappingSetCommand(
  roleId: string,
  target: ProductVisibilityMappingTarget | null,
): Command<{ target: ProductVisibilityMappingTarget | null }> {
  return {
    action: A.ROLE_MAPPING_SET,
    objectType: 'admin_role',
    objectId: roleId,
    async run({ em }) {
      const row = await em.findOne(VisibilityRoleMapping, { adminRoleId: roleId });
      const before = mappingState(row);
      if (target?.kind === 'category' && !(await em.findOne(VisibilityCategory, { id: target.categoryId }))) {
        throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'No such visibility category.', [
          { path: 'target.categoryId', issue: 'no such visibility category' },
        ]);
      }
      if (JSON.stringify(before.target) === JSON.stringify(target)) {
        return { result: { target }, before, after: before, skipAudit: true };
      }
      if (target === null) {
        if (row) em.remove(row);
      } else if (row) {
        row.target = target.kind;
        row.visibilityCategoryId = target.kind === 'category' ? target.categoryId : null;
        row.updatedAt = new Date();
      } else {
        em.persist(
          em.create(VisibilityRoleMapping, {
            adminRoleId: roleId,
            target: target.kind,
            visibilityCategoryId: target.kind === 'category' ? target.categoryId : null,
          }),
        );
      }
      await em.flush();
      return { result: { target }, before, after: { target } };
    },
  };
}

/** The audit snapshot of a currency's designation. */
function designationState(row: CataloguePriceDesignation | null): { priceListId: string; salesChannelId: string } | null {
  return row ? { priceListId: row.priceListId, salesChannelId: row.salesChannelId } : null;
}

/**
 * `product_visibility.designation.set` — FR-001: one book per currency. The book was checked by
 * the caller (`designationStatus`, RQ-1 A); a later change to it is not blocked here.
 */
export function designationSetCommand(
  currencyCode: string,
  designation: { priceListId: string; salesChannelId: string },
): Command<{ changed: boolean }> {
  return {
    action: A.DESIGNATION_SET,
    objectType: 'catalogue_price_designation',
    objectId: currencyCode,
    async run({ em }) {
      const row = await em.findOne(CataloguePriceDesignation, { currencyCode });
      const before = designationState(row);
      if (row && row.priceListId === designation.priceListId && row.salesChannelId === designation.salesChannelId) {
        return { result: { changed: false }, before, after: before, skipAudit: true };
      }
      if (row) {
        row.priceListId = designation.priceListId;
        row.salesChannelId = designation.salesChannelId;
        row.updatedAt = new Date();
      } else {
        em.persist(em.create(CataloguePriceDesignation, { currencyCode, ...designation }));
      }
      await em.flush();
      return { result: { changed: true }, before, after: { ...designation } };
    },
  };
}

/** `product_visibility.designation.clear` — back to the currency's base book. */
export function designationClearCommand(currencyCode: string): Command<{ changed: boolean }> {
  return {
    action: A.DESIGNATION_CLEAR,
    objectType: 'catalogue_price_designation',
    objectId: currencyCode,
    async run({ em }) {
      const row = await em.findOne(CataloguePriceDesignation, { currencyCode });
      if (!row) return { result: { changed: false }, before: null, after: null, skipAudit: true };
      const before = designationState(row);
      em.remove(row);
      await em.flush();
      return { result: { changed: true }, before, after: null };
    },
  };
}
