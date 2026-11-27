import { describe, expect, it } from 'vitest';
import type { CatalogAttributeView, ProductRuleDefinition, RuleCondition } from '@endora-commerce/contracts';
import {
  isRuleMember,
  meetsDefinition,
  ruleAttributeIndex,
  validateRuleDefinition,
  type ProductRuleFacts,
} from './product-rule-evaluator.js';

/**
 * The product rule
 * evaluator: a pure function over a product's facts and the attribute catalogue as it is now.
 */

function attribute(key: string, valueType: CatalogAttributeView['valueType'], options: string[] = [], scopeLevels: CatalogAttributeView['scopeLevels'] = ['G']): CatalogAttributeView {
  return {
    key,
    valueType,
    scopeLevels,
    scopable: scopeLevels.some((l) => l !== 'G'),
    options: options.map((value, i) => ({ id: `${key}-${i}`, value, label: {}, labelDefault: value, isDefault: false, sortOrder: i, createdAt: new Date(0) })),
  } as unknown as CatalogAttributeView;
}

const ATTRIBUTES = ruleAttributeIndex([
  attribute('featured', 'boolean'),
  attribute('clearance', 'boolean'),
  attribute('segment', 'select', ['retail', 'trade', 'export']),
  attribute('tags', 'multiselect', ['eco', 'new']),
  attribute('colour', 'enum', ['red', 'blue']),
  attribute('notes', 'string'),
  attribute('channel_flag', 'boolean', [], ['G', 'C']),
  attribute('lang_choice', 'select', ['a'], ['G', 'C', 'CL']),
]);

function facts(overrides: Partial<ProductRuleFacts> = {}): ProductRuleFacts {
  return {
    status: 'active',
    archived: false,
    deleted: false,
    attributeValues: {},
    prices: new Map(),
    ...overrides,
  };
}

const featured = { kind: 'attribute_boolean', attributeKey: 'featured', value: true } as const;
const trade: RuleCondition = { kind: 'attribute_choice', attributeKey: 'segment', optionKeys: ['trade', 'export'] };
const pricedPln = { kind: 'catalogue_price', currencyCode: 'PLN', threshold: 'gt_zero' } as const;
const pricedEurZero = { kind: 'catalogue_price', currencyCode: 'EUR', threshold: 'gte_zero' } as const;

describe('ruleAttributeIndex', () => {
  it('keeps boolean and choice attributes that are neither channel- nor language-scoped (FR-050)', () => {
    expect([...ATTRIBUTES.keys()].sort()).toEqual(['clearance', 'colour', 'featured', 'segment', 'tags']);
    expect(ATTRIBUTES.get('segment')).toEqual({ kind: 'choice', options: new Set(['retail', 'trade', 'export']) });
    expect(ATTRIBUTES.get('featured')).toEqual({ kind: 'boolean' });
  });
});

