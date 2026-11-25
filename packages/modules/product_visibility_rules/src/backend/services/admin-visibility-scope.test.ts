import { describe, expect, it } from 'vitest';
import type { AdminProductVisibilityScope, CatalogueReferenceLine, DesignationStatus } from '@endora-commerce/contracts';
import { AdminVisibilityScopeService, type AdminVisibilityScopeDeps } from './admin-visibility-scope.js';
import { CataloguePriceDesignation } from '../entities/catalogue-price-designation.entity.js';
import { CataloguePriceGeneration } from '../entities/catalogue-price-generation.entity.js';
import { VisibilityCategoryCondition } from '../entities/visibility-category-condition.entity.js';
import { VisibilityCategory } from '../entities/visibility-category.entity.js';
import { VisibilityRoleMapping } from '../entities/visibility-role-mapping.entity.js';

/**
 * Spec 193 T032 — the admin scope (research R-7, R-13; FR-021 – FR-026; threat model TM-3, TM-7 (4),
 * TM-8) and the live line check (R-8, FR-043).
 */
const ROLE = 'role-1';
const CAT = 'cat-1';
const BOOK = 'book-1';
const CH = 'ch-1';
const IN_FORCE: DesignationStatus = { inForce: true, window: { startsAt: null, endsAt: null } };

interface World {
  role: { id: string; code: string; permissions: string[] } | Error;
  mapping: { target: 'category' | 'unrestricted'; categoryId?: string } | null;
  conditions: Array<{ currencyCode: string; threshold: 'gt_zero' | 'gte_zero' }>;
  active: string[];
  designations: Array<{ currencyCode: string; priceListId: string; salesChannelId: string }>;
  statuses: Record<string, DesignationStatus>;
  generations: Array<{ currencyCode: string; servedGeneration: number; builtForPriceListId: string | null; builtForSalesChannelId: string | null }>;
  prices?: Record<string, Record<string, CatalogueReferenceLine[]>>;
  sql?: Array<{ sql: string; params: unknown[] }>;
}

function world(over: Partial<World> = {}): World {
  return {
    role: { id: ROLE, code: 'sales', permissions: ['rfqs:handle'] },
    mapping: { target: 'category', categoryId: CAT },
    conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }],
    active: ['PLN', 'EUR'],
    designations: [],
    statuses: {},
    generations: [
      { currencyCode: 'PLN', servedGeneration: 3, builtForPriceListId: null, builtForSalesChannelId: null },
      { currencyCode: 'EUR', servedGeneration: 2, builtForPriceListId: null, builtForSalesChannelId: null },
    ],
    ...over,
  };
}

function service(w: World): AdminVisibilityScopeService {
  const rows = (cls: unknown): unknown[] => {
    if (cls === VisibilityRoleMapping) {
      return w.mapping && !(w.role instanceof Error)
        ? [{ adminRoleId: w.role.id, target: w.mapping.target, visibilityCategoryId: w.mapping.categoryId ?? null }]
        : [];
    }
    if (cls === VisibilityCategory) return [{ id: CAT, name: 'Wholesale', version: 1 }];
    if (cls === VisibilityCategoryCondition) return w.conditions.map((c) => ({ visibilityCategoryId: CAT, ...c }));
    if (cls === CataloguePriceDesignation) return w.designations;
    if (cls === CataloguePriceGeneration) return w.generations;
    throw new Error(`unexpected entity ${String(cls)}`);
  };
  const em = {
    findOne: async (cls: unknown) => rows(cls)[0] ?? null,
    find: async (cls: unknown) => rows(cls),
    execute: async (sql: string, params: unknown[]) => {
      (w.sql ??= []).push({ sql, params });
      return [];
    },
  };
  const deps: AdminVisibilityScopeDeps = {
    emFactory: () => em as never,
    permissions: () => ({
      resolveRole: async () => (w.role instanceof Error ? { refusal: w.role } : { role: { ...w.role, name: 'x', requiresTwoFactor: false, createdAt: new Date(), updatedAt: new Date() } }),
    }),
    currencies: () => ({ listActive: async () => w.active.map((code) => ({ code })) }) as never,
    prices: () => ({
      designationStatuses: async (input: ReadonlyArray<{ currencyCode: string }>) => input.map((i) => w.statuses[i.currencyCode] ?? IN_FORCE),
      resolve: async ({ currencyCode, productIds }: { currencyCode: string; productIds: readonly string[] }) =>
        new Map(productIds.flatMap((id) => (w.prices?.[currencyCode]?.[id] ? [[id, w.prices[currencyCode][id]!] as const] : []))),
    }),
  };
  return new AdminVisibilityScopeService(deps);
}

