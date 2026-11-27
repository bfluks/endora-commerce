# Threat model: Product visibility rules (spec 193)

Reviewed: plan stage, `plan.md`, `research.md`, `data-model.md`, `contracts/*`, `tasks.md` at
`9eb9e8eb1`; platform code read at `c3e8a8755` / the worktree. No code of this feature exists yet.
This document extends the ten "Threat-model items" at the end of `tasks.md`; each finding names
the task to add or amend. Hardening requirements only; no attack procedures.

Severity: **block** = the plan cannot meet its own stated guarantee (FR-031/033/036, SC-003,
FR-073) until fixed; **warn** = close before the Phase 5/7 review checkpoint; **note** = record.

## 1. Assets, actors, boundaries

| Asset | Who must not get it | Boundary that protects it |
| --- | --- | --- |
| Existence, name, SKU, id, attributes, stock, price history of a hidden product or variant | Admin whose role is mapped to a category the product is outside of, and no-category roles (FR-021 - FR-023) | Server-side predicate in the catalog statement (R-7); by-id guard; explicit refusal on lines |
| Aggregates over the catalogue (totals, counts, `hasMore`, per-category and per-attribute product counts) | same | Counted over visible rows only |
| The restriction itself (mappings, designations, module on/off) | The restricted user | `product_visibility:manage`, `platform.modules.activate`, `admin_users:manage`, `*` |
| Storefront channel membership of governed channels | Every writer except the rule | Kernel governor + write token (R-10) |
| Derived price flags | Anyone able to make them lie | Worker-only writes, engine-only source (FR-006) |

Actors: unrestricted admin; restricted admin (mapped); no-category admin (fail-closed);
configuration manager; module-activation holder; connector via `salesChannelMembershipPort`; API-key
integration; background workers acting for a requester; the assistant (LLM) tools; an in-process
module that can emit events.

Trust boundaries that are new: (1) module-produced SQL text embedded into another module's
statement; (2) a kernel governor consulted inside every membership write; (3) an in-process event
turned into derived security-relevant state; (4) identity carried into off-request code.

Verified in code (no change needed): the admin id comes only from the promoted session actor
(`modules/auth/src/backend/require-admin.ts`: an `api_key` or customer actor is refused 401 on admin
routes); the role is read per request with no cache (`admin_roles/.../permission-service.ts:146`
`#roleById` is a plain `findOne`), so a role change applies on the next request; `platform_admin`
is a unique, locked role code (`admin-role-service.ts:225-302`); admin list/by-id responses carry
no server cache (no ETag / cache layer found in catalog admin paths).

## 2. Findings

### TM-1 [block] Bulk-operation routes sit outside the by-id inventory and defeat "hidden = absent"

- Where: `catalog/backend/routes.admin.ts:479-560` — `GET /api/v1/admin/catalog/bulk-operations`,
  `GET …/bulk-operations/:id`, `POST …/bulk-operations/:id/undo`; plan R-7 / T035 / T040 only
  enumerate `…/products/:id|:productId` and `…/variants/:variantId`.
- Why: the list and detail return operations by anyone, with the selected product ids and per-product
  results; undo writes back to every product the operation touched. A restricted user can therefore
  read, and write to, hidden products through an operation id. None of the three is filtered by
  requester or scope today (and `list` takes no requester at all).
- Required: T035 inventory = **every** `/api/v1/admin/catalog/**` route that returns or writes
  product data, not only the id prefix (derive from the app's routes, allow-list the ones proven
  product-free). T041 amended: operation list/detail show a restricted caller only operations with
  no hidden product in their selection (or only their own, with hidden ids dropped from `payload`
  and results); undo is refused as not-found when any affected product is hidden from the caller.
  The worker re-check must be per product at write time, not per request.

### TM-2 [block] URL-key conflict answers name the hidden product (OQ-E premise is wrong)

- Where: `catalog/backend/services/url-key.service.ts:324-337` — `URL_KEY_TAKEN` `details.conflicts[]`
  carry `heldByProductId` and `heldByProductName`; the integration-mode `issues` (`:309-316`) carry
  `heldByProductId`. Plan OQ-E says the unique-key oracle "names nothing but confirms a hidden
  product exists".
