import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';
import { designationStatusSchema } from './price-lists.js';

/**
 * Product visibility rules — `specs/193-product-visibility-rules/` (contracts/ports.md,
 * admin-api.md, events-and-errors.md, data-model.md). Source of truth per Principle II.
 *
 * The module `product_visibility_rules` owns visibility categories (a product qualifies
 * by its catalogue price in one or more currencies), the role → category mapping that
 * narrows what an administrator sees, the per-currency catalogue-price designation, and
 * named product rules a sales channel's membership follows (the website rule).
 */

// ────────────────────────────────────────────────────────────────────────
//  Vocabularies
// ────────────────────────────────────────────────────────────────────────

export const PRODUCT_VISIBILITY_MODULE_ID = 'product_visibility_rules';

/** The operator's activation control (Constitution XVII). Ships off (R-3, OQ-C A). */
export const PRODUCT_VISIBILITY_SETTING_CODES = {
  MODULE_ENABLED: 'product_visibility_rules.module_enabled',
} as const;

export const PRODUCT_VISIBILITY_PERMISSIONS = {
  READ: 'product_visibility:read',
  MANAGE: 'product_visibility:manage',
} as const;

/**
 * FR-026 (OQ-G 1): a role holding any of these is always unrestricted and can never be
 * mapped — each lets the role lift its own restriction (TM-4).
 */
export const PRODUCT_VISIBILITY_SELF_LIFTING_PERMISSIONS = [
  '*',
  PRODUCT_VISIBILITY_PERMISSIONS.MANAGE,
  'platform.modules.activate',
  'admin_users:manage',
] as const;

/** FR-023 (as amended by OQ-G): an unmapped role holding this sees no products. */
export const PRODUCT_VISIBILITY_FAIL_CLOSED_PERMISSION = 'rfqs:handle';

/** FR-086: the overview warns on a mapped or fail-closed role holding this. */
export const PRODUCT_VISIBILITY_AUDIT_READ_PERMISSION = 'audit_log:read';

/** The role code that is always unrestricted and never mappable (FR-022). */
export const PRODUCT_VISIBILITY_PLATFORM_ADMIN_ROLE_CODE = 'platform_admin';

/**
 * The module's own error codes (events-and-errors.md §2). Each joins the platform's
 * `ERROR_CODES` and the manifest's `errorCodes` in the change that adds its first raise
 * site. `CHANNEL_MEMBERSHIP_GOVERNED` is the kernel's, not this module's.
 */
export const PRODUCT_VISIBILITY_ERROR_CODES = {
  VISIBILITY_CATEGORY_IN_USE: 'VISIBILITY_CATEGORY_IN_USE',
  ROLE_NOT_MAPPABLE: 'ROLE_NOT_MAPPABLE',
  DESIGNATION_INVALID: 'DESIGNATION_INVALID',
  PRODUCT_RULE_ATTACHED: 'PRODUCT_RULE_ATTACHED',
  WEBSITE_RULE_PREVIEW_REQUIRED: 'WEBSITE_RULE_PREVIEW_REQUIRED',
  WEBSITE_RULE_PREVIEW_LIMIT: 'WEBSITE_RULE_PREVIEW_LIMIT',
  WEBSITE_RULE_PREVIEW_STALE: 'WEBSITE_RULE_PREVIEW_STALE',
  CHANNEL_ALREADY_GOVERNED: 'CHANNEL_ALREADY_GOVERNED',
  PRODUCT_NOT_IN_VISIBILITY_CATEGORY: 'PRODUCT_NOT_IN_VISIBILITY_CATEGORY',
} as const;

/** Audit actions of the configuration Commands (FR-070, events-and-errors.md §3). */
export const PRODUCT_VISIBILITY_AUDIT_ACTIONS = {
  CATEGORY_CREATE: 'product_visibility.category.create',
  CATEGORY_UPDATE: 'product_visibility.category.update',
  CATEGORY_DELETE: 'product_visibility.category.delete',
  ROLE_MAPPING_SET: 'product_visibility.role_mapping.set',
  DESIGNATION_SET: 'product_visibility.designation.set',
  DESIGNATION_CLEAR: 'product_visibility.designation.clear',
  PRODUCT_RULE_CREATE: 'product_visibility.product_rule.create',
  PRODUCT_RULE_UPDATE: 'product_visibility.product_rule.update',
  PRODUCT_RULE_DELETE: 'product_visibility.product_rule.delete',
  WEBSITE_RULE_ATTACH: 'product_visibility.website_rule.attach',
  WEBSITE_RULE_CHANGE: 'product_visibility.website_rule.change',
  WEBSITE_RULE_DETACH: 'product_visibility.website_rule.detach',
} as const;

