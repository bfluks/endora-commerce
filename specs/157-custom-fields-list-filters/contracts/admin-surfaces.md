# Contract: admin surfaces (`specs/157-custom-fields-list-filters/`)

Admin UI only. No new route, page, permission code, palette action or nav entry (FR-019; the
editor is a dialog on the existing `/custom-fields`, which is already in the palette as
`open-custom-fields`). Every component test renders inside `<StrictMode>`.

## 1. Kit: `@endora-commerce/admin-kit/components`

Files under `packages/admin-kit/src/components/custom-field-filters/`; exported from the
explicit barrel (no `export *`).

### 1.1 `useCustomFieldListFilterFields(endpoint: string)`

`{ fields: CustomFieldListFilterField[]; status: 'loading' | 'ready' | 'error' }`. One `GET` per
mount through the kit's `apiClient`; a StrictMode double mount must not leave `status` stuck
(set the "alive" flag in the effect body, clear it in cleanup — 147's rule).

### 1.2 `<CustomFieldListFilters>`

```ts
interface CustomFieldListFiltersProps {
  idPrefix: string;
  fields: readonly CustomFieldListFilterField[];
  value: CustomFieldFilters;
  /** One key's filter, whole; `null` when nothing of it is left. */
  onChange: (key: string, filter: CustomFieldFilter | null) => void;
  language: string;
}
```

Renders grid cells (no container), one per field, by value type: `text` — search input,
committed after a 300 ms pause; `number` — min/max inputs (decimal comma accepted), paused;
`date` — from/to date inputs; `boolean` — select *Any / Yes / No*; `select`/`multiselect` — kit
`MultiSelect` of the options in their order (searchable over 8). Labels: `label[language]` →
`label[base language]` → `labelDefault` (the detail screens' rule), options likewise.

### 1.3 Pure helpers

| Helper | Contract |
| --- | --- |
| `readCustomFieldFilterParams(params: URLSearchParams): CustomFieldFilters` | reads `cf.<key>.<op>`; **re-applies the key regex** `^[a-z][a-z0-9_]{0,63}$` and drops a parameter whose key fails it; drops a malformed operator value (validated by `customFieldFilterSchema`); keeps every well-formed key **including unknown ones** (the server refuses those — US1-9); at most `CUSTOM_FIELD_FILTERS_MAX_KEYS` (10) keys and `CUSTOM_FIELD_FILTERS_MAX_IN_VALUES` (100) `in` values, the rest dropped in address order |
| `writeCustomFieldFilterParams(params: URLSearchParams, filters): URLSearchParams` | removes every `cf.*` then writes `filters`; other parameters untouched; round-trips with `read` |
| `sanitizeCustomFieldFilters(saved: unknown, fields): { kept: CustomFieldFilters; dropped: string[] }` | FR-014: keeps a key only if offered **and** its filter parses; `dropped` in input order; also prunes `in` values that are not among the field's current options (an option removed since — spec edge case), dropping the key when nothing of it is left |
| `pruneRemovedOptions(filters, fields): CustomFieldFilters` | for filters read from the **address** once the fields have loaded: removes `in` values not among a **known** field's options (the server would match nothing on them, and the control cannot show them); never removes an unknown key — that one is the server's to refuse (US1-9) |
| `customFieldFilterChips(fields, filters, language, t): Array<{ id; label; remove: () => CustomFieldFilters }>` | one chip per key: `"<label>: <summary>"` (options' labels joined; `≥ a`, `≤ b`, `a – b`; *Yes*/*No*; *contains "x"*) |
| `customFieldFilterRefusal(error: unknown): string \| null` | the refused key from an `ApiError` whose code is `CUSTOM_FIELD_FILTER_UNAVAILABLE` (`details.key`), else `null` |
| `toCustomFieldFiltersParam(filters): string \| null` | the JSON for `customFieldFilters`, keys sorted, empty ⇒ `null` |

**Key-indexed state is prototype-free** (threat model F-4). `constructor` passes the key regex
(`toString` and `hasOwnProperty` do not — the regex refuses capitals — and are dropped like any
malformed key), so every helper builds its records with
`Object.create(null)` (or a `Map`) and tests membership with `Object.hasOwn` — never `key in
obj` and never a bracket lookup on a plain object. `cf.constructor.in=x` reads as an ordinary
unknown key, is sent, and is refused by the server like any other.

### 1.4 `core` keys (en + pl, `packages/modules/_i18n/i18n/{en,pl}.json`)

`customFieldFilters.any`, `.yes`, `.no`, `.contains` (placeholder), `.containsChip`
(`contains “{text}”`), `.min`, `.max`, `.minShort`, `.maxShort`, `.from`, `.to`, `.rangeChip`,
`.fromChip`, `.toChip`, `.searchOptions`, `.notice.dropped`
(`{count, plural, …}`-free wording: "Some filters of this view are no longer available and were
removed: {fields}."), `.error.unavailable` ("The filter “{field}” is no longer available on this
list."), `.error.remove` ("Remove this filter"), `.loadFailed`. Final wording is the designer's;
every key exists in both files (`check:bundle-pairing`, a bundle-completeness test).

## 2. List pages

All three: filters offered = `useCustomFieldListFilterFields(<host endpoint>)`; changes return the
list to its first page; the address carries `cf.*` (written with `setSearchParams(…, { replace:
true })`, other parameters preserved); a refusal shows an error Alert naming the field (label if
offered, else key) with *Remove this filter*.

**Keys and server text are rendered as text only** (threat model F-5): the refusal Alert, the
dropped-filter notice and the chips put a field's label or key into the React tree as a string
child or an i18next interpolation value — never `dangerouslySetInnerHTML`, never a `Trans`
component or an HTML-bearing bundle value, never `escapeValue: false` for these keys. A key shown
in the UI is truncated to 64 characters with an ellipsis (the regex already caps a well-formed key
at 64; the truncation covers a `details.key` that did not come from this client).

| Page | Request parameter | Chips | Saved views | Extra |
| --- | --- | --- | --- | --- |
| `OrdersList.tsx` | `customFieldFilters` (also on the CSV export link) | yes, beside the existing chips | `filters.customFields`, sanitised on load (FR-014) | export link not offered while a refusal stands |
| `RfqList.tsx` | `customFieldFilters` on the server fetch (re-fetch on change) | yes | `filters.customFields`, sanitised on load | client-side status/search/sort/paging unchanged |
| `OpportunitiesList.tsx` | `fieldFilters` with `custom:<key>` refs, never `cardValues` | none (the page shows no chips) | none (the list has none) | resets the cursor trail; board page untouched |

## 3. `/custom-fields` — `CustomFieldsPage.tsx`

- **Table** — new *List filter* column (translated *Yes* / —); an *Edit* row action (pencil,
  accessible name `Edit {key}`) for holders of `custom_fields:write`; *Delete* and the audience
  select also only for them (today they render for anyone with `custom_fields:read` and the server
  refuses — US3-9 asks that no edit control be offered).
- **Create form** — unchanged fields plus `DefinitionBehaviourFields`; every label translated.
- **`DefinitionEditorDialog`** (module-local, `src/admin/components/`) on the kit `ModalDialog`:
  Identity (read-only key, entity type label, value type label), Labels (default — required; `en`;
  `pl`), Rules (`required` checkbox; when it goes from off to on, the FR-003b notice
  `customFields.editor.requiredNotice`), Options (§3.1), `DefinitionBehaviourFields`. *Save* sends
  one `PATCH` whose body holds **only the members the operator changed** among `labelDefault`,
  `label`, `required`, `listFilter` (threat model F-6) — never `config`, `options`, `valueType` or
  `key`; nothing changed ⇒ no request. It closes on success; a refusal keeps the dialog open with
  the server sentence; busy state blocks Escape/scrim. (`config` is replaced wholesale when sent;
  if a later edit ever must send it, it round-trips the value read with the definition — never a
  rebuilt object.)
- **`DefinitionBehaviourFields`** — the one block both the create form and the editor render:

  ```ts
  interface DefinitionBehaviourFieldsProps {
    /** The definition being created (the form's draft, no `id`) or edited. */
    definition: {
      id?: string;
      key: string;
      valueType: CustomFieldValueType;
      options: ReadonlyArray<{ value: string; label: LocalizedLabel; labelDefault: string }>;
      audience: CustomFieldAudience;
    };
    /** The `entity-types` entry of the definition's type. */
    entityTypeInfo: CustomFieldEntityTypeInfo;
    value: { listFilter: boolean };
    onChange: (next: { listFilter: boolean }) => void;
    disabled?: boolean;
  }
  ```

  Today it renders the *Use as list filter* checkbox with help text only when
  `entityTypeInfo.listFilter`; `definition` is passed now so the block's signature does not change
  when a behaviour depends on the field itself. **This is the seam
  `custom-fields-value-carry` extends**: it may add its carry toggles inside this block, a
  warning slot in the Options section (§3.1), and a confirm step before *Save* — each by
  **additive props** (new optional members of these props and of the dialog's), never by a
  restructure of the dialog or of its save path.
- **`FALLBACK_ENTITY_TYPES`** — `quote_request` removed (FR-005a); pinned by its own admin test in
  Phase 2 (T015a).

### 3.1 Options section (select / multiselect)

Each row: stored value (read-only text), default label, `en`, `pl`, *Default* checkbox,
`TouchReorderButtons` (+ `ReorderAnnouncer`), *Remove*. Each action is applied immediately through
the existing option sub-routes and reports at its row: relabel/default on blur or *Apply*,
reorder patches the `sortOrder` of the options that moved, remove asks for confirmation
(in-dialog, no native `confirm`) and shows `option_in_use`'s sentence when refused. An *Add option*
row takes value + labels. After every option action the dialog re-reads the definition. An option
action sends only that option's changed members (labels, `isDefault`, `sortOrder`), never `value`.

### 3.2 `custom_fields` keys (en + pl)

Moved from hard-coded English: `customFields.form.entity`, `.form.key`, `.form.label`,
`.form.valueType`, `.form.options`, `.form.required`, `.form.submit` (English stays "Add field"),
`.table.title` ("Fields"), `.table.key`, `.table.label`, `.table.type`, `.table.required`,
`.table.options`, `.table.listFilter`, `.required.yes/no`, `.valueType.<six>`. New:
`customFields.listFilter.label`, `.listFilter.help`, `.listFilter.yes`, `customFields.editor.*`
(title `Edit {key}`, section titles, `requiredNotice`, `keyReadOnly`, `save`, `cancel`,
`option.add`, `option.value`, `option.remove`, `option.removeConfirm`, `option.moveUp/Down`,
`option.default`). Drains `HARDCODED_STRINGS_BASELINE['packages/modules/custom_fields/src/admin/pages/CustomFieldsPage.tsx']`.
