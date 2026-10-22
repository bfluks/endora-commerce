import {
  CUSTOM_FIELD_FILTERS_MAX_IN_VALUES,
  CUSTOM_FIELD_FILTERS_MAX_KEYS,
  ERROR_CODES,
  customFieldFilterSchema,
  type CustomFieldFilter,
  type CustomFieldFilters,
  type CustomFieldListFilterField,
} from '@endora-commerce/contracts';
// The barrel, not `../../lib/api-client.js`: see `CustomFieldValuesPanel.tsx`.
import { ApiError } from '../../lib/index.js';

/**
 * Pure helpers behind the admin lists' custom-field filters (feature 157,
 * `specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §1.3).
 *
 * **Every key-indexed record here is prototype-free** (threat model F-4).
 * `constructor` matches the definition-key grammar (`toString` and
 * `hasOwnProperty` do not: the grammar refuses capitals), so a record is built
 * with `Object.create(null)`, membership is
 * `Object.hasOwn`, and a field is looked up through a `Map` — never `key in
 * obj` and never a bracket read on a plain object.
 */

/** The definition-key grammar (`customFieldDefinitionSchema.shape.key`), re-applied to the address. */
const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const PARAM_PREFIX = 'cf.';
/** The order operators are written in, so a round-trip is stable. */
const OPERATORS = ['contains', 'in', 'is', 'min', 'max', 'from', 'to'] as const;
const SCALAR_OPERATORS: ReadonlySet<string> = new Set(['contains', 'min', 'max', 'from', 'to']);
/** The schema's per-key cap on `in` values. */
const MAX_IN_VALUES_PER_KEY = 50;

/** An empty, prototype-free filters record. */
export function emptyCustomFieldFilters(): CustomFieldFilters {
  return Object.create(null) as CustomFieldFilters;
}

function copyFilters(filters: CustomFieldFilters): CustomFieldFilters {
  const copy = emptyCustomFieldFilters();
  for (const key of Object.keys(filters)) {
    const filter = filters[key];
    if (filter !== undefined) copy[key] = filter;
  }
  return copy;
}

function isEmptyFilter(filter: CustomFieldFilter): boolean {
  return OPERATORS.every((op) => filter[op] === undefined);
}

function fieldsByKey(fields: readonly CustomFieldListFilterField[]): Map<string, CustomFieldListFilterField> {
  return new Map(fields.map((field) => [field.key, field]));
}

/** `cf.<key>.<op>` → `[key, op]`, or `null` when the name is not one. */
function splitParamName(name: string): [string, string] | null {
  if (!name.startsWith(PARAM_PREFIX)) return null;
  const rest = name.slice(PARAM_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0) return null;
  return [rest.slice(0, dot), rest.slice(dot + 1)];
}

function parseScalar(op: string, raw: string): Partial<CustomFieldFilter> | null {
  const result = customFieldFilterSchema.safeParse({ [op]: raw });
  return result.success ? result.data : null;
}

/**
 * The filters in an address's `cf.<key>.<op>` parameters. A key failing the
 * grammar, an unknown operator and a malformed value are dropped one parameter
 * at a time; a well-formed **unknown** key is kept (the server refuses it —
 * US1-9). At most {@link CUSTOM_FIELD_FILTERS_MAX_KEYS} keys and
 * {@link CUSTOM_FIELD_FILTERS_MAX_IN_VALUES} `in` values (50 per key), the
 * rest dropped in address order.
 */
export function readCustomFieldFilterParams(params: URLSearchParams): CustomFieldFilters {
  const result = emptyCustomFieldFilters();
  let keyCount = 0;
  let inCount = 0;
  for (const [name, raw] of params) {
    const parts = splitParamName(name);
    if (parts === null) continue;
    const [key, op] = parts;
    if (!KEY_RE.test(key)) continue;
    let operand: Partial<CustomFieldFilter> | null = null;
    if (SCALAR_OPERATORS.has(op)) {
      operand = parseScalar(op, raw);
    } else if (op === 'is') {
      operand = raw === 'true' ? { is: true } : raw === 'false' ? { is: false } : null;
    } else if (op === 'in') {
      const parsed = customFieldFilterSchema.safeParse({ in: [raw] });
      operand = parsed.success ? parsed.data : null;
    }
    if (operand === null) continue;
    const existing = Object.hasOwn(result, key) ? result[key] : undefined;
    if (existing === undefined && keyCount >= CUSTOM_FIELD_FILTERS_MAX_KEYS) continue;
    let next: CustomFieldFilter;
    if (operand.in !== undefined) {
      const current = existing?.in ?? [];
      if (inCount >= CUSTOM_FIELD_FILTERS_MAX_IN_VALUES || current.length >= MAX_IN_VALUES_PER_KEY) continue;
      inCount += 1;
      next = { ...existing, in: [...current, ...operand.in] };
    } else {
      next = { ...existing, ...operand };
    }
    if (existing === undefined) keyCount += 1;
    result[key] = next;
  }
  return result;
}

