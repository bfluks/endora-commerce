import { useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { TaskTag } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { errorMessage } from '../../lib/labels.js';

export interface TaskTagDeleteDialogProps {
  tag: TaskTag;
  /** Resolves when the tag is gone; a rejection is shown in the dialog. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/**
 * Delete a Task tag (`specs/165-task-management/` User Story 9 scenario 1,
 * R-10). The tag comes off every Task that carries it, so the confirmation
 * says how many Tasks the operator can see carry it — `usageCount` counts only
 * those, which is why the sentence says so rather than promising a total.
 */
export function TaskTagDeleteDialog(props: TaskTagDeleteDialogProps): ReactNode {
  const { tag } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await props.onConfirm();
      props.onClose();
    } catch (failure) {
      setError(errorMessage(failure, t('tags.error.save')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('tags.delete.title')}
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
      <div className="space-y-3">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <p className="text-sm text-muted-foreground">{t('tags.delete.body', { name: tag.name })}</p>
        {tag.usageCount > 0 ? <p className="text-sm">{t('tags.delete.inUse', { count: tag.usageCount })}</p> : null}
      </div>
    </ModalDialog>
  );
}
