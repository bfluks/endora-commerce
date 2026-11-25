# Quickstart: Product visibility rules (spec 193)

Prerequisites: a worktree set up with `scripts/setup-worktree.sh`, `pnpm run build:packages`,
`pnpm run setup` (so install hooks run), `pnpm run dev`. Two currencies active (call them A and B),
a storefront channel X. Roles: *rep-domestic*, *rep-export*, *manager*, *rep-unrestricted* (each
holding `rfqs:handle`), *catalog-clerk* (no `rfqs:handle`), and *ops-admin* holding `*`.

## US2 — configure (first; time it for SC-006)

1. Platform → Modules: switch **Product visibility rules** on (it ships off — FR-076; the activation
   text says unmapped quote-handling roles see no products from now on). The configuration screen
   (⌘K → "Product visibility") lists *rep-domestic*, *rep-export*, *manager* and *rep-unrestricted*
   as "sees no products"; *ops-admin* (holds `*`) and `platform_admin` as "unrestricted — cannot be
   mapped" (FR-026); *catalog-clerk* as unrestricted. Nothing can be configured before this step
   (FR-077).
2. Create categories: *domestic* (A > 0), *export* (B > 0), *management* (A ≥ 0, B ≥ 0).
3. Leave A on its base book; designate for B a regular *everyone* book bound to channel X.
   Designating a customer-group book is refused (`DESIGNATION_INVALID`); a draft book is accepted and
   shown "not in force".
4. Map *rep-domestic* → *domestic*, *rep-export* → *export*, *manager* → *management*,
   *rep-unrestricted* → **unrestricted** (I-2). Mapping *ops-admin* is refused (`ROLE_NOT_MAPPABLE`).
   The role list shows each role's mapping.

## US1 — restricted reads

Seed five products: A>0 only, B>0 only, both>0, A=0 only, unpriced; one configurable product with
one A-priced and one unpriced variant.

1. Sign in as *rep-domestic*: the product list shows A>0, both>0 and the configurable product
   (total 3); its variant list shows only the A-priced variant; opening the B-only product by URL
   answers *not found*; global search does not find it.
2. As *manager*: A=0 appears too. As *rep-unrestricted*, *ops-admin* and platform administrator: all
   six, exactly as before (FR-025, FR-026).
3. Change a B row in the designated book; within 60 s the export user's list follows (OQ-A, SC-008).
4. Move the designated book's end date into the past: from the next request no product qualifies
   through B (configuration screen: "not in force — outside schedule").
5. Designate another B book: for up to 150 s the export user sees nothing that qualifies only through
   B, then the new answer (OQ-A); a governed channel's membership does not flicker meanwhile (Q2, US4-11).

## US4 — website rule

1. Create a rule "flag F is true AND catalogue price in A > 0"; attach it to X → the preview shows
   join/leave counts; confirm.
2. Within 5 minutes the storefront on X lists exactly the products the preview announced as members.
3. Try adding a product to X on the channel screen → refused, naming the rule. Create a new product
   that meets the rule → it is not on X until admitted (≤ 5 min).
4. Push a product through a connector-shaped `applyScopes` call with per-language values and a
   channel status for X before admission: the values are stored, the product is not on X; on
   admission it appears with them; that first channel status write after admission does not evict it
   (FR-093, Q1). A later channel-row status inactive → active on X evicts it until re-admitted
   (FR-092); a per-language status change never does (H2 A).
5. Archive a member product that meets the rule: it leaves X within 5 minutes and is never re-admitted
   while archived; deactivate another: same (FR-079).
6. Create a product that meets the rule while X is its only possible channel and the default channel
   is governed: it ends on **no** channel until admitted (FR-059's zero-channel exception), and the
   admin still finds it.
7. Detach: membership stays; the channel screen accepts manual edits again.

## Off state

Switch the module off: every read is as before installation (list responses still `no-store`), the
channel screen accepts edits, no job runs. Switch on: configuration is back; a reconcile and a
rebuild are queued.

## Gated (after spec 192)

1. As *rep-domestic*, create a quote with a B-only line → refused naming the line; as *manager* the
   A=0 product shows "no fixed price" / "brak ustalonej ceny" on the quote screens only (not on
   admin order create).
2. A product excluded from X only by the rule (US4 step 1): a customer accepts a quote containing it,
   converts it to a cart on X, checks out and places the order — the line is kept throughout
   (FR-090); an administrator creates, previews, reorders and clones an order with it on X (FR-091).
   This holds even when the product is inactive in every language of X (H2 A: only the channel-row
   status counts). The same product with an inactive **channel status** on X — stored before admission
   or left over — is absent for another reason and is dropped (US4-13, N1). A product absent from X for
   another reason is still dropped / refused.
