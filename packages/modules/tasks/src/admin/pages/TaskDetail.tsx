import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Pencil, Trash2, UserCheck } from 'lucide-react';
import {
  TASK_DESCRIPTION_MAX,
  TASK_STATUSES,
  TASK_TITLE_MAX,
  type RecordHistoryEntry,
  type TaskDetail as TaskDetailData,
  type TaskStatus,
  type UpdateTaskBody,
} from '@endora-commerce/contracts';
import { formatDateTime, useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  PageHeader,
  Select,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { ModalDialog, RecordHistory, recordHistoryChanges, useRecordHistory } from '@endora-commerce/admin-kit/components';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { AssigneePicker } from '../components/AssigneePicker.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { useCurrentAdmin } from '../lib/current-admin.js';
import { calendarDateLabel, errorMessage } from '../lib/labels.js';

const LIST_PATH = '/tasks';

/**
 * One Task (`specs/163-projects-and-tasks/`, User Story 2;
 * `contracts/admin-surfaces.md` §2–§3).
 *
 * Top to bottom: **the header** — title, number and status; **the details** —
 * a status control that writes at once, and the rest edited in place, sending
 * only what changed; **the context card** — the record the Task belongs to as
 * its owner describes it, linked while it is available and named without a
 * link when it is not, with the group (a Project's Stage) and the note the
 * owner wrote; **the history**; and last the zone `task.detail.after`, which
 * other modules fill and this one names none of.
 *
 * A Task the operator may not see answers exactly as one that does not exist
 * (404 `TASK_NOT_FOUND`), and the screen says what the server said. Without
 * `tasks:write` the screen is read-only and says so.
 */
export function TaskDetail(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('tasks:write');
  const me = useCurrentAdmin();
  const statusId = useId();
  const detailsHeadingId = useId();
  const contextHeadingId = useId();
  const historyHeadingId = useId();
  const [task, setTask] = useState<TaskDetailData | null>(null);
  // A Task of a record is the record owner's to delete (`canChangeTasks`, T147):
  // no Delete the server would refuse.
  const mayDelete = task === null || task.context === null || task.context.canChangeTasks;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const sequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setError(null);
    try {
      const loaded = await tasksApi.getTask(id);
      if (current === sequence.current) setTask(loaded);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('detail.error')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    setTask(null);
    setLoading(true);
    void load();
  }, [load]);

  /** One write; the answer is the Task as it is now. Resolves `true` when it was made. */
  const write = async (body: UpdateTaskBody, done: (next: TaskDetailData) => string): Promise<boolean> => {
    setBusy(true);
    setWriteError(null);
    setNotice('');
    try {
      const next = await tasksApi.updateTask(id, body);
      setTask(next);
      setNotice(done(next));
      setHistoryVersion((version) => version + 1);
      return true;
    } catch (failure) {
      setWriteError(errorMessage(failure, t('detail.saveError')));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const back = { label: t('detail.back'), to: LIST_PATH };

  if (task === null) {
    return (
      <>
        <PageHeader title={t('list.title')} back={back} />
        {loading ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t('detail.loading')}
          </p>
        ) : (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{error ?? t('detail.error')}</span>
              <span className="flex gap-2">
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
                  {tCore('common.action.retry')}
                </Button>
                <Button className="min-h-11 sm:min-h-8" asChild variant="ghost" size="sm">
                  <Link to={LIST_PATH}>{t('detail.back')}</Link>
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}
      </>
    );
  }

  const changeStatus = (status: TaskStatus): Promise<boolean> =>
    write({ status }, () => t('detail.statusChanged', { status: t(`status.${status}`) }));

  const assignToMe = (): Promise<boolean> =>
    me ? write({ assignedAdminUserId: me.id }, () => t('detail.saved')) : Promise.resolve(false);

  return (
    <>
      <PageHeader
        className="[&>div:first-child]:min-w-0 [&_h1]:flex-wrap"
        title={
          <span className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
            <span>{task.title}</span>
            <StatusBadge status={task.status} />
          </span>
        }
        description={<span>{task.number}</span>}
        back={back}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardContent className="pt-6">
            <section aria-labelledby={detailsHeadingId} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={detailsHeadingId} className="text-base font-semibold">
                  {t('detail.details')}
                </h2>
                {canWrite && !editing ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 sm:min-h-8"
                      disabled={busy}
                      onClick={(): void => setEditing(true)}
                    >
                      <Pencil aria-hidden="true" />
                      {t('detail.edit')}
                    </Button>
                    {mayDelete ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-11 text-destructive hover:text-destructive sm:min-h-8"
                        disabled={busy}
                        onClick={(): void => setDeleting(true)}
                      >
                        <Trash2 aria-hidden="true" />
                        {t('detail.delete')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {canWrite && !mayDelete ? (
                <p className="text-xs text-muted-foreground">{t('detail.deleteNotAllowed')}</p>
              ) : null}

              {canWrite ? (
                <div className="max-w-xs space-y-1">
                  <Label htmlFor={statusId}>{t('field.status')}</Label>
                  <Select
                    id={statusId}
                    value={task.status}
                    disabled={busy}
                    onChange={(event): void => void changeStatus(event.target.value as TaskStatus)}
                  >
                    {TASK_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {t(`status.${status}`)}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('detail.readOnly')}</p>
              )}

              {editing ? (
                <TaskEditForm
                  task={task}
                  busy={busy}
                  onCancel={(): void => {
                    setEditing(false);
                    setWriteError(null);
                  }}
                  onSave={async (body): Promise<void> => {
                    if (Object.keys(body).length === 0) {
                      setEditing(false);
                      return;
                    }
                    if (await write(body, () => t('detail.saved'))) setEditing(false);
                  }}
                />
              ) : (
                <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div className="space-y-0.5 sm:col-span-2">
                    <dt className="text-xs font-medium text-muted-foreground">{t('field.description')}</dt>
                    <dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {task.description.trim() ? (
                        task.description
                      ) : (
                        <span className="text-muted-foreground">{t('detail.noDescription')}</span>
                      )}
                    </dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">{t('field.dueOn')}</dt>
                    <dd className={task.overdue ? 'font-medium text-destructive' : undefined}>
                      {task.dueOn ? calendarDateLabel(task.dueOn, language) : t('list.noDueDate')}
                      {task.overdue ? ` · ${t('list.overdue')}` : null}
                    </dd>
                  </div>
                  <div className="space-y-0.5">
                    <dt className="text-xs font-medium text-muted-foreground">{t('field.assignee')}</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      {task.assignee ? (
                        <span className="[overflow-wrap:anywhere]">
                          {task.assignee.name}
                          {task.assignee.active ? null : (
                            <span className="text-muted-foreground"> ({t('detail.inactive')})</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t('list.unassigned')}</span>
                      )}
                      {canWrite && me && task.assignee?.id !== me.id ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="min-h-11 px-2 sm:min-h-8"
                          disabled={busy}
                          onClick={(): void => void assignToMe()}
                        >
                          <UserCheck aria-hidden="true" />
                          {t('detail.assignToMe')}
                        </Button>
                      ) : null}
                    </dd>
                  </div>
                  <div className="space-y-0.5 text-xs text-muted-foreground sm:col-span-2">
                    <p>
                      {task.createdBy
                        ? t('detail.createdBy', { name: task.createdBy.name, date: formatDateTime(task.createdAt) })
                        : t('detail.createdOn', { date: formatDateTime(task.createdAt) })}
                    </p>
                    {task.completedAt ? <p>{t('detail.completedAt', { date: formatDateTime(task.completedAt) })}</p> : null}
                  </div>
                </dl>
              )}

              {writeError ? (
                <Alert variant="destructive">
                  <AlertDescription>{writeError}</AlertDescription>
                </Alert>
              ) : null}
            </section>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardContent className="pt-6">
            <section aria-labelledby={contextHeadingId} className="space-y-2 text-sm">
              <h2 id={contextHeadingId} className="text-base font-semibold">
                {t('detail.context')}
              </h2>
              {task.context === null ? (
                <p className="text-muted-foreground">{t('detail.contextNone')}</p>
              ) : (
                <>
                  {task.context.available && task.context.href ? (
                    <Link
                      to={task.context.href}
                      className="font-medium text-primary underline-offset-4 [overflow-wrap:anywhere] hover:underline"
                    >
                      {task.context.label}
                    </Link>
                  ) : (
                    <p className="font-medium [overflow-wrap:anywhere]">{task.context.label}</p>
                  )}
                  {task.context.groupLabel ? <p className="text-muted-foreground">{task.context.groupLabel}</p> : null}
                  {task.context.available ? null : (
                    <p className="text-xs text-muted-foreground">{t('detail.contextUnavailable')}</p>
                  )}
                  {task.contextNote ? (
                    <div className="space-y-0.5 border-t pt-2">
                      <p className="text-xs font-medium text-muted-foreground">{t('detail.contextNote')}</p>
                      <p className="[overflow-wrap:anywhere]">{task.contextNote}</p>
                    </div>
                  ) : null}
                </>
              )}
            </section>
          </CardContent>
        </Card>

        <Card className="min-w-0 lg:col-span-3">
          <CardContent className="pt-6">
            <section aria-labelledby={historyHeadingId} className="space-y-3">
              <h2 id={historyHeadingId} className="text-base font-semibold">
                {t('detail.history')}
              </h2>
              <TaskHistory taskId={task.id} version={historyVersion} />
            </section>
          </CardContent>
        </Card>
      </div>

      {/* Mounted before it has text, so the announcement is reliable (WCAG 4.1.3). */}
      <p role="status" className="sr-only">
        {notice}
      </p>

      {deleting ? (
        <DeleteTaskDialog
          task={task}
          onClose={(): void => setDeleting(false)}
          onDeleted={(): void => void navigate(LIST_PATH)}
        />
      ) : null}

      <AdminZone name="task.detail.after" props={{ taskId: task.id }} />
    </>
  );
}

interface TaskEditFormProps {
  task: TaskDetailData;
  busy: boolean;
  onCancel: () => void;
  /** Only the fields that changed; empty when nothing did. */
  onSave: (body: UpdateTaskBody) => Promise<void>;
}

/** The Task's title, description, due date and assignee, edited together. */
function TaskEditForm(props: TaskEditFormProps): ReactNode {
  const { task, busy } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const ids = { title: useId(), description: useId(), dueOn: useId(), assignee: useId() };
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [dueOn, setDueOn] = useState(task.dueOn ?? '');
  const [assignee, setAssignee] = useState<{ id: string; name: string } | null>(
    task.assignee ? { id: task.assignee.id, name: task.assignee.name } : null,
  );
  const [missingTitle, setMissingTitle] = useState(false);

  const save = (): void => {
    if (title.trim() === '') {
      setMissingTitle(true);
      return;
    }
    const body: UpdateTaskBody = {
      ...(title.trim() !== task.title ? { title: title.trim() } : {}),
      ...(description !== task.description ? { description } : {}),
      ...((dueOn || null) !== task.dueOn ? { dueOn: dueOn || null } : {}),
      ...((assignee?.id ?? null) !== (task.assignee?.id ?? null) ? { assignedAdminUserId: assignee?.id ?? null } : {}),
    };
    void props.onSave(body);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor={ids.title}>
          {t('field.title')}
          <span aria-hidden="true" className="text-destructive">
            {' *'}
          </span>
        </Label>
        <Input
          id={ids.title}
          value={title}
          maxLength={TASK_TITLE_MAX}
          required
          aria-invalid={missingTitle}
          aria-describedby={missingTitle ? `${ids.title}-error` : undefined}
          onChange={(event): void => {
            setTitle(event.target.value);
            setMissingTitle(false);
          }}
        />
        {missingTitle ? (
          <p id={`${ids.title}-error`} className="text-xs text-destructive">
            {t('create.error.title')}
          </p>
        ) : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor={ids.description}>{t('field.description')}</Label>
        <Textarea
          id={ids.description}
          rows={4}
          value={description}
          maxLength={TASK_DESCRIPTION_MAX}
          onChange={(event): void => setDescription(event.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={ids.dueOn}>{t('field.dueOn')}</Label>
          <Input id={ids.dueOn} type="date" value={dueOn} onChange={(event): void => setDueOn(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={ids.assignee}>{t('field.assignee')}</Label>
          <AssigneePicker
            id={ids.assignee}
            value={assignee?.id ?? null}
            selectedLabel={assignee?.name ?? ''}
            onChange={setAssignee}
            ariaDescribedBy={`${ids.assignee}-hint`}
          />
          <p id={`${ids.assignee}-hint`} className="text-xs text-muted-foreground">
            {t('field.assigneeHint')}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button type="button" className="min-h-11 sm:min-h-9" disabled={busy} aria-busy={busy} onClick={save}>
          {tCore('common.action.save')}
        </Button>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={props.onCancel}>
          {tCore('common.action.cancel')}
        </Button>
      </div>
    </div>
  );
}

/** Fields of a Task's audited state a reader is shown, each with its label (`history.field.<field>`). */
const SHOWN_HISTORY_FIELDS: ReadonlySet<string> = new Set(['title', 'status', 'dueOn', 'contextNote', 'completedAt']);

/**
 * The Task's audit trail (`GET /tasks/:id/history`) on the kit's
 * `RecordHistory` (`specs/163-projects-and-tasks/` research R-17): newest
 * first, a page at a time, each entry by what happened and what it changed,
 * field by field. Identifiers — the assignee, the context — are never a row;
 * the entry's heading says an assignment happened. Read again after every
 * write made on this screen.
 */
function TaskHistory(props: { taskId: string; version: number }): ReactNode {
  const t = useTranslation('tasks');
  const { language } = useAppLanguage();
  const { taskId } = props;
  const loadPage = useCallback((cursor: string | null) => tasksApi.history(taskId, cursor ?? undefined), [taskId]);
  const history = useRecordHistory<RecordHistoryEntry>(loadPage, props.version);

  const renderValue = (field: string, raw: unknown): ReactNode => {
    if (raw === null || raw === undefined || raw === '') return '—';
    if (field === 'status') return t(`status.${String(raw)}`);
    if (field === 'dueOn' && typeof raw === 'string') return calendarDateLabel(raw, language);
    if (field === 'completedAt' && typeof raw === 'string') return formatDateTime(raw);
    return String(raw);
  };

  return (
    <RecordHistory
      history={history}
      copy={{
        hint: t('history.hint'),
        empty: t('history.empty'),
        end: t('history.end'),
        truncated: t('history.truncated'),
      }}
      heading={(entry) => t(`auditLog.${entry.action}`)}
      changes={(entry) => recordHistoryChanges(entry).filter((change) => SHOWN_HISTORY_FIELDS.has(change.field))}
      fieldLabel={(field) => t(`history.field.${field}`)}
      renderValue={renderValue}
    />
  );
}

/** Deleting a Task, behind a confirmation; a refusal is shown in the dialog, in the server's words. */
function DeleteTaskDialog(props: { task: TaskDetailData; onClose: () => void; onDeleted: () => void }): ReactNode {
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await tasksApi.deleteTask(props.task.id);
      props.onDeleted();
    } catch (failure) {
      setError(errorMessage(failure, t('delete.error')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('delete.title')}
      busy={busy}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={props.onClose}>
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
        <p className="text-sm">{t('delete.body', { number: props.task.number })}</p>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </ModalDialog>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TaskDetail;
