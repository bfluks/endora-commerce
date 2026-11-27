import { useEffect, useId, useState, type ReactNode } from 'react';
import {
  TASK_DESCRIPTION_MAX,
  type RecordReference,
  type TaskDetail,
  type TaskPriorityConfig,
} from '@endora-commerce/contracts';
import { ReferenceField, TagMultiSelect } from '@endora-commerce/admin-kit/components';
import { Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { useTaskReferences } from '../lib/references.js';

/**
 * The fields of a Task beyond its title and assignees, as the create form and
 * the detail screen's edit form both write them (`specs/165-task-management/`
 * User Story 1; `contracts/admin-surfaces.md` §2): the description in the
 * kit's reference editor, the due date with an optional time, the start date,
 * the priority and the tags.
 */

/** What the inputs hold — strings as the inputs do; `''` is "none". */
export interface TaskFieldValues {
  description: string;
  dueOn: string;
  /** `HH:MM` in the reader's own clock; `''` for a date-only due date. */
  dueTime: string;
  startOn: string;
  priorityCode: string;
  tagIds: string[];
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The inputs' values for a Task, or empty ones for a new Task. */
export function taskFieldValuesOf(task?: TaskDetail): TaskFieldValues {
  const dueAt = task?.dueAt ? new Date(task.dueAt) : null;
  return {
    description: task?.description ?? '',
    // A due moment is shown in the reader's own clock, its date with it.
    dueOn: dueAt
      ? `${dueAt.getFullYear()}-${pad(dueAt.getMonth() + 1)}-${pad(dueAt.getDate())}`
      : (task?.dueOn ?? ''),
    dueTime: dueAt ? `${pad(dueAt.getHours())}:${pad(dueAt.getMinutes())}` : '',
    startOn: task?.startOn ?? '',
    priorityCode: task?.priority?.code ?? '',
    tagIds: (task?.tags ?? []).map((tag) => tag.id),
  };
}

/**
 * The due date as the API takes it: a moment when a time is set (the server
 * derives its date in `tasks.time_zone`), else the date alone.
 */
export function dueOf(values: Pick<TaskFieldValues, 'dueOn' | 'dueTime'>): { dueOn: string | null; dueAt: string | null } {
  if (values.dueOn && values.dueTime) {
    return { dueOn: null, dueAt: new Date(`${values.dueOn}T${values.dueTime}`).toISOString() };
  }
  return { dueOn: values.dueOn || null, dueAt: null };
}

/** The operator's priority list, read once per screen; empty while it loads or when it could not be read. */
export function usePriorities(): TaskPriorityConfig[] {
  const [priorities, setPriorities] = useState<TaskPriorityConfig[]>([]);
  useEffect(() => {
    let alive = true;
    tasksApi
      .priorities()
      .then((found) => {
        if (alive) setPriorities(found);
      })
      // Without it the picker offers "none" and the Task's own priority; the form still works.
      .catch(() => undefined);
    return (): void => {
      alive = false;
    };
  }, []);
  return priorities;
}

export interface TaskFieldInputsProps {
  values: TaskFieldValues;
  onChange: (patch: Partial<TaskFieldValues>) => void;
  /** `null` on the create form. */
  taskId: string | null;
  /** What the description's tokens name for this reader, so the editor shows them by name. */
  references?: readonly RecordReference[];
  /** The Task's current priority, offered even when the list no longer holds it. */
  currentPriority?: { code: string; name: string } | null;
  disabled?: boolean;
}

export function TaskFieldInputs(props: TaskFieldInputsProps): ReactNode {
  const { values, onChange, disabled = false } = props;
  const t = useTranslation('tasks');
  const { language } = useAppLanguage();
  const ids = {
    description: useId(),
    dueOn: useId(),
    dueTime: useId(),
    startOn: useId(),
    priority: useId(),
    tags: useId(),
  };
  const { kinds, lookups } = useTaskReferences(props.taskId);
  const priorities = usePriorities();
  const priorityOptions = priorities.map((priority) => ({
    code: priority.code,
    name: priority.name[language] || priority.defaultName,
  }));
  if (props.currentPriority && !priorityOptions.some((option) => option.code === props.currentPriority!.code)) {
    priorityOptions.push(props.currentPriority);
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor={ids.description}>{t('field.description')}</Label>
        <ReferenceField
          id={ids.description}
          value={values.description}
          onValueChange={(description): void => onChange({ description })}
          kinds={kinds}
          lookups={lookups}
          {...(props.references ? { references: props.references } : {})}
          maxLength={TASK_DESCRIPTION_MAX}
          disabled={disabled}
          rows={4}
          aria-describedby={`${ids.description}-hint`}
        />
        <p id={`${ids.description}-hint`} className="text-xs text-muted-foreground">
          {t('field.descriptionHint')}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={ids.dueOn}>{t('field.dueOn')}</Label>
          <Input
            id={ids.dueOn}
            type="date"
            value={values.dueOn}
            disabled={disabled}
            onChange={(event): void =>
              onChange(event.target.value ? { dueOn: event.target.value } : { dueOn: '', dueTime: '' })
            }
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={ids.dueTime}>{t('field.dueTime')}</Label>
          <Input
            id={ids.dueTime}
            type="time"
            value={values.dueTime}
            disabled={disabled || values.dueOn === ''}
            aria-describedby={`${ids.dueTime}-hint`}
            onChange={(event): void => onChange({ dueTime: event.target.value })}
          />
          <p id={`${ids.dueTime}-hint`} className="text-xs text-muted-foreground">
            {t('field.dueTimeHint')}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={ids.startOn}>{t('field.startOn')}</Label>
          <Input
            id={ids.startOn}
            type="date"
            value={values.startOn}
            disabled={disabled}
            onChange={(event): void => onChange({ startOn: event.target.value })}
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={ids.priority}>{t('field.priority')}</Label>
          <Select
            id={ids.priority}
            value={values.priorityCode}
            disabled={disabled}
            onChange={(event): void => onChange({ priorityCode: event.target.value })}
          >
            <option value="">{t('field.priorityNone')}</option>
            {priorityOptions.map((priority) => (
              <option key={priority.code} value={priority.code}>
                {priority.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <span id={ids.tags} className="text-sm font-medium leading-none">
            {t('field.tags')}
          </span>
          <TagMultiSelect
            ariaLabelledBy={ids.tags}
            selected={values.tagIds}
            onChange={(tagIds): void => onChange({ tagIds })}
            loadTags={tasksApi.listTags}
            disabled={disabled}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}
