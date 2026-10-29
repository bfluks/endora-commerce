# Contract: list-filter API, port and error code (`specs/157-custom-fields-list-filters/`)

Zod first (Constitution II): every shape below is written in `packages/contracts/` before the
route that uses it. All changes are **additive** — no existing member changes type or meaning,
except the Opportunities list's handling of `custom:` field filters (§5.3, FR-011a), which the
spec makes a deliberate behaviour change.

## 1. `packages/contracts/src/custom-fields.ts`

### 1.1 Definition attribute

```ts
// customFieldDefinitionSchema
listFilter: z.boolean(),                       // response: always present

// createCustomFieldDefinitionSchema (.extend)
listFilter: z.boolean().optional(),           // absent ⇒ false

// updateCustomFieldDefinitionSchema (.extend)
listFilter: z.boolean().optional(),           // absent ⇒ unchanged

// CustomFieldDefinitionRecord (port record)
listFilter: boolean;

// customFieldEntityTypeInfoSchema
listFilter: z.boolean(),                       // the type offers the option (registry marker)
```

`CUSTOM_FIELD_DEFINITION_ERROR_CODES` gains `'list_filter_unsupported'` (published union;
additive).

### 1.2 Filter shapes and their caps

```ts
export const customFieldFilterSchema = z.object({
  contains: z.string().trim().min(1).max(200).optional(),
  in: z.array(z.string().min(1).max(200)).min(1).max(50).optional(),
  is: z.boolean().optional(),
  min: decimalBound.optional(),          // /^-?\d{1,12}(\.\d{1,4})?$/
  max: decimalBound.optional(),
  from: calendarDateSchema.optional(),
  to: calendarDateSchema.optional(),
}).strict();
export type CustomFieldFilter = z.infer<typeof customFieldFilterSchema>;

/** Threat model F-1: bounds the work one list request can ask of the database. */
export const CUSTOM_FIELD_FILTERS_MAX_KEYS = 10;
export const CUSTOM_FIELD_FILTERS_MAX_IN_VALUES = 100;   // summed over every key's `in`

export const customFieldFiltersSchema = z
  .record(customFieldDefinitionSchema.shape.key, customFieldFilterSchema)
  .refine((f) => Object.keys(f).length <= CUSTOM_FIELD_FILTERS_MAX_KEYS, 'Too many custom-field filters')
  .refine(
    (f) => Object.values(f).reduce((n, x) => n + (x.in?.length ?? 0), 0) <= CUSTOM_FIELD_FILTERS_MAX_IN_VALUES,
    'Too many custom-field filter values',
  );
export type CustomFieldFilters = z.infer<typeof customFieldFiltersSchema>;

/** `customFieldFilters` query parameter: the record above as JSON, ≤ 8000 characters. */
export const customFieldFiltersQueryParamSchema: z.ZodType<CustomFieldFilters | undefined, …, string | CustomFieldFilters | undefined>;
```

The record's key schema is the definition key schema (`^[a-z][a-z0-9_]{0,63}$`), so `__proto__`
and every key with a dot, a colon, markup, an upper-case letter or more than 64 characters are
refused at the boundary (`__proto__` explicitly as well: Zod's record skips an own `__proto__` key
without a word, so the schema refuses it ahead of the record). `constructor` **matches** the regex
(`toString` does not — it has an upper-case letter); every consumer of a key therefore
looks it up through a `Map` or `Object.hasOwn` on an `Object.create(null)` record — never `in`,
never a plain-object index (threat model F-4; §1.4, admin-surfaces §1.3).

The per-filter `in` cap (50) is the CRM schema's and stays shared with the board (R-6). The two
record-level caps (10 keys, 100 `in` values in total) are this record's; CRM's
`OpportunityFieldFiltersSchema` keeps its own 20-reference cap for the board (FR-016), and the
port re-applies this record's caps itself (§1.4), so the CRM list cannot reach the port with more.

The parameter schema mirrors `fieldFiltersParamSchema` (`crm.ts:386-410`): empty/absent ⇒
`undefined`; not JSON ⇒ issue `customFieldFilters is not JSON`; shape issues re-added with their
path relative to the parameter (`[key, operator]`). **An array input is refused** (a repeated
`customFieldFilters=…&customFieldFilters=…` reaches Zod as an array; neither the string branch
nor `z.record` accepts it) — threat model F-3.

