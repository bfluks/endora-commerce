import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  customFieldFilterSchema,
  type CustomFieldFilter,
  type CustomFieldFilters,
  type CustomFieldListFilterField,
} from '@endora-commerce/contracts';
import { Input } from '../../ui/input.js';
import { Label } from '../../ui/label.js';
import { MultiSelect } from '../../ui/multi-select.js';
import { Select } from '../../ui/select.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { resolveCustomFieldLabel, type CustomFieldFilterTranslator } from './custom-field-filter-chips.js';

export interface CustomFieldListFiltersProps {
  /** Prefix of every control's `id`, unique on the page. */
  idPrefix: string;
  fields: readonly CustomFieldListFilterField[];
  value: CustomFieldFilters;
  /** One key's filter, whole; `null` when nothing of it is left. */
  onChange: (key: string, filter: CustomFieldFilter | null) => void;
  language: string;
}

/** How long typing pauses before a text or number filter is committed. */
const COMMIT_PAUSE_MS = 300;
/** Above this many options the option list gets a search box. */
const SEARCHABLE_OPTIONS_OVER = 8;

/**
 * One filter control per custom field an admin list offers (feature 157,
 * `specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §1.2).
 *
 * Renders **grid cells and no container**, so the controls sit in the host
 * list's own advanced-filters grid beside its built-in filters, in the same
 * `space-y-1` label-over-input shape. Text and number commit after a pause
 * so a list is not re-read per keystroke; dates, yes/no and options commit
 * at once.
 */
export function CustomFieldListFilters({
  idPrefix,
  fields,
  value,
  onChange,
  language,
}: CustomFieldListFiltersProps): ReactNode {
  const t = useTranslation('core');
  return (
    <>
      {fields.map((field) => {
        const filter = Object.hasOwn(value, field.key) ? value[field.key] : undefined;
        const props: ControlProps = {
          id: `${idPrefix}-cf-${field.key}`,
          field,
          label: resolveCustomFieldLabel(field.label, field.labelDefault, language),
          filter,
          onChange: (next) => onChange(field.key, next),
          language,
          t,
        };
        return <FilterCell key={field.key} {...props} />;
      })}
    </>
  );
}

interface ControlProps {
  id: string;
  field: CustomFieldListFilterField;
  label: string;
  filter: CustomFieldFilter | undefined;
  onChange: (filter: CustomFieldFilter | null) => void;
  language: string;
  t: CustomFieldFilterTranslator;
}

function FilterCell(props: ControlProps): ReactNode {
  switch (props.field.valueType) {
    case 'text':
      return <TextFilter {...props} />;
    case 'number':
      return <NumberFilter {...props} />;
    case 'date':
      return <DateFilter {...props} />;
    case 'boolean':
      return <BooleanFilter {...props} />;
    case 'select':
    case 'multiselect':
      return <OptionsFilter {...props} />;
    default:
      return null;
  }
}

/**
 * A local draft committed after {@link COMMIT_PAUSE_MS}. The draft adopts the
 * value from outside (a chip removed, a view loaded) whenever that value is no
 * longer what the draft would commit — and not while the operator types.
 */
function usePausedDraft<T>(
  committed: T,
  toFilter: (draft: T) => CustomFieldFilter | null | undefined,
  same: (a: T, b: T) => boolean,
  onCommit: (filter: CustomFieldFilter | null) => void,
): [T, (next: T) => void] {
  const [draft, setDraft] = useState<T>(committed);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    setDraft((current) => (same(current, committed) ? current : committed));
    // `same` compares by value; `committed` is the only input that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(committed)]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const update = (next: T): void => {
    setDraft(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const filter = toFilter(next);
      // `undefined`: the draft is not a value yet (a half-typed number) — keep the last filter.
      if (filter !== undefined) commitRef.current(filter);
    }, COMMIT_PAUSE_MS);
  };
  return [draft, update];
}

function TextFilter({ id, label, filter, onChange, t }: ControlProps): ReactNode {
  const committed = filter?.contains ?? '';
  const [draft, setDraft] = usePausedDraft(
    committed,
    (text) => {
      const trimmed = text.trim().slice(0, 200);
      return trimmed === '' ? null : { contains: trimmed };
    },
    (a, b) => a.trim() === b.trim(),
    onChange,
  );
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="search"
        value={draft}
        placeholder={t('customFieldFilters.contains')}
        onChange={(event): void => setDraft(event.target.value)}
      />
    </div>
  );
}

interface Bounds {
  min: string;
  max: string;
}

