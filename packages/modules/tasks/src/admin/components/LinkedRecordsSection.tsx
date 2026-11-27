import { useCallback, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Link2, X } from 'lucide-react';
import { TASK_LINK_KINDS, type TaskDetail, type TaskLink, type TaskLinkKind, type TaskLookupOption } from '@endora-commerce/contracts';
import { useAuth, useModulePresence } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { errorMessage } from '../lib/labels.js';
import { useEditorFocus } from '../lib/use-editor-focus.js';
import { LookupPicker } from './LookupPicker.js';

/** The module that owns each kind a Task may be linked to, and the code it reads its records with. */
const OWNER: Readonly<Record<TaskLinkKind, { module: string; readPermission: string }>> = {
  opportunity: { module: 'crm', readPermission: 'crm:read' },
  order: { module: 'orders', readPermission: 'orders:read' },
  quote_request: { module: 'quote_requests', readPermission: 'rfqs:handle' },
};

export interface LinkedRecordsSectionProps {
  task: TaskDetail;
  /** The reader may change this Task. */
  canChange: boolean;
  /** A link was added or removed: the screen reads the Task again, and says `notice`. */
  onChange: (notice: string) => void;
}

/**
 * The Opportunities, Orders and Quote Requests a Task is linked to
 * (`specs/165-task-management/` User Story 6, FR-031 – FR-033;
 * `contracts/admin-surfaces.md` §2, side column). The links come with the
 * Task, each resolved for the reader by the server: a named one leads to its
 * record, and one the reader may not see — or whose module is off, or which
 * is gone — is shown as *unavailable*, never hidden, so that it can still be
 * removed. A link changes nobody's view of the Task (Q2 = A).
 *
 * A writer links another record through a picker: the kind first — only the
 * kinds whose module is on and whose read code the writer holds — then the
 * record by number (`GET /tasks/lookups/records`). The server decides again,
 * and answers a refusal in its own words.
 */
export function LinkedRecordsSection(props: LinkedRecordsSectionProps): ReactNode {
  const { task, canChange } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const { isPresent } = useModulePresence();
  const { hasPermission } = useAuth();
  const headingId = useId();
  const kindId = useId();
  const recordId = useId();
  const linkable = TASK_LINK_KINDS.filter(
    (kind) => isPresent(OWNER[kind].module) && hasPermission(OWNER[kind].readPermission),
  );
  const [picking, setPicking] = useState(false);
  const [kind, setKind] = useState<TaskLinkKind | null>(null);
  const [chosen, setChosen] = useState<TaskLookupOption | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pickedKind = kind ?? linkable[0] ?? null;
  const focus = useEditorFocus(picking);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(
    (q: string): Promise<TaskLookupOption[]> => (pickedKind ? tasksApi.lookupRecords(pickedKind, q) : Promise.resolve([])),
    [pickedKind],
  );

  const close = (): void => {
    setPicking(false);
    setKind(null);
    setChosen(null);
  };

  const run = async (change: () => Promise<unknown>, notice: string, removed = false): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await change();
      // The removed row's button goes with it: focus rests on the section's heading.
      if (removed) headingRef.current?.focus();
      close();
      props.onChange(notice);
    } catch (failure) {
      setError(errorMessage(failure, t('detail.saveError')));
    } finally {
      setBusy(false);
    }
  };

  const remove = (link: TaskLink): Promise<void> =>
    run(() => tasksApi.removeLink(task.id, link.id), t('links.removed'), true);

  return (
    <section aria-labelledby={headingId} className="space-y-3 text-sm">
      <h2 ref={headingRef} id={headingId} tabIndex={-1} className="text-base font-semibold">
        {t('detail.links')}
      </h2>

      {task.links.length > 0 ? (
        <ul aria-label={t('detail.links')} className="space-y-2">
          {task.links.map((link) => (
            <li key={link.id} className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-xs text-muted-foreground">{t(`links.kind.${link.kind}`)}</span>
                {link.available && link.label ? (
                  link.url ? (
                    <Link
                      to={link.url}
                      className="font-medium text-primary underline-offset-4 [overflow-wrap:anywhere] hover:underline"
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <span className="font-medium [overflow-wrap:anywhere]">{link.label}</span>
                  )
                ) : (
                  <span className="space-y-0.5">
                    <span className="block text-muted-foreground">{t('links.unavailable')}</span>
                    {/* Visible, and the remove control's description: a `title` reaches neither touch nor keyboard. */}
                    <span id={`${headingId}-${link.id}-why`} className="block text-xs text-muted-foreground">
                      {t('links.unavailableHint')}
                    </span>
                  </span>
                )}
              </span>
              {canChange ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11 min-w-11 shrink-0 px-2 sm:min-h-8 sm:min-w-8"
                  disabled={busy}
                  aria-label={
                    link.available && link.label
                      ? t('links.remove', { label: link.label })
                      : t('links.removeUnavailable')
                  }
                  aria-describedby={link.available && link.label ? undefined : `${headingId}-${link.id}-why`}
                  onClick={(): void => void remove(link)}
                >
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t('links.empty')}</p>
      )}

      {canChange && linkable.length > 0 && !picking ? (
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
          {t('links.add')}
        </Button>
      ) : null}

      {picking && pickedKind ? (
        <div ref={focus.editorRef} className="space-y-2 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor={kindId}>{t('links.kindPicker')}</Label>
            <Select
              id={kindId}
              value={pickedKind}
              disabled={busy}
              onChange={(event): void => {
                setKind(event.target.value as TaskLinkKind);
                setChosen(null);
              }}
            >
              {linkable.map((option) => (
                <option key={option} value={option}>
                  {t(`links.kind.${option}`)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor={recordId}>{t('links.recordPicker')}</Label>
            {/* Keyed by the kind: a new kind starts a new search. */}
            <LookupPicker
              key={pickedKind}
              id={recordId}
              load={load}
              value={chosen}
              onChange={setChosen}
              placeholder={t('links.placeholder')}
              emptyMessage={t('links.searchEmpty')}
              loadingMessage={t('links.searching')}
              disabled={busy}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={busy || chosen === null}
              aria-busy={busy}
              onClick={(): void => {
                if (chosen) {
                  void run(() => tasksApi.addLink(task.id, pickedKind, chosen.id), t('links.added', { label: chosen.label }));
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
                close();
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
