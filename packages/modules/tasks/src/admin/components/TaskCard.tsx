import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type {
  TaskAssignee,
  TaskBoardBuiltinFieldKey,
  TaskBoardCardField,
  TaskContextSummary,
  TaskPriorityRef,
  TaskSummary,
  TaskTagRef,
} from '@endora-commerce/contracts';
import { TagChips } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { calendarDateLabel, instantDateLabel } from '../lib/labels.js';
import { ContextLabel } from './ContextLabel.js';
import { TaskMarkers } from './TaskMarkers.js';

/** A card field's name: a built-in one in the module's words, a custom one by its labels. */
export function boardFieldLabel(
  field: TaskBoardCardField,
  language: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (field.source === 'builtin') return t(`board.field.${field.key}`);
  return field.label[language] || field.labelDefault || field.key;
}

/** A custom field's stored value as one line; `null` when there is nothing to show. */
function customText(value: unknown, yes: string, no: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value ? yes : no;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const items = value.filter((item) => typeof item === 'string' || typeof item === 'number').map(String);
    return items.length > 0 ? items.join(', ') : null;
  }
  return null;
}

function instantDate(value: unknown, language: string): string | null {
  if (typeof value !== 'string') return null;
  return instantDateLabel(value, language);
}

/**
 * One field's value on a card, or `null` when the Task has none — the field
 * is then left out of its card. The value is the board's (`cardFields`) when
 * it sent one, else read off the summary: a card moved on this visit is the
 * server's newer summary, which carries no card fields.
 */
function FieldValue(props: { field: TaskBoardCardField; task: TaskSummary }): ReactNode {
  const t = useTranslation('tasks');
  const { language } = useAppLanguage();
  const { field, task } = props;
  const sent = task.cardFields?.find((entry) => entry.ref === field.ref);
  if (field.source === 'custom') {
    const text = customText(sent?.value, t('board.card.yes'), t('board.card.no'));
    return text === null ? null : <span className="[overflow-wrap:anywhere]">{text}</span>;
  }
  const value = sent?.value;
  switch (field.key as TaskBoardBuiltinFieldKey) {
    case 'number':
      return <span className="tabular-nums">{task.number}</span>;
    case 'assignees': {
      const people = (value as TaskAssignee[] | undefined) ?? task.assignees;
      return people.length > 0 ? <span>{people.map((person) => person.name).join(', ')}</span> : null;
    }
    case 'due':
      if (!task.dueOn) return null;
      return (
        <span className={task.overdue ? 'font-medium text-destructive' : undefined}>
          <span className="tabular-nums">{calendarDateLabel(task.dueOn, language)}</span>
          {task.overdue ? ` · ${t('list.overdue')}` : null}
        </span>
      );
    case 'priority': {
      const priority = (value as TaskPriorityRef | null | undefined) ?? task.priority;
      if (!priority) return null;
      return (
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: priority.color }} />
          {priority.name}
        </span>
      );
    }
    case 'tags': {
      const tags = (value as TaskTagRef[] | undefined) ?? task.tags;
      return tags.length > 0 ? <TagChips tags={tags} /> : null;
    }
    case 'startOn':
      return typeof value === 'string' ? <span className="tabular-nums">{calendarDateLabel(value, language)}</span> : null;
    case 'context': {
      const context = (value as TaskContextSummary | null | undefined) ?? task.context;
      return context ? <ContextLabel context={context} /> : null;
    }
    case 'subtasks':
      return task.subtasks.total > 0 ? (
        <span>{t('board.card.subtasks', { closed: task.subtasks.closed, total: task.subtasks.total })}</span>
      ) : null;
    case 'createdAt':
      return <span>{instantDate(task.createdAt, language)}</span>;
    case 'updatedAt':
      return <span>{instantDate(task.updatedAt, language)}</span>;
    default:
      return null;
  }
}

/**
 * A Task as a board card (`specs/165-task-management/` User Story 3 scenario
 * 2, FR-022): its title, linked, its draft, private and sub-task markers
 * (T092), then the fields the operator chose, in their order, each named. A field the Task has no value for is left out.
 */
export function TaskCard(props: { task: TaskSummary; fields: readonly TaskBoardCardField[] }): ReactNode {
  const t = useTranslation('tasks');
  const { language } = useAppLanguage();
  const { task, fields } = props;
  const rows = fields
    .map((field) => ({ field, value: <FieldValue field={field} task={task} /> }))
    // `FieldValue` decides emptiness; the row is dropped when the element would render nothing.
    .filter(({ field }) => hasValue(field, task));
  return (
    <div className="space-y-1.5">
      {/* The link is the title's text and no wider: a link never starts a drag. */}
      <p className="break-words text-sm font-medium">
        <Link
          to={`/tasks/${task.id}`}
          className="text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {task.title}
        </Link>
      </p>
      <TaskMarkers task={task} />
      {rows.length > 0 ? (
        <dl className="space-y-1 text-xs">
          {rows.map(({ field, value }) => (
            <div key={field.ref} className="flex flex-wrap items-baseline gap-x-1.5">
              <dt className="text-muted-foreground">{t('board.card.field', { label: boardFieldLabel(field, language, t) })}</dt>
              <dd className="min-w-0">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

/** Whether `task` has something to show for `field` — the rule {@link FieldValue} renders by. */
function hasValue(field: TaskBoardCardField, task: TaskSummary): boolean {
  const sent = task.cardFields?.find((entry) => entry.ref === field.ref)?.value;
  if (field.source === 'custom') return customText(sent, 'y', 'n') !== null;
  switch (field.key as TaskBoardBuiltinFieldKey) {
    case 'assignees':
      return ((sent as TaskAssignee[] | undefined) ?? task.assignees).length > 0;
    case 'due':
      return task.dueOn !== null;
    case 'priority':
      return ((sent as TaskPriorityRef | null | undefined) ?? task.priority) !== null;
    case 'tags':
      return ((sent as TaskTagRef[] | undefined) ?? task.tags).length > 0;
    case 'startOn':
      return typeof sent === 'string';
    case 'context':
      return ((sent as TaskContextSummary | null | undefined) ?? task.context) !== null;
    case 'subtasks':
      return task.subtasks.total > 0;
    default:
      return true;
  }
}
