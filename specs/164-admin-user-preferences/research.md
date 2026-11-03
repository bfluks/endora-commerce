# Research: Admin user preferences (`specs/164-admin-user-preferences/`)

Every decision below is stated as **decision → rationale → alternatives rejected**. Facts are
measured on `feat/sidebar-pinned-items` at `2b27fa2dd` (= `origin/master`); paths are real.
The owner's rulings (a)–(d) at the top of [spec.md](./spec.md) are binding and are not
re-opened here. The points where this plan *reads* the spec rather than following an explicit
sentence are collected in § *Readings — owner rulings (2026-10-27)* at the end; the owner
accepted every one of them on 2026-10-27.

The brief's seven decisions map to sections as follows: **1** → R-1, R-2; **2** → R-3, R-4;
**3** → R-5; **4** → R-6, R-7; **5** → R-10; **6** → R-13; **7** → R-14. Owner ruling (e) and
FR-027 (pinning from the command palette, added 2026-10-27 after approval) are R-15 and R-16.

---

## R-1 — Owner, table shape and keys (decision 1)

**Decision.**

- **`admin_users` owns one new table, `admin_user_preferences`: one row per (admin,
  preference key)**, the value in a `jsonb` column. Primary key `(admin_user_id,
  preference_key)`, which is also the unique index; no other index.
- Entity `AdminUserPreference`, `@GlobalEntity()`, in
  `packages/modules/admin_users/src/backend/entities/admin-user-preference.entity.ts`, appended
  to the module's `entities` array (`packages/modules/admin_users/src/backend/index.ts:296`).
- **Foreign key to `admin_users(id)` `on delete cascade`.** Soft delete and deactivation keep
  the rows (spec edge case); the only hard deletes of an admin row that exist — the demo
  withdrawal (`packages/modules/admin_users/src/backend/demo/reset.ts:32`) and the test
  harness's `truncate … cascade` (`backend/test/helpers/test-server.ts:651-672`, which lists
  `admin_users` at `:752`) — take the preferences with them.
- The `preference_key` column holds the contract's key token verbatim (`sidebarPins`, …); there
  is no database `check` constraint on it (see alternatives).

**Rationale.**

1. *Ownership.* The spec's *Assumptions* fix the owner: preferences belong to the account,
   `admin_users` is non-deactivatable (`packages/modules/admin_users/src/manifest.ts:228-232`)
   and already owns the one server-held UI preference (`preferredLanguage`). A new module would
   own nothing `admin_users` does not (Principle I asks for ownership, not size).
2. *Last write wins per preference* (spec edge case, FR-017) is the natural behaviour of one row
   per key: a phone toggling rail mode and a desktop re-ordering pins write different rows and
   cannot overwrite each other, and each row carries its own `updated_at`.
3. *The 147 precedent decided "no foreign key" for a reason that does not apply here.*
   `specs/147-saved-views/data-model.md` refused one because the saved-view tables belong to
   `orders`/`catalog`/`quote_requests` and a key into `admin_users` would be a **cross-module**
   reference needing a manifest dependency (`specs/conventions/module-migrations.md` item 4),
   and because a view must outlive its owner. Here both tables are `admin_users`' own, so the
   key costs no lifecycle edge, and a preference has no meaning without its admin. Cascade also
   keeps the demo withdrawal and the per-file truncate clean without adding this table to
   `SEEDED_TABLES`.
4. *Precedent for the row shape.* `catalog`'s per-(admin, product) editor memory is a
   `@GlobalEntity()` with a composite primary key and no surrogate id
   (`packages/modules/catalog/src/backend/entities/product-editor-preference.entity.ts`).

**Alternatives rejected.**

