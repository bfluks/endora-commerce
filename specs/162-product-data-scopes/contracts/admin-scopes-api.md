# Contract: admin API — scoped values, overview, bulk, completeness gate

Zod shapes in `packages/contracts/src/product-scopes.ts` (admin section). Gates reuse `catalog:read` /
`catalog:write` (FR-084); every route is registered in `packages/modules/catalog/src/backend/routes.admin.ts`
(or `routes.admin.scopes.ts`, registered from the same composition) behind `requireAdmin(...)` as its
`preHandler`. Research: R1–R4, R18, R20, R23.

## 1. Read the product's scopes — `GET /api/v1/admin/catalog/products/:id/scopes` (`catalog:read`)

```ts
productScopesResponseSchema = z.object({ data: z.object({
  global: z.object({ status, publishFrom: iso|null, publishUntil: iso|null, visibility, allowedOrganizationIds: uuid[],
                     minOrderQuantity: int|null, returnable: boolean }),
  channels: z.array(z.object({
    channelId, isMember: z.boolean(), languages: z.array(z.string()),   // the channel's current languages
    status: productScopeStatusSchema.nullable(),
    window: z.object({ from: iso|null, until: iso|null }).nullable(),
    audience: z.object({ visibility, allowedOrganizationIds: uuid[], nonMemberOrganizationIds: uuid[] }).nullable(),
    minOrderQuantity: int.nullable(), returnable: z.boolean().nullable(),
    languageStatuses: z.array(z.object({ languageCode, status, orphaned: z.boolean() })),
    orphaned: z.boolean(),                                                 // not a member any more (FR-015)
  })),
})})
```

`nonMemberOrganizationIds` is the C4 warning (organizations named by the override that are not members of
the channel); it is computed on read so the warning stays current.

## 2. Write scoped values — `PATCH /api/v1/admin/catalog/products/:id/scopes` (`catalog:write`)

```ts
patchProductScopesRequestSchema = z.object({
  channels: z.array(z.object({
    channelId: uuid,
    status: productScopeStatusSchema.nullable().optional(),             // null = use inherited
    window: z.object({ from: iso.nullable(), until: iso.nullable() }).nullable().optional(),
    audience: z.object({ visibility, allowedOrganizationIds: z.array(uuid) }).nullable().optional(),
    minOrderQuantity: z.number().int().min(1).max(ORDER_MINIMUM_MAX).nullable().optional(),
    returnable: z.boolean().nullable().optional(),
    languageStatuses: z.array(z.object({ languageCode: z.string(), status: productScopeStatusSchema.nullable() })).optional(),
  })).max(64),
  global: z.object({ publishFrom: iso.nullable(), publishUntil: iso.nullable() }).partial().optional(),
})
// absent key = untouched; null = use inherited (deletes the override, FR-012)
```

Response `200 { data: <§1 shape>, warnings: ScopeWarning[] }` where
`ScopeWarning = { kind: 'completeness'; channelId; languageCode; missing: ('name' | 'urlKey' | `attribute:${string}`)[] }
               | { kind: 'audience_non_members'; channelId; organizationIds: uuid[] }`.

Behaviour:
- One Command `product.scopes.update` (`objectType: 'product'`), one audit entry with `before`/`after` of
  every touched scope row, complete enough that re-sending `before` restores it (FR-080; undo per
  `research.md` R29 — bulk writes are undone by the bulk-operation undo, single writes are restored from the
  audit's before-state until the owner answers Q-D).
- **FR-014**: a channel the product is not a member of → `422 SCOPE_INVALID`
  `details: { channelId, reason: 'not_a_member' }`; a language the channel does not offer →
  `reason: 'language_not_offered', languageCode` — **except** `null` (removing an orphaned override is
  always allowed, FR-015).
- `window.from >= window.until` → `422 VALIDATION_FAILED details.field = 'window'`.
- Emits `product.updated.v1` with the `changedFields` of R10 after commit.
- Completeness gate (R18): `warn` → saved, `warnings[].kind = 'completeness'`; `refuse` →
  `422 SCOPE_INCOMPLETE details: { pairs: [{ channelId, languageCode, missing }] }`, nothing saved.
- The global **status** keeps its existing write path (`PATCH /api/v1/admin/catalog/products/:id`); that
  path now runs the gate too (US6 #3) and never warns about overrides (FR-013).

## 3. Scope overview — `GET /api/v1/admin/catalog/products/:id/scope-overview` (`catalog:read`)

```ts
scopeOverviewResponseSchema = z.object({ data: z.object({
  channels: z.array(z.object({ channelId, name: localized, isMember, languages: z.array(z.string()) })),
  languages: z.array(z.string()),                              // union, or every active platform language with no channel (US4 #4)
  cells: z.array(z.object({
    channelId, languageCode,
    available: z.boolean(),                                    // member ∧ language offered ∧ on ∧ inside window now — see note
    effectiveStatus: productScopeStatusSchema,
    statusSource: z.enum(['channel_language', 'channel', 'global']),
    overriddenFields: z.array(z.object({ field: z.string(), level: z.enum(['channel_language', 'channel', 'language']) })),
  })),
  channelRows: z.array(z.object({ channelId, overriddenFields: z.array(z.string()) })),
  languageColumns: z.array(z.object({ languageCode, overriddenFields: z.array(z.string()) })),
  orphans: z.array(z.object({ field, channelId: uuid.nullable(), languageCode: z.string().nullable(), reason: z.enum(['not_a_member', 'language_not_offered', 'attribute_scope_changed']) })),
})})
```

`available` here means "on and inside the window now" — audience depends on the buyer and is shown as the
rule, not evaluated (SC-003). Fields covered: every row of FR-009 (name/description and user-attribute
overrides read from `product_value_overrides`, SEO through `seo`'s port when present, URL keys, media,
attachments, order rules). "Reset to inherited" in a cell calls the owning write endpoint with `null` for
that one field.

## 4. Bulk — `POST /api/v1/admin/catalog/products/bulk-update` (`catalog:write`, unchanged route)

`bulkUpdateFieldsObject` gains:

```ts
scopedStatus: z.object({
  channelId: uuid, languageCode: z.string().nullable(),
  value: z.enum([...PRODUCT_SCOPE_STATUSES, 'inherit']),
}).optional(),
```

The "at least one field" refine counts it; combined with `fields.status` → `400 VALIDATION_FAILED`
(`details.field = 'scopedStatus'`). Per-product result reasons gain `scope_invalid` (FR-051) and
`completeness_gate` (FR-061, `refuse` mode; in `warn` mode the product succeeds and its result carries
`details.code = 'SCOPE_INCOMPLETE'` as a warning). `changedFields: ['scopedStatus']`. Queued path, undo and
per-product audit unchanged (FR-052).

## 5. Setting

`catalog.scope_completeness_gate` (`warn` | `refuse`, default `warn`) — the ordinary settings screen under
the catalog group; `settings:write` to change it (the existing settings gate).

## 6. Attribute scope-flag change preview (FR-090)

`GET /api/v1/admin/catalog/attributes/:idOrKey/scope-change-preview?channelScoped=&languageScoped=`
(`catalog:read`) → `{ data: { orphanedOverrides: number, byChannel: [{ channelId, count }] } }`. The
existing attribute update keeps working; the admin shows the preview before saving a narrowing.
