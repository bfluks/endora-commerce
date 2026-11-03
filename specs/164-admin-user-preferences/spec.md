# Feature Specification: Admin user preferences — pinned sidebar items, and the admin's layout settings kept on the server

**Feature Branch**: `feat/sidebar-pinned-items` (spec directory `specs/164-admin-user-preferences/`)
**Created**: 2026-10-27
**Status**: Approved by the owner 2026-10-27 (rulings (a)–(e)) before `/speckit.plan`
**Input**: owner request (translated from Polish), 2026-10-27:

- *In the Admin UI, let an admin pin any sidebar menu item to the top of the sidebar, like
  GitLab's "Pinned" navigation section, so the items they use most are easier to reach. Pin and
  unpin freely; each admin has their own set.*
- *The settings must be stored in the database, not in the browser: the same admin signs in from
  the mobile app (PWA) and from the desktop and must see the same settings on both.*

Owner rulings already made (2026-10-27):

- **(a)** In this feature, also move to the server the three admin settings that today live only
  in the browser — list page size, collapsed sidebar groups and sidebar rail mode — and carry
  existing browser values into the server once, so nobody loses their setup on upgrade.
- **(b)** Saved list views (`specs/147-saved-views/`) are already server-side per admin and are
  out of scope.
- **(c)** (clarification of FR-008) There is **no product limit** on the number of pins, as in
  GitLab.
- **(e)** (2026-10-27, added after spec approval) Pinning MUST also be possible from the command
  palette (⌘K / CTRL+K): a palette result that opens a sidebar entry's destination — e.g. a search
  for "Zamówienia" / "Orders" — shows a pin / unpin control beside it (FR-027). This supersedes
  the earlier exclusion of palette pinning.
- **(d)** (clarification of FR-022, narrowing (a)) The two sidebar values the browser never keyed
  by admin — collapsed groups and rail mode — are **not** carried over: every admin starts from the
  default layout, so nobody inherits a colleague's layout on a shared browser. Page size, which is
  keyed by admin, is carried over.

## Vocabulary

- **Admin** — a signed-in Admin UI user (an `admin_users` account). Admins are platform-side
  Supplier employees, not tenants of any Organization.
- **Preference** — one remembered choice of one admin about how the Admin UI looks or behaves for
  them. It changes nothing any other admin sees and no business data.
- **Sidebar entry** — one destination row of the Admin UI sidebar, whether the admin shell
  declares it or a module contributes it. Its identity is its **destination** (the admin route it
  opens).
- **Pin** — a sidebar entry an admin has chosen to show again in the **Pinned section** at the
  top of the sidebar. A pin is stored as the entry's destination; the pinned entry keeps the
  label and icon of the sidebar entry it points at.
- **Visible entry** — a sidebar entry the current admin may see right now: the shell's existing
  visibility rule, permission **and** effective module presence (Constitution XVII).
- **Hidden pin** — a stored pin whose destination is not a visible entry right now (permission
  withdrawn, module switched off or not available, module uninstalled, route retired).
- **Rail mode** — the icon-only, narrow sidebar the admin toggles with the collapse button or
  ⌘B / CTRL+B (desktop and tablet only; the mobile drawer is never in rail mode).
- **Collapsed groups** — the labelled sidebar sections the admin has folded shut.
- **List page size** — the number of rows per page an admin chose on a paginated admin list,
  remembered per list.
- **Legacy browser value** — one of the three settings as the browser stored it before this
  feature (see *Current state*).

## Current state (measured on `feat/sidebar-pinned-items` at `2b27fa2dd`, = `origin/master`)

### The sidebar

