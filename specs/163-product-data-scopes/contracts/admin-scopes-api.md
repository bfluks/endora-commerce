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
  organizations: z.array(z.object({ id: uuid, name: z.string() })),       // U1, below
})})
```

`nonMemberOrganizationIds` is the C4 warning (organizations named by the override that are not members of
the channel); it is computed on read so the warning stays current.

`organizations` (owner decision U1, 2026-10-22) names every organization the channel audience rules name —
non-members included; not the global rule's, which is uncapped — so the admin shows names to an operator who holds
`catalog:read` but not `customers:read`, without reading `GET /api/v1/admin/organizations/:id` per id. The
server resolves them through `organizations`' read port (`organizationDetailsPort.findByIds`), best effort:
an organization that cannot be read (deleted, or the port refusing) is absent from the list and never an
error, and the admin shows its short id. The `PATCH` answer's `data` carries the same list.

## 2. Write scoped values — `PATCH /api/v1/admin/catalog/products/:id/scopes` (`catalog:write`)

```ts
patchProductScopesRequestSchema = z.object({
  channels: z.array(z.object({
    channelId: uuid,
    status: productScopeStatusSchema.nullable().optional(),             // null = use inherited
    window: z.object({ from: iso.nullable(), until: iso.nullable() }).nullable().optional(),
    audience: z.object({ visibility, allowedOrganizationIds: z.array(uuid).max(1000) }).nullable().optional(),
    minOrderQuantity: z.number().int().min(1).max(ORDER_MINIMUM_MAX).nullable().optional(),
    returnable: z.boolean().nullable().optional(),
    languageStatuses: z.array(z.object({
      languageCode: z.string().max(16).regex(/^[a-z]{2,3}(-[a-z]{2})?$/i),  // BCP-47 shape, any case
      status: productScopeStatusSchema.nullable(),
    })).max(64).optional(),
  })).max(64),
  global: z.object({ publishFrom: iso.nullable(), publishUntil: iso.nullable() }).partial().optional(),
})
// absent key = untouched; null = use inherited (deletes the override, FR-012)
```

Response `200 { data: <§1 shape>, warnings: ScopeWarning[] }` where
`ScopeMissingValue = 'name' | 'urlKey' | `attribute:${string}`` (`scopeMissingValueSchema`, one definition,
shared by the warning, `SCOPE_INCOMPLETE` details and the overview cell of §3) and
`ScopeWarning = { kind: 'completeness'; channelId; languageCode; missing: ScopeMissingValue[] }
               | { kind: 'audience_non_members'; channelId; organizationIds: uuid[] }`.

Behaviour:
- One Command `product.scopes.update` (`objectType: 'product'`), one audit entry with `before`/`after` of
  every touched scope row, complete enough that re-sending `before` restores it (FR-080, FR-081). Undo per
  `research.md` R29, owner decision Q-D → A (2026-10-22): bulk writes are undone by the bulk-operation
  undo; a single write has no undo of its own and is restored by re-applying the audit's before-state.
- **FR-014**: a channel the product is not a member of → `422 SCOPE_INVALID`
  `details: { channelId, reason: 'not_a_member' }`; a language the channel does not offer →
  `reason: 'language_not_offered', languageCode` — **except** `null` (removing an orphaned override is
  always allowed, FR-015).
- `window.from >= window.until` → `422 VALIDATION_FAILED details.field = 'window'`.
- A `channelId` named twice in `channels` → `422 VALIDATION_FAILED details: { field: 'channels', channelId }`.
- A `languageCode` named twice in one entry's `languageStatuses` (compared in the channel's spelling, so
  `de-DE` and `de-de` are one language) → `422 VALIDATION_FAILED details: { field: 'languageStatuses', channelId, languageCode }`.
- The write reads the product under a row lock (`FOR UPDATE`), so concurrent writes on one product
  serialise and each audit `before` is its true predecessor; a residual unique violation is
  `409 VERSION_CONFLICT`, never a 500.
- Emits `product.updated.v1` with the `changedFields` of R10 after commit.
- Completeness gate (R18): `warn` → saved, `warnings[].kind = 'completeness'`; `refuse` →
  `422 SCOPE_INCOMPLETE details: { pairs: [{ channelId, languageCode, missing }] }`, nothing saved.
  **Only a status change fires it** (M3 → A, FR-060): the pairs are `pairsTurningOn`, which compares
  effective *status* alone. A request that changes only `window`, `audience`, order rules or nothing at
  all never warns and never refuses, even if it makes the product live at (C, L) now. Joining a channel
  (`PUT /api/v1/admin/sales-channels/:code/:entityType/:entityId`, `sales_channels`, or bulk
  `salesChannels` without `status`) and a channel gaining a language (`PATCH /api/v1/admin/sales-channels/:code`)
  never produce a gate pair;
  what they leave missing is shown by the overview (§3, `cells[].missing`).
- The global **status** keeps its existing write path (`PATCH /api/v1/admin/catalog/products/:id`); that
  path now runs the gate too (US6 #3) and never warns about overrides (FR-013). Since spec Session
  2026-10-25 it accepts `active` | `inactive` only (`draft` or the legacy `archived` → `400 VALIDATION_FAILED`, FR-112, O-1), and a
  write of `inactive` no longer archives: it neither sets nor clears `archivedAt` (FR-010).
- **Archive / Restore** (FR-019, FR-053) are separate `catalog:write` Commands for one product and, for a
  selection, an exclusive `fields.archived` field on the existing bulk-update operation (not a bulk-operation
  kind of its own, R30.3); they touch `archivedAt` only. Shapes (research R30.3, decided 2026-10-25):
  `POST /api/v1/admin/catalog/products/:id/archive` and `…/restore` — no body, `catalog:write`, `200 { data:
  AdminProduct }` also on a no-op, Commands `product.archive` / `product.restore`, `changedFields: ['archivedAt']`;
  bulk `fields.archived: boolean` on `POST …/products/bulk-update`, alone in its request. The admin list's
  `archived=exclude|include|only` and `counts` `{ all, active, inactive, archived }`: R30.4.

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
    missing: z.array(scopeMissingValueSchema).optional(),      // FR-041 — what the gate would report at this cell
  })),
  channelRows: z.array(z.object({ channelId, overriddenFields: z.array(z.string()) })),
  languageColumns: z.array(z.object({ languageCode, overriddenFields: z.array(z.string()) })),
  orphans: z.array(z.object({ field, channelId: uuid.nullable(), languageCode: z.string().nullable(), reason: z.enum(['not_a_member', 'language_not_offered', 'attribute_scope_changed']) })),
})})
```

`available` here means "on and inside the window now" — audience depends on the buyer and is shown as the
rule, not evaluated (SC-003).

`missing` (FR-041, M3 → A) is `checkCompleteness` (R18) evaluated for that cell — the same function and the
same `ScopeMissingValue` vocabulary the gate uses, so the overview and a refusal can never disagree. It is
computed for every cell whose channel the product is a member of and whose language that channel offers,
**whatever the effective status** — so the operator sees the gap before switching a cell on and after a
change that made it live without firing the gate (joining a channel, a channel gaining a language, a window
opening, an audience change). `[]` = complete; absent = the cell is not evaluable (non-member channel,
language not offered); the admin renders nothing for an absent field. Fields covered: every row of FR-009 (name/description and user-attribute
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
