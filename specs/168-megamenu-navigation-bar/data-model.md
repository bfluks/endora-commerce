# Data Model: Megamenu navigation bar

Feature 168 changes one table, `megamenu_items`, and no other module's tables.

## 1. `megamenu_items` — new and changed columns

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| `kind` | `varchar(32)` | no | — | Widened set: `category-link`, `cms-page-link`, `external-link`, `button`, `asset`, `cms-block-embed`, **`group`**, **`category-tree`**. |
| `presentation` | `varchar(16)` | **yes** | — | `link`, `dropdown`, `mega`, `catalog`. Set exactly on top-level rows. |
| `alignment` | `varchar(8)` | **yes** | — | `start`, `end`. Set exactly on top-level rows. |
| `audience` | `jsonb` | no | `'{"kind":"everyone"}'` | `{ "kind": "everyone" \| "guests" \| "signed_in" }` or `{ "kind": "customer_groups", "customerGroupIds": [uuid, …] }`. |

Constraints:

- `megamenu_items_presentation_check` — `presentation in ('link','dropdown','mega','catalog')`.
- `megamenu_items_alignment_check` — `alignment in ('start','end')`.
- `megamenu_items_tab_fields_check` — `(parent_id is null) = (presentation is not null and alignment is not null)`
  and `(presentation is null) = (alignment is null)`.

Migration backfill (R-10): top-level rows get `presentation = 'mega'`, `alignment = 'start'`
before the constraint is added. `down()` drops the constraints and columns.

## 2. `target` per kind (jsonb, validated at the Zod boundary)

| Kind | Target |
| --- | --- |
| `group` | `{}` |
| `category-tree` | `{ "rootCategoryId": uuid \| null, "depth": 1 \| 2 \| 3 }` |
| others | unchanged from feature 015 |

The GIN index on `target` already covers `rootCategoryId` for a future category-reference
scan.

## 3. Item rules (refused on save)

| Rule | Code |
| --- | --- |
| A tab of kind `asset`, `cms-block-embed` or `category-tree` | `MEGAMENU_KIND_NOT_ALLOWED_AS_TAB` |
| Presentation or alignment on a non-tab item, or missing on a tab | `VALIDATION_FAILED` (Zod / normaliser) |
| A `link` tab with children, or a `link` tab of kind `group` | `MEGAMENU_LINK_TAB_INVALID` |
| A `category-tree` depth outside 1–3 | `VALIDATION_FAILED` (Zod) |
| An `external-link`, `button` or `group` without a label in a bound language | `MEGAMENU_LABEL_REQUIRED` |
| A `category-tree` root that does not exist | `MEGAMENU_TARGET_OUT_OF_SCOPE` (existing) |
| A `customer_groups` audience naming a group that does not exist | `MEGAMENU_TARGET_OUT_OF_SCOPE` (existing) |

Warnings (save succeeds, `meta.warnings`): `MEGAMENU_DEPTH_EXCEEDED` (existing),
`MEGAMENU_DROPDOWN_DEPTH_IGNORED`, `MEGAMENU_PROMO_SLOT_TAKEN`.

## 4. Audit state (`megamenu.items.set`)

`{ items: [{ id, parentId, position, kind, presentation, alignment, audience, labels, target }] }`
— descriptions omitted, as `cms` omits page content.
