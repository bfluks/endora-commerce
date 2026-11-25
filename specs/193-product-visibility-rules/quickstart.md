# Quickstart: Product visibility rules (spec 193)

Prerequisites: a worktree set up with `scripts/setup-worktree.sh`, `pnpm run build:packages`,
`pnpm run setup` (so install hooks run), `pnpm run dev`. Two currencies active (call them A and B),
a storefront channel X.

## US2 — configure (first)

1. Platform → Modules: switch **Product visibility rules** on (default off, R-3). The
   configuration screen (⌘K → "Product visibility") lists every role holding the quote-handling
   permission or `*` as "sees no products".
2. Create categories: *domestic* (A > 0), *export* (B > 0), *management* (A ≥ 0, B ≥ 0).
3. Leave A on its base book; designate for B a regular *everyone* book bound to channel X.
   Designating a customer-group book is refused (`DESIGNATION_INVALID`).
4. Map role *rep-domestic* → *domestic*, *rep-export* → *export*, *manager* → *management*.
   `platform_admin` is not offered; the role list shows each role's category.

## US1 — restricted reads

Seed five products: A>0 only, B>0 only, both>0, A=0 only, unpriced; one configurable product with
one A-priced and one unpriced variant.

1. Sign in as a *rep-domestic* user: the product list shows A>0, both>0 and the configurable product
   (total 3); its variant list shows only the A-priced variant; opening the B-only product by URL
   answers *not found*; global search does not find it.
2. As *manager*: A=0 appears too. As platform administrator: all six, exactly as before.
3. Change a B row in the designated book; within a minute the export user's list follows (OQ-A).
4. Move the designated book's end date into the past: from the next request no product qualifies
   through B (configuration screen: "not in force — outside schedule").

## US4 — website rule

1. Create a rule "flag F is true AND catalogue price in A > 0"; attach it to X → the preview shows
   join/leave counts; confirm.
2. Within 5 minutes the storefront on X lists exactly the products the preview announced as members.
3. Try adding a product to X on the channel screen → refused, naming the rule. Create a new product
   that meets the rule → it is not on X until admitted (≤ 5 min).
4. Detach: membership stays; the channel screen accepts manual edits again.

## Off state

Switch the module off: every read is as before installation, the channel screen accepts edits, no
job runs. Switch on: configuration is back; a reconcile and a rebuild are queued.

## Gated (after spec 192)

As *rep-domestic*, create a quote with a B-only line → refused naming the line; as *manager* the
A=0 product shows "no fixed price" on the quote screens only.
