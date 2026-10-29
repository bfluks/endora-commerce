# Contract: HTTP surfaces, permission, palette, cache

The Zod schemas live in `packages/contracts/src/cms-brand.ts`, `cms.ts`, `blog.ts` and
`settings.ts`. All JSON fields are camelCase and all paths are kebab-case (Principle VI). Every
change to an existing schema is additive on the wire, except the removed block names, which are
not wire shapes.

---

## 1. Brand tokens (module `cms`)

### `GET /api/v1/admin/cms/brand-tokens`

- **Gate**: `requireAdmin('cms.read')`.
- **Query**: `salesChannelId?` (uuid).

```ts
200 { data: {
  global: { tokens: BrandTokens | null; version: number };
  channel?: { salesChannelId; tokens: BrandTokens | null; version: number };   // when the query names one
  effective: BrandTokens;                    // channel ?? global ?? DEFAULT_BRAND_TOKENS
  warnings: ContrastFinding[];               // assessBrandContrast(effective)
} }
```

### `PUT /api/v1/admin/cms/brand-tokens`

- **Gate**: `requireAdmin('cms.brand')`.
- **Body**: `{ scope: { kind: 'all' } | { kind: 'channel'; salesChannelId }, tokens: BrandTokens | null, expectedVersion: number }`.
  - `tokens: null` with the channel scope removes the override.
  - `null` with the `all` scope resets to the built-in defaults.
- **Command**: `cms.brand_tokens.update`. It upserts or deletes the scope's `cms_brand_tokens`
  row in its own transaction and records exactly one audit entry. The entry's object is
  `{type: 'cms_brand_tokens', id: 'global' | salesChannelId}`, with before and after captured.
- **After commit**: `storefrontRevalidator.revalidate(['cms:brand'])`. A failure is logged, not
  thrown, as with the existing CMS revalidation.
- **Responses**:
  - `200 { data: { version; warnings: ContrastFinding[] } }`
  - `409 VERSION_CONFLICT` (existing)
  - `400 VALIDATION_ERROR`
  - `404` for an unknown channel

### `GET /api/v1/storefront/cms/brand-tokens`

- **Access**: public.
- **Channel**: resolved by `getResolvedChannel(request)`. It always resolves, falling back to the
  system default.
- **Response**: `200 { data: BrandTokens }`, the effective set.
- **Headers**: `cache-control: public, max-age=60`.
- **Off state**: while `cms` is off, the route does not answer, like every `cms` route. The
  storefront then renders without `<style id="cmsb">`, so the fallbacks apply.

### Page-builder descriptor

`GET /api/v1/admin/cms/page-builder/config?salesChannelId=` gains
`brandTokens: BrandTokens`, the effective set for that channel or the global set.

---

## 2. CMS pages (module `cms`)

- **Admin detail, create and patch schemas** gain `parentPageId: uuid | null`,
  `breadcrumbsVisible: boolean`, `breadcrumbsScheme: 'light' | 'muted' | 'dark'` and
  `shareImageAssetId: uuid | null`. All are optional on create and patch.
- **Parent refusal**: `PATCH` with a cyclic or too-deep parent answers
  `422 CMS_PAGE_PARENT_CYCLE`.
- **Admin page list** gains `parentPageId`, so the parent picker can exclude descendants on the
  client. The server is authoritative.
- **Content writes**: `PUT …/pages/:id/content/:language` (and the block and template
  equivalents) may answer `422 CMS_DUPLICATE_ANCHOR {anchor}` or
  `422 CMS_RESERVED_ANCHOR {anchor}`.
- **Storefront by-slug** (`cmsResolvedPageSchema`) gains `breadcrumbs`, `share` and `languages`
  ([../data-model.md](../data-model.md) §5).

---

## 3. Blog (module `blog`)

### `GET /api/v1/blog/posts`

- **Access**: public.
- **Query**: `limit` (1–24, default 6) and `categorySlug?`.
- **Channel and language**: as `/by-channel`.
- **Response**: `200 { data: BlogPostCard[] }`. Cards are ordered by `publishedAt desc`, published
  and active in the resolved channel only.
- **Unknown category**: an empty list, not a 404, so a stale block setting renders nothing.
- **Channel scoping**: cross-channel tests are required (Principle XII). An out-of-channel post
  never appears, and an unresolved channel falls back to the system default, never to all
  channels.

### Admin post schemas

They gain `mainImageAssetId: uuid | null`. `BlogPostCard.mainImageUrl` is now populated.

---

## 4. Newsletter signup handler (storefront app, not an API route)

### `POST /newsletter/subscribe`

`storefront/app/newsletter/subscribe/route.ts` accepts `application/x-www-form-urlencoded` or
`multipart/form-data`.

| Field | Rule |
| --- | --- |
| `email` | required, `emailSchema` |
| `consent` | must be `on`; otherwise `error=consent` |
| `topics` | 0..n tag codes, each `^[a-z0-9_-]{1,64}$` |
| `returnTo` | a same-origin path only, otherwise `/` |
| `anchor` | anchor pattern; otherwise omitted |

- **Backend call**: the existing `subscribeNewsletter({email, channelCode, tags: topics, source:
  'cms-block'})`.
- **Without JavaScript**: `303` to `returnTo?newsletter=pending|active|error&reason=…#anchor`.
- **With JavaScript**, signalled by `Accept: application/json`: the answer is
  `{status: 'pending' | 'active'}` or `{error: 'consent' | 'email' | 'topics' | 'unavailable'}`, with status
  200 or 400.
- **Newsletter off**: the handler answers `404`, and the block is already absent.

---

## 5. Settings and shop info (module `settings`)

- `ShopInfoSchema` gains `logoUrl: string | null` and `socialProfiles: string[]`.
- `GET /api/v1/storefront/shop-info` returns them.
- New settings:
  - `shop.logo_asset_id` and `shop.social_profiles` (owner `settings`);
  - `cms.default_share_image_asset_id` (owner `cms`).

---

## 6. Permission, command palette, navigation, cache

| Item | Value |
| --- | --- |
| Permission | `cms.brand`. Label key `adminRoles.permission.cms.brand` in `cms/i18n/{en,pl}.json`, `requires: ['cms.read']` |
| Admin route | `/cms/brand` (a `cms` admin contribution), `requiredPermission: 'cms.read'`; saving needs `cms.brand` |
| Nav entry | under the CMS group, "Brand" |
| Palette action | `open-cms-brand` → `/cms/brand`, `requiredPermission: 'cms.read'`, keywords `brand, fonts, colours, colors, typography, theme` |
| Cache namespace | `cms-brand` in `CACHE_NAMESPACES`, `storefrontTags: ['cms:brand']` |
| Storefront fetch | `storefront/lib/api/brand.ts` `getBrandTokens()` with `{revalidate: 300, tags: ['cms:brand']}`, fetched in `getServerContext()` |

`check:action-route-permissions` must pass: the palette action's permission equals the route's
gate.
