import { useCallback, type ReactNode } from 'react';
import type { RecordHistoryEntry } from '@endora-commerce/contracts';
import {
  RecordHistory,
  recordHistoryChanges,
  useRecordHistory,
  type RecordHistoryChange,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { calendarDateLabel, NO_VALUE, valueLabel } from '../lib/labels.js';
import { customFieldValueLabel, useCanSeeCustomFields, useProjectFieldDefinitions } from './ProjectCustomFields.js';

/**
 * The fields of an audited Project state that have a label of their own
 * (`history.field.<field>`); any other field is named from its key. Whatever
 * names an identifier — every key ending `Id` or `Ids` — and the bookkeeping
 * below are never a row: they say nothing to a reader.
 */
const LABELLED_FIELDS: ReadonlySet<string> = new Set([
  'number',
  'title',
  'state',
  'value',
  'valueAmount',
  'valueCurrency',
  'startOn',
  'visibility',
  'stages',
  'stageName',
  'outcome',
  'recordKind',
  'kind',
  'length',
  'fileName',
  'note',
  'comment',
  'deleted',
  'changedFields',
  'changedCustomFields',
]);
const SILENT_FIELDS: ReadonlySet<string> = new Set(['version', 'descriptionLength', 'members', 'moves', 'tasks']);

/**
 * A custom field's row: `customFieldValues` is one audited object, shown as a
 * row per field (User Story 9). The server leaves it out for a reader without
 * `custom_fields:read`.
 */
const CUSTOM_FIELD_PREFIX = 'customField:';

/**
 * The audit trail records *which* value-bearing fields a write changed —
 * `changedFields` (`value`) and `changedCustomFields` (keys) — and never their
 * values (T144 F4). The server serves the values in their place from the
 * Project's own store (T145), as `valueAmount` / `valueCurrency` and
 * `customFieldValues`; an entry it has no stored values for keeps the names,
 * each one row naming them.
 */
const CHANGED_FIELDS = 'changedFields';
const CHANGED_CUSTOM_FIELDS = 'changedCustomFields';

function isSilent(field: string): boolean {
  if (field.startsWith(CUSTOM_FIELD_PREFIX)) return false;
  return SILENT_FIELDS.has(field) || /Ids?$/.test(field);
}

/** An audited state with its custom-field bag spread into a field per key. */
function withCustomFieldsSpread(state: unknown): unknown {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return state;
  const { customFieldValues, ...rest } = state as Record<string, unknown>;
  if (customFieldValues === null || typeof customFieldValues !== 'object' || Array.isArray(customFieldValues)) return state;
  const spread: Record<string, unknown> = { ...rest };
  for (const [key, value] of Object.entries(customFieldValues)) spread[`${CUSTOM_FIELD_PREFIX}${key}`] = value;
  return spread;
}

/**
 * An audited state with `valueAmount` / `valueCurrency` as one `value` field —
 * the amount in its currency's conventions, as the Project screen shows it
 * (`valueLabel`), or `null` for no value. A change of either is a change of
 * the value, one row (T145).
 */
function withValueJoined(state: unknown): unknown {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) return state;
  const record = state as Record<string, unknown>;
  if (!('valueAmount' in record) && !('valueCurrency' in record)) return state;
  const { valueAmount, valueCurrency, ...rest } = record;
  const value =
    typeof valueAmount === 'string' && typeof valueCurrency === 'string'
      ? valueLabel({ amount: valueAmount, currency: valueCurrency })
      : null;
  return { ...rest, value };
}

/** `stageName` → `stage name`. */
function humaniseKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The rows an entry shows: what it changed, without identifiers, nested shapes or bookkeeping. */
export function projectHistoryChanges(entry: { before: unknown; after: unknown }): RecordHistoryChange[] {
  const plain = (value: unknown): boolean =>
    value === null ||
    ['string', 'number', 'boolean'].includes(typeof value) ||
    (Array.isArray(value) && value.every((item) => ['string', 'number'].includes(typeof item)));
  return recordHistoryChanges({
    before: withValueJoined(withCustomFieldsSpread(entry.before)),
    after: withValueJoined(withCustomFieldsSpread(entry.after)),
  })
    .filter((change) => !isSilent(change.field))
    .filter((change) => plain(change.after) && (!('before' in change) || plain(change.before)));
}

/**
 * A Project's change history (User Story 7, FR-028; `GET /projects/:id/history`)
 * on the kit's `RecordHistory`: every Command about the Project, newest first, a
 * page at a time, each entry by what happened and the fields it changed. Notes
 * and messages are recorded by length, never by their text.
 */
export function ProjectHistory(props: { projectId: string; reloadKey?: number }): ReactNode {
  const t = useTranslation('projects');
  const { language } = useAppLanguage();
  const { projectId } = props;
  const loadPage = useCallback((cursor: string | null) => projectsApi.history(projectId, cursor), [projectId]);
  const history = useRecordHistory<RecordHistoryEntry>(loadPage, props.reloadKey);
  const { definitions } = useProjectFieldDefinitions(useCanSeeCustomFields());
  const definitionOf = (field: string) =>
    definitions.find((definition) => `${CUSTOM_FIELD_PREFIX}${definition.key}` === field);
  const words = { yes: t('history.value.yes'), no: t('history.value.no') };

  const fieldLabel = (field: string): string => {
    if (field.startsWith(CUSTOM_FIELD_PREFIX)) {
      const definition = definitionOf(field);
      return definition ? (definition.label[language] ?? definition.labelDefault) : field.slice(CUSTOM_FIELD_PREFIX.length);
    }
    return LABELLED_FIELDS.has(field) ? t(`history.field.${field}`) : humaniseKey(field);
  };

  const renderValue = (field: string, raw: unknown): ReactNode => {
    if (field.startsWith(CUSTOM_FIELD_PREFIX)) return customFieldValueLabel(definitionOf(field), raw, language, words);
    if (raw === null || raw === undefined || raw === '') return NO_VALUE;
    if (typeof raw === 'boolean') return t(raw ? 'history.value.yes' : 'history.value.no');
    if (field === CHANGED_FIELDS && Array.isArray(raw)) {
      const named = (name: string): string =>
        LABELLED_FIELDS.has(name) || name === 'value' ? t(`history.field.${name}`) : humaniseKey(name);
      return raw.map((name) => named(String(name))).join(', ');
    }
    if (field === CHANGED_CUSTOM_FIELDS && Array.isArray(raw)) {
      return raw.map((key) => fieldLabel(`${CUSTOM_FIELD_PREFIX}${String(key)}`)).join(', ');
    }
    if (Array.isArray(raw)) return raw.length === 0 ? NO_VALUE : raw.join(', ');
    if (field === 'state') return t(`state.${String(raw)}`);
    if (field === 'visibility') return t(`visibility.option.${String(raw)}`);
    if (field === 'recordKind') return t(`links.group.${String(raw)}`);
    if (field === 'startOn' && typeof raw === 'string') return calendarDateLabel(raw, language);
    return String(raw);
  };

  return (
    <RecordHistory
      history={history}
      copy={{
        hint: t('changeHistory.hint'),
        empty: t('changeHistory.empty'),
        end: t('changeHistory.end'),
        truncated: t('changeHistory.truncated'),
      }}
      heading={(entry) => t(`auditLog.${entry.action}`)}
      changes={projectHistoryChanges}
      fieldLabel={fieldLabel}
      renderValue={renderValue}
    />
  );
}
