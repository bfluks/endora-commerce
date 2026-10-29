import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { TaskAssigneeOption } from '@endora-commerce/contracts';
import { Combobox, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';

const SEARCH_DEBOUNCE_MS = 250;

export interface AssigneePickerProps {
  id: string;
  /** The administrator chosen, or `null` for an unassigned Task. */
  value: string | null;
  /** Their name, so a choice made earlier reads well before any search ran. */
  selectedLabel: string;
  onChange: (assignee: { id: string; name: string } | null) => void;
  ariaDescribedBy?: string;
  disabled?: boolean;
}

/**
 * Choosing who a Task is for, among the active administrators.
 *
 * It searches `GET /tasks/lookups/assignees` — the module's own lookup, gated
 * by `tasks:write` like every write that names an assignee — and not the
 * administrators list, which needs `admin_users:read`: somebody allowed to
 * assign Tasks must not need the right to manage administrators to do it.
 */
export function AssigneePicker(props: AssigneePickerProps): ReactNode {
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const [found, setFound] = useState<TaskAssigneeOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    async (query: string): Promise<void> => {
      const current = ++sequence.current;
      setSearching(true);
      setError(null);
      try {
        const options = await tasksApi.assignees(query);
        if (current === sequence.current) setFound(options);
      } catch (failure) {
        if (current === sequence.current) {
          setFound([]);
          setError(errorMessage(failure, t('detail.saveError')));
        }
      } finally {
        if (current === sequence.current) setSearching(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void search('');
    return (): void => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [search]);

  const options: ComboboxOption<string>[] = found.map((option) => ({
    value: option.id,
    label: option.name,
    description: option.email,
  }));

  return (
    <Combobox<string>
      id={props.id}
      options={options}
      value={props.value}
      selectedLabel={props.selectedLabel}
      onChange={(value): void => {
        if (value === null) {
          props.onChange(null);
          return;
        }
        const chosen = found.find((option) => option.id === value);
        props.onChange({ id: value, name: chosen?.name ?? props.selectedLabel });
      }}
      onSearchChange={(query): void => {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => void search(query), SEARCH_DEBOUNCE_MS);
      }}
      manualFilter
      clearable
      loading={searching}
      disabled={props.disabled ?? false}
      placeholder={t('field.assigneePlaceholder')}
      emptyMessage={error ?? (searching ? tCore('common.state.loading') : t('field.assigneeNoMatch'))}
      ariaLabel={t('field.assignee')}
      {...(props.ariaDescribedBy ? { ariaDescribedBy: props.ariaDescribedBy } : {})}
    />
  );
}