- Why: for a restricted caller this discloses id and name of a product they must not see, through
  any route that saves a URL key (product save, scoped values, bulk, variants).
- Required: new task in Phase 5b: when the holder is hidden from the caller, the conflict is
  returned without `heldByProductId` / `heldByProductName` (key and channel only). Same sweep for
  every `HttpError` details and message in catalog, price_lists and sales_channels that names a
  product other than the addressed one (grep `heldBy`, `productId`, `name` in `details`). Residual
  oracle (key/SKU "already taken", `SKU_ALREADY_EXISTS` text) stays accepted and documented (T079).

### TM-3 [block] Scope must be an explicit, required argument; nothing may default to "unrestricted"

- Where: R-7 / T037 / T038 / T041 / T043 — scope is resolved "per request", `productPredicate`
  returns `null` for unrestricted (`contracts/ports.md` §1).
- Why: the module is consulted only where a call site remembers to pass a scope. Off-request code
  (bulk worker `withSystemScopeActingFor`, undo, assistant tool execution, `prompt_actions` confirm,
  import/export jobs, scheduled work) has no request actor; an absent scope read as "no clause"
  is a silent fail-open, and `null` meaning "unrestricted" makes a bug indistinguishable from a
  decision.
- Required:
  1. `CatalogAdminService` (and `price_lists` reads) take the scope as a **required** parameter of
     a named type with an explicit `system` member for storefront/connector/system callers;
     the compiler or an architecture test fails on a call that omits it (T038).
  2. Off-request callers resolve with `resolveScope(requestedByAdminUserId)` at execution time
     (T041, T043), never from an ambient request.
  3. `productPredicate` / `variantPredicate` return a discriminated union
     (`{ kind: 'none' } | { kind: 'sql', … } | { kind: 'deny' }`), not `null`; `deny` renders a
     constant false clause.
  4. `resolveScope` never catches: a role-resolution refusal (`ADMIN_ROLE_REQUIRED`), an unreadable
     mapping or an unreadable designation gives `no_category` or a 5xx, never `unrestricted`
     (T031, T026 test per case). Module "present but failing" test in T045.

### TM-4 [block] The boundary can be lifted by the restricted role itself; the plan does not say which roles may be restricted

- Where: FR-021 - FR-023, R-13, `contracts/admin-api.md` §1, `tasks.md` item 8.
- Why: restriction applies to roles holding `rfqs:handle` or `*`. A role that also holds
  `product_visibility:manage` (deletes its own mapping), `platform.modules.activate` (switches the
  module off, FR-073), `admin_users:manage` (assigns a role; edits roles) or `*` is restricted in
  name only. Removing `rfqs:handle`/`*` from an unmapped role also turns it unrestricted.
- Required (T017/T019/T021): (a) the mapping Command refuses a role holding any "lifting"
  permission (`*`, `product_visibility:manage`, `platform.modules.activate`, `admin_users:manage`)
  with a translated error; (b) `GET /overview` shows `liftable: true` for a mapped or fail-closed
  role that acquires one later (admin_roles edits do not call this module); (c) the configuration
  write routes answer 403 to a caller whose own scope is not unrestricted; (d) audit of mapping
  changes and of module activation/deactivation names the actor (activation audit is the existing
  lifecycle ledger — verify it records the flip, T024); (e) docs state that a `*` role is not a
  restrictable role.

### TM-5 [warn] By-id guard: placement, ordering relative to interceptors, canonical answer

- Where: R-7 "Placement is the oracle question", T040, `platform/src/http/guards-before-validation.ts`,
  `platform/src/http/interceptors/dispatch.ts:19-98`.
- Assessment: the plan's concern is right (declared `preHandler` is moved to `preValidation`, so a
  guard there would answer before validation). Two further hazards:
  1. API pre-interceptors are appended to the **end** of the route's own `preHandler` chain. A guard
     that is the first statement of the handler, or a route-level hook appended after the
     interceptor dispatcher, lets other modules' pre-interceptors run (read or mutate) for a hidden id.
  2. A guard that fabricates `404 PRODUCT_NOT_FOUND` can differ from the route's own not-found
     (sub-resources, variant routes, a not-found raised after a semantic check).