describe('meetsDefinition — conditions', () => {
  it('boolean: met only on the exact value', () => {
    const def: ProductRuleDefinition = { match: 'all', conditions: [featured] };
    expect(meetsDefinition(def, facts({ attributeValues: { featured: true } }), ATTRIBUTES)).toBe(true);
    expect(meetsDefinition(def, facts({ attributeValues: { featured: false } }), ATTRIBUTES)).toBe(false);
    expect(meetsDefinition(def, facts({ attributeValues: { featured: 'true' } }), ATTRIBUTES)).toBe(false);
    expect(
      meetsDefinition({ match: 'all', conditions: [{ ...featured, value: false }] }, facts({ attributeValues: { featured: false } }), ATTRIBUTES),
    ).toBe(true);
  });

  it('choice: met when the value is one of the option keys; a multiselect when any of its values is', () => {
    const def: ProductRuleDefinition = { match: 'all', conditions: [trade] };
    expect(meetsDefinition(def, facts({ attributeValues: { segment: 'trade' } }), ATTRIBUTES)).toBe(true);
    expect(meetsDefinition(def, facts({ attributeValues: { segment: 'retail' } }), ATTRIBUTES)).toBe(false);
    const tags: ProductRuleDefinition = { match: 'all', conditions: [{ kind: 'attribute_choice', attributeKey: 'tags', optionKeys: ['eco'] }] };
    expect(meetsDefinition(tags, facts({ attributeValues: { tags: ['new', 'eco'] } }), ATTRIBUTES)).toBe(true);
    expect(meetsDefinition(tags, facts({ attributeValues: { tags: ['new'] } }), ATTRIBUTES)).toBe(false);
  });

  it('catalogue price: gt_zero needs a positive price, gte_zero any price, zero included', () => {
    const gt: ProductRuleDefinition = { match: 'all', conditions: [pricedPln] };
    const gte: ProductRuleDefinition = { match: 'all', conditions: [pricedEurZero] };
    expect(meetsDefinition(gt, facts({ prices: new Map([['PLN', { hasPositive: true }]]) }), ATTRIBUTES)).toBe(true);
    expect(meetsDefinition(gt, facts({ prices: new Map([['PLN', { hasPositive: false }]]) }), ATTRIBUTES)).toBe(false);
    expect(meetsDefinition(gte, facts({ prices: new Map([['EUR', { hasPositive: false }]]) }), ATTRIBUTES)).toBe(true);
    expect(meetsDefinition(gte, facts({ prices: new Map() }), ATTRIBUTES)).toBe(false);
  });

  it('a missing value is not met, whatever the condition asks (FR-057)', () => {
    expect(meetsDefinition({ match: 'all', conditions: [featured] }, facts(), ATTRIBUTES)).toBe(false);
    expect(meetsDefinition({ match: 'all', conditions: [{ ...featured, value: false }] }, facts(), ATTRIBUTES)).toBe(false);
    expect(meetsDefinition({ match: 'all', conditions: [{ ...featured, value: false }] }, facts({ attributeValues: { featured: null } }), ATTRIBUTES)).toBe(false);
    expect(meetsDefinition({ match: 'all', conditions: [trade] }, facts({ attributeValues: { segment: '' } }), ATTRIBUTES)).toBe(false);
  });
});

describe('meetsDefinition — all / any and one nesting level', () => {
  it('all needs every member, any needs one', () => {
    const all: ProductRuleDefinition = { match: 'all', conditions: [featured, pricedPln] };
    const any: ProductRuleDefinition = { match: 'any', conditions: [featured, pricedPln] };
    const onlyFeatured = facts({ attributeValues: { featured: true } });
    expect(meetsDefinition(all, onlyFeatured, ATTRIBUTES)).toBe(false);
    expect(meetsDefinition(any, onlyFeatured, ATTRIBUTES)).toBe(true);
    expect(meetsDefinition(any, facts(), ATTRIBUTES)).toBe(false);
  });

  it('a group is evaluated with its own match inside the root', () => {
    const def: ProductRuleDefinition = {
      match: 'all',
      conditions: [pricedPln, { kind: 'group', match: 'any', conditions: [featured, trade] }],
    };
    const priced = new Map([['PLN', { hasPositive: true }]]);
    expect(meetsDefinition(def, facts({ prices: priced, attributeValues: { segment: 'export' } }), ATTRIBUTES)).toBe(true);
    expect(meetsDefinition(def, facts({ prices: priced, attributeValues: { segment: 'retail' } }), ATTRIBUTES)).toBe(false);
    expect(meetsDefinition(def, facts({ attributeValues: { featured: true } }), ATTRIBUTES)).toBe(false);
  });
});

describe('isRuleMember — active, not archived, not deleted, outside the rule (FR-051, FR-079)', () => {
  const def: ProductRuleDefinition = { match: 'all', conditions: [featured] };
  const meets = { attributeValues: { featured: true } };

  it('a product that meets the rule and is live is a member', () => {
    expect(isRuleMember(def, facts(meets), ATTRIBUTES)).toBe(true);
  });

  it.each([
    ['inactive', { status: 'inactive' }],
    ['draft', { status: 'draft' }],
    ['archived', { archived: true }],
    ['deleted', { deleted: true }],
  ] as const)('a %s product is never a member, even when it meets the rule', (_label, override) => {
    expect(isRuleMember(def, facts({ ...meets, ...override }), ATTRIBUTES)).toBe(false);
  });
});

