# Quickstart: Admin user preferences (`specs/164-admin-user-preferences/`)

How to exercise the feature by hand and which commands prove it. The per-phase commands are in
`tasks.md` (produced by `/speckit.tasks`); this page is the tour.

## Setup

```bash
pnpm install --frozen-lockfile
pnpm run build:packages        # every package resolves at ./dist — rebuild after editing one
pnpm run dev:infra             # Postgres, Redis, Meilisearch
pnpm run setup                 # db:fresh, then module:install --all (applies the new migration)
pnpm run dev
```

Have two administrators: **A**, a platform administrator, and **B**, whose role holds
`credit_limits:read` and `orders:read` and little else. Use two browsers (or one normal and one
private window) and, for the PWA steps, the installed Admin UI on a phone or a narrow emulated
viewport.

## Pins (US1, US2, US4)

1. As A, hover **Orders** → a pin button appears beside it ("Pin Orders"). Activate it → a
   **Pinned** section appears at the top with Orders; Orders also stays in its own group; a
   screen reader hears "Orders pinned".
2. Tab through the sidebar → the pin button is reached right after its link; Space toggles it.
3. Pin **Quote requests** and a CRM entry → they append in that order.
4. Reload → the sidebar paints with the Pinned section already there; nothing moves after.
5. Second browser, sign in as A → same pins, same order. Sign in as B in a third session → no
   pins.
6. As A, drag the last pin to the top; then focus a pin's handle, press Space, ArrowUp, Space →
   "position 1 of 3" is announced and focus stays on the row. On the phone, use the up/down
   buttons.
7. Collapse the sidebar (⌘B) → the first rail icon is a pin; its popover lists the pins, each
   with an unpin button.
8. As B, pin **Credit limits**. As A, withdraw `credit_limits:read` from B's role. B reloads →
   the pin is gone everywhere (expanded, rail, drawer) and nothing hints at it. Restore the
   permission → it returns at its old position.
9. Press ⌘K / CTRL+K, type "orders": the *Orders* result has a pin button. Click it → *Orders*
   appears at the end of the Pinned section, the palette stays open, the button turns into
   "Unpin Orders". Arrow to the server action *Open orders* (or any result opening a sidebar
   entry) and press `Alt+Enter` (`⌥↵`) → toggled and announced; press `Enter` → it navigates as
   before. A record row, a "New …" action and the assistant row show no pin button; neither does
   a result for a module you just switched off.
10. On `/platform/modules`, switch a module holding one of A's pins off → the pin disappears with
   the original entry; switch it on → back in place.

## Layout settings and the carry-over (US3)

1. On a build **before** this feature, as A: fold *Content*, enter rail mode, set the Order list
   to 100 rows and the Product list to 50.
2. Upgrade, reload as A → the sidebar opens in the **default** layout (groups open, rail off —
   ruling (d)); the Order list opens at 100 and the Product list at 50. In devtools,
   `localStorage` no longer holds `b2b-admin.nav.*` or A's `b2b-admin.page-size.*.<A's id>`;
   any `b2b-admin.page-size.*.<B's id>` is still there.
3. Fold two groups and enter rail mode → second browser as A shows the same; the phone's
   drawer ignores rail mode.
4. Go offline (devtools), pin something → it applies; a dismissible notice says it could not be
   saved. Go online → it saves; the notice clears. Open the second browser → the pin is there.
5. Background the PWA, change pins on the desktop, bring the PWA back → it picks the change up.

## API by hand

```bash
# with A's session cookie in $C
curl -s -b "$C" localhost:3001/api/v1/admin/me | jq .data.preferences
curl -s -b "$C" -X PATCH -H 'content-type: application/json' \
  -d '{"sidebarPins":["/orders","/quote-requests"]}' localhost:3001/api/v1/admin/me/preferences
curl -s -b "$C" -X PATCH -H 'content-type: application/json' \
  -d '{"theme":"dark"}' localhost:3001/api/v1/admin/me/preferences          # 400 VALIDATION_FAILED
curl -s -b "$C" -X POST -H 'content-type: application/json' \
  -d '{"listPageSizes":{"orders":50}}' localhost:3001/api/v1/admin/me/preferences/legacy-import
```

## The tests that prove it

```bash
# contracts and the module's pure document logic
pnpm --filter @endora-commerce/contracts exec vitest run src/admin-preferences.test.ts
pnpm --filter @endora-commerce/mod-admin-users exec vitest run src/backend/services/admin-preference-document.test.ts

# admin (kit store, carry-over, shell)
pnpm --filter admin exec vitest run test/kit/admin-preferences-store.test.tsx \
  test/kit/admin-preferences-carry-over.test.tsx test/kit/session-cluster.test.tsx \
  test/kit/no-legacy-layout-storage.test.ts test/unit/pinned-entries.test.ts \
  test/components/AppShell.pinned.test.tsx test/components/AppShell.pinned-visibility.test.tsx \
  test/components/AppShell.pinned-reorder.test.tsx test/components/AppShell.palette-pinning.test.tsx \
  test/components/AppShell.palette.test.tsx test/components/AppShell.layout-preferences.test.tsx \
  test/components/AppShell.pinned.a11y.test.tsx

# backend, with services running (see specs/conventions/backend-test-suite.md)
TEST_DATABASE_URL=postgresql://b2b:b2b@localhost:5441/b2b_test \
pnpm --filter backend exec vitest run test/contract/admin_users/me-preferences.test.ts \
  test/contract/admin_users/me.test.ts test/integration/admin_users/preferences-persistence.test.ts \
  test/integration/admin_users/off-state.test.ts \
  test/contract/admin_users/permissionless-admin-routes.runtime.test.ts \
  test/unit/kernel/permissionless-admin-routes.test.ts test/unit/db/migrations-registry.test.ts

# checks this feature can trip
pnpm --filter backend run check:command-coverage -- --strict
pnpm --filter backend run check:transaction-context
pnpm --filter backend exec tsx scripts/check-entity-tenant-classification.ts
pnpm --filter backend run check:test-ownership
pnpm --filter backend run i18n:hardcoded
pnpm --filter backend run check:docs-translations
pnpm --filter backend run overlay:check && pnpm --filter backend run manifests:check
```

Merge-request pipelines do not run the contract and integration suites (D-198); run them
locally before opening the pull request.
