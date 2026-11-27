import { useId, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { TaskStatusConfig, TaskWorkflow } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { errorMessage, workflowStatusName } from '../../lib/labels.js';

export interface TaskStatusDeleteDialogProps {
  status: TaskStatusConfig;
  workflow: TaskWorkflow;
  language: string;
  /** Resolves when the status is gone; a rejection is shown in the dialog. */
  onConfirm: (replacement: string | undefined) => Promise<void>;
  onClose: () => void;
}

/** Whether the server refused because Tasks are in the status and no replacement was named. */
function replacementRequired(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.envelope.error.code === 'TASK_WORKFLOW_INVALID' &&
    (error.envelope.error.details as { rule?: unknown } | undefined)?.rule === 'replacement_required'
  );
}

/**
 * Remove a Task status (`specs/165-task-management/` FR-016).
 *
 * While Tasks are in it, the operator chooses where they go — among the
 * statuses the removed one may move to, which is what the server accepts — and
 * each Task's history records the move. `inUseCount` counts only the Tasks the
 * operator may see, so a status that looks empty may still hold some: the
 * server then asks for a replacement, and the dialog offers the choice.
 */
export function TaskStatusDeleteDialog(props: TaskStatusDeleteDialogProps): ReactNode {
  const { status, workflow, language } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const fieldId = useId();
  const [askReplacement, setAskReplacement] = useState(status.inUseCount > 0);
  const [replacement, setReplacement] = useState('');
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const targets = workflow.transitions
    .filter((edge) => edge.from === status.code && edge.to !== status.code)
    .map((edge) => workflow.statuses.find((candidate) => candidate.code === edge.to))
    .filter((candidate): candidate is TaskStatusConfig => candidate !== undefined)
    .sort((a, b) => a.weight - b.weight || a.code.localeCompare(b.code));

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
      setError(errorMessage(failure, t('workflow.error.save')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('workflow.delete.title')}
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
            disabled={busy || (askReplacement && targets.length === 0)}
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
          {t('workflow.delete.body', { name: workflowStatusName(status, language) })}
        </p>
        {askReplacement ? (
          targets.length === 0 ? (
            <p className="text-sm text-destructive">{t('workflow.delete.noReplacement')}</p>
          ) : (
            <div className="space-y-1">
              {status.inUseCount > 0 ? (
                <p className="text-sm">{t('workflow.delete.inUse', { count: status.inUseCount })}</p>
              ) : null}
              <Label htmlFor={`${fieldId}-replacement`}>{t('workflow.delete.replacement')}</Label>
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
                <option value="">{t('workflow.delete.replacementPlaceholder')}</option>
                {targets.map((target) => (
                  <option key={target.code} value={target.code}>
                    {workflowStatusName(target, language)}
                  </option>
                ))}
              </Select>
              {missing ? (
                <p id={`${fieldId}-replacement-error`} className="text-xs text-destructive">
                  {t('workflow.delete.replacementRequired')}
                </p>
              ) : null}
            </div>
          )
        ) : null}
      </div>
    </ModalDialog>
  );
}
