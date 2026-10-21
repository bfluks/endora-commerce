# Contract: URL keys and redirects

Shapes in `packages/contracts/src/product-url-keys.ts` (new file — kept apart from `product-scopes.ts` so
the URL-key stream edits its own file). Research: R11, R12, R17; data model §5.

## 1. Admin — read — `GET /api/v1/admin/catalog/products/:id/url-keys` (`catalog:read`)

```ts
productUrlKeysResponseSchema = z.object({ data: z.object({
  globalKey: z.string(),                                                     // products.slug
  languageKeys: z.array(z.object({ languageCode, key })),
  channelKeys: z.array(z.object({ channelId, languageCode, key, orphaned: z.boolean() })),
  effective: z.array(z.object({ channelId, languageCode, key, source: z.enum(['channel_language', 'language', 'global']), url: z.string() })),
  redirects: z.array(z.object({ id: uuid, languageCode: z.string().nullable(), key, createdAt: iso })),
})})
```

`url` is the storefront path as emitted (R12): `/p/<key>` plus `?lang=<L>` when L ≠ channel default.

## 2. Admin — write — `PUT /api/v1/admin/catalog/products/:id/url-keys` (`catalog:write`)

```ts
putProductUrlKeysRequestSchema = z.object({
  globalKey: productSlugSchema.optional(),
  languageKeys: z.array(z.object({ languageCode, key: productSlugSchema.nullable() })).optional(),           // null = use inherited
  channelKeys: z.array(z.object({ channelId: uuid, languageCode, key: productSlugSchema.nullable() })).optional(),
  confirmTakeover: z.array(z.object({ languageCode: z.string().nullable(), key: productSlugSchema })).optional(),
})
```

One Command `product.url_keys.update`, one audit entry (before/after keys and every redirect inserted or
deleted, including another product's redirect taken over — FR-080). Undo restores keys and redirects,
reporting a conflict when a restored key has since been taken.

Refusals (nothing saved):
- `409 URL_KEY_TAKEN` `details: { conflicts: [{ languageCode: string | null, key, heldByProductId, heldByProductName }] }`.
- `409 URL_KEY_REDIRECT_TAKEOVER_REQUIRED` `details: { takeovers: [{ languageCode, key, losingProductId, losingProductName }] }`
  — the admin asks the operator, then retries with `confirmTakeover` (FR-072, US7 #5).
- `422 SCOPE_INVALID` for a channel the product is not a member of or a language the channel does not offer
  (FR-014) — removing an orphaned key (`key: null`) is always allowed.

Emits `product.updated.v1` `changedFields: ['urlKeys']`.

## 3. Admin — delete a redirect — `DELETE /api/v1/admin/catalog/products/:id/url-redirects/:redirectId` (`catalog:write`)

Command `product.url_redirect.delete`, audited, undoable (refuses undo when the key has since been used).
`204`; `404 URL_REDIRECT_NOT_FOUND` when the row is not the product's.

## 4. Public — resolve — `GET /api/v1/catalog/products/resolve/:key` (storefront, channel resolved by middleware)

Language: `resolveScopeLanguage(channel, first Accept-Language tag)`.

```ts
productKeyResolutionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('product'), productId: uuid, key: z.string() }),          // key is the effective key at (C, L)
  z.object({ kind: z.literal('redirect'), key: z.string(), languageCode: z.string() }), // 200; storefront permanentRedirect('/p/'+key(+?lang))
])
```

- `404 PRODUCT_NOT_FOUND` — no product holds the key in L (incl. a key of another language, K1), the
  product it resolves to is not effectively available at (C, L, buyer, now), or the key is a redirect and
  `seo` is not effectively present (FR-111).
- `410 PRODUCT_ARCHIVED` — the key (current or redirect) resolves to an archived product (edge case).
- The existing `GET /api/v1/catalog/products/:idOrSlug` keeps answering ids and **current** keys at
  (C, L) (so existing callers keep working) and never answers a redirect; the storefront PDP switches to
  `resolve` then reads by id.

## 5. Connectors and import — `catalogProductScopeWritePort.applyScopes(…).urlKeys`

Per key: `{ written: true } | { written: false, issue: { languageCode, channelId: string | null, key, heldByProductId, kind: 'current' | 'redirect' } }`.
Never takes over, never asks; the product keeps its previous key at that scope (FR-093).

## 6. Storefront

- `storefront/app/(catalog)/p/[slug]/page.tsx`: resolve first; `kind: 'redirect'` → `permanentRedirect()`
  to the emitted URL; 404/410 as today.
- `generateMetadata`: `alternates.canonical` is the effective URL for (C, L); `alternates.languages` lists
  the effective URL per channel language where the product is available to the anonymous audience
  (FR-074).
- Sitemap: per product, one `<loc>` per channel language where available (anonymous), each with its
  effective key and `?lang=` rule; `seo`'s sitemap generator gets the keys from
  `catalogProductUrlKeyReadPort.effectiveKeys(productIds, channelId)` (owner `catalog`).

## 7. Uniqueness tests (SC-008)

`backend/test/integration/catalog/url-key-uniqueness.test.ts` [PG]: every row of `data-model.md` §5's
table; membership and channel-language changes never refuse and never create a clash; **concurrency**: two
products writing the same key in one language from two connections at once — exactly one wins, the other
gets `URL_KEY_TAKEN`.
