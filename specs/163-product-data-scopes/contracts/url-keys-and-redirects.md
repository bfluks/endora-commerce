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
  redirects: z.array(z.object({ id: uuid, languageCode: z.string().nullable(), key, createdAt: iso })).optional(),
})})
```

`redirects` is **omitted** when `seo` is not effectively present (Q-C, Constitution XVII); the admin renders
the redirect list only when the field is present. The takeover confirmation (§2) is unaffected.

`url` is the storefront path as emitted (R12): `productPath({ key, languageCode, channelDefaultLanguage })`
from `product-url-keys.ts` — `/p/<key>` plus `?lang=<L>` when L ≠ channel default. Every emitter (this
field, the resolve answer's `path`, the PDP's `paths`, the sitemap) is a **backend** call of that one helper,
so the language-path-prefix issue (Q-B → C) changes one function. In-page storefront links (cards, rows,
basket lines — 32 `/p/` sites in 23 files today) keep `/p/<effective key>` without `?lang`: the browser that
clicks them is already in L; the prefix issue will have to touch them (plan risk 3).

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
deleted, including another product's redirect taken over — FR-080). The audit `before` holds every key and
redirect row touched, so re-applying it restores them; a re-applied key that has since been taken is refused
with `URL_KEY_TAKEN` like any other write (R29).

Refusals (nothing saved):
- `409 URL_KEY_TAKEN` `details: { conflicts: [{ languageCode: string | null, key, heldByProductId, heldByProductName }] }`.
  Also raised when a `languageKeys` entry is `null` (use inherited) and the product's global key is another
  product's current key in that language while some channel offers it — removing the language key would
  make the global key the product's key there again (data-model §5). An orphaned language key (no channel
  offers the language) is not checked: removing it stays always allowed (FR-015).
- `409 URL_KEY_REDIRECT_TAKEOVER_REQUIRED` `details: { takeovers: [{ languageCode, key, losingProductId, losingProductName }] }`
  — the admin asks the operator, then retries with `confirmTakeover` (FR-072, US7 #5).
- `422 SCOPE_INVALID` for a channel the product is not a member of or a language the channel does not offer
  (FR-014) — removing an orphaned key (`key: null`) is always allowed.

Emits `product.updated.v1` `changedFields: ['urlKeys']`.

## 3. Admin — delete a redirect — `DELETE /api/v1/admin/catalog/products/:id/url-redirects/:redirectId` (`catalog:write`)

Command `product.url_redirect.delete`, audited with the deleted row as `before` (R29). Not gated on `seo`
(writes never are), but no admin surface reaches it while `seo` is off (Q-C).
`204`; `404 URL_REDIRECT_NOT_FOUND` when the row is not the product's.

## 4. Public — resolve — `GET /api/v1/catalog/products/resolve/:key` (storefront, channel resolved by middleware)

Language: `resolveScopeLanguage(channel, first Accept-Language tag)`.

```ts
productKeyResolutionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('product'), productId: uuid, key: z.string() }),          // key is the effective key at (C, L)
  z.object({ kind: z.literal('redirect'), key: z.string(), languageCode: z.string(), path: z.string() }), // 200; path = productPath(…) built by catalog; storefront permanentRedirect(path)
])
```

- `404 PRODUCT_NOT_FOUND` — no product holds the key in L (incl. a key of another language, K1), the
  product it resolves to is not effectively available at (C, L, buyer, now), or the key is a redirect and
  `seo` is not effectively present (FR-111).
- `410 PRODUCT_ARCHIVED` — the key (current or redirect) resolves to an archived product **and** that
  product would be effectively available at (C, L) to this buyer with the archive taken away and its global
  status read as `active` (FR-005, owner O-3); an archived product failing that test answers
  `404 PRODUCT_NOT_FOUND` like any unavailable one (edge case).
- The existing `GET /api/v1/catalog/products/:idOrSlug` answers, in order, an id, a **current** key at
  (C, L), else a product's **global key** (`products.slug`) — an API handle CMS product blocks store
  (R28) — and never answers a redirect; the storefront PDP switches to `resolve` then reads by id.

## 5. Connectors and import — `catalogProductScopeWritePort.applyScopes(…).urlKeys`

Per key: `{ written: true } | { written: false, issue: { languageCode, channelId: string | null, key, heldByProductId, kind: 'current' | 'redirect' } }`.
Never takes over, never asks; the product keeps its previous key at that scope (FR-093).

## 6. Storefront

- `storefront/app/(catalog)/p/[slug]/page.tsx`: resolve first; `kind: 'redirect'` → `permanentRedirect()`
  to the answer's `path`; 404/410 as today. No cross-language rendering (Q-B option B rejected); a key without
  `?lang` is resolved in `resolveScopeLanguage(channel, Accept-Language)` only — the accepted residual gap
  of R12.
- `generateMetadata`: `alternates.canonical` is the effective URL for (C, L); `alternates.languages` lists
  the effective URL per channel language where the product is available to the anonymous audience
  (FR-074). Both come **ready-made** from the PDP response's new additive field
  `paths: { canonical: string; alternates: { languageCode: string; path: string }[] }`, which catalog builds
  with `productPath()`: the storefront does not know the channel's default language (`RequestContext`
  carries a locale and a channel code only, and `i18n/config` answers the platform default), and only
  catalog knows where the product is available, so the storefront composes no product URL of its own on
  these surfaces.
- Sitemap: per product, one `<loc>` per channel language where available (anonymous), each with its
  effective key and `?lang=` rule; `seo`'s sitemap generator gets the keys from
  `catalogProductUrlKeyReadPort.effectiveKeys(productIds, channelId)` (owner `catalog`).

## 7. Uniqueness tests (SC-008)

`backend/test/integration/catalog/url-key-uniqueness.test.ts` [PG]: every row of `data-model.md` §5's
table; membership and channel-language changes never refuse and never create a clash; **concurrency**: two
products writing the same key in one language from two connections at once — exactly one wins, the other
gets `URL_KEY_TAKEN`.