/**
 * `params` with every `cf.*` parameter replaced by `filters`; every other
 * parameter untouched. Returns a new instance; `params` is not mutated.
 * Round-trips with {@link readCustomFieldFilterParams}.
 */
export function writeCustomFieldFilterParams(
  params: URLSearchParams,
  filters: CustomFieldFilters,
): URLSearchParams {
  const next = new URLSearchParams();
  for (const [name, value] of params) {
    if (!name.startsWith(PARAM_PREFIX)) next.append(name, value);
  }
  for (const key of Object.keys(filters)) {
    const filter = filters[key];
    if (filter === undefined) continue;
    for (const op of OPERATORS) {
      const value = filter[op];
      if (value === undefined) continue;
      const name = `${PARAM_PREFIX}${key}.${op}`;
      if (Array.isArray(value)) for (const item of value) next.append(name, item);
      else next.append(name, String(value));
    }
  }
  return next;
}

/** `filter` with `in` values that are not among `field`'s options removed; `null` when nothing is left. */
function pruneFilterOptions(
  filter: CustomFieldFilter,
  field: CustomFieldListFilterField,
): CustomFieldFilter | null {
  if (filter.in === undefined) return filter;
  const offered = new Set(field.options.map((option) => option.value));
  const kept = filter.in.filter((value) => offered.has(value));
  const next: CustomFieldFilter = { ...filter, in: kept };
  if (kept.length === 0) delete next.in;
  return isEmptyFilter(next) ? null : next;
}

/**
 * A saved view's custom-field filters against the fields the list offers now
 * (FR-014): a key is kept only if offered **and** its filter parses, with `in`
 * values no longer among the field's options pruned; everything else is named
 * in `dropped`, in input order. A non-object input keeps nothing.
 */
export function sanitizeCustomFieldFilters(
  saved: unknown,
  fields: readonly CustomFieldListFilterField[],
): { kept: CustomFieldFilters; dropped: string[] } {
  const kept = emptyCustomFieldFilters();
  const dropped: string[] = [];
  if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return { kept, dropped };
  const offered = fieldsByKey(fields);
  let keyCount = 0;
  for (const key of Object.keys(saved)) {
    const field = offered.get(key);
    const parsed = customFieldFilterSchema.safeParse((saved as Record<string, unknown>)[key]);
    const filter = field !== undefined && parsed.success ? pruneFilterOptions(parsed.data, field) : null;
    if (filter === null || isEmptyFilter(filter) || keyCount >= CUSTOM_FIELD_FILTERS_MAX_KEYS) {
      dropped.push(key);
      continue;
    }
    kept[key] = filter;
    keyCount += 1;
  }
  return { kept, dropped };
}

/**
 * Filters read from the **address**, once the fields have loaded: `in` values
 * a known field no longer offers are removed (the server would match nothing
 * on them and the control cannot show them). An unknown key is never removed —
 * it is the server's to refuse (US1-9).
 */
export function pruneRemovedOptions(
  filters: CustomFieldFilters,
  fields: readonly CustomFieldListFilterField[],
): CustomFieldFilters {
  const offered = fieldsByKey(fields);
  const next = emptyCustomFieldFilters();
  for (const key of Object.keys(filters)) {
    const filter = filters[key];
    if (filter === undefined) continue;
    const field = offered.get(key);
    const pruned = field === undefined ? filter : pruneFilterOptions(filter, field);
    if (pruned !== null) next[key] = pruned;
  }
  return next;
}

/** The refused key of a `CUSTOM_FIELD_FILTER_UNAVAILABLE` refusal (`details.key`), else `null`. */
export function customFieldFilterRefusal(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const { code, details } = error.envelope.error;
  if (code !== ERROR_CODES.CUSTOM_FIELD_FILTER_UNAVAILABLE) return null;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return null;
  const key = Object.hasOwn(details, 'key') ? (details as Record<string, unknown>).key : undefined;
  return typeof key === 'string' && key !== '' ? key : null;
}

/** The `customFieldFilters` request parameter: the filters as JSON, keys sorted; `null` when empty. */
export function toCustomFieldFiltersParam(filters: CustomFieldFilters): string | null {
  const keys = Object.keys(filters).sort();
  if (keys.length === 0) return null;
  const sorted: Record<string, CustomFieldFilter> = Object.create(null) as Record<string, CustomFieldFilter>;
  for (const key of keys) {
    const filter = filters[key];
    if (filter !== undefined) sorted[key] = filter;
  }
  return JSON.stringify(sorted);
}

/** `filters` without `key`, as a new prototype-free record. */
export function withoutCustomFieldFilter(filters: CustomFieldFilters, key: string): CustomFieldFilters {
  const next = copyFilters(filters);
  delete next[key];
  return next;
}

/** `filters` with `key` set to `filter` — or removed, for `null` — as a new prototype-free record. */
export function withCustomFieldFilter(
  filters: CustomFieldFilters,
  key: string,
  filter: CustomFieldFilter | null,
): CustomFieldFilters {
  const next = copyFilters(filters);
  if (filter === null) delete next[key];
  else next[key] = filter;
  return next;
}
