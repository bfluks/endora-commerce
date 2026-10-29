---
'@endora-commerce/platform': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-search': minor
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-settings': patch
'@endora-commerce/demo-composition': patch
'@endora-commerce/cli': patch
---

The sales channel's `isPublic` flag is retired in favour of the pricing display-mode chain
(issue #492; closes #467). The flag was documented as anonymous-price visibility, but every read of
it withheld prices from **everyone** on the channel, signed-in buyers included, beside a chain that
already says "prices after sign-in" per channel: `pricing.unauthenticated_display_mode = none`.

**Behaviour change.** Signed-in buyers on a channel that had `isPublic = false` now see prices
according to the display-mode chain (their organization's override, else the channel's
`pricing.default_display_mode`), where they used to see none — on the catalogue listing, the product
page, product links, search, comparisons, and the price sort and range, which are no longer refused
to them. Anonymous visitors on such a channel still see no prices: the migration below carries that
half of the flag over. A channel that had `isPublic = false` **and** its own value for
`pricing.unauthenticated_display_mode` keeps that value, so its anonymous visitors now see prices if
that value is a priced mode. A new channel, the boot-time default channel included, no longer starts
with prices hidden from everyone; it follows the chain like any other.

The display-mode chain itself is unchanged (owner ruling of 2026-10-28): a product or category
override takes precedence over the channel's `pricing.unauthenticated_display_mode`, also for
anonymous visitors, so a product overridden to `gross_only` shows its price to guests on a channel
whose guest mode is `none`. An organization override still applies to signed-in buyers only.

- **`@endora-commerce/platform`.** New migration `Migration20261028T173317CoreSalesChannelsRetireIsPublic`
  (core): every channel with `is_public = false` and no value of its own for
  `pricing.unauthenticated_display_mode` gets `"none"` as its per-channel value, then
  `sales_channels.is_public` is dropped. It refuses — rather than migrating into showing prices — a
  database that has a non-public channel but no registered `pricing.unauthenticated_display_mode`
  setting; start the platform once on the previous release, so the settings reconciler registers
  it, and migrate again. Because the column is dropped, stop processes running the previous release
  before migrating. `SalesChannel.isPublic` and `CachedChannel.isPublic` are removed;
  `SALES_CHANNELS_CACHE_KEY_PREFIX` moves from `sales-channels:v3:` to `sales-channels:v4:`, so no
  process reads an entry cached in the other shape. The default-channel reconciler no longer sets
  the flag.
- **`@endora-commerce/contracts`.** `ResolvedSearchChannel.isPublic` is removed — drop it from the
  context you hand `SearchQueryPort`. No public HTTP shape carried the flag, so no response changes
  shape. The `SALES_CHANNEL_AUDIT_ACTIONS` documentation now says who writes each row: the identity
  Commands (with `stateBefore` / `stateAfter` snapshots) since #484.
- **`@endora-commerce/mod-catalog`.** `CatalogResolvedChannel.isPublic` and the `isPublic` field of
  `ProductLinkService`'s storefront context are removed. The catalogue no longer skips pricing on
  a channel: prices follow the viewer's display mode (a viewer whose mode is `none` gets the
  withheld answer, `resolvedPrice.displayMode: 'none'`, where the channel used to answer
  `resolvedPrice: null`). The price controls are refused only where the page's display mode is
  `none`; the reason "This sales channel does not publish prices…" is gone.
- **`@endora-commerce/mod-search`.** The service's `ResolvedSearchChannel.isPublic` is removed, and
  hits are always resolved for the viewer.
- **`@endora-commerce/mod-comparisons`.** A comparison is priced for the viewer on every channel.
- **`@endora-commerce/mod-sales-channels`.** The channel form's *Open to anonymous visitors* hint
  gains a second line pointing to the guest display mode, with a link to *Pricing settings*
  (`identity.anonymousAccess.pricesHint`, `identity.anonymousAccess.pricesLink`, English and
  Polish). New channels are no longer written with the flag.
- **`@endora-commerce/mod-price-lists`, `@endora-commerce/mod-i18n`.** *Pricing settings* states,
  under the two default modes, that a channel's own value wins over them and that a product or
  category override takes precedence over both, for anonymous visitors too
  (`priceLists.displayModes.settings.precedenceHint`).
- **`@endora-commerce/demo-composition`.** The `pl_b2b_vip` channel is created without the flag and
  a new step, *the VIP channel hides prices until sign-in*, sets its
  `pricing.unauthenticated_display_mode` to `none`; its signed-in buyers see prices. `pl_retail`
  publishes prices to everyone, as before.
- **`@endora-commerce/mod-settings`, `@endora-commerce/cli`.** Comments only: the cache-clear
  namespace names the new key prefix, and the channel-resolution rule no longer cites the flag.