const CURRENCY_CODE = z.string().regex(/^[A-Z]{3}$/, 'ISO 4217 currency code');

/** FR-011: `gt_zero` — priced above zero; `gte_zero` — priced, zero included. */
export const visibilityThresholdSchema = z.enum(['gt_zero', 'gte_zero']);
export type VisibilityThreshold = z.infer<typeof visibilityThresholdSchema>;

// ────────────────────────────────────────────────────────────────────────
//  adminProductVisibilityPort (contracts/ports.md §1)
// ────────────────────────────────────────────────────────────────────────

/**
 * Whose products an admin read may return. **Required on every catalog / price_lists admin
 * read and write; never optional, never defaulted** (TM-3). Storefront, connectors and
 * system jobs pass `system` explicitly.
 */
export type AdminProductVisibilityScope =
  | { kind: 'system' }
  | {
      kind: 'unrestricted';
      roleId: string;
      reason: 'platform_admin' | 'self_lifting' | 'mapped_unrestricted' | 'unmapped';
    }
  /** FR-023 fail-closed: sees no product. */
  | { kind: 'no_category'; roleId: string }
  | {
      kind: 'restricted';
      roleId: string;
      category: { id: string; name: string };
      /** Conditions whose currency is active and whose designation is in force now. */
      conditions: ReadonlyArray<{ currencyCode: string; threshold: VisibilityThreshold; generation: number }>;
    };

/** A SQL fragment with `?` placeholders, its params in order. No request text ever reaches one. */
export interface SqlFragment {
  sql: string;
  params: unknown[];
}

/** TM-3 (3): a bug can never read as "unrestricted" — there is no `null`. */
export type VisibilityPredicate =
  | { kind: 'none' }
  | { kind: 'sql'; fragment: SqlFragment }
  | { kind: 'deny' };

/**
 * Container name: `adminProductVisibilityPort`. Owner: `product_visibility_rules`. A
 * capability read port (spec 193 research R-7, R-8).
 *
 * **Owner off:** consumers probe `effectiveState.isPresent('product_visibility_rules')`
 * before resolving and treat absent as unrestricted (`degrades-without`: admin product
 * reads, order lines and quote lines are not narrowed by role). A call made while present
 * that fails is not caught.
 */
export interface AdminProductVisibilityPort {
  /**
   * Per request — or, off-request, at execution for the requesting admin. Never cached
   * across requests (FR-060). Never catches: an unreadable role, mapping or designation
   * answers `no_category` or throws, never `unrestricted` (TM-3 (4)).
   */
  resolveScope(adminUserId: string): Promise<AdminProductVisibilityScope>;
  systemScope(): AdminProductVisibilityScope;
  /** `columns` values must match `^"[a-z_]+"\."[a-z_]+"$` or the call throws (TM-8). */
  productPredicate(scope: AdminProductVisibilityScope, columns: { productId: string }): VisibilityPredicate;
  variantPredicate(scope: AdminProductVisibilityScope, columns: { variantId: string }): VisibilityPredicate;
  filterVisible(
    scope: AdminProductVisibilityScope,
    ids: { productIds?: readonly string[]; variantIds?: readonly string[] },
  ): Promise<{ productIds: ReadonlySet<string>; variantIds: ReadonlySet<string> }>;
  /** Live, exact (R-8). One entry per input line, same order. */
  checkLines(
    scope: AdminProductVisibilityScope,
    lines: ReadonlyArray<{ productId: string; variantId?: string | null }>,
  ): Promise<ReadonlyArray<{ visible: boolean; noFixedPrice: boolean }>>;
}

/** `system` and `unrestricted` narrow nothing (SC-003: no clause, byte-identical answers). */
export function narrowsAdminProducts(scope: AdminProductVisibilityScope): boolean {
  switch (scope.kind) {
    case 'system':
    case 'unrestricted':
      return false;
    case 'no_category':
    case 'restricted':
      return true;
  }
}

