# Ports (spec 193)

Types live in `packages/contracts/src/product-visibility.ts` (new) unless stated. Each port's
doc block follows `specs/conventions/module-composition.md` (container name, owner, owner-off
sentence). Published-surface changes follow `specs/conventions/contract-surface.md` and carry a
changeset (`specs/conventions/release-intent.md`).

## 1. `adminProductVisibilityPort` — owner `product_visibility_rules` (capability, read)

```ts
type VisibilityThreshold = 'gt_zero' | 'gte_zero';

/** TM-3: required on every catalog / price_lists admin read and write; never optional, never defaulted. */
type AdminProductVisibilityScope =
  | { kind: 'system' }                                         // storefront, connectors, system jobs — explicit
  | { kind: 'unrestricted'; roleId: string; reason: 'platform_admin' | 'self_lifting' | 'mapped_unrestricted' | 'unmapped' }
  | { kind: 'no_category'; roleId: string }                   // FR-023 fail-closed
  | {
      kind: 'restricted';
      roleId: string;
      category: { id: string; name: string };
      /** Conditions whose currency is active and whose designation is in force now. */
      conditions: ReadonlyArray<{ currencyCode: string; threshold: VisibilityThreshold; generation: number }>;
    };

interface SqlFragment { sql: string; params: unknown[] }        // `?` placeholders, in order

/** TM-3 (3): a discriminated union — a bug can never read as "unrestricted". */
type VisibilityPredicate =
  | { kind: 'none' }                                           // system / unrestricted: no clause (SC-003)
  | { kind: 'sql'; fragment: SqlFragment }
  | { kind: 'deny' };                                          // no_category, or no condition in force: constant false

interface AdminProductVisibilityPort {
  /**
   * Per request — or, off-request, at execution for the requesting admin (bulk worker, undo,
   * assistant tool, import/export job: TM-3 (2)). Never cached across requests (FR-060).
   * Never catches: a role refusal or an unreadable mapping / designation answers `no_category` or
   * throws — never `unrestricted` (TM-3 (4)). A currency whose served generation was built for
   * another designation than the current one contributes no condition (TM-7 (4)).
   */
  resolveScope(adminUserId: string): Promise<AdminProductVisibilityScope>;
  systemScope(): AdminProductVisibilityScope;
  /**
   * `columns` values must match `^"[a-z_]+"\."[a-z_]+"$` or the call throws (TM-8); the caller
   * embeds the fragment inside parentheses with its params in order. No request text ever reaches
   * a fragment.
   */
  productPredicate(scope: AdminProductVisibilityScope, columns: { productId: string }): VisibilityPredicate;
  variantPredicate(scope: AdminProductVisibilityScope, columns: { variantId: string }): VisibilityPredicate;
  /** Non-SQL callers (price book grid's variant lines): which of these are visible, from the flags tables. */
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
```

- `noFixedPrice` is true only for a restricted scope where the line is visible solely through a
  `gte_zero` condition at price 0 (FR-043); always false otherwise (OQ-12).
