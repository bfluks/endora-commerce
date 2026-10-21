# Contract: SEO per channel × language, media, attachments, packaging units, order rules

Research: R13–R16, R26. Data model §6–§8.

## 1. SEO (owner `seo`)

**Port `seoProductMetaPort`** (`packages/contracts/src/seo.ts`, `ctx.di.providePort` in `seo`):

```ts
export interface SeoProductMetaPort {
  resolveForProduct(input: {
    productId: string; channelId: string; languageCode: string;
    fallback: { title: string; description: string; ogTitle: string; ogDescription: string; ogImageUrl: string | null };
  }): Promise<{ title: string; description: string; ogTitle: string; ogDescription: string; ogImageUrl: string | null;
                sources: Record<'title' | 'description' | 'ogTitle' | 'ogDescription' | 'ogImageUrl', 'channel_language' | 'channel' | 'language' | 'derived'> }>;
  listScopesForProduct(productId: string): Promise<Array<{ channelId: string | null; locale: string | null; fields: string[] }>>; // for the overview
}
```

Catalog declares it in `nonBindingDependencies` as `degrades-without` (R12 text) and probes
`effectiveState.isPresent('seo')` before resolving it; the same probe gates redirect serving.

**Admin** (existing routes, `seo`'s permission codes unchanged): `GET|PUT|DELETE
/api/v1/admin/seo/meta/:entityType/:entityId` gain optional `channelId` (query for GET/DELETE, body for
PUT) beside `locale`; `locale` becomes optional when `channelId` is given. `entityType` other than
`product` refuses `channelId` (`422 VALIDATION_FAILED`) — the feature scopes product SEO only.

## 2. Gallery (catalog)

- `PATCH /api/v1/admin/catalog/products/:productId/gallery/:itemId` (existing, `catalog:write`) gains
  `altText: Record<lang, string>` (per-language product alt; empty string removes a language),
  `hiddenInChannels: uuid[]` (replace set).
- `PUT /api/v1/admin/catalog/products/:productId/gallery/channel-roles` (`catalog:write`):
  `{ channelId, roles: { base_image?: itemId | null, small_image?: itemId | null, thumbnail?: itemId | null } }`
  — `null` = use inherited for that role. Role uniqueness per channel by PK (FR-076).
- Product detail (`ProductDetail`), listing card image and OG image read the effective gallery in C and
  alt at L. Command `product.media.update`, `changedFields: ['media']`.

## 3. Attachments (catalog)

- Attachment create/update (existing routes) accept `nameTranslations`, `descriptionTranslations`
  (`Record<lang, string>`) and `hiddenInChannels: uuid[]`.
- PDP: attachments hidden in C are omitted; name/description at L with fallback to the global value.

## 4. Packaging units (catalog)

- Packaging unit create/update accept `nameTranslations` (`.strict()` admin schemas stay strict — the key
  is added to them).
- Storefront DTO `packagingUnits[].name` is the effective name at L; basket/RFQ snapshots take it (N2).

## 5. Order rules per channel (catalog, US10)

Written through `PATCH …/scopes` (`admin-scopes-api.md` §2: `minOrderQuantity`, `returnable` per channel).
Read through `catalogProductAvailabilityPort.effectiveOrderRules(ids, channelId)`. Storefront product DTO's
`minOrderQuantity` (feature 155) becomes channel-effective. Returns read the order line's
`returnableAtPurchase`, which placement now stamps with the channel-effective value — no `returns` change.