/** The one frozen `system` scope a consumer reads with when the owner is absent (and passes as a system caller). */
export const SYSTEM_ADMIN_PRODUCT_SCOPE: AdminProductVisibilityScope = Object.freeze({ kind: 'system' }) as AdminProductVisibilityScope;
const NO_PREDICATE: VisibilityPredicate = Object.freeze({ kind: 'none' }) as VisibilityPredicate;

/**
 * What a consumer module asks of {@link AdminProductVisibilityPort}, with the owner's absence decided
 * in front of the port (`degrades-without`, D-44) — the one shell `catalog`, `price_lists` and
 * `inventory` wrap (spec 193, checkpoint 1):
 *
 * - **absent** ⇒ every scope is `system`, and the port is never resolved;
 * - a scope that **narrows nothing** (`system`, `unrestricted`) ⇒ predicates are `none` and
 *   `filterVisible` answers the ids it was given, without asking the port;
 * - **present** ⇒ the port answers, and a failure is **not** caught (TM-3 (4)): a request whose
 *   scope cannot be read answers 5xx, never unfiltered.
 */
export interface DegradingAdminProductVisibility {
  /** Per request (or at execution, for the requesting administrator). Never cached. */
  scopeFor(adminUserId: string): Promise<AdminProductVisibilityScope>;
  productPredicate(scope: AdminProductVisibilityScope, columns: { productId: string }): VisibilityPredicate;
  variantPredicate(scope: AdminProductVisibilityScope, columns: { variantId: string }): VisibilityPredicate;
  filterVisible(
    scope: AdminProductVisibilityScope,
    ids: { productIds?: readonly string[]; variantIds?: readonly string[] },
  ): Promise<{ productIds: ReadonlySet<string>; variantIds: ReadonlySet<string> }>;
}

export function createDegradingAdminProductVisibility(deps: {
  isPresent: () => boolean;
  port: () => AdminProductVisibilityPort;
}): DegradingAdminProductVisibility {
  return {
    async scopeFor(adminUserId) {
      if (!deps.isPresent()) return SYSTEM_ADMIN_PRODUCT_SCOPE;
      return deps.port().resolveScope(adminUserId);
    },
    productPredicate(scope, columns) {
      return narrowsAdminProducts(scope) ? deps.port().productPredicate(scope, columns) : NO_PREDICATE;
    },
    variantPredicate(scope, columns) {
      return narrowsAdminProducts(scope) ? deps.port().variantPredicate(scope, columns) : NO_PREDICATE;
    },
    async filterVisible(scope, ids) {
      if (!narrowsAdminProducts(scope)) {
        return { productIds: new Set(ids.productIds ?? []), variantIds: new Set(ids.variantIds ?? []) };
      }
      return deps.port().filterVisible(scope, ids);
    },
  };
}

/**
 * A predicate as a clause for a consumer's statements: `null` adds nothing (the statement is the
 * one it was before the feature), `false` matches nothing, a fragment narrows. Exhaustive on
 * purpose: a new predicate kind is a compile error here, never a silent "unrestricted" (TM-3 (3)).
 */
export function visibilityPredicateClause(predicate: VisibilityPredicate): SqlFragment | null | false {
  switch (predicate.kind) {
    case 'none':
      return null;
    case 'deny':
      return false;
    case 'sql':
      return { sql: `(${predicate.fragment.sql})`, params: [...predicate.fragment.params] };
  }
}

/**
 * Spec 193 (FR-023, US1-6, US1-11; contracts/admin-api.md §2) — beside a catalog admin product
 * list answered to a restricted caller. **Absent** for an unrestricted caller (SC-003).
 */
export const adminProductListVisibilitySchema = z.object({
  restricted: z.literal(true),
  /** FR-023: the role has no visibility category and sees no products. */
  reason: z.literal('no_category').optional(),
  /** The category the caller's role is mapped to. */
  categoryName: z.string().optional(),
});
export type AdminProductListVisibility = z.infer<typeof adminProductListVisibilitySchema>;

/** The visibility note a list answer carries for a scope, or `undefined` when it carries none. */
export function adminProductListVisibility(scope: AdminProductVisibilityScope): AdminProductListVisibility | undefined {
  switch (scope.kind) {
    case 'system':
    case 'unrestricted':
      return undefined;
    case 'no_category':
      return { restricted: true, reason: 'no_category' };
    case 'restricted':
      return { restricted: true, categoryName: scope.category.name };
  }
}