- Required: guard = plugin-scope `addHook('preHandler')` on the plugin that mounts the catalog admin
  routes (scope hooks run before route-level `preHandler`, hence before the interceptor dispatcher
  and after schema validation), keyed on `request.routeOptions.url`; when the product is hidden it
  must make the route behave as if its own lookup returned nothing (route-specific not-found), not
  emit a generic 404. T035 additions: a spy pre-interceptor registered on a product route is **not
  invoked** for a hidden id; compare full envelope (status, `error.code`, message, `details` shape,
  response headers other than request id), HEAD/OPTIONS, non-UUID ids, and the request-shape matrix
  already listed. Server-side log (not response) may record the hidden-vs-absent reason at debug.

### TM-6 [warn] Aggregates and counts outside the product list

- Where: FR-031 / "no response counts hidden products"; `catalog-category-read.service.ts:257-268`
  (category `productCount`), `attribute-set.service.ts:118-140,319,536-545` (`productCount`, and
  `assertNotInUse` puts it in error details), `attributes/:idOrKey/usage`,
  `attributes/:idOrKey/scope-change-preview`; product detail aggregates over variants (variant
  count, option/axis value lists, stock totals, price ranges, media of hidden variants).
- Required (T036/T038 + new task): inventory every aggregate in `/api/v1/admin/catalog/**` and
  `price_lists` reads; narrow with the same predicate or record as accepted with the owner; a
  restricted caller's product detail derives every variant-derived aggregate from visible variants
  only. Mutating paths (T038): a payload naming a hidden variant id answers as that route answers a
  non-existent id; option/axis changes that would regenerate or delete variants must not touch
  hidden variants (merge-back rule covers omission only).

### TM-7 [warn] Derived flags: race windows that leave a stale "visible"

- Where: R-5, R-6, `data-model.md` §2, T028 - T030, OQ-A.
- Stale-visible (a product shows after it should hide) is the dangerous direction. Gaps:
  1. Mark cleared "in the same transaction that replaces the product's rows": a price change landing
     between the engine read and that transaction hits `on conflict do nothing` and is then deleted
     with the mark. Clear only marks with `marked_at` earlier than the refresh's read start (or a
     per-mark counter).
  2. A targeted refresh must read `served_generation` and write inside one transaction with the
     generation row locked; otherwise it can write into a generation just swapped away.
  3. Marks arriving while generation n+1 is building are lost for n+1 if cleared against n; keep
     them until after the swap and apply to the new served generation.
  4. After a designation change the old generation serves until swap (≤ 150 s). Make the read apply
     the `built_for_price_list_id/_sales_channel_id` snapshot: a currency whose served generation was
     not built for the **current** designation contributes no condition (fail closed), instead of
     serving the old designation's facts. Admin act, rare; costs a short "no products" window.
  5. Lost announcement: `afterBump` is best effort (`pricing-generation.ts:74-87`) and the in-process
     `EventBus.dispatch` swallows handler failures (`events/bus.ts`, `console.warn`); the only
     backstop is a nightly rebuild, i.e. up to a day of stale-visible. Required: the subscriber writes
     the mark durably before returning; the module records the pricing generation each build
     consumed and a cheap periodic check (<= a few minutes) enqueues a rebuild when it moved without a
     matching mark; nightly stays as the last resort. Add the test to T030.
  6. A partially built generation is never swapped (swap only after a complete build; a crashed
     build restarts; T028 test).

### TM-8 [warn] SQL predicate injection surface (module text embedded in catalog SQL)

- Where: `data-model.md` §2 predicates, `contracts/ports.md` §1 (`columns: { productId: string }`).
- Assessment: values (currency, generation) are placeholders as drafted; the precedent
  (`catalog-admin.service.ts:1868` `stockClause`) is sound. Remaining surface is the **identifier
  strings** the caller passes (`"products"."id"`) interpolated into the fragment, and placeholder
  ordering across the two modules' params.
