# Admin API (spec 193)

Zod schemas in `packages/contracts/src/product-visibility.ts`. All routes registered through
`ctx.routes` (gated by the module's effective presence). Writes take `If-Match` (row `version`)
where the row has one, run one Command each (FR-070), and answer the module's error codes
(contracts/events-and-errors.md §2). Permissions: `product_visibility:read` (GET),
`product_visibility:manage` (writes; `requires: ['product_visibility:read']`). **TM-4 c**: every
write also answers `403 FORBIDDEN` unless the caller's own scope is `unrestricted` — unreachable end
to end since FR-026 makes every `product_visibility:manage` holder unrestricted; kept as defence in
depth and unit-tested with a stubbed scope (T020). The overview
reports `mapping_without_effect` for a mapped role that later gained `*`, `product_visibility:manage`,
`platform.modules.activate` or `admin_users:manage` (always unrestricted, FR-026), and warns on a
mapped or fail-closed role holding `audit_logs:read` (FR-086).

## 1. Configuration — `/api/v1/admin/product-visibility`

| Method | Path | Body / answer |
| --- | --- | --- |
| GET | `/overview` | currencies (active + used-but-inactive) with designation, `designationStatus`, served generation and `building` flag; categories with conditions; roles with `{ effect: 'unrestricted' \| 'mapped_unrestricted' \| 'mapped' \| 'unmappable_unrestricted' \| 'mapping_without_effect' \| 'sees_no_products', categoryId?, warnings: 'audit_logs_read'[] }` (FR-024, FR-026, FR-086); website rules and attachments |
| POST | `/categories` | `{ name, conditions[{ currencyCode, threshold }] (≥1) }` → 201 |
| PATCH | `/categories/:id` | same fields, partial |
| DELETE | `/categories/:id` | 409 `VISIBILITY_CATEGORY_IN_USE` with `details[].issue = roleId` (FR-013) |
| PUT | `/role-mappings/:roleId` | `{ target: { kind: 'category', categoryId } \| { kind: 'unrestricted' } \| null }` (I-2); 409 `ROLE_NOT_MAPPABLE` for `platform_admin` and for a role holding a self-lifting permission (FR-022, FR-026) |
| PUT | `/designations/:currencyCode` | `{ priceListId, salesChannelId }`; 422 `DESIGNATION_INVALID` with the `designationStatus` reason when it is `not_found`, `currency_mismatch`, `not_regular`, `audience_restricted` or `not_on_channel` (RQ-1 A, US2-8); `not_active` / `outside_schedule` are accepted |
| DELETE | `/designations/:currencyCode` | back to the base book |
| GET | `/designations/:currencyCode/options` | `designatableBooks` |
| GET | `/attributes` | boolean/choice, non-scoped attributes with options (rule editor) |
| POST | `/product-rules` | `{ name, definition }` → 201 |
| PATCH | `/product-rules/:id` | `{ name?, definition? }` — a definition change on an **attached** rule is refused here (409 `WEBSITE_RULE_PREVIEW_REQUIRED`); it goes through a preview |
| DELETE | `/product-rules/:id` | 409 `PRODUCT_RULE_ATTACHED` |
| POST | `/website-rules/previews` | `{ kind: 'attach', productRuleId, salesChannelIds[] }` or `{ kind: 'change', productRuleId, definition }` → 202 `{ previewId }` |
| GET | `/website-rules/previews/:id` | `{ status, counts: { [channelId]: { join, leave } }, expiresAt }` |
| POST | `/website-rules/previews/:id/confirm` | applies (attach / change Command); 409 `WEBSITE_RULE_PREVIEW_STALE` (expired, rule version moved, or a channel got another rule); 409 `CHANNEL_ALREADY_GOVERNED` (FR-051) |
| DELETE | `/website-rules/attachments/:salesChannelId` | detach (FR-058) |

## 2. Catalog admin changes (`catalog`, Phases 5a – 5c)

- `GET /api/v1/admin/catalog/products`: for a restricted or no-category caller, `items`, `total`,
  `counts` cover visible products only; the response gains
  `visibility?: { restricted: true, reason?: 'no_category', categoryName?: string }` — **absent** for
  unrestricted callers (SC-003 byte-identical).
- `POST …/products/resolve-ids`, `POST …/products/batch-by-id`: visible only; totals likewise.
- `GET …/products/:productId/variants`: restricted ⇒ qualifying variants only (RQ-3 A); a product
  detail that embeds variants likewise.
- Every route under `…/products/:id` / `…/products/:productId` (≈ 60): hidden ⇒ the same answer as a
  non-existent id (`404 PRODUCT_NOT_FOUND`, or the route's own not-found), nothing written
  (FR-033); a hidden variant under `…/variants/:variantId` ⇒ that route's variant not-found.
- `GET …/bulk-operations`, `GET …/bulk-operations/:id`, `POST …/bulk-operations/:id/undo` (TM-1): a
  restricted caller sees only operations with no hidden product in their selection; undo of one
  touching a hidden product answers not-found.
- `URL_KEY_TAKEN` and every other error naming another product drop that product's id and name
  when it is hidden from the caller (TM-2).
- List routes send `Cache-Control: private, no-store` (TM-14).
- `POST …/products/bulk-update`: hidden ids treated as absent; a patch naming a governed channel
  ⇒ 409 `CHANNEL_MEMBERSHIP_GOVERNED` before enqueue (FR-054).
- Admin global search (`admin_search` host, catalog provider): visible products only, `hasMore`
  over visible rows (FR-034).
- FR-080 (OQ-D A, decided): links / grouped items / bundle options of a visible product omit hidden
  targets; adding a hidden target ⇒ target not-found.

## 3. Gated on spec 192 (Phases 9a, 9b)

- Admin product list/variant rows gain `noFixedPrice?: true` (restricted callers only; additive).
- The admin quote-request **line** projection (as left by spec 192) gains `noFixedPrice?: true` for a
  restricted caller, computed live through `checkLines` (FR-043, M7); absent for unrestricted callers.
  Marker texts are fixed: en "no fixed price", pl "brak ustalonej ceny".
  `ProductPicker` / product browser show the translated marker only on quote-request screens
  (RQ-2 C, OQ-12).
- `POST /api/v1/admin/orders`, `POST /api/v1/admin/orders/preview`,
  `POST /api/v1/admin/orders/:id/reorder`, `POST /api/v1/admin/orders/:id/clone-to-quote`:
  restricted caller with an out-of-category line (product or variant) ⇒ `422
  PRODUCT_NOT_IN_VISIBILITY_CATEGORY`, `details[].path = 'items.<i>'`, nothing saved (FR-037,
  RQ-2 C). Order **preview** answers it the same way as create.
- Quote request admin create / modify (`RfqAdminService`, as rewritten by 192): new line or changed
  product out of category ⇒ the same refusal; an existing out-of-category line keeps quantity,
  price edits and removal (FR-042).
- Rule-excluded products (FR-090, FR-091, Q3): quote → cart conversion and checkout / placement of a
  cart line from an accepted quote, and admin order create / preview / reorder / clone-to-quote,
  accept a product absent from the channel **only** because of its website rule
  (`productRuleGovernancePort.excludedOnlyByRule`); every other out-of-channel case answers as today.
