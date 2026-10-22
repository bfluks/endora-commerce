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
PUT) beside `locale`; `locale` becomes optional when `channelId` is given. A row is addressed by
(entity, `channelId?`, `locale?`): `locale` only = L row, `channelId` only = C row, both = C×L row; a
request naming **neither** keeps today's meaning (`locale = 'en-US'`), so no existing caller changes.
`entityType` other than `product` refuses `channelId` (`422 VALIDATION_FAILED`) — the feature scopes
product SEO only. `channelId` of a channel the product is not a member of, or a `locale` the channel does
not offer, → `422 SCOPE_INVALID` (FR-014), except on DELETE (removing an orphan is always allowed, FR-015).

**Writes are Commands (analyze C1, Constitution XIII, FR-080).** PUT runs `seo_meta_override.upsert`, DELETE
runs `seo_meta_override.delete` (`seo/src/backend/commands/seo-meta-override.commands.ts`), each through
`CommandBus.run`: one audit entry per request, `before` = the full row projection (`entityType`,
`entityId`, `channelId`, `locale`, `title`, `description`, `ogTitle`, `ogDescription`, `ogImageUrl`) or
`null` on create, `after` likewise or `null` on delete. The hand-written `recordAuditFromContext` path in
`meta-tag-resolver.service.ts` is removed in the same change. Restoring = re-sending `before` (R29). DELETE of
an absent row answers `204` with no audit entry (`skipAudit`).

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