| Alternative | Why rejected |
| --- | --- |
| Columns on `admin_users` (`pinned_entries jsonb`, `rail_mode boolean`, …) | Every future preference is a migration on the identity table the session gate reads on every request; UI writes would churn `admin_users.updated_at`, which `/admin-users` shows; page sizes are a map and pins a list, so most columns would be `jsonb` anyway. |
| One `jsonb` document per admin (`admin_ui_preferences(admin_user_id pk, document jsonb)`) | Per-preference last-write-wins would need `jsonb_set` per key on every write and a read-modify-write discipline for every future key; a whole-document write — the obvious implementation — lets a rail toggle on the phone erase a pin made on the desktop a second earlier. |
| One row per (admin, key, list) for page sizes | Opens the key space to an unbounded set of rows per admin; per-list last-write-wins is obtained instead by a server-side per-entry merge of the one `listPageSizes` row (R-3). |
| The Settings store | Spec *Assumptions*: platform-wide or channel-scoped operator configuration with no per-admin scope (`packages/contracts/src/settings.ts:290-310`). |
| A new `admin_preferences` module | Owns nothing `admin_users` does not; it would have to be non-deactivatable too, which Principle XVII asks to keep minimal. |
| No foreign key (147's choice) | 147's reason was cross-module; here it would only leave orphan rows after a demo withdrawal and force the table into the harness truncate list by hand. |
| A `check (preference_key in (…))` constraint | A second statement of the closed set beside the contract (Principle II makes the Zod schema the source of truth), and every new preference would need an `admin_users` migration to widen it. The service writes only keys the contract parsed. |

### Migration and generated artefacts

| Step | Command / file |
| --- | --- |
| Scaffold | `pnpm --filter backend run migration:new -- --module admin_users --name admin_user_preferences` — the tool assigns the timestamp and the `Migration<STAMP>AdminUsersAdminUserPreferences` class name; no number is chosen by hand (`specs/conventions/module-migrations.md` items 1, 6) |
| Barrel | Add the class to `packages/modules/admin_users/src/migrations/index.ts` — the `migrations` array **and** the named export. The scaffolder prints this instruction (`backend/scripts/new-migration.ts:459-461`); a class in neither does not run |
| Register | `pnpm --filter backend run composer:generate` — **must run**: `backend/src/db/migrations-registry.generated.ts` imports each `admin_users` class by name (`:47-49`, `:398-400`) and gains a line. `entities-registry.generated.ts` imports the `entities` array (`:49`) and is expected not to change textually; commit whatever the generator writes |
| Manifests | `pnpm --filter backend run manifests:generate` then `manifests:check` and `pnpm install --lockfile-only` — expected **no diff** (the new files import only `@mikro-orm/core`, `@endora-commerce/platform/tenancy` and `@endora-commerce/contracts`, all already peers of `@endora-commerce/mod-admin-users`); run them because a derived artefact left stale is a silent defect (`AGENTS.md`, *traps*) |
| Ordering | The table references only `admin_users`, owned by the same module, so no manifest `dependencies` change and nothing for `fk-dependency-drift.test.ts` to report |

The manifest itself does not change (no permission, action, setting or activation change), so
the generated module reference `docs/docs/module-reference/admin-users.md` does not change.

---

## R-2 — The closed key set, each value's shape, and the technical bounds (decisions 1, 2)

**Decision.** Four keys, closed in `@endora-commerce/contracts` (`ADMIN_PREFERENCE_KEYS`):

| Key | Value (write schema) | Default | Bound | Merge on write |
| --- | --- | --- | --- | --- |
| `sidebarPins` | ordered array of admin destinations, each `AdminNavDeclarationSchema.shape.to` (leading-slash ASCII path ≤ 255, no query string — the same rule a sidebar entry's `to` obeys, `packages/contracts/src/admin-contributions.ts:47`, `:850-866`), no duplicates | `[]` | **200** entries | whole value replaced |
| `sidebarCollapsedGroups` | array of group-key tokens `^[a-z][A-Za-z0-9]{0,63}$`, no duplicates | `[]` | **32** entries | whole value replaced |
| `sidebarRailMode` | boolean | `false` | — | whole value replaced |
| `listPageSizes` | record list-id → page size; list id `^[a-z0-9]+(?:-[a-z0-9]+)*$`, ≤ 64 chars; size one of `ADMIN_LIST_PAGE_SIZE_OPTIONS` (`5, 10, 20, 50, 100, 500`); `null` in a `PATCH` means "forget this list" | `{}` | **128** lists after the merge | **per list**: present entries set, `null` entries removed, others untouched |

**The pin bound, measured.** The platform can contribute **80** sidebar entries today: 77
module `nav` declarations (`grep -c "section: '" packages/modules/*/src/admin/index.ts`, summed)
plus the 3 rows the host still declares in `NAV` (`packages/admin-shell/src/components/AppShell.tsx:109-400`).
200 is 2.5× that — "well above … out of reach of real use" (FR-008) — while bounding a stored
value at ≈ 51 KB worst case. Beyond it the request is refused as invalid input (FR-008). There is
**no product limit** (owner ruling (c)): the UI never refuses a pin and never shows a count.

**Strict on write, tolerant on read** (FR-012 vs FR-015). The write schemas above refuse an
unknown key, a wrong shape, a duplicate or an oversized value with `400 VALIDATION_FAILED`. The
**read** schema accepts any string array / boolean / integer map, because a value valid when it
was written can stop being understood later (a retired section, a removed page-size option, a
route an upgrade retired); the server then returns it as stored, the Admin UI ignores what it
does not understand, and nothing rewrites it merely because it was read. A stored row whose
`jsonb` does not even parse as the read shape is served as the default and logged, and is left
in place.

**Why group keys and list ids are bounded tokens rather than enums.** The server cannot
enumerate them honestly: destinations and list ids are contributed by modules at build time of
the admin (`AdminNavDeclarationSchema`, the nine `usePageSizePreference(scope)` call sites), and
a closed server-side enum of section names (`AdminNavSectionNameSchema`, `:93-110`) would turn
every admin/backend version skew during a deploy into a refused save. "Closed" in FR-012 is the
set of **preferences**; each one's inner tokens are bounded in length, pattern and count. The
group key admits the 13 section names plus `pinned` (`ADMIN_PINNED_GROUP_KEY`), which is **not**
added to `AdminNavSectionNameSchema` — that would let a module contribute a nav entry into the
Pinned section.

**Page-size options move to contracts.** `PAGE_SIZE_OPTIONS` is today declared in
`packages/admin-kit/src/lib/page-size-options.ts`; the server must validate against the same
list, and `contracts` cannot import the kit. The array moves to
`packages/contracts/src/admin-preferences.ts` as `ADMIN_LIST_PAGE_SIZE_OPTIONS`, and the kit's
file re-exports it as `PAGE_SIZE_OPTIONS` — one array, the kit's existing name and identity
preserved for its nine callers and `admin/test/kit/admin-kit-identity.test.ts`.

**Alternatives rejected.** A `PUT` per key with a free-form `jsonb` value validated by a
per-key schema map (the same validation with a weaker static type); a product cap on pins
(owner ruling (c)); a bound equal to today's entry count (an overlay or a new module would hit
it); enum-validated group keys (version-skew refusals, above).

---

## R-3 — The HTTP API (decision 2)

**Decision.** Three routes, registered by `admin_users` beside `GET /api/v1/admin/me` in
`packages/modules/admin_users/src/backend/routes.admin.ts` (or a sibling
`routes.preferences.ts` the same plugin registers — the developer's choice; both go through
`ctx.routes`):

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `GET` | `/api/v1/admin/me/preferences` | — | `{ data: AdminPreferences }` |
| `PATCH` | `/api/v1/admin/me/preferences` | `AdminPreferencesPatch` — a **strict** partial object, at least one key | `{ data: AdminPreferences }` |
| `POST` | `/api/v1/admin/me/preferences/legacy-import` | `{ listPageSizes: Record<listId, size> }`, strict, 1–128 entries | `{ data: AdminPreferences }` |

- **Self-service only.** The subject is `resolveAdminContext(request).adminUserId`
  (`routes.admin.ts:93-120`, the `/admin/me` pattern). No route takes an admin id in its path,
  query or body, so no request can name another admin and no permission — the wildcard included
  — reaches anyone else's (FR-011). There is nothing to return `403`/`404` for.
- **No new permission code** (FR-011, FR-024). The gate is `requireAdmin()` — a session and no
  code — as on `PATCH /api/v1/admin/me` and `PATCH /api/v1/admin/me/preferred-language`. Each of
  the three routes therefore gets an entry, `guard: 'session'`, with its reason, in
  `PERMISSIONLESS_ADMIN_ROUTES` (`backend/test/helpers/permissionless-admin-routes.ts:96-110`);
  the static sweep and `contract/admin_users/permissionless-admin-routes.runtime.test.ts` both
  fail without it. A role-less administrator can keep preferences (spec edge case), which is
  what that list's `session` guard means.
- **Error codes: none new.** Refusals are the platform's own: `401` with no session, `400
  VALIDATION_FAILED` for any schema failure — unknown key, wrong shape, duplicate, beyond a
  bound — with the issue path in `error.details`. `errors.VALIDATION_FAILED` is already
  translated in both languages (`packages/modules/_i18n/i18n/en.json:530`, `pl.json:530`), and
  the guard runs before validation (`packages/platform/src/http/guards-before-validation.ts`),
  so an anonymous probe gets `401`, never `400`.
- **`PATCH` semantics.** Each key present is written in one transaction; `sidebar*` keys
  replace their whole value; `listPageSizes` merges per list under a row lock (`insert … on
  conflict do nothing`, then `select … for update`, then compute and check the 128 bound, then
  update), so two devices choosing sizes on two different lists do not erase each other. Both
  statements go through the transaction's own connection (`tx.execute`), never `getKnex()`
  (`check:transaction-context`).
- **`legacy-import` semantics: insert-if-absent per list, server value wins.** Same lock, the
  merge is `{ ...imported, ...stored }`. Idempotent: a repeat, a reload mid-import and two tabs
  at once all converge on one value per list, and a value the admin set on the server is never
  overwritten (FR-022, FR-023). It is a distinct route rather than a `PATCH` flag because its
  contract — *never overwrites* — is the opposite of `PATCH`'s and is tested as such.
- **Every response is the full document**, defaults filled, so a client can reconcile; the
  client applies from a write's response **only the keys it wrote** (R-6).

**Alternatives rejected.**

| Alternative | Why rejected |
| --- | --- |
| `PUT /api/v1/admin/me/preferences/:key` per key | Four routes' worth of permissionless entries and a path parameter the server must still validate against the closed set; a strict `PATCH` body expresses the same thing with one schema (FR-012's "unknown preference" is then an unrecognised key in a strict object). |
| `/api/v1/admin/admin-users/:id/preferences` | Puts an admin id on the wire, the exact thing FR-011 forbids; `admin_users:manage` would then be a question to answer. |
| Optimistic concurrency (`If-Match` / version per key, `409` on a stale write) | The spec rules last-write-wins per preference and calls merging not worth its cost; a `409` would need a UI the spec does not have. |
| A specific `ADMIN_PREFERENCE_*` error code | Nothing for a consumer to branch on beyond "invalid input"; minting one is a manifest entry, a `MINTED_ERROR_CODES` ledger line and two bundle sentences for a refusal only a non-UI caller can trigger (the Admin UI never sends an invalid value). |
| Client-side "write only where the server has nothing" for the carry-over | Read-then-write from the client has a window in which a value set on another device is overwritten — FR-023 says *never*. |

---

## R-4 — No Command Bus, no audit (decision 2, Principle XIII)

**Decision.** Preference writes do **not** run through `CommandBus.run` and write no audit entry
(FR-020). Each writing method of the new service carries
`// command-coverage-ignore: per-admin Admin UI preference — personal UI setting, not an audited domain-state mutation`.

**Rationale.** Principle XIII binds *sensitive mutations — a create / update / delete of a domain
record*. A preference changes nothing another admin sees and no business record; the spec
records the call in *Assumptions — No audit trail*. Three in-tree precedents take the same
exemption with the same marker: `AdminUserService.setPreferredLanguage`
(`packages/modules/admin_users/src/backend/services/admin-user-service.ts:633-645`),
`ProductEditorPreferencesService.upsert`
(`packages/modules/catalog/src/backend/services/product-editor-preferences.service.ts`), and
the saved-view writes of `specs/147-saved-views/` (its plan's Constitution Check, XIII row).
`check:command-coverage -- --strict` keeps the marker honest in both directions (a marker on a
method that no longer writes is `stale-ignore`, `packages/cli/src/rules/command-coverage.ts`
header). The contract test asserts that a `PATCH` leaves `audit_log_entries` untouched, so the
exemption is a tested property rather than an omission.

**Alternatives rejected.** A non-reversible `admin_user.preferences.update` Command — an audit
row on every group fold and every page-size change would bury the entries the audit log exists
for, and an "undo my sidebar" has no operator meaning.

---

## R-5 — Preferences arrive with the identity (decision 3)

**Decision.**

- **`GET /api/v1/admin/me` gains `preferences: AdminPreferences | null`** (contract:
  `adminMeResponseSchema` in `packages/contracts/src/admin.ts:51-57`; kit type `AdminMe` in
  `packages/admin-kit/src/lib/auth.tsx`, field optional so an older backend is tolerated).
- `null` means *the server could not read them*: the handler reads them through the new service
  in its own `try`, logs at `warn` and answers `null` rather than failing the sign-in probe.
  An absent field (older backend) is treated the same way. Either state is the client's
  **unavailable** mode (R-6, FR-018).
- `GET /api/v1/admin/me/preferences` is the refetch path (foreground, reconnect, retry).

**Rationale.**

1. *FR-016 asks for exactly this:* "available at the same point the signed-in admin's identity
   and permissions are". `/admin/me` is the one request the shell waits for before it renders
   anything (`packages/admin-shell/src/App.tsx:159-165` renders a loading screen while
   `status === 'loading'`; `AuthProvider.refresh` sets `authenticated` only when it resolves,
   `packages/admin-kit/src/lib/auth.tsx`). Riding on it means the sidebar's first render
   already has the pins, the folded groups and the rail state — zero layout shifts (SC-003) by
   construction, not by a skeleton.
2. *Precedent.* `idleLogoutMinutes` travels on `/admin/me` for the same kind of reason — a
   per-session value every admin needs, whatever their role (`packages/contracts/src/admin.ts:38-50`).
3. *Sign-in never depends on a convenience.* A failing preference read must not stop an admin
   signing in (FR-018: "the Admin UI still opens, with the defaults"). The `try` is around this
   module's **own** service, not a port, so `check:port-catches` is not engaged and there is no
   `ModuleDisabledError` to rethrow.
4. *The login path is covered too:* `login` and `verifyMfa` both end in `refresh()`, i.e. in
   `/admin/me` (`auth.tsx`, `login`/`verifyMfa`).

**Alternatives rejected.**

| Alternative | Why rejected |
| --- | --- |
| A second request at boot (`/me` then `/me/preferences`) | Either the shell waits for two round trips before first paint, or it paints with defaults and re-arranges — the exact failure FR-016 and SC-003 name. |
| Put them on the login response | A reload does not log in; `/admin/me` is the path every load takes. |
| Cache the last-known preferences in `localStorage` for first paint | FR-010 forbids browser storage as the source of truth, SC-004 searches for it, and on a shared browser it would paint the previous admin's layout for one frame — the leak ruling (d) exists to prevent. |
| Fail `/admin/me` when the preference read fails | Makes a UI preference a sign-in dependency, contradicting FR-018. |

---

## R-6 — The client store: where it lives and how it writes (decision 4)

**Decision.** A preferences store in **`@endora-commerce/admin-kit/lib`**, directory
`packages/admin-kit/src/lib/admin-preferences/`, **mounted by `AuthProvider` itself** around its
children while `status === 'authenticated'`, keyed by `me.adminUser.id` and seeded from
`me.preferences`. Public surface (contract: [contracts/admin-preferences-client.md](./contracts/admin-preferences-client.md)):

- `useAdminPreference(key)` → `[value, setValue]` for the three sidebar keys;
- `usePageSizePreference(scope)` — **same signature and return as today**, re-implemented over
  the store;
- `useAdminPreferencesStatus()` → `{ availability: 'available' | 'unavailable', unsavedNotice: boolean, dismissNotice() }`
  for the shell's save-failure notice.

Write protocol:

1. **Optimistic.** `setValue` updates the store synchronously; the UI re-renders before any
   request (FR-017, Doherty).
2. **One in flight per key, latest pending coalesced.** A key with a request in flight records
   only its newest value as *pending*; when the request settles, the pending value (if any) is
   sent next. The server therefore never ends holding an older value than the UI shows, however
   fast the admin clicks (FR-017's last sentence), and no request is ever sent out of order.
   No debounce timer: coalescing gives the same request economy without delaying a save the
   tab might not live to send.
3. **Failure keeps the value.** A failed write leaves the local value in place, marks the key
   *unsaved* and raises the notice **once per failure episode** (cleared by the next success).
   The notice is a non-blocking, dismissible kit `Alert` the shell renders below the top bar,
   announced through a polite live region; no dialog (FR-017, spec edge case).
4. **Retry** the latest value of every unsaved key on `window` `online`, on
   `visibilitychange` → `visible`, and on the next change of that key (FR-017).
5. **Refetch on foreground.** On `visibilitychange` → `visible` (which is what a PWA resumed
   from the background fires), `GET /me/preferences`; adopt the server's value for every key
   that is **not** in flight, pending or unsaved locally; keep the local value for those that
   are (FR-019). A refetch already in flight is not duplicated. A write's response updates only
   the key that write sent, for the same reason.
6. **Last write wins** across sessions, by the server's upsert; no version check (R-3).
7. **Unavailable mode** (FR-018) — entered when `me.preferences` is `null`/absent: the store
   holds the defaults, **sends nothing**, and records the admin's changes as **deltas** — pins
   added (in order) and removed, groups folded and unfolded, the last rail value, each list's
   last size. It retries the load on `online`, on foreground and on the next change; on the
   first success it applies the deltas onto the loaded values, writes **only the keys the admin
   touched**, and becomes available. Defaults are therefore never saved over stored values,
   and a pin made while unavailable is added to — not substituted for — the stored list.
   (A session **seeded** through `AuthProvider`'s `initial` prop without the field is the one
   exception: a test chose it, so it starts available with the defaults — client contract §1.)
8. **Another admin, another store.** The provider is keyed by admin id, so a sign-out → sign-in
   as someone else remounts it with nothing carried over (US1 AS-7). A new `me` for the **same**
   admin (any later `refresh()`) is treated as a refetch result under rule 5.

**Rationale.**

1. *It has to be the kit.* `usePageSizePreference` is the kit's
   (`packages/admin-kit/src/lib/use-page-size-preference.ts`), the kit's own
   `ProductBrowserDialog` calls it (`packages/admin-kit/src/components/product-browser/ProductBrowserDialog.tsx:128`),
   and eight module pages import it from the kit; the kit cannot import `admin-shell`. One store
   for all four keys means one write protocol and one notice.
2. *Mounting inside `AuthProvider` makes FR-016 structural.* Preferences exist exactly when
   identity does, and every test or host that seeds `<AuthProvider initial={…}>` — the seam the
   kit already publishes for tests (`auth.tsx`, `AuthProviderProps.initial`) — gets a working
   store with no second provider to remember. A separate provider mounted in `App` would be a
   second place availability could diverge from identity, and every admin test rendering a list
   page would need it added.
3. *The kit may call `admin_users`' `/me/*` routes.* It already does — `AuthProvider` reads
   `/api/v1/admin/me` and `language-storage.ts` writes `/api/v1/admin/me/preferred-language`
   (`packages/admin-kit/src/i18n/language-storage.ts:46`). These are the platform's
   always-present identity routes (`admin_users` is required to be present, Principle XVII), not
   a switchable module's surface, so this is not the module knowledge R6 of
   `admin-kit-surface.md` refuses. The barrel grows by named exports only (no `export *`).
4. *An open list is never resized under the admin* (spec edge case): `usePageSizePreference`
   still reads its value once, at mount, into local state — as today — so a foreground refetch
   changes what the **next** mount reads, not the list on screen.

**Alternatives rejected.**

| Alternative | Why rejected |
| --- | --- |
| The store in `admin-shell` | The kit's own dialog and the module pages reach the page size through the kit; the shell cannot be imported from the kit. |
| A separate `AdminPreferencesProvider` mounted in `App` | A second mount point whose omission silently degrades persistence in a host or test; availability decoupled from identity. |
| TanStack Query / Zustand / SWR | A new runtime dependency (Principle IV) for one document and four keys. |
| A debounce (e.g. 500 ms) instead of a per-key queue | Delays every save, loses the last change if the tab closes inside the window, and still needs ordering for slow responses. |
| `BroadcastChannel` / `storage` events to sync tabs live | Live sync is out of scope (spec, FR-019); foreground refetch covers the PWA case. |
| In unavailable mode, save the local value of a touched key verbatim | A pin made while unavailable would replace the admin's stored pins with a one-element list — "saving defaults" by another name. Deltas avoid it. |

---

## R-7 — The Pinned section in the shell (decision 4, UI)

**Decision.**

- **Pure resolution, one predicate.** `packages/admin-shell/src/lib/pinned-entries.ts` exports
  `resolvePinnedEntries(pins, composedNav, isVisible)`, which walks the stored destinations in
  order and, for each, takes the **first visible** composed entry with that `to` — the *same*
  `NavItem` objects and the *same* `useSurfaceVisibility()` predicate the sections render with
  (`AppShell.tsx:1257`). A destination with no visible entry (permission withdrawn, module off
  or unavailable, route retired) yields nothing — no placeholder, no count (FR-006, US2). It
  returns, per pin, the item, its source section key (for the accessible description) and the
  `end` flag the original row computes (`AppShell.tsx` `hasNestedSibling`), so active state is
  identical to the original's (FR-003, US1 AS-8).
- **Pin operations** in the same file: `pinDestination` (append if absent, FR-007),
  `unpinDestination`, and `reorderVisiblePins(pins, visibleOrder)` — **slot-preserving**: hidden
  pins keep their absolute positions and the visible pins are written into the remaining slots
  in their new order, so hidden pins keep a stable place relative to each other and reappear
  where they were (FR-009, US4 AS-4, US2 AS-3).
- **Components** (new files, keeping the 2113-line `AppShell.tsx` from growing a further
  section): `packages/admin-shell/src/components/sidebar/PinnedSection.tsx` (expanded and drawer
  rendering, reuses `.b2b-sidebar__group` / `.b2b-nav-item` / the collapse button with group key
  `pinned`), `sidebar/PinToggleButton.tsx` (the pin/unpin icon button), and a `pinned` variant
  of the existing `RailSection` (first rail entry, lucide `Pin` icon, the same hover/click
  popover, an unpin control per row) (FR-002, US1 AS-9).
- **The pin control** is a real `<button type="button" aria-pressed>` placed **after** the link
  inside the row — never inside it — with an accessible name from core keys ("Pin Orders" /
  "Unpin Orders"), visually revealed on row `:hover` and `:focus-within`, always visible with a
  ≥ 44 × 44 px target on the mobile drawer and on `(pointer: coarse)` (FR-004, Fitts). It is in
  the Tab sequence directly after its link; see § *Readings* item 1.
- **Reorder** uses the kit's `useReorderList` + `TouchReorderButtons` + `ReorderAnnouncer`
  (`packages/admin-kit/src/components/reorder/useReorderList.ts`, exported from
  `@endora-commerce/admin-kit/components`), applied to the **visible** pins in the expanded
  sidebar and the drawer, with `onReorder` feeding `reorderVisiblePins`. That one primitive
  already provides pointer drag, the keyboard grab-mode map, the touch up/down buttons and the
  polite announcements ("Orders, position 1 of 6"), with focus kept on the moved row (FR-009,
  US4 AS-2, WCAG 2.2 SC 2.5.7). Reorder is not offered in the rail popover (FR-009 asks for the
  expanded sidebar; FR-004 asks the popover only for unpin).
- **Announcements** for pin and unpin go through one polite live region owned by
  `PinnedSection`, in the admin's language (FR-005).
- **Pinning never adds a palette entry or group** (FR-024): the palette's sources — the
  Navigate rows, the server's Actions, records, the assistant row — are untouched; the palette
  only gains a control beside results that already exist (R-15).

**Rationale.** Principle IX — every visual element already exists (section, item, rail popover,
icon button, reorder primitive); the only new composite is the Pinned section itself, a pattern
the shell does not have. Using the shell's own composed `NavItem`s and predicate is what makes
SC-006 a property of construction: a pin cannot be visible when its original is not, because it
*is* the original's object filtered by the original's predicate.

**Alternatives rejected.**

| Alternative | Why rejected |
| --- | --- |
| `@dnd-kit/core` (named in the spec's *Assumptions*) | The kit's `useReorderList` is the repo's shared, already-accessible reorder primitive (feature 067) and needs no dependency at all; `@dnd-kit` in the kit serves the Kanban board. The spec's assumption was "no new runtime dependency", which both satisfy. |
| Storing label/icon/permission with the pin | FR-003 and the spec's *Pin* definition: resolved at render; a stored permission would be a second, stale visibility answer. |
| A separate predicate for pins | Issue #230's lesson recorded in `AppShell.tsx:1250-1256`: one predicate for every surface. |
| Pin control inside the `NavLink` | A button inside a link is invalid interactive nesting and would make activating the pin navigate. |
| Shift-free "move pin" by drag only | Fails WCAG 2.2 SC 2.5.7 and FR-009. |

---

## R-8 — Collapsed groups and rail mode move onto the store (decision 4)

**Decision.** `AppShell` replaces `loadCollapsed`/`persistCollapsed` and
`loadRailMode`/`persistRailMode` (`AppShell.tsx:401-450`, `:1071-1072`, `:1082-1088`,
`:1110-1118`) with `useAdminPreference('sidebarCollapsedGroups')` and
`useAdminPreference('sidebarRailMode')`; both `STORAGE_KEY` constants are deleted. Unknown group
keys in the stored set are ignored at render (a key matching no rendered group folds nothing)
and are not rewritten until the admin folds or unfolds something, when the client writes the
set **it holds** — including tokens it does not recognise, so a newer admin's group survives an
older tab (FR-015). Rail mode keeps having no effect on the mobile tier (`AppShell.tsx:1158`,
`:1174`, FR-013). The Pinned section folds under the key `pinned` like any other group (FR-013).

**Alternatives rejected.** Keeping a `localStorage` mirror for speed (FR-010, SC-004; first paint
is already solved by R-5).

---

## R-9 — List page size on the store (decision 4)

**Decision.** `usePageSizePreference(scope)` keeps its signature
(`{ pageSize, setPageSize }`); it reads `listPageSizes[scope]` at mount, falls back to 20 for an
absent value or one not in `ADMIN_LIST_PAGE_SIZE_OPTIONS` (FR-014, FR-015, US3 AS-7), and
`setPageSize` writes `PATCH { listPageSizes: { [scope]: size } }` through the store. The scopes
stay exactly as the nine call sites name them, so the Product list and the product browser
dialog keep sharing `catalog-products` (FR-014). No list screen changes (spec *Assumptions*).

---

## R-10 — Carrying the browser values over, once (decision 5)

**Decision.** A single module, `packages/admin-kit/src/lib/admin-preferences/legacy-carry-over.ts`,
is the **only** source file allowed to name the three legacy key shapes (SC-004). It runs once
per store mount, right after the store becomes available (and the unkeyed half also when it
does not):

1. **Unkeyed sidebar keys — removed, never imported** (owner ruling (d)): delete
   `b2b-admin.nav.collapsed-groups` and `b2b-admin.nav.rail-mode` from `localStorage` on the first
   authenticated load, whether or not preferences are available. Every admin starts from the
   default layout.
2. **Page sizes — this admin's only.** Enumerate `localStorage` keys matching
   `b2b-admin.page-size.<scope>.<signed-in admin id>` exactly; a key ending in another admin's id
   (or the hook's historical `anon`) is **neither read nor removed** (US3 AS-6).
3. Parse each value; an unreadable value, a size not in the options or a scope not matching the
   list-id pattern is **discarded silently** — removed, not sent (FR-022 last sentence).
4. If anything valid remains, `POST /me/preferences/legacy-import` with the map. The server
   merges insert-if-absent per list (R-3), so a list the server already has keeps the server's
   value (US3 AS-5).
5. **On success only**, remove those keys and adopt the response's `listPageSizes`. On failure,
   leave them for the next load — the import is idempotent, so a retry, a reload mid-import or
   a second tab doing the same thing converges on one value per list (FR-023).
6. Storage access is wrapped as the existing hooks wrap it (`try { … } catch {}`): a browser
   with storage disabled simply has nothing to carry over.

**Rationale.** FR-022/FR-023 and SC-005 verbatim; the server-side merge is what makes "never
overwrite a value the admin set on the server" hold across devices and tabs (R-3). Keeping the
legacy key names in one file is what lets SC-004's repository search be a test with a one-entry
allow-list rather than a judgement.

**Alternatives rejected.** Import the unkeyed values for "whoever signs in first" (ruling (d));
remove page-size keys before the server confirms (a failed import would lose the value, SC-005);
a one-off backend migration (the values live in browsers, not in the database).

---

## R-11 — Translations (FR-025)

**Decision.** Every new string is a `core` key in `packages/modules/_i18n/i18n/{en,pl}.json`
(the bundle the shell's existing `appShell.*` keys live in, e.g. `appShell.sidebarToggle.*` at
`en.json:257-258`): the Pinned heading, pin/unpin/move accessible names, the source-section
description, the four live-region sentences, the reorder labels `useReorderList` takes as
props, and the save-failure notice. The kit's store and notice read only `core` (a kit
component may read nothing else, `specs/147-saved-views/research.md` R-4). `admin_users`' own
bundle gains nothing: its server refusals are the platform's translated `VALIDATION_FAILED`
(R-3). The key list with both languages is in
[contracts/admin-preferences-client.md](./contracts/admin-preferences-client.md) §5.

**Rationale.** `specs/conventions/module-i18n.md`: an HTTP refusal is backend-translated and
ships its code; Admin UI chrome is translated by the consumer from the shipped bundle.
`check:bundle-pairing`, `registered-bundles-shape.test.ts` and `i18n:hardcoded` hold the rest.

---

## R-12 — Tenancy, caching and presence

- **Tenancy (Principle XI, FR-021).** `AdminUserPreference` is `@GlobalEntity()`: admins are
  platform-side users, exactly as `admin_users` rows and saved views are classified
  (`specs/147-saved-views/data-model.md`, *Tenancy classification*). A row holds destinations,
  group keys, list ids and numbers — never business or tenant data — and is read only by its own
  admin through a route that names no id. Held by `check-entity-tenant-classification`. No
  cross-tenant test is owed for a global entity; the cross-**admin** isolation test (R-13) is
  the one that matters here.
- **Cache.** None, so no Redis lifecycle pub/sub to design: the document is read once per load
  plus once per foreground, for one admin (spec *Assumptions*).
- **Settings module.** No configuration is introduced; the pin bound is a contract constant, not
  an operator knob (Principle IV — nobody needs to tune abuse protection set 2.5× above reality).
- **Presence (Principle XVII).** `admin_users` is non-deactivatable, so its new routes have no
  operator-off state; on the platform axis they are gated by `ctx.routes` with the rest of the
  module. What XVII does demand here is that a **pin never outlives its original entry's
  presence**, which R-7 gets by construction and R-13 proves for every combination (SC-006).

---

## R-13 — Tests, mapped to requirements (decision 6, Principle III)

Placement follows `specs/106-module-owned-tests/contracts/module-test-ownership.md` (held by
`check:test-ownership`): a harness-free test naming one module sits beside its subject in that
module's package; a test that composes the server sits under `backend/test/`; admin tests sit
under `admin/test/`. Every test is written first and seen to fail.

| Test file | Kind | Proves |
| --- | --- | --- |
| `packages/contracts/src/admin-preferences.test.ts` | unit (co-located) | FR-007 duplicate refused; FR-008 bound (200 ok, 201 refused); FR-012 unknown key, wrong shape, empty `PATCH`, strict import body; FR-014 options; read schema tolerant of retired tokens (FR-015); options identity with the kit |
| `packages/modules/admin_users/src/backend/services/admin-preference-document.test.ts` | unit (co-located) | pure document assembly: defaults filled; unparsable row → default without rewrite (FR-015); per-list merge and `null` removal; import merge server-wins (FR-022 AS-5); 128-list bound after merge |
| `backend/test/contract/admin_users/me-preferences.test.ts` | contract | GET/PATCH/POST shapes; 401 without session; 400 per FR-012 case with nothing changed; two admins isolated both ways and a wildcard admin cannot reach another's (FR-011, SC-008); role-less admin can write (edge case); `PATCH` writes no `audit_log_entries` row (FR-020); pin order preserved and appended (FR-007, FR-008 last sentence) |
| `backend/test/contract/admin_users/me.test.ts` (extended) | contract | `/admin/me` carries `preferences` with defaults for a new admin and stored values after a `PATCH` (FR-016) |
| `backend/test/integration/admin_users/preferences-persistence.test.ts` | integration (real DB) | last-write-wins per key, independent keys do not clobber; concurrent `PATCH`es of two lists both survive; import idempotent under repeat and under two concurrent imports and never overwrites a stored list (FR-023, SC-008); soft delete / deactivate keep rows, restore returns them; demo withdrawal cascades; `/admin/me` answers `preferences: null` and still 200 when the read fails (FR-018) |
| `backend/test/helpers/permissionless-admin-routes.ts` (+3 entries) with `test/unit/kernel/permissionless-admin-routes.test.ts` and `contract/admin_users/permissionless-admin-routes.runtime.test.ts` | ledger | the three routes are open to a session and nothing else, by decision (FR-011, FR-024) |
| `backend/test/integration/admin_users/off-state.test.ts` (extended) | integration | with `admin_users` platform-unavailable, `GET /me/preferences` answers as every other route of the module (Principle XVII, platform axis) |
| `admin/test/kit/admin-preferences-store.test.tsx` | kit | optimistic apply; per-key queue — five rapid writes end with the last value on the server and no out-of-order request (FR-017); failure keeps value, one notice per episode, retry on `online` / foreground / next change; foreground refetch adopts remote keys and keeps pending ones (FR-019); unavailable mode sends nothing, replays deltas on recovery and never writes untouched keys (FR-018); remount per admin id (US1 AS-7) |
| `admin/test/kit/admin-preferences-carry-over.test.tsx` | kit | FR-022 / FR-023 / SC-005 / US3 AS-4–AS-6: own page sizes imported then removed; other admin's and `anon` left; server value wins; unkeyed keys removed, not imported, even when unavailable; failure keeps keys; idempotent on re-run |
| `admin/test/kit/session-cluster.test.tsx` (page-size cases rewritten) | kit | FR-014, US3 AS-3/AS-7/AS-8: per-list value from the server, default 20, invalid stored size → 20, shared `catalog-products`, an open list not resized by a refetch |
| `admin/test/kit/no-legacy-layout-storage.test.ts` | static | SC-004: no source under `packages/admin-kit/src`, `packages/admin-shell/src`, `packages/modules/*/src/admin` or `admin/src` names the three legacy keys except `legacy-carry-over.ts` (precedent: `admin/test/components/saved-views-no-native-dialogs.test.ts`) |
| `admin/test/unit/pinned-entries.test.ts` | unit | `visibleDestinations` (first visible entry per destination; hidden entries absent — the one map the Pinned section and the palette both read, FR-006, FR-027), `resolvePinnedEntries` (hidden and retired yield nothing; `end` flag copied), `pinDestination` append/no-dup, `unpinDestination`, `reorderVisiblePins` slot preservation (FR-006, FR-007, FR-009) |
| `admin/test/components/AppShell.pinned.test.tsx` | component | US1 AS-1–AS-5, AS-8, AS-10–AS-12; FR-001–FR-005; no palette entry or group added (FR-024); 11+ pins all reachable (AS-11) |
| `admin/test/components/AppShell.palette-pinning.test.tsx` | component | FR-027, US1 AS-13–AS-15 — see R-16's test list: control on a Navigate row **and** on a server Action (`open-orders`-shaped, `useAdminActions` stubbed) whose destination is a visible entry; none on a record, a create action, the assistant row, "see all", or a destination whose module is off or whose permission is withdrawn; click pins without navigating or closing and the row's control flips; the pin appears at the end of the Pinned section at once; `Alt+Enter` toggles the highlighted row and never navigates; `Enter` still navigates; `Alt+Enter` on a row without the control does nothing; the announcement lands in the palette's own live region; the item count of every palette group is unchanged (FR-024) |
| `admin/test/components/AppShell.palette.test.tsx`, `.palette-records.test.tsx`, `.palette-diacritics.test.tsx` (existing) | component | regression: `Enter`, arrows, `Escape`, mouse activation and records behave as before |
| `admin/test/components/AppShell.pinned-visibility.test.tsx` | component | US2 AS-1–AS-5 and SC-006: the full matrix — permission withdrawn × operator-off × platform-unavailable — in expanded, rail popover and mobile drawer; no count, placeholder or text naming a hidden pin; restored at its old position |
| `admin/test/components/AppShell.pinned-reorder.test.tsx` | component | US4 AS-1–AS-4, FR-009: drag, keyboard grab-mode and touch buttons; focus stays; announcement text; hidden pins keep their slots |
| `admin/test/components/AppShell.layout-preferences.test.tsx` | component | US3 AS-1/AS-2/AS-8, FR-013, FR-016, SC-003: first render already folded / in rail / pinned, and the DOM does not change after effects settle; rail ignored on mobile; a fold writes the server, not `localStorage` |
| `admin/test/components/AppShell.pinned.a11y.test.tsx` | a11y | SC-007: `admin/test/helpers/axe.ts` over the sidebar with pins, expanded and rail, and over the open palette with a pinnable result, no WCAG 2.2 AA violation |
| `backend/test/unit/_i18n/registered-bundles-shape.test.ts` (existing) + a key-list case in `AppShell.pinned.test.tsx` rendering in `pl` | i18n | SC-009, FR-025: every new key resolves in both languages, none renders raw |

Every component test renders inside `<StrictMode>` (the 147 practice) so the per-key queue and
the carry-over are proved idempotent under double mount. **Merge-request pipelines do not run
the contract and integration trees (D-198)**: the last phase runs them locally.

---

## R-14 — Documentation and release intent (decision 7)

**Documentation.** `packages/modules/admin_users/docs/admin_users.md` gains a section
*Admin UI preferences* with two audiences (FR-026): for operators — pin, unpin, reorder (pointer,
keyboard, touch), pinning from the command palette (the control beside a result, and
`Alt+Enter` on the highlighted one), preferences follow you across devices and the PWA, a hidden pin comes back with
access, the one-time carry-over and the default layout after upgrade; for engineers — the closed
key set and bounds, `usePageSizePreference(scope)` and how a new list gets a remembered size
(pick a scope id, nothing else), the three routes, and why there is no audit trail. Polish: the
materialised `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/admin_users.md` and its
cache entry under `docs/translation-cache/pl/` in the same merge request, then
`pnpm --filter backend run check:docs-translations`
(`specs/conventions/module-documentation.md`, *Polish translations*;
`docs/docs/contributing/documentation-i18n.md`). The kit README's `./lib` row
(`packages/admin-kit/README.md:14`) gains the preferences hooks. No link to a sibling module's
page or the site tree (`check:module-docs`).

**Changesets** (`specs/conventions/release-intent.md`; every bump `minor`, the estate being
`0.x`; one file per meaning):

| File | Packages | Meaning, for the consumer |
| --- | --- | --- |
| `.changeset/164-admin-preferences-contract.md` | `@endora-commerce/contracts` | New `admin-preferences` exports (`ADMIN_PREFERENCE_KEYS`, the write and read schemas, `ADMIN_LIST_PAGE_SIZE_OPTIONS`, the bounds); `adminMeResponseSchema` gains `preferences` (nullable) |
| `.changeset/164-admin-preferences-server.md` | `@endora-commerce/mod-admin-users` | New table and the three `/api/v1/admin/me/preferences` routes; `/admin/me` carries the admin's preferences |
| `.changeset/164-admin-preferences-client.md` | `@endora-commerce/admin-kit`, `@endora-commerce/admin-shell`, `@endora-commerce/mod-i18n` | `useAdminPreference`, `useAdminPreferencesStatus`; `usePageSizePreference` now server-backed with the same signature; the Pinned sidebar section and the palette's pin control; collapsed groups and rail mode server-held; the one-time carry-over and what it removes; new `core` strings |

---

## R-15 — How the palette learns which results are pinnable (FR-027, ruling (e))

**Decision.**

- **One map, computed once in `AppShell`, read by both consumers.** A pure helper in
  `packages/admin-shell/src/lib/pinned-entries.ts`,
  `visibleDestinations(sections, isVisible): ReadonlyMap<string, { item: NavItem; sectionKey: string; end: boolean }>`,
  walks `composedNav` in section order and keeps the **first visible** entry per destination,
  using the same `useSurfaceVisibility()` predicate the sidebar renders with
  (`AppShell.tsx:1257`). `AppShell` memoises it on `(composedNav, isVisible)` and passes it to
  the Pinned section (which `resolvePinnedEntries` now reads through it) and to
  `CommandPalette` as a new prop, `pinTargets`.
- **A palette row is pinnable iff `pinTargets.has(row.to)`** — exact string equality, whichever
  group produced the row: Navigate host rows (`PALETTE_ITEMS`, `AppShell.tsx:903`), server
  Actions (`actionItems`, `to: a.targetRoute`, `:1742-1758`), and in principle a record row or
  any future group whose target equals a visible entry's destination. The assistant sentinel
  (`PROMPT_MODE_SENTINEL`) and "see all" (a path with a query) never match.
- **US1 AS-14's "a create action" holds by measurement, not by a second rule.** No sidebar entry
  today is a create route (`grep "to: '…/new'"` over `packages/modules/*/src/admin/index.ts` and
  `AppShell.tsx` finds none), while ten manifests declare `…/new` palette actions (e.g.
  `packages/modules/crm/src/manifest.ts:366`), so none of them matches. If a module ever
  contributed a sidebar entry whose destination is a create route, FR-027's destination-only
  rule would offer the control on that action too; the test pins the measured fact with a real
  create action (`/crm/opportunities/new`) rather than with a hand-made exclusion list.
- **The control's accessible name and the announcement use the sidebar entry's label**
  (`navLabel(pinTargets.get(to).item)`), not the palette row's — an Action labelled "Open
  orders" pins *Orders*, which is what then appears in the Pinned section (FR-027: "MUST name the
  entry and the action").
- **The write path is the sidebar's.** A shell hook `usePinActions()` (in
  `components/sidebar/use-pin-actions.ts`) wraps `useAdminPreference('sidebarPins')` with
  `pinDestination` / `unpinDestination` and returns `{ isPinned(d), toggle(d) }`; the sidebar
  controls and the palette control both call it — same store, same optimistic write, same
  append-at-end (FR-007, FR-027).

**Rationale.** Both `CommandPalette` and the composed nav live in `AppShell.tsx`, and
`CommandPalette` is rendered by `AppShell` (`:1480`), so a prop is the shortest honest seam. The
map is the one answer to "which destinations may this admin see in the sidebar right now"; a
palette row borrowing it cannot offer a hidden surface (FR-027's last sentence, FR-006), because
hidden entries are never in it. Deciding by the **sidebar's** visibility rather than the palette
row's own gating is what FR-027 asks for ("the destination of a visible entry of the sidebar")
and it means a server Action that the server's own filter let through but whose destination the
sidebar hides still gets no control.

**Alternatives rejected.**

| Alternative | Why rejected |
| --- | --- |
| `CommandPalette` calls `useComposedNav()` and `useSurfaceVisibility()` itself | Two derivations of one answer in one file — the drift issue #230 removed (`AppShell.tsx:1250-1256`); it would also compose the nav a second time per open. |
| A React context for the map | A context for one parent and two children in the same file; a prop is visible where it is used. |
| Match by prefix (`/orders/123` → `/orders`) | Would put a pin control on record rows that do not open the entry; FR-027 says the result's destination **is** the entry's destination. |
| Mark pinnable rows on the server (`module_actions` gaining a flag) | The server does not know the admin's composed sidebar; pinnability is a client fact. |
| The palette writes the store directly with its own pin/unpin logic | A second copy of FR-007's append rule. |

---

## R-16 — The palette's keyboard model for a secondary control (FR-027, US1 AS-15)

**Facts.** The palette keeps DOM focus in its search input and drives a highlight with a
`window` `keydown` listener: `ArrowUp`/`ArrowDown` move `cursor`, `Enter` activates
`items[cursor]`, `Escape` closes (`AppShell.tsx:1919-1937`). Rows are plain `div`s with
`onMouseEnter` and `onClick` (`renderRow`, `:1970-1990`) — no `role="listbox"`/`option`, no
`aria-activedescendant`. A live region for record results already sits inside the dialog
(`:2019`).

**Decision.**

- **Keyboard: a chord on the highlighted row, focus never leaves the input.** `Alt+Enter`
  (`⌥↵` on macOS) toggles the pin of `items[cursor]` when that row is pinnable and does nothing
  otherwise; it never navigates and never closes the palette. The `Enter` branch of the existing
  handler is narrowed to `e.key === 'Enter' && !e.altKey`, so plain `Enter` keeps opening the
  destination exactly as today (US1 AS-15). `preventDefault` on the chord, so nothing is typed
  into the input.
- **Discoverable, not hidden.** The highlighted pinnable row shows a key hint beside the existing
  `↵` chip (`⌥↵ Pin` / `⌥↵ Unpin`, from core keys); the pin button carries
  `aria-keyshortcuts="Alt+Enter"`; the input gains `aria-describedby` → a visually-hidden
  sentence "Alt+Enter pins or unpins the highlighted result" (core key) — the input is where a
  keyboard or screen-reader user is.
- **Pointer and touch: a real button beside the result.** `<button type="button" tabIndex={-1}
  aria-pressed={pinned} aria-label="Pin Orders" aria-keyshortcuts="Alt+Enter">` with the
  lucide `Pin` / `PinOff` icon, rendered on every pinnable row (not only the highlighted one, so
  the state is visible while scanning), ≥ 44 × 44 px under `(pointer: coarse)` (Fitts).
  `onClick` calls `event.stopPropagation()` so the row's `activate` does not fire;
  `onMouseDown` prevents default so focus stays in the input. It is out of the Tab sequence
  because Tab from the input would otherwise leave the input for a row control and break typing;
  its keyboard equivalent is the chord (WCAG 2.1.1 is about the function being keyboard
  operable, which the chord provides with the input keeping focus).
- **Announcement inside the dialog.** A second polite live region, mounted inside the palette
  before it has text, receives "Orders pinned" / "Orders unpinned" (the same core keys as the
  sidebar). The sidebar's own region cannot be used: the palette is `aria-modal="true"`
  (`:1997`), so assistive technology ignores content outside it.

**Rationale.** The WAI-ARIA combobox pattern keeps focus in the input and moves a virtual
highlight; an `option` may not contain interactive descendants (its children are
presentational), so the standard way to offer a second action on the active option is a key
binding on the input — the convention of command palettes that offer an alternate action on
the highlighted result with a modified `Enter`. `Alt+Enter` is unbound in the palette, types no
character on any platform, and is not a browser shortcut inside a page. UX laws
(`.claude/skills/ux-laws/SKILL.md` §4): keyboard reachable, icon-only control carries
`aria-label`, status in a live region mounted before it has text; §2 Fitts for the touch target;
Jakob's law for the palette convention.

**Alternatives rejected.**

| Alternative | Why rejected |
| --- | --- |
| Tab-reachable pin buttons in the rows | Tab leaves the input; the user can no longer type a refinement without returning, and the window `keydown` listener would then treat `Enter` on the focused button as "open the highlighted row" as well — two actions for one key. |
| `ArrowRight` moves a "focus" onto the row's control, `Enter` there toggles | A two-level virtual focus inside a list that has no ARIA semantics yet; `ArrowRight` is also the caret key in the input. |
| `Ctrl/⌘+P`, `Ctrl+Shift+P` | Print, and private window in Firefox. |
| `Shift+Enter` | Commonly "open in new tab/window"-like in launchers, and today it already opens the row (the handler ignores modifiers), so it would change an existing behaviour. |
| Add `role="listbox"`/`option` + `aria-activedescendant` in this feature | A repair of the whole palette FR-027 does not ask for; recorded as a follow-up (§ *Readings* item 6). |

**Tests (FR-027).** `admin/test/components/AppShell.palette-pinning.test.tsx` (listed in R-13),
`admin/test/unit/pinned-entries.test.ts` (`visibleDestinations`), the palette case in
`AppShell.pinned.a11y.test.tsx`, and the existing palette suites as regression. Every case renders
in `<StrictMode>`; pins are seeded through `AuthProvider initial.preferences`.

---

## Readings — owner rulings (2026-10-27)

Each item below was a reading of the spec the design implements rather than an explicit
sentence. The owner accepted every default reading on **2026-10-27**; they are binding owner
rulings from that date and nothing here is open. Items 1, 5 and 6 were ruled explicitly; the
others were confirmed as written.

1. **FR-004 "MUST NOT change keyboard order or focus of the sidebar links when not in use" —
   ruled: one extra Tab stop per sidebar entry.** The links keep their order, and focus is never
   moved or trapped by the control. The pin button is in the Tab sequence directly after its
   link (as in GitLab), which adds one Tab stop per entry. The alternative — pin buttons out of
   the Tab order with a keyboard shortcut on the focused link — keeps the stop count but makes
   pinning undiscoverable by keyboard and hard to meet SC-007 with; rejected.
2. **Changes made while preferences are unavailable (FR-018) — confirmed as written.** The spec
   says defaults are never saved; a change the admin makes in that state is replayed as a delta
   once loading succeeds (R-6 rule 7).
3. **`@dnd-kit` in the spec's *Assumptions* — confirmed as written.** The plan uses the kit's
   dependency-free `useReorderList` instead (R-7). No FR is affected.
4. **List ids are an open, bounded vocabulary — confirmed as written.** FR-012's closed set is
   the set of preferences; the lists inside `listPageSizes` are named by whichever list asks
   (R-2).
5. **FR-027's keyboard binding — ruled: `Alt+Enter`** (`⌥↵` on macOS) on the highlighted
   palette row, advertised on the row and through `aria-keyshortcuts` and the input's
   description. The palette keeps focus in its search input and has no listbox/option semantics
   today, so a Tab-reachable button inside a row is not available without moving focus out of
   the input (R-16). `Enter` keeps opening the destination.
6. **The palette's missing ARIA semantics — ruled: out of scope, a follow-up.** No
   `role="listbox"`/`option` and no `aria-activedescendant` (`AppShell.tsx` `renderRow`) predate
   this feature and mean a screen reader does not hear which row is highlighted. FR-027 does not
   ask for that repair and this feature does not make it; it is a follow-up candidate, since it
   limits how well the palette's pin control (and the palette as a whole) can be used without
   sight.
7. **The spec's status line — resolved.** `spec.md` reads "Approved by the owner 2026-10-27
   (rulings (a)–(e))"; nothing remains to update.

---

## Implementation notes — mechanical deviations (recorded during `/speckit.implement`)

Small deviations from the letter of the plan and contracts, made while implementing; none
changes a requirement, a contract shape or an owner ruling.

1. **The preferences provider is not keyed by admin id; it creates one store per admin id.**
   Client contract §1 says `AuthProvider` mounts `AdminPreferencesProvider` "while
   authenticated, `key={me.adminUser.id}`". A keyed element that appears only once signed in
   changes the element tree above the whole application on sign-in, remounting everything
   beneath `AuthProvider`. The provider is therefore always mounted and builds its store with
   `useMemo(…, [adminUserId])`: a different admin is still a different store with nothing
   carried over (US1 AS-7, proved in `admin/test/kit/admin-preferences-store.test.tsx`), and the
   tree beneath does not remount.
2. **While nobody is signed in, the hooks read the defaults and their setters do nothing**
   (availability `unavailable`); they still throw **outside** an `AuthProvider`, as the contract
   says. Throwing inside one while the boot probe is loading would crash any component rendered
   before sign-in completes.
3. **`AdminPreferenceService` is on `AdminModuleHandle`** (`adminPreferenceService`), still not
   published as a port. T016's FR-018 case spies on its prototype; the in-process server runs
   the package's `dist`, so a spy on the source class would be a spy on a different object.
   The `/admin/me` handler logs an unreadable document through the service's own logger
   (`adminPreferenceService.log`, the module logger), which is what the test observes.
4. **The three routes live in `routes.preferences.ts`**, registered by the same plugin under
   `ctx.routes` — the option R-3 and T020 leave to the developer.
5. **A coalesced `listPageSizes` write may carry several lists.** `wire(listPageSizes)` sends
   only the lists changed since the last successful write — one list per change, as client
   contract §1.1 says, except that changes to two lists made while a write is in flight are
   sent together in the next one. Never the whole map.
6. **The rail form of the Pinned section is not a `role="menu"`.** The other rail fly-outs are
   menus of `menuitem` links; a pinned row holds a link *and* an unpin button, and a menu may hold
   only menu items. The pinned fly-out is therefore a plain group of links and buttons (its
   trigger keeps `aria-expanded`, drops `aria-haspopup="menu"`).
7. **The pinned rows are a `list` of `listitem`s.** `useReorderList` puts `aria-posinset` /
   `aria-setsize` on each row, which axe refuses on an element with no role
   (`aria-allowed-attr`) — found by re-running T031's a11y file with the handles present (T053).
8. **T032's Navigate case pins *Home*.** The palette's Navigate group holds only *Home* on this
   tree; *Orders* reaches the palette as the `orders` module's server Action `open-orders`, which
   is T032's server-Action case. The test exercises both groups as R-15 asks.
9. **Rail mode is computed once as `stored && !mobile`** at the top of `AppShell`; before this
   feature the section loop rendered rail sections from the raw value even on the mobile tier.
   FR-013 is now true of every rail check, and T046 asserts it.