const kind = (scope: AdminProductVisibilityScope) => scope.kind;

describe('resolveScope — per role (R-13, FR-021 – FR-026)', () => {
  it('platform_admin and every self-lifting permission are unrestricted, even when mapped', async () => {
    expect(await service(world({ role: { id: ROLE, code: 'platform_admin', permissions: [] } })).resolveScope('u')).toEqual({
      kind: 'unrestricted',
      roleId: ROLE,
      reason: 'platform_admin',
    });
    for (const p of ['*', 'product_visibility:manage', 'platform.modules.activate', 'admin_users:manage']) {
      const scope = await service(world({ role: { id: ROLE, code: 'sales', permissions: ['rfqs:handle', p] } })).resolveScope('u');
      expect(scope, p).toEqual({ kind: 'unrestricted', roleId: ROLE, reason: 'self_lifting' });
    }
  });

  it('mapped to unrestricted, unmapped with rfqs:handle, unmapped otherwise', async () => {
    expect(kind(await service(world({ mapping: { target: 'unrestricted' } })).resolveScope('u'))).toBe('unrestricted');
    expect(await service(world({ mapping: null })).resolveScope('u')).toEqual({ kind: 'no_category', roleId: ROLE });
    const viewer = await service(world({ mapping: null, role: { id: ROLE, code: 'v', permissions: ['catalog:read'] } })).resolveScope('u');
    expect(viewer).toEqual({ kind: 'unrestricted', roleId: ROLE, reason: 'unmapped' });
  });

  it('mapped to a category ⇒ restricted to its conditions, with the served generation', async () => {
    const w = world({
      conditions: [
        { currencyCode: 'PLN', threshold: 'gt_zero' },
        { currencyCode: 'EUR', threshold: 'gte_zero' },
      ],
    });
    expect(await service(w).resolveScope('u')).toEqual({
      kind: 'restricted',
      roleId: ROLE,
      category: { id: CAT, name: 'Wholesale' },
      conditions: [
        { currencyCode: 'EUR', threshold: 'gte_zero', generation: 2 },
        { currencyCode: 'PLN', threshold: 'gt_zero', generation: 3 },
      ],
    });
  });

  it('an inactive currency, a currency never built and a designation not in force drop out', async () => {
    const inactive = await service(world({ active: ['EUR'] })).resolveScope('u');
    expect(inactive.kind === 'restricted' && inactive.conditions).toEqual([]);
    const unbuilt = await service(world({ generations: [] })).resolveScope('u');
    expect(unbuilt.kind === 'restricted' && unbuilt.conditions).toEqual([]);
    const notInForce = await service(
      world({
        designations: [{ currencyCode: 'PLN', priceListId: BOOK, salesChannelId: CH }],
        statuses: { PLN: { inForce: false, reason: 'outside_schedule', window: null } },
        generations: [{ currencyCode: 'PLN', servedGeneration: 3, builtForPriceListId: BOOK, builtForSalesChannelId: CH }],
      }),
    ).resolveScope('u');
    expect(notInForce.kind === 'restricted' && notInForce.conditions).toEqual([]);
  });

  it('TM-7 (4): a currency whose served generation was built for another designation drops out', async () => {
    const changed = await service(
      world({
        designations: [{ currencyCode: 'PLN', priceListId: BOOK, salesChannelId: CH }],
        // Served generation still built for the base book: the designation's rebuild has not swapped.
        generations: [{ currencyCode: 'PLN', servedGeneration: 3, builtForPriceListId: null, builtForSalesChannelId: null }],
      }),
    ).resolveScope('u');
    expect(changed.kind === 'restricted' && changed.conditions).toEqual([]);
    const cleared = await service(
      world({ generations: [{ currencyCode: 'PLN', servedGeneration: 3, builtForPriceListId: BOOK, builtForSalesChannelId: CH }] }),
    ).resolveScope('u');
    expect(cleared.kind === 'restricted' && cleared.conditions).toEqual([]);
  });

  it('TM-3 (4): a role refusal throws — never unrestricted', async () => {
    const refusal = new Error('ADMIN_ROLE_REQUIRED');
    await expect(service(world({ role: refusal })).resolveScope('u')).rejects.toBe(refusal);
  });
});

