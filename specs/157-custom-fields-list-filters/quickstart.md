# Quickstart: Custom fields as admin list filters (`specs/157-custom-fields-list-filters/`)

A manual walk-through for the owner's test before the pull request. Automated coverage is in
[tasks.md](./tasks.md) § *Requirement → test*.

## Setup

```bash
pnpm install --frozen-lockfile && pnpm run build:packages
pnpm --filter backend run migration:pending      # expect one: custom_fields definition_list_filter
pnpm --filter backend run migration:up
pnpm run dev                                     # or backend + admin dev servers separately
```

Sign in to the admin as a platform administrator.

## 1. Define and edit (US3)

1. `/custom-fields` → entity *Order* → add a `select` field `customer_source` with options
   `trade_fair, web, referral`, *Use as list filter* **off**. The *List filter* column shows —.
2. *Edit* the row: the key, entity type and value type are read-only. Set the Polish label to
   *Źródło klienta* and the English one to *Customer source*; add an option `partner`; move
   `web` up; switch *Use as list filter* on; *Save*. The column shows *Yes*.
3. Try to remove an option a record holds (after step 2.1 below) — refused, naming the option.
4. Switch *Required* on — the notice says records without a value must get one at their next
   custom-field edit. Save, then switch it off again.
5. Entity *Customer*: the create form and the editor offer no *Use as list filter*.

## 2. Orders (US1)

1. Set `customer_source` on three orders from their detail pages: two *Trade fair*, one *Web*.
2. `/orders` → the advanced filters show *Customer source*. Choose *Trade fair*: two orders, the
   total says 2, a chip *Customer source: Trade fair* appears, the address carries
   `cf.customer_source.in=trade_fair`.
3. Add *Web*: three orders (OR within the field). Add a status filter: AND with it.
4. Copy the address into a new tab: same filter applied.
5. *Export CSV*: the file holds the same orders.
6. Save a view; clear filters; load the view: the filter returns.
7. Edit the definition, switch the option off; load the view: the list loads without that filter
   and a notice says it is no longer available. Open the address from step 4: an error names
   `customer_source` and offers *Remove this filter*.
8. Open `/orders?cf.constructor.in=x`: the same error names `constructor` (an ordinary unknown
   key, not a crash). With a filter applied, the status counts and the total agree, and the CSV
   holds exactly *total* rows.

## 3. Quote Requests and Opportunities (US2)

1. Repeat 1–2 for a *Quote request* field on `/quote-requests` with more matching requests than
   one page shows; page through — each appears once, the total is right.
2. As a sales representative, the filter never shows a request outside their organizations.
3. An *Opportunity* field with the option on and **not** on the board card: the Opportunities list
   filters by it. Put a different Opportunity field on the board card with the option off: the
   board still filters by it (and *Show more* on a lane keeps working); the list does not offer it.
4. `/platform/modules` → switch *Quote requests* off: `/custom-fields` offers no *Quote request*
   type; switch it back on: the definitions, options, the filter option and values are unchanged.
   Same for *CRM* and Opportunity definitions.

## 4. Language

Switch the admin to Polish: every label, operator, chip, notice and editor text above is Polish;
the filter labels follow each field's Polish label (falling back to the default label).