- Required (T026, T031): identifiers validated by an allow-list pattern (quoted `schema`-free
  `"alias"."column"` only) and rejected otherwise; no request-derived text ever reaches a fragment;
  unit test that every fragment's `?` count equals `params.length` and that fragments contain no
  literal beyond constants; `ctx.di.providePort` JSDoc says callers embed the fragment inside
  parentheses with its params in order. No cross-request cache of scope or fragments (cache key
  would have to include the role, mapping version and every designation status; the plan says none, keep it).

### TM-9 [warn] Other admin read paths that return product data to a restricted identity

- Where: FR-038 and `tasks.md` item 5 treat exports/feeds as out of scope; OQ-E covers only
  `catalog`'s assistant tools. Measured at `c3e8a8755`:
  - `inventory/backend/routes.admin.ts:580-615` (`/api/v1/admin/inventory/legacy` returns
    `productSku`, `productName`, stock) and other inventory admin lists; `inventory/backend/prompt-tools.ts:86-101`
    (assistant "set stock" tool returns the product name for any id and writes).
  - `price_lists/backend/routes.price-books.ts:536-567` (`…/price-history/products/:productId`,
    `…/price-history/:changeId/lines`, `…/rows`) — by product id, amounts included; T041a/b narrow
    only the grid.
  - `import_export` products adapter (`import_export/.../adapters/products.adapter.ts`): an
    export lists the whole catalogue; an import by SKU updates a hidden product and its created/updated
    result is an existence oracle.
  - Audit-log and notification surfaces naming products (already noted in `tasks.md` item 4).
- Required: add a table "surface | narrowed / refused / accepted + reason" to this feature's docs
  (T079); the owner signs off the accepted rows. Recommended defaults: products export and import
  refused for a non-unrestricted scope (403, one check in the adapter through the port); inventory
  admin reads and all assistant tools that take a product id resolve through the scoped lookup; the
  price-history-by-product route answers as absent when the product is hidden (a read, not an
  "edit", so FR-038 does not cover it). The overview screen should warn when a mapped role holds
  `import_export:*`, `inventory:read` or `audit_logs:read`.

### TM-10 [warn] Governor token and governor registration

- Where: R-10, `contracts/ports.md` §5, T054, T056.
- Required: `GovernorWriteToken` is an opaque object checked by identity (module-private `WeakSet` in
  the registry), never a string, not exported on the `./kernel` barrel as a constructible type, and
  **never placed in the DI container** (every module can resolve the cradle). Registration only
  during boot, one governor per module id, frozen afterwards. If `governs()` throws, the write is
  refused (fail closed), never treated as "not governed". The audit `source` is honoured **only when
  the governor token is present**; any caller-supplied `source` otherwise is ignored/overwritten so
  rule attribution (FR-072) cannot be forged. T053 adds: a test enumerating every writer of the
  channel-product bridge (grep for the bridge table in `packages/**`, fails on an unlisted one) so a
  new direct writer cannot bypass the service. The rule label in `CHANNEL_MEMBERSHIP_GOVERNED` is
  user-authored text: render as text only in the admin UI.

### TM-11 [warn] Website-rule preview, confirm, evaluation

- Where: R-9, R-11, `data-model.md` §3, T047 - T050.
- Required: confirm checks `created_by_admin_user_id` against the **session** admin id server-side;
  per-admin cap on concurrent previews and a size cap on `website_rule_preview_changes`
  (channels x products can reach millions of rows); `sales_channel_ids`, conditions (20), option keys
  and string lengths bounded in the Zod schema and by `bodyLimit`; the evaluator re-validates attribute
  keys at evaluation (an attribute deleted or re-scoped after save evaluates "not met", and no
  definition value is ever interpolated into SQL or a JSON path); a rule's channel list is checked
  against the caller's channel permissions if the platform has per-channel admin scope.

### TM-12 [warn] Event spoofing and rebuild amplification

- Where: R-6, `contracts/events-and-errors.md` §1.
- Assessment: the `EventBus` is in-process and does not enforce emitter ownership, so any composed
  module can emit `price_lists.catalogue_prices_changed`. This is safe only if the event is a hint.
