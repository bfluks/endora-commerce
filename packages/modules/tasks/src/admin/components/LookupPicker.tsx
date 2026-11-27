import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Combobox, type ComboboxOption } from '@endora-commerce/admin-kit/ui';

/** One option a lookup answers: its id, what it is called, and a quieter second line. */
export interface LookupOption {
  id: string;
  label: string;
  sublabel?: string | undefined;
}

export interface LookupPickerProps<T extends LookupOption> {
  id: string;
  /** Asked for each search the operator types — the server decides what matches. */
  load: (query: string) => Promise<T[]>;
  value: T | null;
  onChange: (option: T | null) => void;
  placeholder: string;
  emptyMessage: string;
  loadingMessage: string;
  disabled?: boolean;
}

/**
 * One record picked from a server-side lookup (`specs/165-task-management/`
 * User Story 6): the record picker of a link and the record picker of the
 * context card. Like `TaskPicker`, it asks nothing until the operator types,
 * and a search abandoned by a newer one, or by unmounting, writes into nothing.
 */
export function LookupPicker<T extends LookupOption>(props: LookupPickerProps<T>): ReactNode {
  const [found, setFound] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const { load } = props;

  const search = useCallback(
    (q: string): void => {
      const current = ++sequence.current;
      setLoading(true);
      load(q)
        .then((options) => {
          if (current === sequence.current) setFound(options);
        })
        .catch(() => {
          if (current === sequence.current) setFound([]);
        })
        .finally(() => {
          if (current === sequence.current) setLoading(false);
        });
    },
    [load],
  );

  useEffect(
    () => (): void => {
      sequence.current += 1;
    },
    [],
  );

  const options: ComboboxOption<string>[] = found.map((option) => ({
    value: option.id,
    label: option.label,
    ...(option.sublabel ? { description: option.sublabel } : {}),
  }));

  return (
    <Combobox<string>
      id={props.id}
      options={options}
      value={props.value?.id ?? null}
      selectedLabel={props.value?.label ?? ''}
      onChange={(id): void => props.onChange(found.find((option) => option.id === id) ?? null)}
      onSearchChange={search}
      manualFilter
      loading={loading}
      disabled={props.disabled ?? false}
      placeholder={props.placeholder}
      emptyMessage={props.emptyMessage}
      loadingMessage={props.loadingMessage}
    />
  );
}