// ────────────────────────────────────────────────────────────────────────
//  Product rule definition (contracts/ports.md §4)
// ────────────────────────────────────────────────────────────────────────

/** TM-11: at most this many conditions in a rule, groups' members included. */
export const PRODUCT_RULE_MAX_CONDITIONS = 20;

const ATTRIBUTE_KEY = z.string().min(1).max(100);
const OPTION_KEY = z.string().min(1).max(100);

export const ruleConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('attribute_boolean'), attributeKey: ATTRIBUTE_KEY, value: z.boolean() }),
  z.object({
    kind: z.literal('attribute_choice'),
    attributeKey: ATTRIBUTE_KEY,
    optionKeys: z.array(OPTION_KEY).min(1).max(100),
  }),
  z.object({ kind: z.literal('catalogue_price'), currencyCode: CURRENCY_CODE, threshold: visibilityThresholdSchema }),
]);
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

const ruleMatchSchema = z.enum(['all', 'any']);

/** Groups nest one level: a group's members are conditions, never groups. */
export const ruleGroupSchema = z.object({
  kind: z.literal('group'),
  match: ruleMatchSchema,
  conditions: z.array(ruleConditionSchema).min(1).max(PRODUCT_RULE_MAX_CONDITIONS),
});
export type RuleGroup = z.infer<typeof ruleGroupSchema>;

export const ProductRuleDefinitionSchema = z
  .object({
    match: ruleMatchSchema,
    conditions: z
      .array(z.union([ruleConditionSchema, ruleGroupSchema]))
      .min(1)
      .max(PRODUCT_RULE_MAX_CONDITIONS),
  })
  .superRefine((definition, ctx) => {
    let total = 0;
    for (const node of definition.conditions) total += 'conditions' in node ? node.conditions.length : 1;
    if (total > PRODUCT_RULE_MAX_CONDITIONS) {
      ctx.addIssue({
        code: 'custom',
        path: ['conditions'],
        message: `A rule holds at most ${PRODUCT_RULE_MAX_CONDITIONS} conditions in total.`,
      });
    }
  });
export type ProductRuleDefinition = z.infer<typeof ProductRuleDefinitionSchema>;

// ────────────────────────────────────────────────────────────────────────
//  productRuleGovernancePort (contracts/ports.md §2)
// ────────────────────────────────────────────────────────────────────────

/**
 * Container name: `productRuleGovernancePort`. Owner: `product_visibility_rules`. A capability
 * read port (FR-055), registered since the website rule landed (spec 193 Phase 6); `catalog`
 * resolves it behind its presence probe (`degrades-without`).
 *
 * **Owner off:** the port gate answers 503 `MODULE_DISABLED`; a connector that probes
 * presence first treats absent as "nothing governed", consistent with the kernel.
 */
export interface ProductRuleGovernancePort {
  governedChannels(): Promise<ReadonlyArray<{ salesChannelId: string; productRuleId: string; productRuleName: string }>>;
  /** `null` ⇒ the channel is not governed. */
  meetsRule(salesChannelId: string, productIds: readonly string[]): Promise<ReadonlyMap<string, boolean> | null>;
  /** FR-090, FR-091 (R-18): per ref, absent from the governed channel only because of its rule. */
  excludedOnlyByRule(
    salesChannelId: string,
    refs: ReadonlyArray<{ productId: string; variantId?: string | null }>,
  ): Promise<ReadonlyArray<boolean>>;
}

// ────────────────────────────────────────────────────────────────────────
//  Admin API — /api/v1/admin/product-visibility (admin-api.md §1)
// ────────────────────────────────────────────────────────────────────────

const CATEGORY_NAME = z.string().trim().min(1).max(120);

export const visibilityConditionSchema = z.object({
  currencyCode: CURRENCY_CODE,
  threshold: visibilityThresholdSchema,
});
export type VisibilityCondition = z.infer<typeof visibilityConditionSchema>;