| Fact | Where |
| --- | --- |
| A sidebar entry is `{ to, labelKey, labelScope?, icon, requiredPermission?, module }`; sections are `{ key, labelKey, items }` with 13 stable section keys (`main`, `sales`, `crm`, `catalog`, `inventory`, `pricing`, `customers`, `channels`, `content`, `messaging`, `newsletter`, `analyticsAds`, `system`) | `packages/admin-shell/src/components/AppShell.tsx:53-105`, `:109-400` |
| The host declares almost no rows itself; modules contribute entries through the admin registry and `composeNav` appends them per section, refusing a section the shell does not declare | same file `:991-1027` (`composeNav`), `:1041-1044` (`useComposedNav`); `packages/contracts/src/admin-contributions.ts:850-866` (`AdminNavDeclarationSchema`: `to` is a leading-slash admin path, max 255, no query string) |
| Every entry is filtered by one shared predicate — permission **and** module presence — before it renders, and a section with no visible entry folds away | `AppShell.tsx:1257`; `packages/admin-kit/src/lib/surface-visibility.ts:79-104` (`isSurfaceVisible`, `useSurfaceVisibility`) |
| In rail mode each section renders as one icon with a hover/click popover of its visible entries; a one-entry section renders as a plain icon link | `AppShell.tsx:1512` (`RailSection`) and below |
| On the mobile tier the sidebar is a drawer, rail mode is ignored and ⌘B does nothing | same file `:1079`, `:1129-1135`, `:1362` |
| **Collapsed groups** are kept in `localStorage` under `b2b-admin.nav.collapsed-groups` (a JSON array of section keys) — **not keyed by admin**, so every admin signing in on one browser shares them | same file `:401`, `:428-450`, `:1071`, `:1110-1118` |
| **Rail mode** is kept in `localStorage` under `b2b-admin.nav.rail-mode` (`'1'` / `'0'`) — **not keyed by admin** | same file `:402`, `:410-426`, `:1072`, `:1082-1088` |
| There is no pinning, favouriting or reordering of sidebar entries anywhere | — |

### List page size

