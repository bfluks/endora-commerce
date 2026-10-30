import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TaskAssigneeOption } from '@endora-commerce/contracts';
import { MultiCombobox, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';

/** An administrator chosen as an assignee: their id, and the name a Task shows. */
export interface ChosenAssignee {
  id: string;
  name: string;
}

export interface AssigneePickerProps {
  id: string;
  /** The administrators chosen, in order; empty for an unassigned Task. */
  value: readonly ChosenAssignee[];
  onChange: (next: ChosenAssignee[]) => void;
  ariaDescribedBy?: string;
  disabled?: boolean;
  /** The Task being edited: only who may see it is offered (#506). */
  taskId?: string;
  /** The record a new Task is created in (the create form's `?context=`): only who may see it is offered. */
  contextType?: string;
  contextId?: string;
}

/**
 * Choosing who a Task is for — several administrators, as chips
 * (`specs/165-task-management/` research R-2), on the kit's `MultiCombobox`.
 *
 * Its options come from `GET /tasks/lookups/assignees` — the module's own
 * lookup, gated by `tasks:write` like every write that names an assignee —
 * and not the administrators list, which needs `admin_users:read`: somebody
 * allowed to assign Tasks must not need the right to manage administrators to
 * do it. The lookup answers the active administrators, at most fifty, and the
 * control narrows them as the operator types; somebody already chosen stays a
 * chip, named, whether or not the lookup still offers them. On a Task's
 * screen, or on the create form inside a record, the lookup is asked for that
 * Task or record, and offers only who may see it — the save refuses anybody
 * else (#506).
 */
export function AssigneePicker(props: AssigneePickerProps): ReactNode {
  const t = useTranslation('tasks');
  const [found, setFound] = useState<TaskAssigneeOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const { taskId, contextType, contextId } = props;

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setSearching(true);
    setError(null);
    try {
      const options = await tasksApi.assignees('', {
        ...(taskId ? { taskId } : {}),
        ...(contextType && contextId ? { context: { contextType, contextId } } : {}),
      });
      if (current === sequence.current) setFound(options);
    } catch (failure) {
      if (current === sequence.current) {
        setFound([]);
        setError(errorMessage(failure, t('detail.saveError')));
      }
    } finally {
      if (current === sequence.current) setSearching(false);
    }
  }, [t, taskId, contextType, contextId]);

  useEffect(() => {
    void load();
  }, [load]);

  const offered = new Set(found.map((option) => option.id));
  const options: ComboboxOption<string>[] = [
    ...found.map((option) => ({ value: option.id, label: option.name, description: option.email })),
    // A chosen administrator the lookup no longer offers (deactivated since) keeps their name.
    ...props.value.filter((chosen) => !offered.has(chosen.id)).map((chosen) => ({ value: chosen.id, label: chosen.name })),
  ];
  const names = new Map(options.map((option) => [option.value, option.label]));

  return (
    <MultiCombobox<string>
      id={props.id}
      options={options}
      value={props.value.map((chosen) => chosen.id)}
      onChange={(next): void =>
        props.onChange(next.map((id) => ({ id, name: names.get(id) ?? id })))
      }
      loading={searching}
      disabled={props.disabled ?? false}
      placeholder={t('field.assigneePlaceholder')}
      emptyMessage={error ?? t('field.assigneeNoMatch')}
      ariaLabel={t('field.assignee')}
      {...(props.ariaDescribedBy ? { ariaDescribedBy: props.ariaDescribedBy } : {})}
    />
  );
}
