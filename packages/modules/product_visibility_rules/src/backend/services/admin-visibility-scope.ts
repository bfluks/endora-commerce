import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AdminProductVisibilityPort,
  AdminProductVisibilityScope,
  CatalogueReferencePricePort,
  CurrencyReadPort,
  PermissionReadPort,
  ProductVisibilityMappingTarget,
  SqlFragment,
  VisibilityPredicate,
  VisibilityThreshold,
} from '@endora-commerce/contracts';
import { CataloguePriceDesignation } from '../entities/catalogue-price-designation.entity.js';
import { CataloguePriceGeneration } from '../entities/catalogue-price-generation.entity.js';
import { VisibilityCategoryCondition } from '../entities/visibility-category-condition.entity.js';
import { VisibilityCategory } from '../entities/visibility-category.entity.js';
import { VisibilityRoleMapping } from '../entities/visibility-role-mapping.entity.js';
import { roleScopeKind } from './role-visibility.js';

/** TM-8 — the only shape a caller-supplied column may take. */
const COLUMN_RE = /^"[a-z_]+"\."[a-z_]+"$/;

/** Ids reach a statement only as a uuid array literal; anything else names no row. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SYSTEM: AdminProductVisibilityScope = Object.freeze({ kind: 'system' }) as AdminProductVisibilityScope;

export interface AdminVisibilityScopeDeps {
  readonly emFactory: () => EntityManager;
  /** Ports of other modules, resolved per call (`lazyPort`), never captured. */
  readonly permissions: () => Pick<PermissionReadPort, 'resolveRole'>;
  readonly currencies: () => Pick<CurrencyReadPort, 'listActive'>;
  readonly prices: () => Pick<CatalogueReferencePricePort, 'designationStatuses' | 'resolve'>;
}

type Condition = { currencyCode: string; threshold: VisibilityThreshold; generation: number };

function assertColumn(column: string): void {
  if (!COLUMN_RE.test(column)) {
    throw new Error(`product_visibility_rules: refusing column ${JSON.stringify(column)} — only "alias"."column" is accepted (TM-8).`);
  }
}

/**
 * `adminProductVisibilityPort` — spec 193 (`specs/193-product-visibility-rules/` contracts/ports.md §1,
 * research R-7, R-8, R-13; threat model TM-3, TM-7 (4), TM-8).
 *
 * The scope is resolved per call and never cached (FR-060). It never catches: a role refusal
 * throws, so a failure is never read as unrestricted (TM-3 (4)). A restricted scope carries only
 * the conditions that can be met now: the currency is active, its served flag generation exists
 * and was built for the designation that holds now, and that designation is in force — the
 * flags and `resolve` answer the designation as if in force (R-4), so in-force is applied here.
 */
export class AdminVisibilityScopeService implements AdminProductVisibilityPort {
  constructor(private readonly deps: AdminVisibilityScopeDeps) {}

  systemScope(): AdminProductVisibilityScope {
    return SYSTEM;
  }

  async resolveScope(adminUserId: string): Promise<AdminProductVisibilityScope> {
    const resolution = await this.deps.permissions().resolveRole(adminUserId);
    if (!resolution.role) throw resolution.refusal;
    const role = resolution.role;
    const em = this.deps.emFactory();
    const row = await em.findOne(VisibilityRoleMapping, { adminRoleId: role.id });
    const target: ProductVisibilityMappingTarget | null = row
      ? row.target === 'category' && row.visibilityCategoryId
        ? { kind: 'category', categoryId: row.visibilityCategoryId }
        : { kind: 'unrestricted' }
      : null;
    const decided = roleScopeKind(role, target);
    if (decided.kind === 'unrestricted') return { kind: 'unrestricted', roleId: role.id, reason: decided.reason };
    if (decided.kind === 'no_category') return { kind: 'no_category', roleId: role.id };

    const category = await em.findOne(VisibilityCategory, { id: decided.categoryId });
    if (!category) return { kind: 'no_category', roleId: role.id };
    return {
      kind: 'restricted',
      roleId: role.id,
      category: { id: category.id, name: category.name },
      conditions: await this.#conditionsInForce(em, decided.categoryId),
    };
  }

