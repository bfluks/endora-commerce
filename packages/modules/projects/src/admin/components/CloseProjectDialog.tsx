import { useEffect, useId, useState, type ReactNode } from 'react';
import type { ProjectDetail, ProjectLossReason } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Label, Select, Textarea } from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { projectsApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';

export interface CloseProjectDialogProps {
  project: ProjectDetail;
  onClose: () => void;
  /** The Project was closed: the server's answer. */
  onClosed: (project: ProjectDetail) => void;
  /** Read the Project again, after a refusal that says it has changed. */
  reload: () => Promise<void>;
}

/**
 * Closing a Project as lost (`specs/163-projects-and-tasks/`, User Story 1;
 * FR-005).
 *
 * A loss reason is required — the dialog says so and sends nothing without one
 * — and a comment is optional. The reasons offered are the active ones; the
 * Project stays in its current Stage, which is recorded as the Stage it was
 * lost in, and it can be reopened later.
 */
export function CloseProjectDialog(props: CloseProjectDialogProps): ReactNode {
  const { project, onClose, onClosed, reload } = props;
  const t = useTranslation('projects');
  const tCore = useTranslation('core');
  const reasonId = useId();
  const commentId = useId();
  const [reasons, setReasons] = useState<ProjectLossReason[] | null>(null);
  const [reasonsFailed, setReasonsFailed] = useState(false);
  const [lossReasonId, setLossReasonId] = useState('');
  const [comment, setComment] = useState('');
  const [missingReason, setMissingReason] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    projectsApi
      .listLossReasons({ active: true })
      .then((loaded) => {
        if (alive) setReasons(loaded);
      })
      .catch(() => {
        if (alive) setReasonsFailed(true);
      });
    return (): void => {
      alive = false;
    };
  }, []);

  const submit = async (): Promise<void> => {
    if (lossReasonId === '') {
      setMissingReason(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const closed = await projectsApi.close(project.id, {
        outcome: 'lost',
        lossReasonId,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        version: project.version,
      });
      onClosed(closed);
    } catch (failure) {
      setError(errorMessage(failure, t('stageBar.error')));
      setBusy(false);
      if (failure instanceof ApiError && failure.status === 409) void reload();
    }
  };

  const stageName = project.currentStage?.name ?? '';

  return (
    <ModalDialog
      title={t('close.title')}
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
            onClick={(): void => void submit()}
          >
            {t('close.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm">{t('close.body', { stage: stageName })}</p>

        <div className="space-y-1">
          <Label htmlFor={reasonId}>
            {t('close.reason')}
            <span aria-hidden="true" className="text-destructive">
              {' *'}
            </span>
          </Label>
          <Select
            id={reasonId}
            value={lossReasonId}
            required
            disabled={reasons === null}
            aria-invalid={missingReason}
            aria-describedby={missingReason ? `${reasonId}-error` : undefined}
            onChange={(event): void => {
              setLossReasonId(event.target.value);
              setMissingReason(false);
            }}
          >
            <option value="">{t('close.reasonChoose')}</option>
            {(reasons ?? []).map((reason) => (
              <option key={reason.id} value={reason.id}>
                {reason.label}
              </option>
            ))}
          </Select>
          {missingReason ? (
            <p id={`${reasonId}-error`} className="text-xs text-destructive">
              {t('close.reasonRequired')}
            </p>
          ) : null}
          {reasonsFailed ? (
            <p role="alert" className="text-xs text-destructive">
              {t('close.reasonsError')}
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <Label htmlFor={commentId}>{t('close.comment')}</Label>
          <Textarea
            id={commentId}
            rows={3}
            value={comment}
            maxLength={2000}
            aria-describedby={`${commentId}-hint`}
            onChange={(event): void => setComment(event.target.value)}
          />
          <p id={`${commentId}-hint`} className="text-xs text-muted-foreground">
            {t('close.commentHint')}
          </p>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </ModalDialog>
  );
}
