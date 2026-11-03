import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import {
  ERROR_CODES,
  SCOPE_COMPLETENESS_GATE_MODES,
  getAttributeScope,
  isNonEmpty,
  pairsTurningOn,
  toScopeChannel,
  type AttributeScope,
  type OverrideRow,
  type ScopeChannel,
  type ScopeCompletenessGateMode,
  type ScopeMissingValue,
  type ScopeSnapshot,
  type ScopeWarning,
  sameLanguage,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { SalesChannelMembershipPort, SettingsReadPort } from '@endora-commerce/platform/kernel';
import type { Product } from '../entities/product.entity.js';
import { ProductUrlKey } from '../entities/product-url-key.entity.js';
import { ProductValueOverride } from '../entities/product-value-override.entity.js';
import type { CatalogAttributeReadService } from './catalog-attribute-read.service.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/`) — the completeness gate (US6, FR-060,
 * FR-061, research R18) and what it would report at a scope-overview cell (FR-041).
 *
 * {@link checkCompleteness} is the one definition of "complete at (C, L)": the name and
 * every required language-scoped attribute count only where they are set at (C, L), at
 * C, or for L itself — the resolver's fallback to another language never satisfies them
 * (FR-060, last sentence) — and the URL key is satisfied by the product's effective key
 * there, the global key included (K3).
 *
 * The gate asks it only about the pairs a **status write** turns on
 * ({@link completenessFailures} over `pairsTurningOn`, owner decision M3 → A): joining a
 * channel, a channel gaining a language, a window opening, an audience change, Archive
 * and Restore never reach it. It runs only where an operator's write asks for it, with
 * the mode the caller read once for the request: imports, connectors and the API-key
 * upsert never pass a mode, so they are never gated (A-6, FR-061).
 */

/** The setting that chooses the gate's mode — one platform-wide value (FR-060). */
export const SCOPE_COMPLETENESS_GATE_SETTING = 'catalog.scope_completeness_gate';

/** Everything {@link checkCompleteness} reads about one product. */
export interface CompletenessFacts {
  /** The baseline name per language. */
  name: Readonly<Record<string, string>>;
  /** The global URL key (`products.slug`). */
  slug: string;
  attributeValues: Readonly<Record<string, unknown>>;
  /** The required, language-scoped user attributes of the product's attribute set, by key. */
  requiredLanguageAttributes: readonly string[];
  /** The user-defined attributes' current scope flags, by key. */
  attributeScopes: ReadonlyMap<string, AttributeScope>;
  valueOverrides: readonly OverrideRow[];
  urlKeys: ReadonlyArray<{ languageCode: string; salesChannelId: string | null | undefined }>;
}

/** A failing pair: a (channel, language) the write turns on, and what it lacks there. */
export interface CompletenessFailure {
  channelId: string;
  languageCode: string;
  missing: ScopeMissingValue[];
}

/** Present, and for text not blank. */
function hasValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return isNonEmpty(value);
}

/** The value of a per-language baseline in `languageCode` itself — no fallback. */
function inLanguage(baseline: unknown, languageCode: string): unknown {
  if (baseline === null || typeof baseline !== 'object' || Array.isArray(baseline)) return undefined;
  for (const [code, value] of Object.entries(baseline as Record<string, unknown>)) {
    if (sameLanguage(code, languageCode)) return value;
  }
  return undefined;
}

/** A value override at (C, L) or at C that the attribute's scope still lets the resolver read. */
function overriddenAt(facts: CompletenessFacts, attributeKey: string, channelId: string, languageCode: string): boolean {
  const scope = getAttributeScope(attributeKey, facts.attributeScopes.get(attributeKey) ?? null);
  if (!scope.channelScoped) return false;
  return facts.valueOverrides.some(
    (row) =>
      row.attributeKey === attributeKey &&
      row.channelId === channelId &&
      (row.languageCode === null || (scope.languageScoped && sameLanguage(row.languageCode, languageCode))) &&
      hasValue(row.value.v),
  );
}