  async #conditionsInForce(em: EntityManager, categoryId: string): Promise<Condition[]> {
    const conditions = await em.find(VisibilityCategoryCondition, { visibilityCategoryId: categoryId });
    if (conditions.length === 0) return [];
    const currencies = [...new Set(conditions.map((c) => c.currencyCode.trim()))];
    const [active, designations, generations] = await Promise.all([
      this.deps.currencies().listActive(),
      em.find(CataloguePriceDesignation, { currencyCode: { $in: currencies } }),
      em.find(CataloguePriceGeneration, { currencyCode: { $in: currencies } }),
    ]);
    const activeCodes = new Set(active.map((c) => c.code));
    const designationOf = new Map(designations.map((d) => [d.currencyCode.trim(), d]));
    const generationOf = new Map(generations.map((g) => [g.currencyCode.trim(), g]));
    const designated = designations.map((d) => ({ currencyCode: d.currencyCode.trim(), priceListId: d.priceListId, salesChannelId: d.salesChannelId }));
    const statuses = designated.length > 0 ? await this.deps.prices().designationStatuses(designated) : [];
    const inForce = new Map(designated.map((d, i) => [d.currencyCode, statuses[i]?.inForce === true]));

    const out: Condition[] = [];
    for (const c of conditions) {
      const code = c.currencyCode.trim();
      if (!activeCodes.has(code)) continue;
      const generation = generationOf.get(code);
      if (!generation || generation.servedGeneration <= 0) continue;
      const designation = designationOf.get(code);
      // TM-7 (4): the served flags must have been built for the designation that holds now.
      const builtFor = generation.builtForPriceListId ?? null;
      const builtOn = generation.builtForSalesChannelId ?? null;
      if (designation) {
        if (builtFor !== designation.priceListId || builtOn !== designation.salesChannelId) continue;
        if (!inForce.get(code)) continue;
      } else if (builtFor !== null) {
        continue;
      }
      out.push({ currencyCode: code, threshold: c.threshold, generation: generation.servedGeneration });
    }
    return out.sort((a, b) => (a.currencyCode + a.threshold).localeCompare(b.currencyCode + b.threshold));
  }

  productPredicate(scope: AdminProductVisibilityScope, columns: { productId: string }): VisibilityPredicate {
    assertColumn(columns.productId);
    return this.#predicate(scope, columns.productId, 'product_catalogue_prices', 'product_id');
  }

  variantPredicate(scope: AdminProductVisibilityScope, columns: { variantId: string }): VisibilityPredicate {
    assertColumn(columns.variantId);
    return this.#predicate(scope, columns.variantId, 'variant_catalogue_prices', 'variant_id');
  }

  #predicate(
    scope: AdminProductVisibilityScope,
    column: string,
    table: 'product_catalogue_prices' | 'variant_catalogue_prices',
    key: 'product_id' | 'variant_id',
  ): VisibilityPredicate {
    switch (scope.kind) {
      case 'system':
      case 'unrestricted':
        return { kind: 'none' };
      case 'no_category':
        return { kind: 'deny' };
      case 'restricted': {
        if (scope.conditions.length === 0) return { kind: 'deny' };
        return { kind: 'sql', fragment: this.#fragment(column, table, key, scope.conditions) };
      }
    }
  }

  #fragment(column: string, table: string, key: string, conditions: readonly Condition[]): SqlFragment {
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const c of conditions) {
      clauses.push(
        c.threshold === 'gt_zero'
          ? `(f."currency_code" = ? and f."generation" = ? and f."has_positive")`
          : `(f."currency_code" = ? and f."generation" = ?)`,
      );
      params.push(c.currencyCode, c.generation);
    }
    return { sql: `${column} in (select f."${key}" from "${table}" f where ${clauses.join(' or ')})`, params };
  }

  async filterVisible(
    scope: AdminProductVisibilityScope,
    ids: { productIds?: readonly string[]; variantIds?: readonly string[] },
  ): Promise<{ productIds: ReadonlySet<string>; variantIds: ReadonlySet<string> }> {
    const productIds = [...new Set(ids.productIds ?? [])].filter((id) => UUID_RE.test(id));
    const variantIds = [...new Set(ids.variantIds ?? [])].filter((id) => UUID_RE.test(id));
    if (scope.kind === 'system' || scope.kind === 'unrestricted') {
      return { productIds: new Set(productIds), variantIds: new Set(variantIds) };
    }
    if (scope.kind === 'no_category' || scope.conditions.length === 0) return { productIds: new Set(), variantIds: new Set() };
    const em = this.deps.emFactory();
    const read = async (table: string, key: string, values: string[]): Promise<Set<string>> => {
      if (values.length === 0) return new Set();
      const fragment = this.#fragment(`x."${key}"`, table, key, scope.conditions);
      const rows = await em.execute<Array<{ id: string }>>(
        `select x."${key}" as "id" from (select unnest(?::uuid[]) as "${key}") x where ${fragment.sql}`,
        [`{${values.join(',')}}`, ...fragment.params],
      );
      return new Set(rows.map((r) => r.id));
    };
    return {
      productIds: await read('product_catalogue_prices', 'product_id', productIds),
      variantIds: await read('variant_catalogue_prices', 'variant_id', variantIds),
    };
  }

  /**
   * Live and exact (R-8): each line through the engine, for the scope's in-force currencies,
   * at the designation that holds now. A product line with variants counts any of them.
   * `noFixedPrice` — visible, and no currency of the scope prices it above zero (FR-043).
   */
  async checkLines(
    scope: AdminProductVisibilityScope,
    lines: ReadonlyArray<{ productId: string; variantId?: string | null }>,
  ): Promise<ReadonlyArray<{ visible: boolean; noFixedPrice: boolean }>> {
    if (scope.kind === 'system' || scope.kind === 'unrestricted') return lines.map(() => ({ visible: true, noFixedPrice: false }));
    if (scope.kind === 'no_category' || scope.conditions.length === 0) return lines.map(() => ({ visible: false, noFixedPrice: false }));
    const em = this.deps.emFactory();
    const currencies = [...new Set(scope.conditions.map((c) => c.currencyCode))];
    const designations = new Map(
      (await em.find(CataloguePriceDesignation, { currencyCode: { $in: currencies } })).map((d) => [d.currencyCode.trim(), d]),
    );
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const facts = new Map<string, Map<string, { priced: boolean; positive: boolean }[]>>();
    for (const code of currencies) {
      const d = designations.get(code);
      const answers = await this.deps
        .prices()
        .resolve({ currencyCode: code, designation: d ? { priceListId: d.priceListId, salesChannelId: d.salesChannelId } : null, productIds });
      const byLine = new Map<string, { priced: boolean; positive: boolean }[]>();
      for (const line of lines) {
        const answer = answers.get(line.productId) ?? [];
        const chosen = line.variantId ? answer.filter((a) => a.variantId === line.variantId) : answer;
        byLine.set(
          `${line.productId}|${line.variantId ?? ''}`,
          chosen.map((a) => ({ priced: a.amount !== null, positive: a.amount !== null && Number(a.amount) > 0 })),
        );
      }
      facts.set(code, byLine);
    }
    return lines.map((line) => {
      const key = `${line.productId}|${line.variantId ?? ''}`;
      let visible = false;
      let positive = false;
      for (const c of scope.conditions) {
        const answers = facts.get(c.currencyCode)?.get(key) ?? [];
        const priced = answers.some((a) => a.priced);
        const pos = answers.some((a) => a.positive);
        if (pos) positive = true;
        if (c.threshold === 'gt_zero' ? pos : priced) visible = true;
      }
      return { visible, noFixedPrice: visible && !positive };
    });
  }
}
