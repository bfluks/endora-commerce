# Contract: the scope rule, the availability port and the scope language

All shapes land in `packages/contracts/src/product-scopes.ts` (new file, exported from the barrel)
**before** any service code (Principle II). Additive only. Research: R3–R7, R19.

## 1. Constants and types

Since the owner's Q1 decision (spec Session 2026-10-25) the value set is `active` | `inactive` at every
scope, and `productStatusSchema` (`packages/contracts/src/catalog.ts`) narrows to the same set — a breaking
change shipped as a changeset marked BREAKING at bump level `minor` (spec *Compatibility and release*; D-225
refuses `major` while a package is in `0.x` — research R30.6). The legacy `archived` write alias
(`coerceProductStatusWrite`, `productStatusWriteSchema`'s preprocess) is removed too: `archived` is refused
like `draft` (owner O-1, 2026-10-25). `inactive` is plain off everywhere;
`archivedAt` is set only by the Archive Command (FR-019) and is independent of `status`.

```ts
export const PRODUCT_SCOPE_STATUSES = ['active', 'inactive'] as const; // R3 — the only list of values; `draft` removed (spec Session 2026-10-25, FR-112)
export type ProductScopeStatus = (typeof PRODUCT_SCOPE_STATUSES)[number];
export const productScopeStatusSchema = z.enum(PRODUCT_SCOPE_STATUSES);

export interface PublicationWindow { from: Date | null; until: Date | null }          // inclusive both ends
export interface AudienceRule { visibility: ProductVisibility; allowedOrganizationIds: string[] }

export interface ProductChannelScopeRecord {
  productId: string; channelId: string;
  status: ProductScopeStatus | null;                 // null = inherit
  window: PublicationWindow | null;                  // null = inherit (flag false)
  audience: AudienceRule | null;                     // null = inherit (whole rule, C4)
  minOrderQuantity: number | null;                   // null = inherit; 1 = none here
  returnable: boolean | null;                        // null = inherit
}
export interface ProductChannelLanguageScopeRecord {
  productId: string; channelId: string; languageCode: string; status: ProductScopeStatus;
}
export interface ProductGlobalScopeFields {
  status: ProductScopeStatus; deletedAt: Date | null; archivedAt: Date | null;
  window: PublicationWindow; visibility: ProductVisibility; allowedOrganizationIds: string[];
  minOrderQuantity: number | null; returnable: boolean;
}
export interface ScopeChannel { id: string; languages: readonly string[]; defaultLanguage: string }
```

## 2. Pure rule (one definition, FR-002)

```ts
export function effectiveStatus(g, channelRow | undefined, clRow | undefined): ProductScopeStatus;
export function isOn(status: ProductScopeStatus): boolean;           // status === 'active' — the only test of a value
export function effectiveWindow(g, channelRow | undefined): PublicationWindow;
export function isInsideWindow(w: PublicationWindow, now: Date): boolean; // from ≤ now ≤ until, null = open
export function effectiveAudience(g, channelRow | undefined): AudienceRule;
export function isProductEffectivelyAvailable(input: {
  global: ProductGlobalScopeFields;
  channelRow?: ProductChannelScopeRecord; clRow?: ProductChannelLanguageScopeRecord;
  isMember: boolean; channel: ScopeChannel; languageCode: string;
  audience: ProductAudience; now: Date;
}): boolean;                        // FR-001; isProductVisibleTo(effectiveAudience(...), audience) inside
export function effectiveOrderRules(g, channelRow | undefined): { minOrderQuantity: number | null; returnable: boolean };
export function pairsTurningOn(before: ScopeSnapshot, after: ScopeSnapshot, channels: ScopeChannel[]):
  Array<{ channelId: string; languageCode: string }>;   // R18; members only, channel languages only
  // M3 → A (2026-10-22): a pair is returned only when isOn(effectiveStatus(...)) goes false → true.
  // Window and audience are NOT inputs to the comparison, and one `channels` list (membership and channel
  // languages after the write) serves both snapshots, so a membership or channel-language change cannot
  // produce a pair on its own — the gate fires on status writes only. A bulk run that sets `status` and
  // adds channels in one go gates the pairs its status change turns on, new channels included.
export function resolveScopeLanguage(channel: ScopeChannel, requestedTag: string | null | undefined): string; // R7
```

Unit tests (`packages/contracts/src/product-scopes.test.ts`): every row of `data-model.md` §4; `inactive`
at C or C×L is off and nothing else (FR-010); the window's inclusive edges at the millisecond (K4); an
overridden open window beats a bounded global one; the audience override replaces the list (US3 #3);
`resolveScopeLanguage` exact / base / default / unknown-tag cases; `pairsTurningOn` for a global switch,
a channel row covering every language, a C×L row, and non-member channels ignored; **and the M3 non-trigger
cases** — snapshots that differ only in window (incl. one that opens the window now) or only in audience
return `[]`.

## 3. Port — `catalogProductAvailabilityPort` (owner `catalog`, `ctx.di.providePort`)

```ts
export interface ProductAvailabilityScope {
  channelId: string;
  languageCode: string;            // already resolved by resolveScopeLanguage (or channel default for an operator)
  audience: ProductAudience;
  now?: Date;                      // default: new Date() at the call
}
export interface ChannelAvailability {
  liveLanguages: string[];         // channel languages where effective status is on (member, not archived/deleted)
  window: PublicationWindow;       // effective
  audience: AudienceRule;          // effective
}
export interface CatalogProductAvailabilityPort {
  /** FR-001 for each id; ids not returned are unavailable for any reason — callers answer one not-found. */
  filterAvailable(productIds: readonly string[], scope: ProductAvailabilityScope): Promise<Set<string>>;
  /** Projection for whole-channel consumers (search documents, sitemap, feeds). Non-members are absent. */
  describeChannelAvailability(productIds: readonly string[], channelId: string): Promise<Map<string, ChannelAvailability>>;
  /** FR-017 — effective Name per id at (channel, language), #384's walk; snapshots and outcome messages. */
  effectiveNames(productIds: readonly string[], scope: { channelId: string; languageCode: string }): Promise<Map<string, string>>;
  /** FR-100 — effective MOQ and returnable in the channel. */
  effectiveOrderRules(productIds: readonly string[], channelId: string): Promise<Map<string, { minOrderQuantity: number | null; returnable: boolean }>>;
}
```

- **Owner off**: `catalog` is `nonDeactivatable`; the gate cannot fire. Consumers declare the edge in
  `dependencies` (each already lists `catalog`).
- **Never** answers for an unresolved channel (FR-007): a caller with no channel does not call it; the
  exempt seams (R6) keep their documented exemption.
- `filterAvailable` is one statement: the SQL of §4 with `id in (…)`.
- `effectiveNames` and `effectiveOrderRules` apply **no availability**: they answer for every id given.
  A buyer-facing caller filters with `filterAvailable` first (checkpoint C security review, I8). The
  same holds for `catalogProductUrlKeyReadPort.effectiveKeys`, which narrows by membership only.

## 4. SQL restatement (catalog-internal) — `product-availability.sql.ts`

```ts
export function availabilityCondition(scope: Required<ProductAvailabilityScope>, membership: SalesChannelMembershipPort): ListingCondition;
// returns { sql: (alias) => string, params } — a description; the caller creates raw() in the executing
// expression (catalog-query.service.ts' own rule for #listingNarrowing).
```

Shape (aliases `c` = `product_channel_scopes`, `cl` = `product_channel_language_scopes`, joined by
keyed sub-select on (product, channel[, language])):

```sql
{alias}.deleted_at is null and {alias}.archived_at is null
and {alias}.id in (<kernel membership subquery for C>)
and ? = any(<C.languages>)                                     -- bound from the resolved channel record
and coalesce(cl.status, c.status, {alias}.status) = 'active'
and (case when c.window_overridden then c.publish_from else {alias}.publish_from end) is null
     or (case …from…) <= ?::timestamptz
and (case when c.window_overridden then c.publish_until else {alias}.publish_until end) is null
     or ?::timestamptz <= (case …until…)
and <#audienceCondition over (case when c.visibility is not null then c.visibility else {alias}.visibility end,
                              case when c.visibility is not null then c.allowed_organization_ids else {alias}.allowed_organization_ids end)>
```

Parity: `backend/test/integration/catalog/availability-parity.test.ts` [PG] generates the grid of R5 and
asserts the SQL-selected id set equals `isProductEffectivelyAvailable` over the same rows.

## 5. Read-port additions (`CatalogProductReadPort`, additive)

`CatalogProductRecord` gains optional `publishFrom?: Date | null`, `publishUntil?: Date | null` (global; optional permanently so consumer fixtures that build record literals keep compiling). No other
record field changes meaning; channel-effective MOQ/returnable come from `effectiveOrderRules` (FR-100), so
feature 155's record fields keep meaning "global".
