import type {
  CatalogAttributeView,
  ProductRuleDefinition,
  RuleCondition,
  RuleGroup,
} from '@endora-commerce/contracts';

/**
 * The product rule evaluator — spec 193 T057 (research R-9; FR-050, FR-051, FR-057, FR-079;
 * threat model TM-11).
 *
 * **Pure.** A rule is evaluated over a product's facts and the attribute catalogue as it is at
 * evaluation time; nothing here reads a database, and no value of a definition reaches a query or
 * a JSON path — an attribute key is looked up as an own property of the product's attribute
 * values, and an option key is compared as a string.
 *
 * The catalogue is re-read at every evaluation (TM-11): an attribute deleted, re-scoped to
 * channels or languages, or changed to another type after the rule was saved makes its condition
 * "not met"; an option removed no longer matches. A missing value is "not met" (FR-057). Being
 * active, not archived and not deleted is applied outside the rule (FR-051, FR-079): a rule only
 * ever narrows.
 */

/** What a rule may test of an attribute: its kind, and a choice attribute's option keys. */
export type RuleAttribute = { readonly kind: 'boolean' } | { readonly kind: 'choice'; readonly options: ReadonlySet<string> };

/** The attributes a rule may name, by key — boolean or choice, neither channel- nor language-scoped. */
export type RuleAttributeIndex = ReadonlyMap<string, RuleAttribute>;

/** A product's catalogue-price facts in one currency (from the served flag generation). */
export interface CataloguePriceFact {
  /** Some line of the product is priced above zero. */
  readonly hasPositive: boolean;
}

export interface ProductRuleFacts {
  readonly status: string;
  readonly archived: boolean;
  readonly deleted: boolean;
  readonly attributeValues: Readonly<Record<string, unknown>>;
  /** Per currency the product is priced in (a row of the served generation); absent = not priced. */
  readonly prices: ReadonlyMap<string, CataloguePriceFact>;
}

const CHOICE_TYPES = new Set(['select', 'enum', 'multiselect']);

/** FR-050: the attributes a rule may name, from the catalogue as it is now. */
export function ruleAttributeIndex(attributes: readonly CatalogAttributeView[]): RuleAttributeIndex {
  const index = new Map<string, RuleAttribute>();
  for (const attribute of attributes) {
    if (!attribute.scopeLevels.every((level) => level === 'G')) continue;
    if (attribute.valueType === 'boolean') index.set(attribute.key, { kind: 'boolean' });
    else if (CHOICE_TYPES.has(attribute.valueType)) {
      index.set(attribute.key, { kind: 'choice', options: new Set(attribute.options.map((o) => o.value)) });
    }
  }
  return index;
}

function ownValue(values: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
}

function conditionMet(condition: RuleCondition, facts: ProductRuleFacts, attributes: RuleAttributeIndex): boolean {
  switch (condition.kind) {
    case 'catalogue_price': {
      const fact = facts.prices.get(condition.currencyCode);
      if (fact === undefined) return false;
      return condition.threshold === 'gte_zero' ? true : fact.hasPositive;
    }
    case 'attribute_boolean': {
      const attribute = attributes.get(condition.attributeKey);
      if (attribute?.kind !== 'boolean') return false;
      const value = ownValue(facts.attributeValues, condition.attributeKey);
      return typeof value === 'boolean' && value === condition.value;
    }
    case 'attribute_choice': {
      const attribute = attributes.get(condition.attributeKey);
      if (attribute?.kind !== 'choice') return false;
      const value = ownValue(facts.attributeValues, condition.attributeKey);
      const values = Array.isArray(value) ? value : [value];
      return values.some(
        (v) => typeof v === 'string' && v.length > 0 && attribute.options.has(v) && condition.optionKeys.includes(v),
      );
    }
  }
}

function nodeMet(node: RuleCondition | RuleGroup, facts: ProductRuleFacts, attributes: RuleAttributeIndex): boolean {
  if (node.kind === 'group') return matches(node.match, node.conditions, facts, attributes);
  return conditionMet(node, facts, attributes);
}

function matches(
  match: 'all' | 'any',
  nodes: ReadonlyArray<RuleCondition | RuleGroup>,
  facts: ProductRuleFacts,
  attributes: RuleAttributeIndex,
): boolean {
  return match === 'all'
    ? nodes.every((n) => nodeMet(n, facts, attributes))
    : nodes.some((n) => nodeMet(n, facts, attributes));
}

/** Whether the product's facts meet the definition — the rule alone. */
export function meetsDefinition(definition: ProductRuleDefinition, facts: ProductRuleFacts, attributes: RuleAttributeIndex): boolean {
  return matches(definition.match, definition.conditions, facts, attributes);
}

/** The product is live — active, not archived, not deleted (FR-051, FR-079). */
export function isLive(facts: Pick<ProductRuleFacts, 'status' | 'archived' | 'deleted'>): boolean {
  return facts.status === 'active' && !facts.archived && !facts.deleted;
}

/** Whether the product belongs on a channel this rule governs: live, and meeting the rule. */
export function isRuleMember(definition: ProductRuleDefinition, facts: ProductRuleFacts, attributes: RuleAttributeIndex): boolean {
  return isLive(facts) && meetsDefinition(definition, facts, attributes);
}

export interface RuleDefinitionIssue {
  readonly path: string;
  readonly issue: 'unknown_attribute' | 'not_a_boolean_attribute' | 'not_a_choice_attribute' | 'unknown_option';
}

function conditionIssues(condition: RuleCondition, path: string, attributes: RuleAttributeIndex): RuleDefinitionIssue[] {
  if (condition.kind === 'catalogue_price') return [];
  const attribute = attributes.get(condition.attributeKey);
  if (attribute === undefined) return [{ path: `${path}.attributeKey`, issue: 'unknown_attribute' }];
  if (condition.kind === 'attribute_boolean') {
    return attribute.kind === 'boolean' ? [] : [{ path: `${path}.attributeKey`, issue: 'not_a_boolean_attribute' }];
  }
  if (attribute.kind !== 'choice') return [{ path: `${path}.attributeKey`, issue: 'not_a_choice_attribute' }];
  return condition.optionKeys.every((key) => attribute.options.has(key)) ? [] : [{ path: `${path}.optionKeys`, issue: 'unknown_option' }];
}

/**
 * FR-050 — the save-time check: every attribute a condition names is a boolean or choice attribute
 * that is neither channel- nor language-scoped, of the condition's kind, and every option key
 * exists. Answers the issues in definition order; empty = valid.
 */
export function validateRuleDefinition(definition: ProductRuleDefinition, attributes: RuleAttributeIndex): RuleDefinitionIssue[] {
  const issues: RuleDefinitionIssue[] = [];
  definition.conditions.forEach((node, i) => {
    const path = `definition.conditions.${i}`;
    if (node.kind === 'group') {
      node.conditions.forEach((c, j) => issues.push(...conditionIssues(c, `${path}.conditions.${j}`, attributes)));
    } else {
      issues.push(...conditionIssues(node, path, attributes));
    }
  });
  return issues;
}

/** The currencies a definition's price conditions name. */
export function ruleCurrencies(definition: ProductRuleDefinition): string[] {
  const out = new Set<string>();
  const visit = (node: RuleCondition | RuleGroup): void => {
    if (node.kind === 'group') node.conditions.forEach(visit);
    else if (node.kind === 'catalogue_price') out.add(node.currencyCode);
  };
  definition.conditions.forEach(visit);
  return [...out].sort();
}