/** A typed bound as the API's decimal string: comma accepted, `undefined` when empty, `null` when not a number. */
function toDecimal(raw: string): string | undefined | null {
  const normalised = raw.trim().replace(',', '.');
  if (normalised === '') return undefined;
  return customFieldFilterSchema.shape.min.safeParse(normalised).success ? normalised : null;
}

function NumberFilter({ id, label, filter, onChange, t }: ControlProps): ReactNode {
  const committed: Bounds = { min: filter?.min ?? '', max: filter?.max ?? '' };
  const [draft, setDraft] = usePausedDraft<Bounds>(
    committed,
    (bounds) => {
      const min = toDecimal(bounds.min);
      const max = toDecimal(bounds.max);
      if (min === null || max === null) return undefined;
      if (min === undefined && max === undefined) return null;
      return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
    },
    (a, b) => toDecimal(a.min) === toDecimal(b.min) && toDecimal(a.max) === toDecimal(b.max),
    onChange,
  );
  const labelId = `${id}-label`;
  const invalidMin = toDecimal(draft.min) === null;
  const invalidMax = toDecimal(draft.max) === null;
  return (
    <div className="space-y-1">
      <Label id={labelId}>{label}</Label>
      <div role="group" aria-labelledby={labelId} className="flex gap-2">
        <Input
          id={`${id}-min`}
          type="text"
          inputMode="decimal"
          aria-label={`${label}: ${t('customFieldFilters.min')}`}
          aria-invalid={invalidMin || undefined}
          placeholder={t('customFieldFilters.min')}
          value={draft.min}
          onChange={(event): void => setDraft({ ...draft, min: event.target.value })}
        />
        <Input
          id={`${id}-max`}
          type="text"
          inputMode="decimal"
          aria-label={`${label}: ${t('customFieldFilters.max')}`}
          aria-invalid={invalidMax || undefined}
          placeholder={t('customFieldFilters.max')}
          value={draft.max}
          onChange={(event): void => setDraft({ ...draft, max: event.target.value })}
        />
      </div>
    </div>
  );
}

function DateFilter({ id, label, filter, onChange, t }: ControlProps): ReactNode {
  const labelId = `${id}-label`;
  const set = (bound: 'from' | 'to', raw: string): void => {
    const next: CustomFieldFilter = {};
    if (filter?.from !== undefined) next.from = filter.from;
    if (filter?.to !== undefined) next.to = filter.to;
    const parsed = customFieldFilterSchema.shape[bound].safeParse(raw);
    if (raw !== '' && parsed.success) next[bound] = raw;
    else delete next[bound];
    onChange(next.from === undefined && next.to === undefined ? null : next);
  };
  return (
    <div className="space-y-1">
      <Label id={labelId}>{label}</Label>
      <div role="group" aria-labelledby={labelId} className="flex gap-2">
        <Input
          id={`${id}-from`}
          type="date"
          aria-label={`${label}: ${t('customFieldFilters.from')}`}
          value={filter?.from ?? ''}
          onChange={(event): void => set('from', event.target.value)}
        />
        <Input
          id={`${id}-to`}
          type="date"
          aria-label={`${label}: ${t('customFieldFilters.to')}`}
          value={filter?.to ?? ''}
          onChange={(event): void => set('to', event.target.value)}
        />
      </div>
    </div>
  );
}

function BooleanFilter({ id, label, filter, onChange, t }: ControlProps): ReactNode {
  const current = filter?.is === undefined ? '' : String(filter.is);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        id={id}
        value={current}
        onChange={(event): void => {
          const next = event.target.value;
          onChange(next === '' ? null : { is: next === 'true' });
        }}
      >
        <option value="">{t('customFieldFilters.any')}</option>
        <option value="true">{t('customFieldFilters.yes')}</option>
        <option value="false">{t('customFieldFilters.no')}</option>
      </Select>
    </div>
  );
}

function OptionsFilter({ id, field, label, filter, onChange, language, t }: ControlProps): ReactNode {
  const options = field.options.map((option) => ({
    value: option.value,
    label: resolveCustomFieldLabel(option.label, option.labelDefault, language),
  }));
  const labelId = `${id}-label`;
  return (
    <div className="space-y-1">
      <Label id={labelId}>{label}</Label>
      <MultiSelect
        ariaLabel={label}
        placeholder={t('customFieldFilters.any')}
        options={options}
        selected={filter?.in ?? []}
        onChange={(next): void => onChange(next.length === 0 ? null : { in: next })}
        searchable={options.length > SEARCHABLE_OPTIONS_OVER}
        searchPlaceholder={t('customFieldFilters.searchOptions')}
      />
    </div>
  );
}
