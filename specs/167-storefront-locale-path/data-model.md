# Data model — Storefront language in the URL path (feature 167)

No new table. One new column, one cache-shape bump, one derived value object, no new cache.

## 1. Migration

Scaffold with `pnpm --filter backend run migration:new -- --module core --name sales-channels-prefix-default-language`
(`specs/conventions/module-migrations.md`). **Owner: `core` (the platform)**, not the
`sales_channels` module: the `sales_channels` table and the `SalesChannel` entity moved into the
kernel in feature 072 T019 (`packages/modules/sales_channels/src/manifest.ts` comment;
`packages/platform/src/kernel/sales-channels/sales-channel.entity.ts`). The precedent is 154's
`anonymous_access` (`packages/platform/src/migrations/20261018T101912_core_sales_channels_anonymous_access.ts`).
No migration number is assigned here; the scaffold timestamps it.

| Id | Owner | Slug | Kind | Statement | Depends on |
| --- | --- | --- | --- | --- | --- |
| M1 | `core` | `sales-channels-prefix-default-language` | DDL + DML | (1) `alter table "sales_channels" add column if not exists "prefix_default_language" boolean not null default true;` — catalogue-only, no row rewrite. (2) `update "sales_channels" set "prefix_default_language" = false;` — every channel that exists at upgrade keeps its unprefixed URLs (owner ruling OR-10); rows inserted later take the default `true` (OR-1). `down()`: drop the column. | — (references only the kernel's own table) |

The two statements are one migration so no process can observe the column with existing rows on.
On a fresh database the `update` touches nothing: no migration inserts a channel, the boot-time
default-channel reconciler does, after migrations, with `true`.

Registration: `pnpm --filter backend run composer:generate`, commit the regenerated registries
(AGENTS.md trap: an unregistered migration silently does not run).

## 2. `SalesChannel` (kernel entity) — one field

| Field | Column | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| `prefixDefaultLanguage` (new) | `prefix_default_language` | boolean, not null | `true` (existing rows backfilled `false` by M1, OR-10) | OR-1. Added to `OptionalProps`. Set explicitly to `true` by `identity.command.ts` on create when the body omits it, so the intent is in code and not only in the column default (154's pattern). |

The default-channel reconciler (`default-channel-reconciler.ts`) creates the system default with
`prefixDefaultLanguage: true`.

## 3. `CachedChannel` — cache shape v5

`packages/platform/src/kernel/sales-channels/sales-channels-cache.ts`:

- add `prefixDefaultLanguage: boolean` to `CachedChannel` and `toCachedChannel`;
- bump `SALES_CHANNELS_CACHE_KEY_PREFIX` to `sales-channels:v5:` with a `v5 (feature 167)` line in
  the version log, so a process still running v4 code never reads an entry without the flag.

Invalidation is unchanged: the identity write awaits `SalesChannelsCacheInvalidation` before it
emits (D-93), dropping Redis first, then the LRU, then announcing on the lifecycle pub/sub channel.
Downstream, the storefront's per-process channel identity cache (`lib/channel/channel-identity.ts`,
fresh for one minute) is the documented window in which a flipped setting reaches the middleware.

## 4. `ChannelUrlLanguage` — derived, never stored

Computed by `channelUrlLanguages()` in `packages/contracts/src/storefront-language-path.ts`
(`contracts/contracts-package.md` §1) from `languages`, `defaultLanguage`,
`prefixDefaultLanguage`.

| Field | Type | Rule |
| --- | --- | --- |
| `languageCode` | string | A channel language, as stored (`pl-PL`). Channel order; the default language included even if absent from `languages` (`toScopeChannel` rule). |
| `prefix` | string | `primarySubtag(code).toLowerCase()` when exactly one channel language has that primary subtag; else `code.toLowerCase()`. Grammar `^[a-z]{2,3}(-[a-z0-9]{1,8})*$`. |
| `prefixed` | boolean | `false` only for the default language when `prefixDefaultLanguage` is `false`. |
| `isDefault` | boolean | `languageCode === defaultLanguage`. |

Plus `splitAliases: Array<{ alias: string; languageCodes: string[] }>` — a primary subtag shared
by several channel languages, answered 307 to one of them (FR-015).

**Invariants** (unit-tested): prefixes unique within the channel; every prefix matches the grammar;
exactly one `isDefault`; the function is total over any input the channel validator accepts and
throws on a case-insensitive duplicate code (which that validator already prevents).

**Examples**

| `languages` | default | flag | Result |
| --- | --- | --- | --- |
| `pl-PL, en-US` | `pl-PL` | on | `pl-PL → /pl`, `en-US → /en` |
| `pl-PL, en-US` | `pl-PL` | off | `pl-PL → (none)`, `en-US → /en` |
| `pl-PL, en-US, en-GB` | `pl-PL` | on | `pl-PL → /pl`, `en-US → /en-us`, `en-GB → /en-gb`; alias `en → [en-US, en-GB]` |
| `de-DE` | `de-DE` | off | `de-DE → (none)`; `/de/…` answers 308 |

## 5. Shapes that change (`packages/contracts`, detail in `contracts/contracts-package.md`)

| Schema | Change |
| --- | --- |
| `SalesChannelSummarySchema`, `SalesChannelDetailSchema` | `prefixDefaultLanguage: z.boolean()` |
| `SalesChannelCreateBodySchema` | `prefixDefaultLanguage: z.boolean().optional().default(true)` |
| `SalesChannelUpdateBodySchema` | `prefixDefaultLanguage: z.boolean().optional()` |
| `PublicSalesChannelSchema` | `prefixDefaultLanguage: z.boolean()`, `urlLanguages: z.array(channelUrlLanguageSchema)`, `urlLanguageAliases: z.array(…)` |
| `productKeyResolutionSchema` (`redirect`) | `permanent: z.boolean()` |
| `productPagePathsSchema` | `xDefault: z.string()` |
| `ProductPathInput` / `productPath()` | `channelDefaultLanguage` replaced by `channel: ChannelUrlFacts` |

## 6. Audit

The flag is part of the channel identity Command's before/after state (`identity.command.ts`
snapshot gains `prefixDefaultLanguage`), so one audit entry records a change. Not reversible beyond
what the identity Command already offers.

## 7. What is not stored

No per-language prefix column, no per-page language, no cookie state, no redirect table: every
answer is derived from the channel row and, for products, 163's existing key and redirect rows.
