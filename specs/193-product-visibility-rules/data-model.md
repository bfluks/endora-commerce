# Data model: Product visibility rules (spec 193)

All tables are owned by `product_visibility_rules`, created by its own migrations
(`pnpm --filter backend run migration:new -- --module product_visibility_rules --name <slug>`),
and classified **platform-global** (instance configuration and derived catalogue facts —
Principle XI; FR-075). No column is added to another module's table. No foreign key crosses a
module boundary (R-13): ids of products, variants, roles, books and channels are plain `uuid`
columns, and a dangling one matches nothing.

## 1. Configuration (Command-written, audited — FR-070)

### `visibility_categories`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `name` | varchar(120) not null | unique, case-insensitive (`lower(name)` unique index) |
| `version` | integer not null default 1 | optimistic concurrency (`If-Match`) |
| `created_at`, `updated_at` | timestamptz | |

### `visibility_category_conditions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `visibility_category_id` | uuid not null FK → `visibility_categories` on delete cascade | |
| `currency_code` | char(3) not null | any currency, validated against `currencyReadPort` on save (FR-012); a later-deactivated currency stays stored and is shown inactive; its condition is never met |
| `threshold` | varchar(8) not null | check in (`gt_zero`, `gte_zero`) |

Unique `(visibility_category_id, currency_code, threshold)`. A category has ≥ 1 condition
(Command validation). A product qualifies when **any** condition is met (FR-011).

### `visibility_role_mappings`

| Column | Type | Notes |
| --- | --- | --- |
| `admin_role_id` | uuid PK | at most one target per role (FR-020) |
| `target` | varchar(12) not null | check in (`category`, `unrestricted`) — I-2, FR-025 |
| `visibility_category_id` | uuid null FK → `visibility_categories` (restrict) | not null ⇔ `target = 'category'` (check constraint); deleting a mapped category is refused naming the roles (FR-013) |
| `updated_at` | timestamptz | |

`platform_admin` and every role holding a self-lifting permission are refused (FR-022, FR-026); a
stored row of a role that later gains such a permission stays but has no effect (flagged on the
overview). Setting no target deletes the row.

### `catalogue_price_designations`

| Column | Type | Notes |
| --- | --- | --- |
| `currency_code` | char(3) PK | one per currency (FR-001) |
| `price_list_id` | uuid not null | refused unless the book exists and is regular / everyone / of the currency / bound to the channel (RQ-1 A); a draft or scheduled book is accepted and shows "not in force" until it is |
| `sales_channel_id` | uuid not null | |
| `updated_at` | timestamptz | |

No row ⇒ the currency's base book (channel-independent). A later deletion, unbinding,
re-audiencing or status change of the book is **not** blocked; the read-time
`designationStatus` reports it and the currency has no catalogue price (fail-closed) while it
lasts.

### `product_rules`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `name` | varchar(120) not null unique | named and reusable (FR-056) |
| `definition` | jsonb not null | `ProductRuleDefinitionSchema` (contracts/ports.md §4) |
| `version` | integer not null default 1 | moves on every definition change; a preview binds to it |
| `created_at`, `updated_at` | timestamptz | |

Delete refused while attached to any channel.

### `website_rule_attachments`

| Column | Type | Notes |
| --- | --- | --- |
| `sales_channel_id` | uuid PK | at most one rule per channel (FR-051) |
| `product_rule_id` | uuid not null FK → `product_rules` (restrict) | a rule may govern many channels |
| `attached_at` | timestamptz | |
| `applied_rule_version` | integer not null | the version whose preview was applied |

Read by the kernel governor inside the membership mutation's transaction (R-10).

## 2. Derived catalogue-price flags (worker-written; not audited — derived data)

### `catalogue_price_generations`

| Column | Type | Notes |
| --- | --- | --- |
| `currency_code` | char(3) PK | one row per currency that has ever been built |
| `served_generation` | integer not null | the generation every read uses |
| `building_generation` | integer null | set while a rebuild runs |
| `built_for_price_list_id`, `built_for_sales_channel_id` | uuid null | designation snapshot of `served_generation` (null = base book) |
| `whole_stale` | boolean not null default false | a catalogue-wide change is pending |
| `consumed_watermark` | text null | `price_lists` change watermark the served generation (or last refresh) consumed — drift poll (TM-7 (5)) |
| `built_at` | timestamptz | |

