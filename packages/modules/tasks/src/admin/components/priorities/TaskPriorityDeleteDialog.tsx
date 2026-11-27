import { useId, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { TaskPriorityConfig } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { errorMessage, workflowStatusName } from '../../lib/labels.js';

/** The `replacement` that leaves the Tasks without a priority (FR-024). */
const NO_PRIORITY = 'none';

export interface TaskPriorityDeleteDialogProps {
  priority: TaskPriorityConfig;
  /** Every configured priority, most urgent first — the removed one among them. */
  priorities: readonly TaskPriorityConfig[];
  language: string;
  /** Resolves when the priority is gone; a rejection is shown in the dialog. */
  onConfirm: (replacement: string | undefined) => Promise<void>;
  onClose: () => void;
}

/** Whether the server refused because Tasks hold the priority and nothing was named for them. */
function replacementRequired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.envelope.error.code === 'TASK_WORKFLOW_INVALID' &&
    (error.envelope.error.details as { rule?: unknown } | undefined)?.rule === 'priority_replacement_required'
  );
}

/**
 * Remove a Task priority (`specs/165-task-management/` User Story 9 scenario
 * 2, FR-024). While Tasks hold it, the operator chooses which priority they
 * get — or none — and each Task's history records the change. `inUseCount`
 * counts only the Tasks the operator may see, so a priority that looks unused
 * may still be held: the server then asks, and the dialog offers the choice.
 */
export function TaskPriorityDeleteDialog(props: TaskPriorityDeleteDialogProps): ReactNode {
  const { priority, language } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const fieldId = useId();
  const [askReplacement, setAskReplacement] = useState(priority.inUseCount > 0);
  const [replacement, setReplacement] = useState('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const others = props.priorities.filter((candidate) => candidate.code !== priority.code);

  const confirm = async (): Promise<void> => {
    if (askReplacement && replacement === '') {
      setMissing(true);
      return;
    }
    setMissing(false);
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm(askReplacement ? replacement : undefined);
      props.onClose();
    } catch (failure) {
      if (replacementRequired(failure)) setAskReplacement(true);
      setError(errorMessage(failure, t('priorities.error.save')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('priorities.delete.title')}
      busy={busy}
      onClose={props.onClose}
      footer={
        <>
          <Button className="min-h-11 sm:min-h-9" variant="outline" disabled={busy} onClick={props.onClose}>
            {tCore('common.action.cancel')}
          </Button>
          <Button
            className="min-h-11 sm:min-h-9"
            variant="destructive"
            disabled={busy}
            aria-busy={busy}
            onClick={(): void => void confirm()}
          >
            <Trash2 aria-hidden="true" />
            {tCore('common.action.delete')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {t('priorities.delete.body', { name: workflowStatusName(priority, language) })}
        </p>
        {askReplacement ? (
          <div className="space-y-1">
            {priority.inUseCount > 0 ? (
              <p className="text-sm">{t('priorities.delete.inUse', { count: priority.inUseCount })}</p>
            ) : null}
            <Label htmlFor={`${fieldId}-replacement`}>{t('priorities.delete.replacement')}</Label>
            <Select
              id={`${fieldId}-replacement`}
              value={replacement}
              aria-invalid={missing}
              aria-describedby={missing ? `${fieldId}-replacement-error` : undefined}
              onChange={(event): void => {
                setReplacement(event.target.value);
                setMissing(false);
              }}
            >
              <option value="">{t('priorities.delete.replacementPlaceholder')}</option>
              <option value={NO_PRIORITY}>{t('priorities.delete.none')}</option>
              {others.map((candidate) => (
                <option key={candidate.code} value={candidate.code}>
                  {workflowStatusName(candidate, language)}
                </option>
              ))}
            </Select>
            {missing ? (
              <p id={`${fieldId}-replacement-error`} className="text-xs text-destructive">
                {t('priorities.delete.replacementRequired')}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </ModalDialog>
  );
}