**It must be idempotent: `parse(parse(raw))` equals `parse(raw)`.** The platform registers
`@fastify/type-provider-zod`'s `validatorCompiler` (`packages/platform/src/http/server.ts:130`),
which **replaces** `request.query` with the parsed output, and the Orders list and export
handlers parse `request.query` a second time with the same `adminOrdersListQuerySchema`
(`packages/modules/orders/src/backend/routes.ts:604`, `:627`). Every existing member survives a
second pass (`multiQueryParam` takes an array, `z.coerce` a number); a plain `string → object`
transform would not. So the input is `string | CustomFieldFilters`: a string is JSON-parsed then
validated, a plain non-array object is validated by `customFieldFiltersSchema` directly. CRM's own
`fieldFiltersParamSchema` is not on a route schema and is left as it is.

`crm.ts` replaces its own operator object with
`export const OpportunityFieldFilterSchema = customFieldFilterSchema;` — the same object; its
`OpportunityFieldFilter` type, its record (and the record's 20-reference cap) and its parameter
schema are otherwise unchanged. `opportunityBoardFieldRefSchema` already applies
`custom:[a-z][a-z0-9_]{0,63}` to every reference before anything echoes it (`crm.ts:285-287`,
threat model F-13 — confirmed on `fda284a45`, re-confirmed on `3d9ca98cd`).

### 1.3 What a list offers

```ts
export const customFieldListFilterFieldSchema = z.object({
  key: customFieldDefinitionSchema.shape.key,
  valueType: customFieldValueTypeSchema,
  label: localizedLabelSchema,
  labelDefault: z.string(),
  options: z.array(z.object({ value: z.string(), label: localizedLabelSchema, labelDefault: z.string() })),
}).strict();
export type CustomFieldListFilterField = z.infer<typeof customFieldListFilterFieldSchema>;
export const customFieldListFilterFieldsResponseSchema = z.object({ data: z.array(customFieldListFilterFieldSchema) });
```

**Never in this DTO** (threat model F-7): `audience`, `required`, `config`, `listFilter`, `id`,
`sortOrder`. The routes that serve it are admin-only (§4, §5); `listFilter` is not added to any
customer-facing projection (`projectForCustomer`, storefront DTOs).

### 1.4 Port (plain TypeScript, no Zod — an in-process seam)

```ts
/** Container name: `customFieldListFilterPort`. Owner: `custom_fields` (nonDeactivatable). */
export interface CustomFieldListFilterPort {
  listFilterable(entityType: SupportedEntityType): Promise<CustomFieldListFilterField[]>;
  /**
   * The whole request's filters as **one** condition — one scan of the bound host table,
   * every predicate of every key ANDed in its WHERE — or `null` when nothing applies.
   */
  condition(
    entityType: SupportedEntityType,
    filters: CustomFieldFilters | undefined,
  ): Promise<CustomFieldListFilterCondition | null>;
}
export interface CustomFieldListFilterCondition {
  /** `select t."id" from "<bound table>" t where (<p1>) and (<p2>) …` — every key and value bound. */
  readonly sql: string;
  readonly params: readonly unknown[];
}
export interface CustomFieldFilterUnavailableFailure extends Error {
  readonly name: 'CustomFieldFilterUnavailableError';
  readonly keys: readonly string[];
}
export function isCustomFieldFilterUnavailableFailure(e: unknown): e is CustomFieldFilterUnavailableFailure;
```

Semantics:

- `listFilterable` — the **served** definitions of the type (owner module present) with
  `listFilter` on; `[]` for a type without the registry marker or whose owner is absent. Reads the
  per-entity cache.
- `condition`, in this order:
  1. `null` for `undefined` or `{}`.
  2. **Caps** — the input is parsed with `customFieldFiltersSchema` first; a breach (more than 10
     keys, more than 100 `in` values in total, a key failing the regex) throws the `ZodError`,
     which every host rethrows and the platform answers as 400 `VALIDATION_FAILED`
     (`packages/platform/src/http/error-envelope.ts:236`, an `instanceof ZodError` branch — so the
     error must be the one `parse` throws, never re-wrapped; T023 and T033 assert the 400 end to
     end, which would catch two `zod` copies breaking the `instanceof`). Nothing is
     read and nothing is built. For Orders and Quote Requests this is a second line behind the
     parameter schema; for the CRM list (whose record allows 20 references) it is the line.
  3. **Availability** — every key is looked up in a `Map` of the type's served, `listFilter`-on
     definitions (never a plain-object index: `constructor` is a valid key). If any key has no
     entry, one failure names **all** such keys (in request order) and nothing is built.
  4. **Operators** — an operator that does not apply to its definition's value type
     (`CUSTOM_FIELD_FILTER_OPERATORS`) is **refused, not ignored** (FR-011: a filter is never
     dropped silently): `assertCustomFieldFilterOperators` throws one `ZodError` naming every such
     operator at `[key, operator]`, answered 400 `VALIDATION_FAILED`, and nothing is built. The key
     *is* available, so `CUSTOM_FIELD_FILTER_UNAVAILABLE` would misname the problem. (Amended after
     the backend QA, owner ruling 2026-10-19; it was "ignored".) An inverted range — `min` above
     `max`, `from` after `to` — is refused the same way (`assertCustomFieldFilterRanges`), since it
     could only match nothing.
  5. **One condition** — the predicates of every key (`min`+`max` and `from`+`to` on one key are
     two predicates of the same scan), ANDed in one `where`. `null` when no key names an
     operator. OR within a key is inside its predicate. A number bound compares only a stored
     JSON number and a date bound only a stored string, so a value that drifted to another type
     neither matches nor fails the read.
- **SQL rules** (threat model F-9): the table and column come from the storage binding, never
  from the caller; every key and value is a `?` parameter; no jsonb `?`/`?|`/`?&` operator (they
  collide with the placeholder — `->`, `->>`, `jsonb_typeof`, `jsonb_array_elements_text` only);
  no `::date` cast — dates compare as `YYYY-MM-DD` text; `::numeric` only inside the
  `jsonb_typeof(…) = 'number'` guard; text patterns escape `%`, `_`, `\`.
- **Callers create the raw fragment once per statement** (threat model F-2): a host keeps the
  `{ sql, params }` value and wraps it as
  `{ id: { $in: raw('(' + c.sql + ')', [...c.params]) } }` **freshly for every statement** it runs
  (CRM's `boardFieldFilterConditions` states the same rule: "a raw fragment is not reused").
- **Work bound** — one sequential scan of the host table per list statement whatever the number
  of keys, at most 20 predicates (10 keys × 2) and at most ~120 bound parameters. The remaining
  backstops are the hosts' own: the Orders list's `pageSize` cap and `ORDER_EXPORT_MAX_ROWS`
  (10 000, `order-export-service.ts:4`) bound the rows materialised; the Quote Request whole-set
  read has neither (R-9 leaves that to #317). **No statement timeout exists** in the platform
  today (no `statement_timeout` on `fda284a45`, nor on `3d9ca98cd`); adding one is a platform change, not this
  feature's (research R-16).

## 2. Error code

| Code | HTTP | Owner (manifest) | Raised by | `details` |
| --- | --- | --- | --- | --- |
| `CUSTOM_FIELD_FILTER_UNAVAILABLE` | 400 | `custom_fields` | `orders` (list, export), `quote_requests` (list), `crm` (Opportunities list) | `{ key: string, keys: string[] }` |
| `CUSTOM_FIELD_OPTION_IN_USE` | 409 | `custom_fields` | `custom_fields` (option `DELETE`) | `{ value: string, label: string }` |
| `CUSTOM_FIELD_VALUE_TYPE_LOCKED` | 409 | `custom_fields` | `custom_fields` (definition `PATCH`) | `{ key: string }` |
| `CUSTOM_FIELD_STORED_VALUES_EXIST` | 409 | `custom_fields` | `custom_fields` (definition `POST`) | `{ key: string }` |

The three 409 codes were added in the final review round (owner ruling 2026-10-19); they replace
`CUSTOM_FIELD_DEFINITION_INVALID` and an English message for those refusals. A mismatched operator
and an inverted range are not codes of their own: they are 400 `VALIDATION_FAILED` (§1.4).

Sentences (`packages/modules/custom_fields/i18n/{en,pl}.json`):

- en `errors.CUSTOM_FIELD_FILTER_UNAVAILABLE`: `The filter on the custom field "{key}" is not available on this list. Remove it and try again.`
- pl: the same sentence in Polish, with `{key}` kept as a token (written in `pl.json` only; specs stay English — Principle VIII).

`{key}` always passed the key regex before the port named it, so the sentence never interpolates
markup. The admin still renders it — and any `details.key` — as text only (admin-surfaces §2,
threat model F-5).

Minted per the four-place rule in one commit: `ERROR_CODES` (`packages/contracts/src/errors.ts`),
`MINTED_ERROR_CODES` (`to: 'custom_fields'`, reason naming the three raisers and the port as the
deciding seam), the `custom_fields` manifest `errorCodes`, both bundles.

## 3. Definition admin routes (`custom_fields`, existing paths)

| Route | Change |
| --- | --- |
| `GET …/custom-fields/entity-types` | each item gains `listFilter: boolean`; `quote_request` omitted while `quote_requests` is not present |
| `GET …/custom-fields/definitions[?entityType]`, `GET …/definitions/:id` | items gain `listFilter`; `quote_request` definitions not served while `quote_requests` is off (404 by id) |
| `POST …/definitions` | accepts `listFilter`; `true` on a type without the marker → 422 `CUSTOM_FIELD_DEFINITION_INVALID`; `quote_request` while off → 409 `CUSTOM_FIELD_HOST_MANAGED` |
| `PATCH …/definitions/:id` | accepts `listFilter`, same refusals; one Command, audited. Absent members are unchanged — `config` in particular is replaced only when sent (`custom-field-definition-apply.ts:144`), and the editor never sends it (admin-surfaces §3, threat model F-6) |
| `DELETE …/definitions/:id` | `quote_request` while off → 409 |
| option sub-routes (`POST …/options`, `PATCH …/options/:id`, `DELETE …/options/:id`) | unchanged rules; `quote_request` while off → 409 |

**Concurrent edits** (threat model F-6): last write wins per member. Because the editor sends
only changed members, two admins editing different members of one definition do not overwrite
each other. An optimistic-concurrency precondition (`If-Match`) is deferred to
`custom-fields-value-carry`, which adds edits whose loss would matter more.

## 4. Orders (`orders`)

| Route | Change |
| --- | --- |
| `GET /api/v1/admin/orders` | `adminOrdersListQuerySchema` gains `customFieldFilters: customFieldFiltersQueryParamSchema`; rows, `total`, `counts`, `paymentStatusCounts` all narrowed by the **same** condition, wrapped fresh in each of the three statements; refusal 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE` |
| `GET /api/v1/admin/orders/export` | same schema, same narrowing (the export's `list()` call is a fourth statement with its own fragment), same refusal (FR-015); `x-export-row-count` equals the list's `total` up to `ORDER_EXPORT_MAX_ROWS` |
| **new** `GET /api/v1/admin/orders/custom-field-filters` | `orders:read`; `{ data: CustomFieldListFilterField[] }` for `order` |

`OrderListQuery.customFieldFilters?: CustomFieldFilters`; storefront and API-key callers of
`OrderListService` never set it (FR-017).

## 5. Quote Requests and Opportunities

### 5.1 `quote_requests`

| Route | Change |
| --- | --- |
| `GET /api/v1/admin/quote-requests` | accepts `customFieldFilters` (parsed in the handler; no route querystring schema — research R-9). **Before the schema**, a present value that is not a single string (a repeated parameter arrives as an array) → 400 `VALIDATION_FAILED`. The condition is pushed into `where.$and` (never assigned to `where.id`) **before** the visibility and scope passes; refusal 400 |
| **new** `GET /api/v1/admin/quote-requests/custom-field-filters` | `rfqs:handle`; registered in the module's admin route function (gated with the module) |

The admin Quote Request detail already returns the full value bag to an admin
(`quoteCustomFieldValuesFor(…, forAdmin)` returns the bag, `rfq-service.ts:1336-1343`), so a list
filter on an `internal` field reveals nothing an `rfqs:handle` holder cannot already read (threat
model F-7).

### 5.2 `crm`

| Route | Change |
| --- | --- |
| **new** `GET /api/v1/admin/crm/opportunities/custom-field-filters` | `crm:read`; `{ data }` for `opportunity` |

### 5.3 `GET /api/v1/admin/crm/opportunities` — `fieldFilters` (FR-011a, research R-8)

| Request | `custom:<key>` reference | `builtin:<key>` reference |
| --- | --- | --- |
| `cardValues=true` (board lane continuation) | card rule, unchanged — a reference that is neither on the card nor list-filter-enabled is **ignored**, never 400 | card rule, unchanged |
| otherwise (the Opportunities list) | FR-011: option on ⇒ filtered whether on the card or not; otherwise 400 `CUSTOM_FIELD_FILTER_UNAVAILABLE`; the `custom:` subset goes to the port as one record, so more than 10 `custom:` references or 100 `in` values → 400 `VALIDATION_FAILED` | card rule, unchanged |

`cardValues` is a **mode switch, never a security boundary** (threat model F-8): either mode runs
inside the same tenant-scoped, assignment-scoped statement, so a client choosing board semantics
gains only the card rule's narrower filter set, never a wider result. The handler carries a
comment saying so.

`fieldFilters` is a `z.string()` parameter, so a repeated `fieldFilters` is already refused with
400 `VALIDATION_FAILED` by the route schema (threat model F-3; tested, not changed).

The `fieldFilters` doc comment in `crm.ts:420` is updated to say this. `GET …/crm/board` is
unchanged (FR-016).

## 6. OpenAPI baseline

`backend/test/fixtures/openapi-baseline.json` records paths, methods and the 200 description.
The three new `…/custom-field-filters` routes are added by
`UPDATE_OPENAPI_BASELINE=1` on `backend/test/contract/kernel/openapi-baseline.test.ts`; a diff
touching anything else is a defect, not a re-record.
