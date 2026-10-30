import { useState, type ReactNode } from 'react';
import type { TaskDetail } from '@endora-commerce/contracts';
import { CustomFieldValuesPanel } from '@endora-commerce/admin-kit/components';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { useAppLanguage } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';

/**
 * Reading the definitions is `custom_fields`' permission: the kit's panel asks
 * that module's admin API for them, gated `custom_fields:read`, so the fields
 * are shown only to a holder (Projects' `ProjectCustomFields.tsx`, the model).
 */
const CUSTOM_FIELDS_READ = 'custom_fields:read';

/** The per-field issues of a refused write, keyed by field key — `null` for any other failure. */
function customFieldIssues(failure: unknown): Record<string, string> | null {
  if (!(failure instanceof ApiError)) return null;
  const { code, details } = failure.envelope.error as { code: string; details?: unknown };
  if (code !== 'CUSTOM_FIELD_VALUE_INVALID' || !Array.isArray(details)) return null;
  const issues: Record<string, string> = {};
  for (const entry of details as Array<{ path?: unknown; issue?: unknown }>) {
    if (typeof entry.path === 'string' && typeof entry.issue === 'string') issues[entry.path] = entry.issue;
  }
  return issues;
}

/**
 * The bag to send: a value that was stored and is now empty is sent as `null`
 * — "clear this" — because a key the request does not name keeps its value.
 */
function withCleared(stored: Record<string, unknown>, edited: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...edited };
  for (const key of new Set([...Object.keys(stored), ...Object.keys(edited)])) {
    if (out[key] === undefined) out[key] = null;
  }
  return out;
}

/**
 * A Task's custom fields (`specs/165-task-management/` FR-007, research R-8):
 * the kit's `CustomFieldValuesPanel` for the `task` host, saved through the
 * Task's own `PATCH`, so the change is the Task's audited
 * `tasks.task.custom_fields_change`. Shown to a holder of `custom_fields:read`;
 * editable when the Task may be changed.
 */
export function TaskCustomFields(props: {
  task: TaskDetail;
  canChange: boolean;
  onChange: (next: TaskDetail) => void;
}): ReactNode {
  const { task, canChange, onChange } = props;
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  if (!hasPermission(CUSTOM_FIELDS_READ)) return null;

  const save = async (values: Record<string, unknown>): Promise<void> => {
    setFieldErrors({});
    try {
      onChange(await tasksApi.updateTask(task.id, { customFieldValues: withCleared(task.customFieldValues, values) }));
    } catch (failure) {
      setFieldErrors(customFieldIssues(failure) ?? {});
      // The panel shows the refusal's sentence; the fields show which.
      throw failure;
    }
  };

  return (
    <CustomFieldValuesPanel
      entityType="task"
      values={task.customFieldValues}
      {...(canChange ? { save } : {})}
      fieldErrors={fieldErrors}
      language={language}
    />
  );
}