describe('predicates (TM-3 (3), TM-8)', () => {
  const restricted: AdminProductVisibilityScope = {
    kind: 'restricted',
    roleId: ROLE,
    category: { id: CAT, name: 'W' },
    conditions: [
      { currencyCode: 'PLN', threshold: 'gt_zero', generation: 3 },
      { currencyCode: 'EUR', threshold: 'gte_zero', generation: 2 },
    ],
  };

  it('none for system and unrestricted, deny for no_category and no condition in force', () => {
    const s = service(world());
    expect(s.productPredicate(s.systemScope(), { productId: '"p"."id"' })).toEqual({ kind: 'none' });
    expect(s.productPredicate({ kind: 'unrestricted', roleId: ROLE, reason: 'unmapped' }, { productId: '"p"."id"' })).toEqual({ kind: 'none' });
    expect(s.productPredicate({ kind: 'no_category', roleId: ROLE }, { productId: '"p"."id"' })).toEqual({ kind: 'deny' });
    expect(s.variantPredicate({ ...restricted, conditions: [] }, { variantId: '"v"."id"' })).toEqual({ kind: 'deny' });
  });

  it('sql: placeholders only, one per param, over the module’s own tables', () => {
    const s = service(world());
    for (const predicate of [
      s.productPredicate(restricted, { productId: '"products"."id"' }),
      s.variantPredicate(restricted, { variantId: '"product_variants"."id"' }),
    ]) {
      if (predicate.kind !== 'sql') throw new Error('expected sql');
      const { sql, params } = predicate.fragment;
      expect(sql.split('?').length - 1).toBe(params.length);
      expect(params).toEqual(['PLN', 3, 'EUR', 2]);
      expect(sql).not.toMatch(/'/);
      expect(sql).toMatch(/"(product|variant)_catalogue_prices"/);
    }
  });

  it('refuses any column that is not "alias"."column"', () => {
    const s = service(world());
    for (const bad of ['products.id', '"products"."id"; drop table x', 'id', '"Products"."id"', '"p"."id" or 1=1']) {
      expect(() => s.productPredicate(restricted, { productId: bad }), bad).toThrow();
      expect(() => s.variantPredicate(restricted, { variantId: bad }), bad).toThrow();
    }
  });
});

describe('checkLines — live, exact (R-8, FR-043)', () => {
  const pricedWorld = (conditions: World['conditions']) =>
    world({
      conditions,
      prices: {
        PLN: { pos: [{ variantId: null, amount: '10.0000' }], zero: [{ variantId: null, amount: '0.0000' }], none: [{ variantId: null, amount: null }] },
        EUR: { pos: [{ variantId: null, amount: '2.0000' }], zero: [{ variantId: null, amount: '0.0000' }] },
      },
    });

  it('truth table: gt_zero needs > 0; gte_zero accepts 0 and marks it "no fixed price"', async () => {
    const s = service(pricedWorld([{ currencyCode: 'PLN', threshold: 'gt_zero' }, { currencyCode: 'EUR', threshold: 'gte_zero' }]));
    const scope = await s.resolveScope('u');
    const lines = await s.checkLines(scope, [{ productId: 'pos' }, { productId: 'zero' }, { productId: 'none' }, { productId: 'missing' }]);
    expect(lines).toEqual([
      { visible: true, noFixedPrice: false },
      { visible: true, noFixedPrice: true },
      { visible: false, noFixedPrice: false },
      { visible: false, noFixedPrice: false },
    ]);
  });

  it('unrestricted and system see every line with no marker; no_category sees none', async () => {
    const s = service(pricedWorld([{ currencyCode: 'PLN', threshold: 'gt_zero' }]));
    expect(await s.checkLines(s.systemScope(), [{ productId: 'none' }])).toEqual([{ visible: true, noFixedPrice: false }]);
    expect(await s.checkLines({ kind: 'no_category', roleId: ROLE }, [{ productId: 'pos' }])).toEqual([{ visible: false, noFixedPrice: false }]);
  });

  it('a variant line is judged by that variant', async () => {
    const w = world({
      conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }],
      prices: { PLN: { cfg: [{ variantId: 'v1', amount: '5.0000' }, { variantId: 'v2', amount: null }] } },
    });
    const s = service(w);
    const scope = await s.resolveScope('u');
    expect(await s.checkLines(scope, [{ productId: 'cfg', variantId: 'v1' }, { productId: 'cfg', variantId: 'v2' }, { productId: 'cfg' }])).toEqual([
      { visible: true, noFixedPrice: false },
      { visible: false, noFixedPrice: false },
      { visible: true, noFixedPrice: false },
    ]);
  });
});