| Fact | Where |
| --- | --- |
| `usePageSizePreference(scope)` keeps the choice in `localStorage` under `b2b-admin.page-size.${scope}.${userId}` — keyed by admin **and** list; an unreadable or unknown value falls back to 20 | `packages/admin-kit/src/lib/use-page-size-preference.ts:31-66`; options `5, 10, 20, 50, 100, 500` in `packages/admin-kit/src/lib/page-size-options.ts` |
| `packages/admin-shell/src/lib/use-page-size-preference.ts` is a re-export of the kit's hook, not a second copy | that file |
| Nine call sites across eight lists: `orders`, `catalog-products` (the Product list **and** the kit's product browser dialog share it), `inventory-levels`, `returns`, `price-books`, `quote-requests`, `crm-opportunities`, `promotion-coupons` | `grep -rn "usePageSizePreference(" packages` |

### Existing per-admin preferences on the server

| Fact | Where |
| --- | --- |
| The Admin UI language is a column on the admin's own row, written by `PATCH /api/v1/admin/me/preferred-language` for the signed-in admin only, through `AdminUserPreferencePort.setPreferredLanguage` | `packages/modules/_i18n/src/backend/routes.admin.ts:106-131`; `packages/contracts/src/admin-users.ts:72-80` |
| That write is **outside Command Bus auditing**, marked `command-coverage-ignore` as "personal UI setting, not an audited domain-state mutation" | `packages/modules/admin_users/src/backend/services/admin-user-service.ts:633-645` |
| Saved list views made the same call (`specs/147-saved-views/spec.md`, *Assumptions — No audit trail*) and are platform-global rows owned by an admin with no foreign key to `admin_users` | `packages/modules/orders/src/backend/services/order-list-view-service.ts`; `specs/147-saved-views/data-model.md` |
| `catalog` keeps a per-(admin, product) editor preference as a `@GlobalEntity()` row | `packages/modules/catalog/src/backend/entities/product-editor-preference.entity.ts` |
| `admin_users` is **non-deactivatable** — without it nobody can sign in | `packages/modules/admin_users/src/manifest.ts:228-232` |
| The Settings store is platform-wide or sales-channel scoped; it has no per-admin scope | `packages/contracts/src/settings.ts:290-310` |

### Other browser-only Admin UI state (scope decision below)

| Fact | Where |
| --- | --- |
| The page builder remembers whether its settings panel is open in `localStorage`, **not keyed by admin**, and when no choice is stored it opens the panel only on screens at least 1800 px wide | `packages/page-builder-admin/src/chrome/PageBuilderEditorLayout.tsx:30-62` |
| The admin service worker never caches `/api/` responses, so server-held preferences are never served stale from the PWA cache | `admin/public/admin-service-worker.js` |

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Pin the sidebar entries I use most (Priority: P1)

A sales manager opens Orders, Quote Requests and the CRM pipeline twenty times a day; they sit in
three different sidebar groups, two of them below the fold. They hover the Orders entry, press its
pin control, and Orders appears in a *Pinned* section at the top of the sidebar. They pin the
other two the same way. Tomorrow, signing in on their phone, the same three entries are at the
top of the drawer.

**Why this priority**: it is the capability the owner asked for, and on its own it delivers the
value — faster reach to the entries an admin actually uses.

**Independent Test**: as one admin, pin three entries from three sections, unpin one from the
Pinned section and one from its original place, reload, sign in from a second browser, and
confirm the same pins in the same order; sign in as a second admin and confirm they see none of
them.

**Acceptance Scenarios**:

1. **Given** an admin with no pins, **When** the sidebar renders, **Then** no Pinned section is
   shown and every entry is where it is today.
2. **Given** a visible sidebar entry, **When** the admin points at it or moves keyboard focus onto
   it, **Then** a pin control for that entry becomes available, with a translated accessible name
   that names the entry ("Pin Orders").
3. **Given** the admin activates an entry's pin control, **When** the action completes, **Then** a
   Pinned section appears at the top of the sidebar, above every other section, listing that
   entry with the same label and icon; the entry also stays in its original section; and the
   change is announced to assistive technology.
4. **Given** pinned entries exist, **When** the admin pins another, **Then** it is added at the
   end of the Pinned section.
5. **Given** a pinned entry, **When** the admin activates its unpin control — in the Pinned
   section or on the original entry — **Then** it leaves the Pinned section, its original entry
   is unaffected, and the change is announced; when the last pin is removed the Pinned section
   disappears.
6. **Given** pins saved on one device, **When** the same admin signs in on another device or
   browser, including the installed PWA, **Then** the Pinned section shows the same entries in the
   same order on first paint, without the sidebar visibly re-arranging after it appears.
7. **Given** admin A has pins, **When** admin B signs in on any device, including the same
   browser, **Then** B sees only B's own pins.
8. **Given** the current page is a pinned entry's destination, **When** the sidebar renders,
   **Then** both the pinned entry and the original entry show the active state.
9. **Given** the sidebar is in rail mode and the admin has pins, **When** the sidebar renders,
   **Then** the Pinned section appears as the first rail entry, marked with a pin icon, and opens
   the same kind of popover as every other rail section, listing the pins with an unpin control
   on each.
10. **Given** the admin opens the sidebar drawer on a phone, **When** they want to pin or unpin
    an entry, **Then** the control is reachable without hover, with a touch target of at least
    44 × 44 px.
11. **Given** the admin has many pins, **When** the Pinned section is taller than the space
    available, **Then** the sidebar scrolls as it does today and every pin stays reachable; no
    pin is ever refused for being one too many.
12. **Given** the Admin UI is in Polish, **When** the Pinned section, its controls and its
    messages render, **Then** they are in Polish; likewise in English.
13. **Given** the admin opens the command palette and searches "Orders", **When** the result that
    opens the Orders list is shown, **Then** a pin control sits beside it; activating it pins the
    Orders entry (it appears at the end of the Pinned section at once) without navigating or
    closing the palette, and the control turns into an unpin control. Activating that unpins it.
14. **Given** a palette result whose destination is not a sidebar entry the admin can see (a
    record, a create action, an assistant prompt, a destination behind a module that is off),
    **When** it renders, **Then** it shows no pin control.
15. **Given** the admin navigates the palette by keyboard, **When** a result with a pin control is
    highlighted, **Then** the pin control is reachable and operable by keyboard without a pointer,
    `Enter` still opens the destination as today, and the change is announced to screen readers.

---

### User Story 2 — Pinned entries never reveal a surface I can no longer reach (Priority: P1)

An admin pinned *Credit limits*. Their role later loses `credit_limits:read`; separately, an
operator switches the `newsletter` module off, which held another of their pins. Their Pinned
section quietly stops showing both — and both come back, in their old places, when access
returns.

**Why this priority**: part of the P1 slice, not an add-on. A pin that outlives the visibility
rule would advertise a 403 or a switched-off module (Constitution XVII), which the sidebar
otherwise never does.

**Independent Test**: pin an entry, withdraw the gating permission from the admin's role and
confirm the pin is gone from the sidebar and nothing in the Admin UI names it; restore the
permission and confirm it returns at its old position. Repeat with the owning module switched off
on `/platform/modules`, and with it made platform-unavailable.

**Acceptance Scenarios**:

1. **Given** a pin whose entry the admin can no longer see because a required permission was
   withdrawn, **When** the sidebar renders, **Then** the pin is not shown, in the expanded
   sidebar, the rail popover or the mobile drawer, and no count, placeholder or message hints at
   it.
2. **Given** a pin whose owning module is switched off by the operator or not available on the
   platform, **When** the sidebar renders, **Then** the pin is not shown, exactly as the original
   entry is not.
3. **Given** a hidden pin, **When** access returns (permission re-granted, module switched back on
   or reinstalled), **Then** the pin is shown again at its previous position among the pins.
4. **Given** every pin of an admin is hidden, **When** the sidebar renders, **Then** no Pinned
   section is shown.
5. **Given** a pin whose destination no longer exists as any sidebar entry (a route retired by an
   upgrade), **When** the sidebar renders, **Then** it is not shown and nothing errors.

---

### User Story 3 — My existing layout settings follow me between devices (Priority: P2)

An admin who works in rail mode with the Content and Newsletter groups folded, and who reads the
Order list at 100 rows a page, signs in on their phone and on a second desktop and finds the same
setup — and nothing they had configured before the upgrade is lost.

**Why this priority**: owner ruling (a). It extends the same server-held store to the three
settings that exist today; it is independent of pins and testable on its own.

**Independent Test**: on one browser set rail mode, fold two groups and choose page sizes on two
lists; sign in from a second browser and confirm all of them; then, on a browser holding legacy
values from before the upgrade, sign in and confirm the page sizes were carried over, the sidebar
opens in its default layout, and the browser no longer holds the signed-in admin's legacy values.

**Acceptance Scenarios**:

1. **Given** the admin folds or unfolds a sidebar group, **When** they sign in on another device,
   **Then** the same groups are folded there.
2. **Given** the admin switches rail mode on or off on a desktop, **When** they sign in on another
   desktop or tablet, **Then** the sidebar opens in the same mode; on a phone the drawer behaves
   as today, unaffected by rail mode.
3. **Given** the admin chooses 100 rows on the Order list and 50 on the Product list, **When**
   they open those lists on another device, **Then** each opens at its own chosen size, and every
   list they never changed opens at the default.
4. **Given** a browser holding legacy page-size values for the signed-in admin and the server
   holding no value for those lists, **When** the admin first loads the Admin UI after the upgrade,
   **Then** the legacy values are saved to the server, applied, and removed from the browser; the
   legacy collapsed-groups and rail-mode values are removed without being imported, and the
   sidebar opens in its default layout (owner ruling (d)).
5. **Given** the server already holds a value for a setting, **When** a browser holding an older
   legacy value for it is used, **Then** the server's value wins, the legacy value is discarded,
   and nothing is overwritten on the server.
6. **Given** a legacy page-size value stored for a different admin on the same browser, **When**
   this admin signs in, **Then** it is neither imported into this admin's preferences nor removed.
7. **Given** a stored value the Admin UI no longer understands (a page size no longer offered, a
   group that no longer exists), **When** it is read, **Then** it is ignored and the default
   applies, without an error.
8. **Given** the admin has never set a preference, **When** the Admin UI loads, **Then** it looks
   exactly as it does today for a new admin: no pins, every group open, rail mode off, 20 rows
   per page.

---

### User Story 4 — Reorder my pins (Priority: P3)

An admin with six pins wants Orders first. They drag it to the top of the Pinned section — or,
using the keyboard, move it up step by step — and the new order is what every device shows.

**Why this priority**: appending in pin order serves most admins; ordering is the polish GitLab
offers. Deliverable after Stories 1–3 without changing them.

**Independent Test**: with four pins, move the last to the top by drag and the first down by the
keyboard alternative, reload, sign in elsewhere, and confirm the order.

**Acceptance Scenarios**:

1. **Given** two or more pins in the expanded sidebar, **When** the admin drags a pinned entry to
   a new position, **Then** the pins take the new order.
2. **Given** two or more pins, **When** the admin uses the non-drag alternative to move a pinned
   entry up or down by one position, **Then** the pins take the new order, focus stays on the
   moved entry, and the new position is announced ("Orders, position 1 of 6").
3. **Given** reordered pins, **When** the admin signs in on another device, **Then** the same order
   is shown.
4. **Given** some pins are hidden, **When** the admin reorders the visible pins, **Then** the
   hidden pins keep their place relative to each other and reappear in a stable position when
   access returns.

---

### Edge Cases

- **Two sessions of one admin change the same preference** — the most recent save wins for that
  preference as a whole (e.g. the whole pin list); preferences are not merged across sessions.
  Another open session picks the change up the next time it loads or comes back to the
  foreground (FR-019), never by overwriting a change of its own that is still being saved.
- **Saving fails or the device is offline** — the change stays in effect in the current session;
  the admin is told once, without a blocking dialog, that it could not be saved and will not
  follow them to other devices yet; the latest value is saved again when connectivity returns or
  with the next change (FR-017).
- **The server's preferences cannot be loaded at sign-in** — the Admin UI still opens, with the
  defaults, and says nothing is lost; it does not save those defaults over the admin's stored
  preferences (FR-018).
- **The same destination is contributed by two sidebar entries** — one pin per destination; the
  pinned entry takes the label and icon of the first visible entry with that destination.
- **A pinned entry's label changes** (renamed in an upgrade, or the admin switches language) —
  the pinned entry shows the current label; nothing about the label is stored.
- **Two pinned entries share a label** (same word in two sections) — each pinned entry's
  accessible description names the section it comes from, so they are distinguishable.
- **There is no pin limit** — an admin may pin every entry they can see; the server's technical
  bound on the stored list (FR-008) is out of reach of real use.
- **An admin is deactivated or soft-deleted** — their preferences stay stored and come back
  unchanged if the account is reactivated or restored; they are never shown to anyone else.
- **An admin signs in on a shared browser after another admin used it before the upgrade** —
  page-size legacy values are keyed by admin and only the signed-in admin's are taken; the two
  unkeyed sidebar values are not carried over at all (FR-022).
- **An admin whose session has no role** (`RoleRequiredNotice`) — can still keep preferences;
  with no visible entry they have nothing to pin.
- **The Home entry (`/`)** — can be pinned like any other entry.
- **A list page whose page-size choice changes while another list is open in another tab** — each
  list reads its own remembered size when it is opened; an open list is not resized under the
  admin.

## Requirements *(mandatory)*

### Functional Requirements

**Pinned section (US1, US2)**

- **FR-001**: An admin MUST be able to pin any visible sidebar entry, whether the shell declares it
  or a module contributes it, and to unpin it again, any number of times.
- **FR-002**: Pinned entries MUST render in a Pinned section placed above every other sidebar
  section, in the expanded sidebar, in the mobile drawer and in rail mode. The section MUST NOT
  render when the admin has no visible pin.
- **FR-003**: A pinned entry MUST show the label and icon of the sidebar entry it points at,
  resolved at render time in the admin's current language, MUST navigate to the same destination,
  and MUST show the active state whenever its original entry does. The original entry MUST stay in
  its section.
- **FR-004**: The pin control MUST be a separate control from the entry's link, MUST appear on
  pointer hover and on keyboard focus of the entry, MUST be reachable without hover on touch
  devices with a target of at least 44 × 44 px, MUST expose its state (pinned / not pinned) and a
  translated accessible name naming the entry, and MUST NOT change keyboard order or focus of the
  sidebar links when not in use. Every pinned entry MUST offer an unpin control in the Pinned
  section, including inside the rail popover.
- **FR-005**: Pinning, unpinning and moving a pin MUST be announced through a polite live region
  in the admin's language.
- **FR-006**: A pin MUST render only while its destination is a visible entry under the shell's
  existing visibility rule (permission and effective module presence). A hidden pin MUST NOT be
  revealed by any count, placeholder, tooltip or message, MUST be kept, and MUST render again at
  its stored position when the entry becomes visible.
- **FR-007**: New pins MUST be added at the end of the Pinned section. One destination MUST be
  pinned at most once.
- **FR-008**: There MUST be no product limit on the number of pins (owner ruling (c)). The
  server MUST still validate the stored pin list against a fixed technical upper bound, as abuse
  protection, set well above the number of sidebar entries the platform can contribute, so that
  no admin reaches it in real use; a request beyond it MUST be refused as invalid input. Pinning
  MUST NOT drop or reorder an existing pin.
- **FR-009** (US4): An admin MUST be able to reorder pins by dragging within the Pinned section of
  the expanded sidebar and by a non-drag alternative that moves a pin one position up or down
  (WCAG 2.2 SC 2.5.7). Reordering visible pins MUST keep hidden pins in a stable relative position.

**Server-held preferences (US1, US3)**

- **FR-010**: Pins, collapsed groups, rail mode and every list page size MUST be stored on the
  server per admin, so that the same admin sees the same preferences on every browser and device,
  including the installed PWA. After this feature, none of them MUST be read from or written to
  browser storage as their source of truth.
- **FR-011**: An admin MUST be able to read and change only their own preferences. No request may
  name another admin, no response may carry another admin's preferences, and no permission — the
  wildcard included — grants access to them. Any signed-in admin MAY keep preferences; no new
  permission code is introduced.
- **FR-012**: The set of preferences MUST be closed and each MUST have a defined shape and size
  bound, validated on the server: a request naming an unknown preference, or carrying a value of
  the wrong shape or beyond its bound, MUST be refused with a translated error and MUST change
  nothing.
- **FR-013**: Collapsed groups MUST be remembered as the set of section keys the admin folded,
  including the Pinned section's own key. Rail mode MUST be remembered as on/off and MUST have no
  effect on the mobile drawer.
- **FR-014**: List page size MUST be remembered per list, independently for each list, from the
  page-size options the list offers today; a list the admin never changed MUST use the default
  of 20. Lists that today share a remembered size (the Product list and the product browser
  dialog) MUST continue to share it.
- **FR-015**: Stored values the Admin UI no longer understands — an unknown section key, a page
  size no longer offered, a destination no longer contributed — MUST be ignored on read without
  an error; the Admin UI MUST NOT rewrite them merely because it read them.
- **FR-016**: Preferences MUST be applied on the first paint of the Admin UI after sign-in or
  reload: the sidebar MUST NOT first render with defaults and then re-arrange. They MUST be
  available at the same point the signed-in admin's identity and permissions are.
- **FR-017**: A change MUST take effect in the Admin UI immediately, before the server confirms
  it. If saving fails, the change MUST remain in effect for the current session, the admin MUST be
  told once in a non-blocking, translated message that it could not be saved, and the latest value
  MUST be saved again when the browser reports connectivity or with the next change of that
  preference. Rapid successive changes MUST NOT leave the server holding an older value than the
  Admin UI shows.
- **FR-018**: If preferences cannot be loaded at sign-in, the Admin UI MUST open with the defaults,
  MUST NOT save those defaults over the stored preferences, and MUST load the stored preferences
  on the next successful attempt.
- **FR-019**: A running Admin UI MUST pick up preferences changed in another session of the same
  admin when it is next loaded, and when it returns to the foreground after being hidden (the PWA
  resumed from the background), without discarding a change of its own that is still being saved.
  Live push between sessions is not required.
- **FR-020**: Preference writes are personal UI configuration and MUST NOT create audit entries,
  following the precedent of the Admin UI language and of saved list views (see *Assumptions*).
- **FR-021**: Preferences are platform-global data owned by one admin and MUST be classified as
  such for the tenancy guard; they hold destinations, section keys, list identifiers and numbers,
  never business records or tenant data.

**Carrying browser values over (US3)**

- **FR-022**: On the first load of the Admin UI after the upgrade, for each of the three existing
  settings for which the server holds no value for the signed-in admin and the browser holds a
  legacy value, the legacy value MUST be saved to the server and applied, and then removed from
  the browser once the server has confirmed it. Where the server already holds a value, the
  server's value MUST win and the legacy value MUST be removed without being saved. Page-size
  legacy values MUST be taken only from the keys belonging to the signed-in admin; those of other
  admins MUST be left in place. The two unkeyed sidebar values (collapsed groups, rail mode) MUST
  NOT be imported (owner ruling (d)): they MUST be removed from the browser on first load and every
  admin starts from the default sidebar layout. A legacy value that cannot be read MUST be
  discarded silently.
- **FR-023**: The carry-over MUST be idempotent: repeated loads, a reload mid-import, or two tabs
  importing at once MUST leave the server holding one value per setting, never a mix, and MUST
  never overwrite a value the admin set on the server.

**Surfaces, language and documentation**

- **FR-024**: No new command-palette entry and no new permission code are introduced: pinning is a
  control on existing sidebar entries and on existing palette results (FR-027), not a surface of
  its own. Pins MUST NOT add entries or a group to the command palette.
- **FR-025**: Every new user-facing string — the Pinned section heading, pin / unpin / move
  controls and their accessible names, live-region announcements, the
  save-failure message and the server's validation errors — MUST ship in English and Polish.
- **FR-026**: The `admin_users` module documentation MUST describe, for the operator audience,
  how to pin, reorder and unpin entries — from the sidebar and from the command palette — that preferences follow the admin across
  devices, and that hidden pins return with access; and, for the engineer audience, the closed set
  of preferences and how a list's page size is remembered. In English and Polish.
- **FR-027** (owner ruling (e)): Every command-palette result whose destination is the destination
  of a **visible entry** of the sidebar — host-declared or module-contributed, whichever palette
  group produced the result — MUST show a pin / unpin control beside it reflecting the current pin
  state; no other result may show one. Activating it MUST pin or unpin exactly as the sidebar
  control does (same store, same optimistic behaviour, FR-007 ordering), MUST NOT navigate or
  close the palette, and MUST be operable by keyboard with `Enter` on the result keeping its
  current meaning (open the destination). The control's accessible name MUST name the entry and
  the action; the outcome MUST be announced through a live region. Matching is by destination
  only, so a palette result can never offer to pin a surface the sidebar would hide (FR-006).

### Key Entities

- **Admin preference** — one remembered choice of one admin: the owning admin, which preference
  it is (one of a closed set: pinned entries, collapsed groups, rail mode, list page sizes), its
  value in that preference's shape, and when it was last changed. At most one per admin and
  preference. Platform-global, owned by `admin_users`; it outlives a deactivation or a soft
  delete of its admin and is never visible to another admin.
- **Pin** (inside the pinned-entries preference) — an ordered list of destinations. A destination
  is an admin route path; it carries no label, icon or permission, all of which are resolved from
  the sidebar at render time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A pinned entry is reachable in one activation from anywhere in the Admin UI with
  the sidebar open, with no scrolling, for an admin with up to 10 pins.
- **SC-002**: The same admin sees identical pins (same entries, same order), collapsed groups,
  rail mode and page sizes on two different browsers within one reload of making a change on
  the first.
- **SC-003**: Zero sidebar layout shifts after first paint attributable to preferences loading,
  measured on a reload with stored pins and folded groups.
- **SC-004**: Zero reads or writes of `b2b-admin.nav.collapsed-groups`, `b2b-admin.nav.rail-mode`
  or `b2b-admin.page-size.*` remain in the Admin UI sources other than the one-time carry-over and
  its removal (a repository search confirms it).
- **SC-005**: An admin upgrading with existing browser page-size values loses none of them: after
  the first load, the server holds the page sizes the browser held for that admin (the two unkeyed
  sidebar values are deliberately not carried over, owner ruling (d)).
- **SC-006**: For every combination of withdrawn permission, operator-off module and
  platform-unavailable module, no pinned entry renders that its original entry would not
  (automated off-state and permission tests).
- **SC-007**: Pin, unpin and reorder are fully operable by keyboard alone, and an automated
  accessibility check of the sidebar with pins, in expanded and rail mode, reports no WCAG 2.2 AA
  violation.
- **SC-008**: Every acceptance scenario and FR is covered by at least one automated test,
  including: one admin cannot read or write another's preferences; an unknown preference and an
  oversized value are refused; a failed save keeps the change for the session; the carry-over is
  idempotent and never overwrites a server value.
- **SC-009**: Every string the feature adds resolves in English and Polish; none renders as a raw
  translation key.

## Assumptions

- **Owner: `admin_users`.** Preferences belong to the admin account, the module is
  non-deactivatable, and it already owns the one per-admin UI preference on the server (language).
  No new module; a new module would own nothing `admin_users` does not already. The `_i18n` route
  that writes the language stays where it is.
- **Not the Settings store.** Settings are platform-wide or channel-scoped operator configuration
  with no per-admin scope (`packages/contracts/src/settings.ts`); bending them to per-admin
  values would mix business configuration with one person's UI state.
- **No audit trail (Constitution XIII not engaged).** A preference changes nothing any other admin
  sees and no domain record; this is the same call as `setPreferredLanguage`
  (`command-coverage-ignore`) and saved list views (`specs/147-saved-views/`, *No audit trail*).
  Planning records the `command-coverage-ignore` marker on each write.
- **Self-service only.** No admin, including a platform admin, can view, copy or reset another
  admin's preferences; an admin-facing "reset someone's sidebar" is not requested.
- **Platform-global, not organization-scoped (Constitution XI).** Admins are platform-side users,
  not tenant actors, exactly like `admin_users` rows themselves and saved list views; this is a
  classification, not a "no-organization" path for tenant data.
- **No server-side cache, so no cache invalidation.** Preferences are read once per Admin UI load
  for one admin; there is nothing for the lifecycle pub/sub pattern to invalidate.
- **No new runtime dependency.** Drag reordering (US4) uses `@dnd-kit`, which the admin already
  depends on.
- **Last write wins per preference.** Two devices editing pins at the same moment are rare enough
  that merging is not worth its cost; the whole pin list is one value.
- **Pins stay in their original section too**, as in GitLab, so the sidebar's structure an admin
  has learnt never changes because of a pin.
- **No empty-state hint.** With no pins the Pinned section is absent; the pin control on hover and
  focus is the discovery path. A one-time hint can follow if adoption is low.
- **Page size stays per list, not per device.** The owner's ruling (a) applies to all three
  settings alike, so a phone and a desktop share one page size per list and one rail mode
  (which a phone ignores).
- **List screens do not change.** Every list keeps asking for its remembered page size the way it
  does today; only where the value is kept changes.
- **Preferences are not deleted with the account.** Admins are soft-deleted, and restoring one
  restores their preferences; a hard purge of admin accounts, if one is ever added, removes them.

## Out of scope

- **The page builder's settings-panel state** (`packages/page-builder-admin/src/chrome/PageBuilderEditorLayout.tsx`)
  — stays in the browser. Its default depends on the screen width (open only at 1800 px and
  above), so the right answer on a phone and on a wide monitor genuinely differ, and following the
  admin across devices would push the panel above the canvas on a small screen. It is also not
  keyed by admin today. Recorded as a follow-up candidate: if it moves, it should be remembered per
  device class, which is a different preference from the ones here.
- Saved list views (`specs/147-saved-views/`) — already server-side per admin (owner ruling (b)).
- Pinning anything other than a sidebar entry: a record, a saved view, a settings group or a
  palette action.
- A separate "Pinned" group in the command palette, or a standalone palette action "Pin this
  page" — pinning from the palette is the control beside an existing result (FR-027), nothing
  more.
- Pinned sections shared by role or by team, operator-defined default pins, and renaming a pinned
  entry.
- Live synchronisation of preferences between open sessions.
- Moving any other browser-held state (none other is held for the Admin UI today; see *Current
  state*).

## Constraints from the constitution and the conventions

- **I. Modular architecture** — preferences are owned by `admin_users`; the shell and the admin
  kit reach them through `admin_users`' published endpoints, never its internals. No module other
  than `admin_users` gains an entity.
- **II. API-first** — the closed preference set and the shape of each value are defined in
  `packages/contracts/` first (FR-012).
- **III. TDD** — SC-008.
- **IX. UI reuse** — the Pinned section reuses the sidebar's existing section, item and rail
  popover presentation; the pin control follows the existing icon-button pattern.
- **XI. Multi-tenant isolation** — FR-011, FR-021; the entity is classified platform-global.
- **XIII. Command Bus** — not engaged (FR-020, *Assumptions*).
- **XVI. Command palette** — FR-024, FR-027.
- **XVII. Operator-toggleable modules** — FR-006 and US2 bind the Pinned section to the same
  presence rule as the sidebar; `admin_users` itself is non-deactivatable. Read
  `specs/conventions/module-activation.md` (item 5) before planning the off-state tests.
- **Admin surfaces** — no permission code, no palette action or group (only a control on existing
  results, FR-027), no new nav entry:
  `specs/conventions/module-admin-surfaces.md`.
- **Migrations** — one new table owned by `admin_users`, scaffolded per
  `specs/conventions/module-migrations.md`; no other module's migrations are touched.
- **i18n** — FR-025; the shell's strings are in the `core` scope today, and
  `specs/conventions/module-i18n.md` decides which bundle new shell and `admin_users` strings
  belong in.
- **UX laws** — `.claude/skills/ux-laws/SKILL.md`: Fitts (FR-004 touch target), Serial Position
  (pins first), Miller / Hick (pins as a short, admin-chosen first group), Doherty (FR-017 optimistic), WCAG 2.2 AA floor
  (FR-004, FR-005, FR-009, SC-007).