describe('TM-11 — the attribute catalogue is re-read at evaluation; definitions never reach a query', () => {
  it('an attribute deleted after the rule was saved evaluates "not met"', () => {
    const without = ruleAttributeIndex([attribute('segment', 'select', ['trade'])]);
    expect(meetsDefinition({ match: 'all', conditions: [featured] }, facts({ attributeValues: { featured: true } }), without)).toBe(false);
  });

  it('an attribute re-scoped to channels after the rule was saved evaluates "not met"', () => {
    const rescoped = ruleAttributeIndex([attribute('featured', 'boolean', [], ['G', 'C'])]);
    expect(meetsDefinition({ match: 'all', conditions: [featured] }, facts({ attributeValues: { featured: true } }), rescoped)).toBe(false);
  });

  it('an attribute whose type changed evaluates "not met"; an option removed no longer matches', () => {
    const changed = ruleAttributeIndex([attribute('featured', 'select', ['true']), attribute('segment', 'select', ['retail'])]);
    expect(meetsDefinition({ match: 'all', conditions: [featured] }, facts({ attributeValues: { featured: true } }), changed)).toBe(false);
    expect(meetsDefinition({ match: 'all', conditions: [trade] }, facts({ attributeValues: { segment: 'trade' } }), changed)).toBe(false);
  });

  it('a key is looked up as an own property only — no path, no prototype', () => {
    const index = ruleAttributeIndex([attribute('a.b', 'boolean'), attribute('__proto__', 'boolean'), attribute('constructor', 'boolean')]);
    const dotted = { kind: 'attribute_boolean', attributeKey: 'a.b', value: true } as const;
    expect(meetsDefinition({ match: 'all', conditions: [dotted] }, facts({ attributeValues: { a: { b: true } } }), index)).toBe(false);
    const proto = { kind: 'attribute_boolean', attributeKey: '__proto__', value: true } as const;
    expect(meetsDefinition({ match: 'all', conditions: [proto] }, facts({ attributeValues: {} }), index)).toBe(false);
    const ctor = { kind: 'attribute_boolean', attributeKey: 'constructor', value: true } as const;
    expect(meetsDefinition({ match: 'all', conditions: [ctor] }, facts({ attributeValues: {} }), index)).toBe(false);
  });
});

describe('validateRuleDefinition — the save-time check (FR-050)', () => {
  it('accepts boolean and choice attributes with existing options', () => {
    expect(validateRuleDefinition({ match: 'any', conditions: [featured, trade, pricedPln] }, ATTRIBUTES)).toEqual([]);
  });

  it('names an unknown, scoped or non-boolean/choice attribute, a type mismatch and an unknown option', () => {
    const issues = validateRuleDefinition(
      {
        match: 'all',
        conditions: [
          { kind: 'attribute_boolean', attributeKey: 'missing', value: true },
          { kind: 'attribute_boolean', attributeKey: 'channel_flag', value: true },
          { kind: 'attribute_choice', attributeKey: 'notes', optionKeys: ['x'] },
          { kind: 'group', match: 'any', conditions: [{ kind: 'attribute_choice', attributeKey: 'featured', optionKeys: ['x'] }, { kind: 'attribute_choice', attributeKey: 'segment', optionKeys: ['trade', 'wholesale'] }] },
        ],
      },
      ATTRIBUTES,
    );
    expect(issues).toEqual([
      { path: 'definition.conditions.0.attributeKey', issue: 'unknown_attribute' },
      { path: 'definition.conditions.1.attributeKey', issue: 'unknown_attribute' },
      { path: 'definition.conditions.2.attributeKey', issue: 'unknown_attribute' },
      { path: 'definition.conditions.3.conditions.0.attributeKey', issue: 'not_a_choice_attribute' },
      { path: 'definition.conditions.3.conditions.1.optionKeys', issue: 'unknown_option' },
    ]);
  });

  it('names a boolean condition on a choice attribute', () => {
    expect(validateRuleDefinition({ match: 'all', conditions: [{ kind: 'attribute_boolean', attributeKey: 'segment', value: true }] }, ATTRIBUTES)).toEqual([
      { path: 'definition.conditions.0.attributeKey', issue: 'not_a_boolean_attribute' },
    ]);
  });
});