### `product_catalogue_prices`

| Column | Type | Notes |
| --- | --- | --- |
| `currency_code` | char(3) | |
| `generation` | integer | |
| `product_id` | uuid | |
| `has_positive` | boolean not null | some line of the product (itself, or any variant when it has variants) is priced > 0 |
| `refreshed_at` | timestamptz | |

PK `(currency_code, generation, product_id)`. **A row exists only when some line is priced**
(price 0 included); no row ⇒ no catalogue price (FR-003, FR-004). Index
`(currency_code, generation, has_positive, product_id)` serves the predicate.

### `variant_catalogue_prices`

Same shape keyed by `variant_id` with `product_id` and `has_positive` (row exists ⇔ the variant is
priced in C). PK `(currency_code, generation, variant_id)`.

### `catalogue_price_stale_products`

| Column | Type | Notes |
| --- | --- | --- |
| `currency_code` | char(3) | |
| `product_id` | uuid | |
| `marked_at` | timestamptz | a refresh clears only marks older than its read start (TM-7 (1)) |

PK `(currency_code, product_id)`; `on conflict do nothing`. Cleared by the refresh in the same
transaction that replaces the product's rows.

### Predicates (built by `adminProductVisibilityPort`, embedded by `catalog`)

For a restricted scope with conditions `{(C, gt_zero)…}` ∪ `{(D, gte_zero)…}` over in-force
currencies only:

```sql
"products"."id" in (
  select f."product_id" from "product_catalogue_prices" f
   where (f."currency_code" = ? and f."generation" = ? and f."has_positive")
      or (f."currency_code" = ? and f."generation" = ?)        -- gte_zero: any row
)
```

`no_category`, or no in-force condition ⇒ `false`. Variant predicate: same over
`variant_catalogue_prices` with `"…"."id"` of the variant. Every value is a `?` placeholder.

## 3. Website-rule work tables (worker-written)

### `website_rule_previews`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `kind` | varchar(8) | `attach`, `change` |
| `product_rule_id` | uuid null | null for an unsaved draft of a new rule |
| `definition` | jsonb not null | the evaluated definition |
| `rule_version` | integer null | refused at confirm when moved |
| `sales_channel_ids` | uuid[] not null | |
| `status` | varchar(10) | `pending`, `ready`, `failed`, `applied`, `expired` |
| `counts` | jsonb | per channel `{ join, leave }` |
| `created_by_admin_user_id` | uuid | only the creator may confirm |
| `created_at`, `expires_at` | timestamptz | 15 min |

### `website_rule_preview_changes`

`(preview_id FK cascade, sales_channel_id, product_id, op 'join'|'leave')`, PK of the four.
Up to channels × products rows; deleted with the preview (expired previews are swept hourly).

### `website_rule_admissions` (FR-093, Q1 A)

| Column | Type | Notes |
| --- | --- | --- |
| `sales_channel_id` | uuid | |
| `product_id` | uuid | |
| `admitted_at` | timestamptz | written by the apply job with each governor-token add |
| `post_admission_status_seen` | boolean not null default false | the first channel-scoped status write after admission sets it and is exempt from the reactivation hook |

PK `(sales_channel_id, product_id)`; row deleted when the rule removes the product.

### `website_rule_stale_products`

`(product_id PK, marked_at)` — products to re-evaluate on every governed channel.

## 4. State transitions

- **Designation**: none → set → changed / cleared (each schedules a whole rebuild of the currency;
  until the swap the currency contributes **no** condition, because the served generation was built
  for another designation — TM-7 (4)) — in force ⇄ not in force is
  read-time and needs no transition.
- **Generation**: served n → building n+1 → swap (served n+1, rows of n deleted) → idle; a rebuild
  request while building restarts from the newer designation.
- **Preview**: pending → ready | failed → applied | expired.
- **Attachment**: none → attached (apply preview) → changed (apply preview) → detached (row
  deleted; membership unchanged — FR-058).

## 5. Kernel (platform package) — no schema change

`MembershipMutationOptions` gains `onGoverned`, `governorToken`, `source` (contracts/ports.md §5);
the membership audit row's `stateAfter` carries `source` (audit-state.md list rules apply: names
only). `MembershipMutationResult` gains `skippedGovernedChannelIds`.
