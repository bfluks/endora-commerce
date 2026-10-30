---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-settings': minor
---

The shop's identity gains a logo and social profiles, for the storefront's `Organization` structured data.

- `@endora-commerce/mod-settings` registers `shop.logo_asset_id` (an asset id, `''` while unset) and `shop.social_profiles` (a list of URLs, `[]` by default). Social profile URLs must be `https:`; anything else is refused with `422 VALIDATION_FAILED` and nothing is stored. The shop-info read resolves the logo to its public URL (a missing or non-public asset reads as `null`) and returns only `https:` profiles. No existing default changes.
- **`@endora-commerce/mod-settings` now declares a dependency on `assets_library`** to resolve the logo. Both modules are non-deactivatable, so no installation changes, but a deployment that composes `settings` without `assets_library` now fails the module dependency check.
- `@endora-commerce/contracts`: `ShopInfoSchema` gains `logoUrl` (`string | null`) and `socialProfiles` (`string[]`), both required in the response.
