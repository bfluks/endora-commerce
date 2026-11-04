import {
  TASK_BOARD_BUILTIN_FIELD_KEYS,
  TASK_BOARD_CARD_MAX_FIELDS,
  TASK_BOARD_DEFAULT_CARD_FIELDS,
  type CustomFieldDefinitionWithOptions,
  type TaskBoardBuiltinFieldKey,
  type TaskBoardCardField,
  type TaskCardFieldValue,
  type TaskSummary,
} from '@endora-commerce/contracts';

/**
 * What a Task board card can show (`specs/165-task-management/` FR-022,
 * research R-11) — CRM's `board-card-fields.ts`, the model, without its field
 * filters: the board takes the list's filters, custom-field filters included,
 * so a card field is something shown and never something filtered by.
 *
 * Pure: the catalogue of built-in fields, the reading of the stored choice,
 * and the value a card carries for each chosen field.
 */

/** The built-in fields a card can show, in the order they are offered. The Admin UI names them. */
export function builtinBoardCardFields(): TaskBoardCardField[] {
  return TASK_BOARD_BUILTIN_FIELD_KEYS.map((key) => ({
    ref: `builtin:${key}`,
    source: 'builtin' as const,
    key,
    label: {},
    labelDefault: null,
  }));
}

/** A custom field of the `task` host type as a card field. */
export function customBoardCardField(entry: CustomFieldDefinitionWithOptions): TaskBoardCardField {
  const { definition } = entry;
  return {
    ref: `custom:${definition.key}`,
    source: 'custom',
    key: definition.key,
    label: { ...definition.label },
    labelDefault: definition.labelDefault,
  };
}

/**
 * The stored choice as references — forgiving, because the Settings screen can
 * store anything under the code: a value that is not an array is the default,
 * an entry that is not a string or repeats one is skipped.
 */
export function storedBoardCardFieldRefs(stored: unknown): string[] {
  if (!Array.isArray(stored)) return [...TASK_BOARD_DEFAULT_CARD_FIELDS];
  return [...new Set(stored.filter((entry): entry is string => typeof entry === 'string'))];
}

/** Whether a stored choice names a custom field at all — when not, no definition is read. */
export function namesCustomBoardField(refs: readonly string[]): boolean {
  return refs.some((ref) => ref.startsWith('custom:'));
}

/** The references that are offered, in their stored order, no more than a card shows. */
export function resolveBoardCardFields(
  refs: readonly string[],
  offered: readonly TaskBoardCardField[],
): TaskBoardCardField[] {
  const byRef = new Map(offered.map((field) => [field.ref, field]));
  return refs
    .map((ref) => byRef.get(ref))
    .filter((field): field is TaskBoardCardField => field !== undefined)
    .slice(0, TASK_BOARD_CARD_MAX_FIELDS);
}

/** What a card's value needs beyond the summary: two columns the summary does not carry. */
export interface CardFieldSource {
  startOn: string | null;
  customFieldValues: Record<string, unknown> | null;
}

/** One built-in field's value, read off the summary the list already built. */
function builtinValue(key: TaskBoardBuiltinFieldKey, summary: TaskSummary, source: CardFieldSource): unknown {
  switch (key) {
    case 'number':
      return summary.number;
    case 'assignees':
      return summary.assignees;
    case 'due':
      return { dueOn: summary.dueOn, dueAt: summary.dueAt, overdue: summary.overdue };
    case 'priority':
      return summary.priority;
    case 'tags':
      return summary.tags;
    case 'startOn':
      return source.startOn;
    case 'context':
      return summary.context;
    case 'subtasks':
      return summary.subtasks;
    case 'createdAt':
      return summary.createdAt;
    case 'updatedAt':
      return summary.updatedAt;
  }
}

const BUILTIN_KEYS: ReadonlySet<string> = new Set(TASK_BOARD_BUILTIN_FIELD_KEYS);

/**
 * A card's values for the chosen fields, in their order. A custom field the
 * Task holds no value for is `null` — the card shows nothing for it.
 */
export function cardFieldValues(
  fields: readonly TaskBoardCardField[],
  summary: TaskSummary,
  source: CardFieldSource,
): TaskCardFieldValue[] {
  return fields.map((field) => {
    if (field.source === 'custom') {
      const value = source.customFieldValues?.[field.key];
      return { ref: field.ref, value: value === undefined ? null : value };
    }
    return {
      ref: field.ref,
      value: BUILTIN_KEYS.has(field.key)
        ? builtinValue(field.key as TaskBoardBuiltinFieldKey, summary, source)
        : null,
    };
  });
}
