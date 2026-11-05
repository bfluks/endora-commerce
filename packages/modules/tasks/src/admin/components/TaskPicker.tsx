import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TaskSummary } from '@endora-commerce/contracts';
import { Combobox, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';

/** How many Tasks one search offers. */
const PICKER_LIMIT = 20;

/** A Task as a picker names it: its number, then its title. */
export function taskLabel(task: Pick<TaskSummary, 'number' | 'title'>): string {
  return `${task.number} ${task.title}`;
}

export interface TaskPickerProps {
  id: string;
  value: TaskSummary | null;
  onChange: (task: TaskSummary | null) => void;
  /** Tasks never offered — the Task on screen, those already chosen. */
  exclude: readonly string[];
  disabled?: boolean;
  ariaDescribedBy?: string;
}

/**
 * One Task, searched on the Tasks list by number or title (`GET /tasks?q=`) —
 * only the Tasks the reader may see, which is all the server ever lists. It
 * asks for nothing until it is opened: the screens mount it only once an
 * operator chose to pick (`specs/165-task-management/` User Story 5).
 */
export function TaskPicker(props: TaskPickerProps): ReactNode {
  const t = useTranslation('tasks');
  const [found, setFound] = useState<TaskSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const { exclude } = props;

  const search = useCallback(
    (q: string): void => {
      const current = ++sequence.current;
      setLoading(true);
      const query = new URLSearchParams({ limit: String(PICKER_LIMIT) });
      if (q.trim()) query.set('q', q.trim());
      tasksApi
        .listTasksBy(query)
        .then((page) => {
          if (current === sequence.current) setFound(page.items.filter((task) => !exclude.includes(task.id)));
        })
        .catch(() => {
          if (current === sequence.current) setFound([]);
        })
        .finally(() => {
          if (current === sequence.current) setLoading(false);
        });
    },
    [exclude],
  );

  // A search abandoned by unmounting the picker writes into nothing.
  useEffect(
    () => (): void => {
      sequence.current += 1;
    },
    [],
  );

  const options: ComboboxOption<string>[] = found.map((task) => ({
    value: task.id,
    label: taskLabel(task),
    description: task.status.name,
  }));

  return (
    <Combobox<string>
      id={props.id}
      options={options}
      value={props.value?.id ?? null}
      selectedLabel={props.value ? taskLabel(props.value) : ''}
      onChange={(id): void => props.onChange(found.find((task) => task.id === id) ?? null)}
      onSearchChange={search}
      manualFilter
      loading={loading}
      disabled={props.disabled ?? false}
      placeholder={t('taskPicker.placeholder')}
      emptyMessage={t('taskPicker.empty')}
      loadingMessage={t('taskPicker.loading')}
      {...(props.ariaDescribedBy ? { ariaDescribedBy: props.ariaDescribedBy } : {})}
    />
  );
}
