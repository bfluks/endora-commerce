import { useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Link2, X } from 'lucide-react';
import type { TaskDetail, TaskSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, Label } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';
import { useEditorFocus } from '../lib/use-editor-focus.js';
import { StatusBadge } from './StatusBadge.js';
import { TaskPicker } from './TaskPicker.js';

export interface RelatedTasksSectionProps {
  task: TaskDetail;
  /** The reader may change this Task; the server also asks it of the other one. */
  canChange: boolean;
  /** A link was added or removed: the screen reads the Task again, and says `notice`. */
  onChange: (notice: string) => void;
}

/**
 * A Task's related Tasks (`specs/165-task-management/` User Story 5, FR-030;
 * `contracts/admin-surfaces.md` §2, side column) — Tasks linked with no
 * parent/child meaning, shown on both of them. Only those the reader may see
 * are listed; they come with the Task. A writer adds one through a picker over
 * the Tasks list and removes one from either side; the server asks that the
 * writer may change both Tasks and answers a refusal in its own words.
 */
export function RelatedTasksSection(props: RelatedTasksSectionProps): ReactNode {
  const { task, canChange } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const headingId = useId();
  const pickerId = useId();
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<TaskSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focus = useEditorFocus(picking);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const run = async (change: () => Promise<void>, notice: string, removed = false): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await change();
      // The removed row's button goes with it: focus rests on the section's heading.
      if (removed) headingRef.current?.focus();
      setPicking(false);
      setChosen(null);
      props.onChange(notice);
    } catch (failure) {
      setError(errorMessage(failure, t('detail.saveError')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className="space-y-3 text-sm">
      <h2 ref={headingRef} id={headingId} tabIndex={-1} className="text-base font-semibold">
        {t('detail.related')}
      </h2>

      {task.relatedTasks.length > 0 ? (
        <ul aria-label={t('detail.related')} className="space-y-2">
          {task.relatedTasks.map((related) => (
            <li key={related.id} className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  to={`/tasks/${related.id}`}
                  className="font-medium text-primary underline-offset-4 [overflow-wrap:anywhere] hover:underline"
                >
                  <span className="text-muted-foreground">{related.number}</span> {related.title}
                </Link>
                <StatusBadge status={related.status} />
              </span>
              {canChange ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11 min-w-11 shrink-0 px-2 sm:min-h-8 sm:min-w-8"
                  disabled={busy}
                  aria-label={t('related.remove', { number: related.number })}
                  onClick={(): void =>
                    void run(
                      () => tasksApi.unrelate(task.id, related.id),
                      t('related.removed', { number: related.number }),
                      true,
                    )
                  }
                >
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t('related.empty')}</p>
      )}

      {canChange && !picking ? (
        <Button
          ref={focus.openerRef}
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-8"
          disabled={busy}
          onClick={(): void => {
            setPicking(true);
            setError(null);
          }}
        >
          <Link2 aria-hidden="true" />
          {t('related.add')}
        </Button>
      ) : null}

      {picking ? (
        <div ref={focus.editorRef} className="space-y-2 rounded-md border p-3">
          <Label htmlFor={pickerId}>{t('related.picker')}</Label>
          <TaskPicker
            id={pickerId}
            value={chosen}
            onChange={setChosen}
            exclude={[task.id, ...task.relatedTasks.map((related) => related.id)]}
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={busy || chosen === null}
              aria-busy={busy}
              onClick={(): void => {
                if (chosen) {
                  void run(() => tasksApi.relate(task.id, chosen.id), t('related.added', { number: chosen.number }));
                }
              }}
            >
              {tCore('common.action.save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={busy}
              onClick={(): void => {
                setPicking(false);
                setChosen(null);
                setError(null);
              }}
            >
              {tCore('common.action.cancel')}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
