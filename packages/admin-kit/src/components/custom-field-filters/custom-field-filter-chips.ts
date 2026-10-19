import type {
  CustomFieldFilter,
  CustomFieldFilters,
  CustomFieldListFilterField,
  LocalizedLabel,
} from '@endora-commerce/contracts';
import { withoutCustomFieldFilter } from './custom-field-filter-params.js';

/** A `core` translator: `useTranslation('core')`'s return value. */
export type CustomFieldFilterTranslator = (key: string, params?: Record<string, string | number>) => string;

export interface CustomFieldFilterChip {
  /** Stable per key. */
  id: string;
  /** `"<label>: <summary>"`, plain text. */
  label: string;
  /** The filters without this chip's key. */
  remove: () => CustomFieldFilters;
}

/**
 * A field's or an option's label: `label[language]` → `label[base language]`
 * → `labelDefault` — the rule the detail screens use, so a filter reads as the
 * field does where its value is shown.
 */
export function resolveCustomFieldLabel(
  label: LocalizedLabel,
  labelDefault: string,
  language: string,
): string {
  const base = language.split('-')[0] ?? language;
  for (const candidate of [language, base]) {
    const value = Object.hasOwn(label, candidate) ? label[candidate] : undefined;
    if (typeof value === 'string' && value !== '') return value;
  }
  return labelDefault;
}

function rangeSummary(
  low: string | undefined,
  high: string | undefined,
  t: CustomFieldFilterTranslator,
  lowKey: string,
  highKey: string,
  param: string,
): string | null {
  if (low !== undefined && high !== undefined) return t('customFieldFilters.rangeChip', { from: low, to: high });
  if (low !== undefined) return t(lowKey, { [param]: low });
  if (high !== undefined) return t(highKey, { [param]: high });
  return null;
}

function summarise(
  filter: CustomFieldFilter,
  field: CustomFieldListFilterField | undefined,
  language: string,
  t: CustomFieldFilterTranslator,
): string {
  const parts: string[] = [];
  if (filter.in !== undefined) {
    const options = new Map((field?.options ?? []).map((option) => [option.value, option]));
    parts.push(
      filter.in
        .map((value) => {
          const option = options.get(value);
          return option === undefined ? value : resolveCustomFieldLabel(option.label, option.labelDefault, language);
        })
        .join(', '),
    );
  }
  if (filter.is !== undefined) parts.push(t(filter.is ? 'customFieldFilters.yes' : 'customFieldFilters.no'));
  if (filter.contains !== undefined) parts.push(t('customFieldFilters.containsChip', { text: filter.contains }));
  const numbers = rangeSummary(filter.min, filter.max, t, 'customFieldFilters.minShort', 'customFieldFilters.maxShort', 'value');
  if (numbers !== null) parts.push(numbers);
  const dates = rangeSummary(filter.from, filter.to, t, 'customFieldFilters.fromChip', 'customFieldFilters.toChip', 'date');
  if (dates !== null) parts.push(dates);
  return parts.join(', ');
}

/**
 * One chip per filtered key, `"<label>: <summary>"` — option labels joined,
 * `≥ a`, `≤ b`, `a – b`, Yes or No, *contains “x”* — in `language`. A key the
 * list does not offer is named by the key itself. The label is plain text: a
 * page renders it as a string child, never as markup (threat model F-5).
 */
export function customFieldFilterChips(
  fields: readonly CustomFieldListFilterField[],
  filters: CustomFieldFilters,
  language: string,
  t: CustomFieldFilterTranslator,
): CustomFieldFilterChip[] {
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const chips: CustomFieldFilterChip[] = [];
  for (const key of Object.keys(filters)) {
    const filter = filters[key];
    if (filter === undefined) continue;
    const field = byKey.get(key);
    const name = field === undefined ? key : resolveCustomFieldLabel(field.label, field.labelDefault, language);
    chips.push({
      id: `cf:${key}`,
      label: `${name}: ${summarise(filter, field, language, t)}`,
      remove: () => withoutCustomFieldFilter(filters, key),
    });
  }
  return chips;
}
