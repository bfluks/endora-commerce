import { useState, type ReactNode } from 'react';
import type { ProjectDetail } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';

export interface DeleteProjectDialogProps {
  project: ProjectDetail;
  onClose: () => void;
  /** The Project is gone. */
  onDeleted: () => void;
}

/**
 * Deleting a Project, behind a confirmation that says what goes with it
 * (`DELETE /projects/:id`, User Story 1's API).
 *
 * A Project with linked records is refused (409 `PROJECT_HAS_LINKS`): the
 * refusal stays in the dialog, in the server's words, and nothing is deleted.
 */
export function DeleteProjectDialog(props: DeleteProjectDialogProps): ReactNode {
  const { project, onClose, onDeleted } = props;
  const t = useTranslation('projects');
  const tCore = useTranslation('core');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await projectsApi.deleteProject(project.id);
      onDeleted();
    } catch (failure) {
      setError(errorMessage(failure, t('delete.error')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('delete.title')}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onClose}>
            {tCore('common.action.cancel')}
          </Button>
          <Button
            variant="destructive"
            className="min-h-11 sm:min-h-9"
            disabled={busy}
            aria-busy={busy}
            onClick={(): void => void confirm()}
          >
            {t('delete.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm">{t('delete.body', { number: project.number })}</p>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </ModalDialog>
  );
}
