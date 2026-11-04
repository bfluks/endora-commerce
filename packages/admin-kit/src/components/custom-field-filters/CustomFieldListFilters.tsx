import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  customFieldFilterSchema,
  type CustomFieldFilter,
  type CustomFieldFilters,
  type CustomFieldListFilterField,
} from '@endora-commerce/contracts';
import { Button } from '../../ui/button.js';
import { Input } from '../../ui/input.js';
import { Label } from '../../ui/label.js';
import { MultiSelect } from '../../ui/multi-select.js';
import { Select } from '../../ui/select.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { resolveCustomFieldLabel, type CustomFieldFilterTranslator } from './custom-field-filter-chips.js';
import type { CustomFieldListFilterFieldsStatus } from './useCustomFieldListFilterFields.js';

export interface CustomFieldListFiltersProps {
  /** Prefix of every control's `id`, unique on the page. */
  idPrefix: string;
  fields: readonly CustomFieldListFilterField[];
  value: CustomFieldFilters;
  /** One key's filter, whole; `null` when nothing of it is left. */
  onChange: (key: string, filter: CustomFieldFilter | null) => void;
  language: string;
  /**
   * Where the offered fields are (`useCustomFieldListFilterFields`): a
   * placeholder cell while they load, and on failure a sentence with a retry —
   * the same on every list. Omitted, the fields are taken as loaded.
   */
  status?: CustomFieldListFilterFieldsStatus;
  /** Called by the retry on a failed load (the hook's `reload`). */
  onRetry?: () => void;
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
  status = 'ready',
  onRetry,
}: CustomFieldListFiltersProps): ReactNode {
  const t = useTranslation('core');
  if (status === 'loading') {
    return (
      <div className="space-y-1" aria-busy="true">
        <span className="sr-only">{t('customFieldFilters.loading')}</span>
        <div aria-hidden="true" className="h-4 w-24 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div aria-hidden="true" className="h-9 w-full animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="col-span-full flex flex-wrap items-center gap-3">
        <p className="text-sm text-destructive">{t('customFieldFilters.loadFailed')}</p>
        {onRetry ? (
          <Button type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-8" onClick={onRetry}>
            {t('customFieldFilters.retry')}
          </Button>
        ) : null}
      </div>
    );
  }
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
 * value from outside (a chip removed, a view loaded) whenever that value
 * changes to one the draft would not commit — and not while the operator
 * types. A commit still pending when an outside value is adopted is dropped:
 * the operator's half-typed draft must not land over the value they just chose.
 *
 * Both rules hold from the moment the control is on screen, before its effects
 * have run (issue #524): a control appears when the list's fields load, and an
 * operator — or a test — may type into it in that commit's window. So adoption
 * reacts to a *change* of the outside value, not to the effect's first run,
 * which would take the value the control mounted with back over what was just
 * typed; and the pending commit is not cleared by StrictMode's simulated
 * unmount, only skipped once the control is really gone.
 */
function usePausedDraft<T>(
  committed: T,
  toFilter: (draft: T) => CustomFieldFilter | null | undefined,
  same: (a: T, b: T) => boolean,
  onCommit: (filter: CustomFieldFilter | null) => void,
  pauseMs: number = COMMIT_PAUSE_MS,
): [T, (next: T) => void] {
  const [draft, setDraft] = useState<T>(committed);
  const draftRef = useRef(draft);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  /** The outside value as of the last render that adopted it, or of the first. */
  const committedKey = JSON.stringify(committed);
  const adoptedKey = useRef(committedKey);
  useEffect(() => {
    if (adoptedKey.current === committedKey) return;
    adoptedKey.current = committedKey;
    if (same(draftRef.current, committed)) return;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    draftRef.current = committed;
    setDraft(committed);
    // `same` compares by value; `committed` is the only input that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committedKey]);

  useEffect(() => {
    mounted.current = true;
    return (): void => {
      mounted.current = false;
    };
  }, []);

  const update = (next: T): void => {
    draftRef.current = next;
    setDraft(next);
    if (timer.current !== null) clearTimeout(timer.current);
    const commit = (): void => {
      timer.current = null;
      const filter = toFilter(next);
      // `undefined`: the draft is not a value yet (a half-typed number, an
      // inverted range) — keep the last filter.
      if (filter !== undefined) commitRef.current(filter);
    };
    if (pauseMs === 0) commit();
    else
      timer.current = setTimeout(() => {
        if (mounted.current) commit();
      }, pauseMs);
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

/**
 * Two bounds, side by side from `sm` up and stacked below it, each with a
 * visible short label, and one message under them saying what is wrong —
 * linked to the input it is about through `aria-describedby`.
 */
function RangeLayout({
  labelId,
  label,
  children,
  message,
}: {
  labelId: string;
  label: string;
  children: ReactNode;
  message: { id: string; text: string } | null;
}): ReactNode {
  return (
    <div className="space-y-1">
      <Label id={labelId}>{label}</Label>
      <div role="group" aria-labelledby={labelId} className="flex flex-col gap-2 sm:flex-row">
        {children}
      </div>
      {message ? (
        <p id={message.id} className="text-xs text-destructive">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function RangeBound({ id, prefix, children }: { id: string; prefix: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <label htmlFor={id} className="w-10 shrink-0 text-xs text-muted-foreground">
        {prefix}
      </label>
      {children}
    </div>
  );
}

function NumberFilter({ id, label, filter, onChange, t }: ControlProps): ReactNode {
  const committed: Bounds = { min: filter?.min ?? '', max: filter?.max ?? '' };
  const [draft, setDraft] = usePausedDraft<Bounds>(
    committed,
    (bounds) => {
      const min = toDecimal(bounds.min);
      const max = toDecimal(bounds.max);
      if (min === null || max === null) return undefined;
      if (min !== undefined && max !== undefined && Number(min) > Number(max)) return undefined;
      if (min === undefined && max === undefined) return null;
      return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
    },
    (a, b) => toDecimal(a.min) === toDecimal(b.min) && toDecimal(a.max) === toDecimal(b.max),
    onChange,
  );
  const labelId = `${id}-label`;
  const messageId = `${id}-message`;
  const min = toDecimal(draft.min);
  const max = toDecimal(draft.max);
  const invalidMin = min === null;
  const invalidMax = max === null;
  const inverted = typeof min === 'string' && typeof max === 'string' && Number(min) > Number(max);
  const message =
    invalidMin || invalidMax
      ? { id: messageId, text: t('customFieldFilters.numberInvalid') }
      : inverted
        ? { id: messageId, text: t('customFieldFilters.rangeInverted') }
        : null;
  return (
    <RangeLayout labelId={labelId} label={label} message={message}>
      <RangeBound id={`${id}-min`} prefix={t('customFieldFilters.minLabel')}>
        <Input
          id={`${id}-min`}
          type="text"
          inputMode="decimal"
          aria-label={`${label}: ${t('customFieldFilters.min')}`}
          aria-invalid={invalidMin || inverted || undefined}
          aria-describedby={invalidMin || inverted ? messageId : undefined}
          value={draft.min}
          onChange={(event): void => setDraft({ ...draft, min: event.target.value })}
        />
      </RangeBound>
      <RangeBound id={`${id}-max`} prefix={t('customFieldFilters.maxLabel')}>
        <Input
          id={`${id}-max`}
          type="text"
          inputMode="decimal"
          aria-label={`${label}: ${t('customFieldFilters.max')}`}
          aria-invalid={invalidMax || inverted || undefined}
          aria-describedby={invalidMax || inverted ? messageId : undefined}
          value={draft.max}
          onChange={(event): void => setDraft({ ...draft, max: event.target.value })}
        />
      </RangeBound>
    </RangeLayout>
  );
}

interface Dates {
  from: string;
  to: string;
}

const isDate = (raw: string): boolean => raw !== '' && customFieldFilterSchema.shape.from.safeParse(raw).success;

function DateFilter({ id, label, filter, onChange, t }: ControlProps): ReactNode {
  const committed: Dates = { from: filter?.from ?? '', to: filter?.to ?? '' };
  // Dates commit at once; the draft only holds an inverted pair back.
  const [draft, setDraft] = usePausedDraft<Dates>(
    committed,
    (dates) => {
      const from = isDate(dates.from) ? dates.from : undefined;
      const to = isDate(dates.to) ? dates.to : undefined;
      if (from !== undefined && to !== undefined && from > to) return undefined;
      if (from === undefined && to === undefined) return null;
      return { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
    },
    (a, b) => a.from === b.from && a.to === b.to,
    onChange,
    0,
  );
  const labelId = `${id}-label`;
  const messageId = `${id}-message`;
  const inverted = isDate(draft.from) && isDate(draft.to) && draft.from > draft.to;
  return (
    <RangeLayout
      labelId={labelId}
      label={label}
      message={inverted ? { id: messageId, text: t('customFieldFilters.dateRangeInverted') } : null}
    >
      <RangeBound id={`${id}-from`} prefix={t('customFieldFilters.from')}>
        <Input
          id={`${id}-from`}
          type="date"
          aria-label={`${label}: ${t('customFieldFilters.from')}`}
          aria-invalid={inverted || undefined}
          aria-describedby={inverted ? messageId : undefined}
          value={draft.from}
          onChange={(event): void => setDraft({ ...draft, from: event.target.value })}
        />
      </RangeBound>
      <RangeBound id={`${id}-to`} prefix={t('customFieldFilters.to')}>
        <Input
          id={`${id}-to`}
          type="date"
          aria-label={`${label}: ${t('customFieldFilters.to')}`}
          aria-invalid={inverted || undefined}
          aria-describedby={inverted ? messageId : undefined}
          value={draft.to}
          onChange={(event): void => setDraft({ ...draft, to: event.target.value })}
        />
      </RangeBound>
    </RangeLayout>
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