const conditionsSchema = z
  .array(visibilityConditionSchema)
  .min(1)
  .max(50)
  .superRefine((conditions, ctx) => {
    const seen = new Set<string>();
    conditions.forEach((condition, index) => {
      const key = `${condition.currencyCode}:${condition.threshold}`;
      if (seen.has(key)) ctx.addIssue({ code: 'custom', path: [index], message: 'Duplicate condition.' });
      seen.add(key);
    });
  });

export const productVisibilityCategoryCreateBodySchema = z.object({
  name: CATEGORY_NAME,
  conditions: conditionsSchema,
});
export type ProductVisibilityCategoryCreateBody = z.infer<typeof productVisibilityCategoryCreateBodySchema>;

export const productVisibilityCategoryUpdateBodySchema = z.object({
  name: CATEGORY_NAME.optional(),
  conditions: conditionsSchema.optional(),
});
export type ProductVisibilityCategoryUpdateBody = z.infer<typeof productVisibilityCategoryUpdateBodySchema>;

export const productVisibilityCategorySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  version: z.number().int().positive(),
  conditions: z.array(visibilityConditionSchema),
  /** Roles mapped to this category (FR-013). */
  mappedRoleIds: z.array(uuidSchema),
});
export type ProductVisibilityCategory = z.infer<typeof productVisibilityCategorySchema>;

export const productVisibilityCategoryIdParamsSchema = z.object({ id: uuidSchema });

/** I-2: a role maps to a category, to `unrestricted`, or to nothing. */
export const productVisibilityMappingTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('category'), categoryId: uuidSchema }),
  z.object({ kind: z.literal('unrestricted') }),
]);
export type ProductVisibilityMappingTarget = z.infer<typeof productVisibilityMappingTargetSchema>;

export const productVisibilityRoleMappingBodySchema = z.object({
  target: productVisibilityMappingTargetSchema.nullable(),
});
export type ProductVisibilityRoleMappingBody = z.infer<typeof productVisibilityRoleMappingBodySchema>;

export const productVisibilityRoleIdParamsSchema = z.object({ roleId: uuidSchema });

export const productVisibilityRoleMappingResponseSchema = z.object({
  roleId: uuidSchema,
  target: productVisibilityMappingTargetSchema.nullable(),
});
export type ProductVisibilityRoleMappingResponse = z.infer<typeof productVisibilityRoleMappingResponseSchema>;

export const productVisibilityDesignationBodySchema = z.object({
  priceListId: uuidSchema,
  salesChannelId: uuidSchema,
});
export type ProductVisibilityDesignationBody = z.infer<typeof productVisibilityDesignationBodySchema>;

export const productVisibilityCurrencyParamsSchema = z.object({ currencyCode: CURRENCY_CODE });

export const productVisibilityDesignationResponseSchema = z.object({
  currencyCode: CURRENCY_CODE,
  designation: productVisibilityDesignationBodySchema.nullable(),
  designationStatus: designationStatusSchema.nullable(),
});
export type ProductVisibilityDesignationResponse = z.infer<typeof productVisibilityDesignationResponseSchema>;

export const productVisibilityDesignationOptionsResponseSchema = z.object({
  items: z.array(
    z.object({ priceListId: uuidSchema, name: z.string(), salesChannelIds: z.array(uuidSchema) }),
  ),
});
export type ProductVisibilityDesignationOptionsResponse = z.infer<typeof productVisibilityDesignationOptionsResponseSchema>;

/** FR-023, FR-024, FR-026 — what the module does to a role's admin reads. */
export const productVisibilityRoleEffectSchema = z.enum([
  'unrestricted',
  'mapped_unrestricted',
  'mapped',
  'unmappable_unrestricted',
  'mapping_without_effect',
  'sees_no_products',
]);
export type ProductVisibilityRoleEffect = z.infer<typeof productVisibilityRoleEffectSchema>;

/** FR-086 — the only warning. */
export const productVisibilityRoleWarningSchema = z.enum(['audit_logs_read']);