/**
 * What the gate reports missing at (channel, language) — `[]` when complete. Name
 * first, then the URL key, then the attributes by key. Status is not an input: the
 * overview asks it for every evaluable cell whatever its status (FR-041).
 */
export function checkCompleteness(facts: CompletenessFacts, channelId: string, languageCode: string): ScopeMissingValue[] {
  const missing: ScopeMissingValue[] = [];
  if (!hasValue(inLanguage(facts.name, languageCode)) && !overriddenAt(facts, 'name', channelId, languageCode)) {
    missing.push('name');
  }
  const keyed =
    hasValue(facts.slug) ||
    facts.urlKeys.some(
      (key) => sameLanguage(key.languageCode, languageCode) && (key.salesChannelId == null || key.salesChannelId === channelId),
    );
  if (!keyed) missing.push('urlKey');
  for (const key of [...facts.requiredLanguageAttributes].sort()) {
    if (hasValue(inLanguage(facts.attributeValues[key], languageCode))) continue;
    if (overriddenAt(facts, key, channelId, languageCode)) continue;
    missing.push(`attribute:${key}`);
  }
  return missing;
}

/** The pairs a status write turns on that lack a required value — the gate's subject. */
export function completenessFailures(
  before: ScopeSnapshot,
  after: ScopeSnapshot,
  channels: readonly ScopeChannel[],
  facts: CompletenessFacts,
): CompletenessFailure[] {
  return pairsTurningOn(before, after, channels).flatMap(({ channelId, languageCode }) => {
    const missing = checkCompleteness(facts, channelId, languageCode);
    return missing.length === 0 ? [] : [{ channelId, languageCode, missing }];
  });
}

/**
 * What the mode makes of the failures (FR-060): `warn` → the write is saved and each
 * failing pair is a `completeness` warning; `refuse` → `422 SCOPE_INCOMPLETE` naming
 * every failing pair, so the write is refused as a whole (N3).
 */
export function completenessOutcome(mode: ScopeCompletenessGateMode, failures: readonly CompletenessFailure[]): ScopeWarning[] {
  if (failures.length === 0) return [];
  if (mode === 'refuse') {
    throw new HttpError(
      422,
      ERROR_CODES.SCOPE_INCOMPLETE,
      'The product cannot be switched on where required content is missing.',
      { pairs: failures.map((failure) => ({ ...failure, missing: [...failure.missing] })) },
    );
  }
  return failures.map((failure) => ({ kind: 'completeness' as const, ...failure, missing: [...failure.missing] }));
}

/** The required, language-scoped user attributes among an attribute set's definitions. */
export function requiredLanguageAttributeKeys(
  views: ReadonlyArray<{ key: string; customFieldDefinitionId: string; isRequired: boolean; languageScoped: boolean }>,
  setDefinitionIds: ReadonlySet<string>,
): string[] {
  return views
    .filter((view) => view.isRequired && view.languageScoped && setDefinitionIds.has(view.customFieldDefinitionId))
    .map((view) => view.key)
    .sort();
}

/** The definitions an attribute set holds. */
export async function attributeSetDefinitionIds(em: EntityManager, attributeSetId: string | null | undefined): Promise<Set<string>> {
  if (!attributeSetId) return new Set();
  const rows = await em
    .getConnection()
    .execute<Array<{ custom_field_definition_id: string }>>(
      `select custom_field_definition_id from attribute_set_attributes where attribute_set_id = ?`,
      [attributeSetId],
      'all',
      em.getTransactionContext(),
    );
  return new Set(rows.map((row) => row.custom_field_definition_id));
}

/**
 * The gate's I/O: the mode, the product's member channels and the facts
 * {@link checkCompleteness} reads. Composed only into the operator's admin services;
 * the integration ports are built without it.
 */