- Required (T030): the subscriber validates the payload with `CataloguePricesChangedEventSchema`,
  never copies amounts or flags from it (flags come only from the engine, FR-006), caps array sizes
  (over the cap degrades to a whole-currency rebuild), and coalesces rebuilds (one running plus one
  queued per currency; deduplicated job ids) so a burst of price writes cannot queue unbounded
  rebuilds.

### TM-13 [warn] Module off lifts all restrictions silently

- Where: FR-073, R-3, R-15; OQ-C default off.
- Required: while the module is off and mappings or designations exist, the platform module screen
  and the overview show that restrictions are **not** applied; activation and deactivation are
  audited with actor (existing lifecycle ledger, T024 verifies); the deactivation confirmation
  states that every restricted role becomes unrestricted. Default-off at upgrade means the control is
  not in force until an operator enables it: the release note and T079 say so.

### TM-14 [warn] Client-side caches across users

- Where: tasks item 6 ("admin-kit client caches are per session").
- Required: confirm the admin SPA drops its query cache on sign-out and on a 401, and that list
  endpoints send `Cache-Control: private, no-store` (the external namespace already does,
  `catalog/backend/routes.external.ts`); add to T066/T068.

### TM-15 [note] Accepted oracles (record in docs)

- SKU / URL-key "already taken": existence only, once TM-2 is done. IDs are UUIDs; no SKU-based line
  input exists in orders at `c3e8a8755` (`orders/backend/routes.ts` has no sku lookup). If spec 192's
  quote lines add a SKU or paste-by-SKU input, the refusal for a hidden product must equal the
  not-found answer for that input (re-check in Phase 9).
- `PRODUCT_NOT_IN_VISIBILITY_CATEGORY` vs `PRODUCT_NOT_FOUND` on order/quote lines: caller supplied
  the id; keep `details` to `items.<i>` only (no category name, price, flag).
- `visibility.categoryName` in the list response is the caller's own category.

### TM-16 [note] Plan items checked and adequate as drafted

Scope from session only (item 1); role change mid-session (live read); `platform_admin` unrestricted
and unmappable; fail-closed cases in item 7 provided TM-3 and TM-7(4); no per-role response cache;
no amounts in `price_lists.catalogue_prices_changed` (names only); configuration writes through the
Command Bus with before/after; module tables classified platform-global (no tenant data); no
dependency added.

## 3. Task changes requested (summary)

> **Pointer (architect, analyze round)**: the task ids below are the ids of `tasks.md` at `9eb9e8eb1`;
> tasks were renumbered since — the current mapping is `tasks.md` § *Threat-model finding → task map*.
> TM-4 (b)'s `liftable` flag is named `mapping_without_effect` in the plan (owner OQ-G 1 made such roles
> always unrestricted). TM-11's per-channel admin scope check is not applicable: the platform has no
> per-channel admin scope (recorded). TM-9's recommended overview warnings (`import_export:*`,
> `inventory:read`, `audit_logs:read`) were replaced by FR-086: only the `audit_logs:read` warning is
> planned (L4).

| Finding | Tasks to add or amend |
| --- | --- |
| TM-1 | T035 (inventory = all catalog admin routes), T041 (operations list/detail/undo, per-product worker check) |
| TM-2 | new task 5b (redact `heldBy*`), details sweep; T079 |
| TM-3 | T031, T032, T037, T038, T041, T043, T045 (required scope type, union predicate, no catch) |
| TM-4 | T017, T019, T021, T024, T079 |
| TM-5 | T035, T040 |
| TM-6 | T036, T038, new aggregate-inventory task |
| TM-7 | T028 - T030, T031, T033 |
| TM-8 | T026, T031 |
| TM-9 | T043, T041a/b, new inventory/price-history/import_export tasks, T079 |
| TM-10 | T053, T054, T056 |
| TM-11 | T047 - T050 |
| TM-12 | T030 |
| TM-13 | T024, T067, T079 |
| TM-14 | T066, T068 |

Re-review on the diff: Phase 4 (flags, scope), Phase 5a/5b (by-id inventory, bulk), Phase 7
(governor), Phase 9 (lines) — against TM-1 - TM-14.