export const productVisibilityOverviewResponseSchema = z.object({
  currencies: z.array(
    z.object({
      code: CURRENCY_CODE,
      /** An inactive currency is listed while a condition or designation still names it (FR-012). */
      active: z.boolean(),
      designation: productVisibilityDesignationBodySchema.nullable(),
      designationStatus: designationStatusSchema.nullable(),
      servedGeneration: z.number().int().nonnegative().nullable(),
      building: z.boolean(),
    }),
  ),
  categories: z.array(productVisibilityCategorySchema),
  roles: z.array(
    z.object({
      roleId: uuidSchema,
      code: z.string(),
      name: z.string(),
      effect: productVisibilityRoleEffectSchema,
      categoryId: uuidSchema.optional(),
      warnings: z.array(productVisibilityRoleWarningSchema),
    }),
  ),
  productRules: z.array(
    z.object({ id: uuidSchema, name: z.string(), version: z.number().int().positive() }),
  ),
  websiteRuleAttachments: z.array(
    z.object({ salesChannelId: uuidSchema, productRuleId: uuidSchema, attachedAt: isoDateTimeSchema }),
  ),
});
export type ProductVisibilityOverviewResponse = z.infer<typeof productVisibilityOverviewResponseSchema>;

const RULE_NAME = z.string().trim().min(1).max(120);

export const productRuleCreateBodySchema = z.object({
  name: RULE_NAME,
  definition: ProductRuleDefinitionSchema,
});
export type ProductRuleCreateBody = z.infer<typeof productRuleCreateBodySchema>;

export const productRuleUpdateBodySchema = z.object({
  name: RULE_NAME.optional(),
  definition: ProductRuleDefinitionSchema.optional(),
});
export type ProductRuleUpdateBody = z.infer<typeof productRuleUpdateBodySchema>;

/** TM-11: the channels a preview may name at once. */
export const WEBSITE_RULE_PREVIEW_MAX_CHANNELS = 50;

export const websiteRulePreviewCreateBodySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('attach'),
    productRuleId: uuidSchema,
    salesChannelIds: z.array(uuidSchema).min(1).max(WEBSITE_RULE_PREVIEW_MAX_CHANNELS),
  }),
  z.object({ kind: z.literal('change'), productRuleId: uuidSchema, definition: ProductRuleDefinitionSchema }),
]);
export type WebsiteRulePreviewCreateBody = z.infer<typeof websiteRulePreviewCreateBodySchema>;

export const websiteRulePreviewResponseSchema = z.object({
  status: z.enum(['pending', 'ready', 'failed', 'applied', 'expired']),
  counts: z.record(z.string(), z.object({ join: z.number().int().nonnegative(), leave: z.number().int().nonnegative() })),
  expiresAt: isoDateTimeSchema,
});
export type WebsiteRulePreviewResponse = z.infer<typeof websiteRulePreviewResponseSchema>;

/** A saved product rule, as the rule routes answer it (`ETag` = `version`). */
export const productRuleSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  version: z.number().int().positive(),
  definition: ProductRuleDefinitionSchema,
});
export type ProductRuleView = z.infer<typeof productRuleSchema>;

/**
 * `GET /product-rules/:id` — a saved rule with the sales channels it governs (T103, FR-053): what
 * the rule editor opens, and the version its save or change preview sends as `If-Match`. A
 * channel deleted while governed is not listed.
 */
export const productRuleDetailSchema = productRuleSchema.extend({
  attachments: z.array(z.object({ salesChannelId: uuidSchema, attachedAt: isoDateTimeSchema })),
});
export type ProductRuleDetail = z.infer<typeof productRuleDetailSchema>;

/** `GET /attributes` — the attributes a rule may name (FR-050): global boolean or choice ones. */
export const productRuleAttributesResponseSchema = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      labelDefault: z.string(),
      label: z.record(z.string(), z.string()),
      kind: z.enum(['boolean', 'choice']),
      /**
       * Options of a choice attribute, in the catalogue's order; empty for a boolean one. A rule
       * names an option by `key`; `label` (per language) and `labelDefault` are for display, read
       * as the attribute's own label is.
       */
      options: z.array(z.object({ key: z.string(), labelDefault: z.string(), label: z.record(z.string(), z.string()) })),
    }),
  ),
});
export type ProductRuleAttributesResponse = z.infer<typeof productRuleAttributesResponseSchema>;

/** `POST /website-rules/previews` — 202. */
export const websiteRulePreviewCreatedSchema = z.object({ previewId: uuidSchema });

/** `website_rule:<productRuleId>` — the audit `source` of a membership the rule wrote (FR-072). */
export function websiteRuleAuditSource(productRuleId: string): string {
  return `website_rule:${productRuleId}`;
}
