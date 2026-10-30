# Data model: Custom fields as admin list filters (`specs/157-custom-fields-list-filters/`)

One column, owned by `custom_fields`. No new table, no host-table change, no tenant-scoped
entity added. Everything else in this feature is a **transient** shape (a request parameter, a
saved-view member, a port answer).

## 1. `custom_field_definitions.list_filter` (owner: `custom_fields`)

| Column | Type | Null | Default | Meaning |
| --- | --- | --- | --- | --- |
| `list_filter` | `boolean` | not null | `false` | The definition is offered as a filter on the admin list of its entity type (FR-001) |

- **Migration** — scaffolded, never numbered by hand:
  `pnpm --filter backend run migration:new -- --module custom_fields --name definition_list_filter`.
  `up`: `alter table "custom_field_definitions" add column "list_filter" boolean not null default false;`
  `down`: `alter table "custom_field_definitions" drop column "list_filter";`
  Every existing definition reads `false` (spec: default off). References no other module's
  table; `custom_fields`' manifest `dependencies` are unchanged. Registered with
  `pnpm --filter backend run composer:generate` and the regenerated
  `backend/src/db/migrations-registry.generated.ts` committed with it.
- **Entity** — `CustomFieldDefinition.listFilter: boolean = false`
  (`packages/modules/custom_fields/src/backend/entities/custom-field-definition.entity.ts`), added
  to `[OptionalProps]`. The class stays `@GlobalEntity()` (platform-global, Principle XI is
  inherited by the host rows the values live on).
- **Validation rules** (service + apply seam, `custom-field-definition-apply.ts`):
  - `listFilter: true` is accepted only where the type's registry entry carries `listFilter: true`
    (R-2) — today `order`, `quote_request`, `opportunity`; elsewhere
    `CustomFieldDefinitionError('list_filter_unsupported')` → 422
    `CUSTOM_FIELD_DEFINITION_INVALID`. `false` is always accepted.
  - Every value type may carry it (FR-002).
  - Toggling it writes the definition row only — never a host row (FR-004).
- **Audit** — `snapshotDefinition` includes `listFilter`, so `custom_fields.definition.updated`
  carries it in `before`/`after` (FR-003).
- **Cache** — no new invalidation path: every definition Command already calls
  `cache.publishInvalidate(entityType)` (Redis fan-out + 5 s TTL fallback,
  `custom-field-definition.service.ts`), and the list-filter port reads through that cache.
- **Off state** — while a type's owner module (`crm`, now also `quote_requests`) is not present,
  its definitions are not served, so neither the option nor a filter is offered; the column keeps
  its value and takes effect again with the owner (FR-005).

## 2. Registry metadata (code, not schema)

`SupportedEntityMeta` (`custom-field-registry.ts`):

| Entry | Change |
| --- | --- |
| `order` | `+ listFilter: true` |
| `quote_request` | `+ listFilter: true`, `+ ownerModuleId: 'quote_requests'` (FR-005a) |
| `opportunity` | `+ listFilter: true` (already `ownerModuleId: 'crm'`) |
| `category`, `organization`, `customer`, `product` | unchanged — no `listFilter` |

## 3. Host storage binding (existing, reused)

The port reads the value bag through the binding the change-guard probes already use,
`HOST_TABLE_BY_ENTITY` (`custom-field-value.service.ts`): `orders.custom_field_values`,
`quote_requests.custom_field_values`, `crm_opportunities.custom_field_values`. Each of those
tables has primary key `id`, which the condition's subquery selects. The binding moves into a
small shared module inside `custom_fields` (`services/host-storage-binding.ts`) so the value
service and the list-filter service read one map.

## 4. Transient shapes

### 4.1 `CustomFieldFilter` (one key)

`{ contains?, in?, is?, min?, max?, from?, to? }` — the CRM operator object, `.strict()`; bounds
as in `crm.ts:361-377` (`contains` 1–200 trimmed; `in` 1–50 entries of 1–200; `min`/`max`
decimal strings `-?\d{1,12}(\.\d{1,4})?`; `from`/`to` calendar dates). Operators not of the
field's value type are ignored (research R-6).

### 4.2 `CustomFieldFilters`

`Record<definitionKey, CustomFieldFilter>`, keys matching `^[a-z][a-z0-9_]{0,63}$`, at most 10
keys and 100 `in` values in total (threat model F-1; CRM's board record keeps 20 references).
Held in prototype-free records (`Object.create(null)` / `Map`) wherever it is indexed by key —
`constructor` is a valid key. On the wire as `customFieldFilters=<JSON>` (≤ 8000 characters) on Orders, the Orders CSV
export and Quote Requests; as `fieldFilters` with `custom:<key>` references on the Opportunities
list.

### 4.3 Saved view member

`filters.customFields: CustomFieldFilters` inside the opaque saved-view `filters`
(`packages/contracts/src/saved-list-views.ts`), on the Orders and Quote Requests lists. Counted
in the 8192-byte limit. Dropped key-by-key on load when no longer offered (FR-014).

### 4.4 Page address

`cf.<key>.<operator>=<value>`, `in` repeated (research R-7).

### 4.5 `CustomFieldListFilterField` (what a list offers)

```ts
{
  key: string;
  valueType: CustomFieldValueType;
  label: Record<string, string>;
  labelDefault: string;
  options: Array<{ value: string; label: Record<string, string>; labelDefault: string }>;
}
```

Ordered by the definition's `sortOrder`, then `key`; options by `sortOrder`. No `audience`,
`required` or `config` — an `internal` field is offered in the admin like any other (FR-017).

### 4.6 `CustomFieldListFilterCondition` (port answer)

**One per request, or `null`.** `{ sql: string; params: readonly unknown[] }` where `sql` is
`select t."id" from "<bound table>" t where (<p1>) and … and (<pn>)` — every predicate of every
filtered key in one scan (n ≤ 20), every key and value a bound `?` parameter; the table name comes
from the binding of §3, never from the caller. A host wraps it in a fresh `raw()` for each
statement it runs (contract `list-filter-api.md` §1.4).

## 5. What does not change

- No host table, entity or migration in `orders`, `quote_requests` or `crm`.
- `order_list_saved_views` / `quote_request_list_saved_views` — `filters` is already opaque.
- Stored custom-field values on any record (FR-004, FR-003a).
- `custom_field_options` — option CRUD keeps its rules (value immutable, `option_in_use`).