- **Owner off**: consumers probe `effectiveState.isPresent('product_visibility_rules')` before
  resolving and treat absent as unrestricted (`degrades-without`, whenAbsent: "admin product reads,
  order lines and quote lines are not narrowed by role"). A call made while present that fails is
  not caught (`check:port-catches`).
- Consumers: `catalog` and `price_lists` (Phase 5a), `orders`, `quote_requests` (Phase 9).

## 2. `productRuleGovernancePort` — owner `product_visibility_rules` (capability, read) — FR-055

```ts
interface ProductRuleGovernancePort {
  governedChannels(): Promise<ReadonlyArray<{ salesChannelId: string; productRuleId: string; productRuleName: string }>>;
  /** Whether each product meets the rule governing the channel now (status, archive, attributes, flags). `null` map ⇒ channel not governed. */
  meetsRule(salesChannelId: string, productIds: readonly string[]): Promise<ReadonlyMap<string, boolean> | null>;
  /**
   * FR-090, FR-091 (R-18, owner N1): per ref, true when the product (or variant) is not a member of
   * the governed channel only because the rule excludes it — channel governed, not a member, active,
   * not archived or deleted — AND its currently stored channel status (scope level `channel`) is not
   * `inactive` (inherited / no stored value counts as not inactive). The stored value counts whenever
   * it was written (pending admission, after admission, or left over); per-language statuses are never
   * read. Ungoverned channel ⇒ all false. Built from own tables + the membership port + catalog read
   * ports only (no foreign SQL).
   */
  excludedOnlyByRule(
    salesChannelId: string,
    refs: ReadonlyArray<{ productId: string; variantId?: string | null }>,
  ): Promise<ReadonlyArray<boolean>>;
}
```

Owner off: the port gate answers 503 `MODULE_DISABLED`; a connector that probes presence first
treats absent as "nothing governed" — consistent with the kernel, which governs nothing while the
module is off.

## 3. `catalogueReferencePricePort` — owner `price_lists` (capability port beside `pricingService`)

Type in `packages/contracts/src/price-lists.ts`.

```ts
type CatalogueDesignation = { priceListId: string; salesChannelId: string };

type DesignationStatus =
  | { inForce: true; window: { startsAt: string | null; endsAt: string | null } }
  | { inForce: false; reason: 'not_found' | 'currency_mismatch' | 'not_regular' | 'audience_restricted'
      | 'not_on_channel' | 'not_active' | 'outside_schedule';
      window: { startsAt: string | null; endsAt: string | null } | null };

interface CatalogueReferencePricePort {
  /**
   * Quantity 1, no buyer, now; fixed profile [base book, designated book?]; one entry per product;
   * `lines` is the product itself when it has no variants, else one per variant.
   * Amount is the engine's four-place decimal string; `null` = unpriced (0 is a price).
   * Answers the designation **as if in force** (its status and schedule window are not read);
   * the caller applies `designationStatus` at read time — not in force ⇒ no catalogue price
   * in that currency (FR-007). A deleted book contributes no rows (base stands).
   */
  resolve(input: {
    currencyCode: string;
    designation: CatalogueDesignation | null;
    productIds: readonly string[];
  }): Promise<ReadonlyMap<string, ReadonlyArray<{ variantId: string | null; amount: string | null }>>>;
  designationStatus(input: { currencyCode: string } & CatalogueDesignation): Promise<DesignationStatus>;
  /** Many at once — one statement (per-request scope resolution). */
  designationStatuses(input: ReadonlyArray<{ currencyCode: string } & CatalogueDesignation>): Promise<ReadonlyArray<DesignationStatus>>;
  /**
   * Durable, monotonic watermark of price changes (TM-7 (5) drift poll): moves on every write or
   * status flip that emits `price_lists.catalogue_prices_changed`. Opaque string; compare for equality.
   */
  changeWatermark(): Promise<string>;
  /** Regular, everyone books of the currency in any status (draft / scheduled allowed). */
  designatableBooks(currencyCode: string): Promise<ReadonlyArray<{ priceListId: string; name: string; salesChannelIds: string[] }>>;
}
```

Owner: `price_lists` is non-deactivatable, so the gate never refuses in practice; the JSDoc still
states the fail-closed sentence. Identity test: research R-4.

## 4. Product rule definition — `ProductRuleDefinitionSchema`

```ts
type RuleCondition =
  | { kind: 'attribute_boolean'; attributeKey: string; value: boolean }
  | { kind: 'attribute_choice'; attributeKey: string; optionKeys: [string, ...string[]] }   // value ∈ optionKeys
  | { kind: 'catalogue_price'; currencyCode: string; threshold: 'gt_zero' | 'gte_zero' };

type RuleGroup = { kind: 'group'; match: 'all' | 'any'; conditions: [RuleCondition, ...RuleCondition[]] };

type ProductRuleDefinition = { match: 'all' | 'any'; conditions: [RuleCondition | RuleGroup, ...(RuleCondition | RuleGroup)[]] };
```

Max 20 conditions in total; groups nest one level. Save validates every `attributeKey` is a
boolean or choice attribute that is neither language- nor channel-scoped (FR-050) and every option
key exists. A missing value ⇒ not met (FR-057).

## 5. Kernel membership governor — owner platform (`packages/platform/src/kernel/sales-channels/`)

Published on `@endora-commerce/platform/kernel` (additive; changeset).

```ts
interface ChannelMembershipGovernor {
  readonly moduleId: string;
  readonly entityTypes: readonly ChannelMemberEntityType[];   // ['product']
  /** Runs on the mutation's own EntityManager (same transaction). null = not governed. */
  governs(em: EntityManager, channelId: string): Promise<{ ruleLabel: string } | null>;
}

/**
 * What the container holds as `salesChannelMembershipGovernors`: the registry's
 * `registrationPort()`, a frozen `{ register }` and nothing else. `seal`, `tokenModule` and
 * `governing` stay on the registry, held only by the composition and the membership service.
 */
interface ChannelMembershipGovernorRegistryPort {
  /** Boot-time contribution; returns this governor's write token. Filtered by the module's presence. */
  register(governor: ChannelMembershipGovernor): GovernorWriteToken;
}

// added to MembershipMutationOptions (all optional):
onGoverned?: 'skip' | 'refuse';           // default 'skip'
governorToken?: GovernorWriteToken;       // only the governing module's own writes
source?: string;                          // recorded in the membership audit row, e.g. 'website_rule:<id>'

// added to MembershipMutationResult:
skippedGovernedChannelIds?: string[];
```

Semantics per method — R-10. Refusal: `409 CHANNEL_MEMBERSHIP_GOVERNED`, `details: [{ path:
'channelId', issue: <channelId> }]`, message naming the rule label, translated through the
platform's error-message catalogue (FR-054, FR-074).

Consumer changes: `sales_channels/backend/routes.admin.ts` (channel-side PUT/DELETE pass
`onGoverned: 'refuse'`), `catalog-bulk-update.service.ts` (`'refuse'`, plus an enqueue-time
refusal). No other caller changes.

### Governor hardening (TM-10)

- `GovernorWriteToken` is an opaque object issued by `register` and checked **by identity**
  (module-private `WeakSet` in the registry); the type is not constructible from the `./kernel`
  barrel; it is never placed in the DI container (the module keeps it in a closure).
- `register` is accepted only during boot, once per module id; the registry is frozen afterwards.
- `governs()` throwing ⇒ the mutation is refused (fail closed), never treated as "not governed".
- `source` is honoured only together with a valid token; otherwise it is ignored, so rule
  attribution (FR-072) cannot be forged.
- The rule label in `CHANNEL_MEMBERSHIP_GOVERNED` is user-authored text: rendered as text only.
- A test enumerates every writer of the channel-product bridge table in `packages/**` and fails on
  any file other than the membership service.