export class ScopeCompletenessGate {
  constructor(
    private readonly membership: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'>,
    private readonly attributeRead: Pick<CatalogAttributeReadService, 'listAll'>,
    private readonly settings: Pick<SettingsReadPort, 'get'>,
  ) {}

  /** The platform-wide mode (`catalog.scope_completeness_gate`), read once per request. */
  mode(): Promise<ScopeCompletenessGateMode> {
    return this.settings.get(SCOPE_COMPLETENESS_GATE_SETTING, null, z.enum(SCOPE_COMPLETENESS_GATE_MODES));
  }

  /** The product's member channels with their languages, as the rule reads them. */
  async memberChannels(productId: string): Promise<ScopeChannel[]> {
    return (await this.membership.listChannelsForEntity('product', productId)).map((channel) => toScopeChannel(channel));
  }

  /** Everything {@link checkCompleteness} reads about `product`, on `em` (inside the caller's transaction). */
  async facts(em: EntityManager, product: Product): Promise<CompletenessFacts> {
    const [overrides, urlKeys, views, setDefinitions] = await Promise.all([
      em.find(ProductValueOverride, { productId: product.id }),
      em.find(ProductUrlKey, { productId: product.id }),
      this.attributeRead.listAll(),
      attributeSetDefinitionIds(em, product.attributeSetId),
    ]);
    return {
      name: product.name ?? {},
      slug: product.slug ?? '',
      attributeValues: product.attributeValues ?? {},
      requiredLanguageAttributes: requiredLanguageAttributeKeys(views, setDefinitions),
      attributeScopes: new Map(
        views.map((view) => [view.key, { channelScoped: view.channelScoped, languageScoped: view.languageScoped }]),
      ),
      valueOverrides: overrides.map((row) => ({
        attributeKey: row.attributeKey,
        channelId: row.channelId,
        languageCode: row.languageCode ?? null,
        value: row.value,
      })),
      urlKeys: urlKeys.map((row) => ({ languageCode: row.languageCode, salesChannelId: row.salesChannelId ?? null })),
    };
  }

  /**
   * Run the gate for one product's status write: the pairs `before` → `after` turns on
   * among `channels`, checked against the product's facts. Returns the warnings in
   * `warn`; throws `SCOPE_INCOMPLETE` in `refuse`. Reads nothing when no pair turns on.
   */
  async enforce(
    em: EntityManager,
    product: Product,
    before: ScopeSnapshot,
    after: ScopeSnapshot,
    channels: readonly ScopeChannel[],
    mode: ScopeCompletenessGateMode,
  ): Promise<ScopeWarning[]> {
    if (pairsTurningOn(before, after, channels).length === 0) return [];
    return completenessOutcome(mode, completenessFailures(before, after, channels, await this.facts(em, product)));
  }
}

/**
 * Checkpoint C security review (I7) — the gate composed for the operator's services,
 * or `undefined` with **one** warning naming what the composition lacks: a deployment
 * that wires no settings read (or no membership, no attribute read) must not run with
 * the completeness check silently off.
 */
export function composeCompletenessGate(
  deps: {
    membership?: Pick<SalesChannelMembershipPort, 'listChannelsForEntity'> | undefined;
    attributeRead?: Pick<CatalogAttributeReadService, 'listAll'> | undefined;
    settings?: Pick<SettingsReadPort, 'get'> | undefined;
  },
  log: { warn(obj: unknown, msg?: string): void } | undefined,
): ScopeCompletenessGate | undefined {
  if (deps.membership && deps.attributeRead && deps.settings) {
    return new ScopeCompletenessGate(deps.membership, deps.attributeRead, deps.settings);
  }
  const missing = (['membership', 'attributeRead', 'settings'] as const).filter((name) => !deps[name]);
  log?.warn(
    { missing },
    '[catalog] the scope completeness gate is not composed: status writes run unchecked in this composition',
  );
  return undefined;
}
