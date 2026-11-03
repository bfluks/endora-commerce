import { useId, useRef, useState, type ReactNode } from 'react';
import { BellPlus, X } from 'lucide-react';
import type { TaskDetail, TaskReminder } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Badge, Button, Checkbox, Input, Label, Select } from '@endora-commerce/admin-kit/ui';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { useCurrentAdmin } from '../lib/current-admin.js';
import { errorMessage, momentLabel } from '../lib/labels.js';
import { useEditorFocus } from '../lib/use-editor-focus.js';

/** The offsets a reminder before the due date is offered at, in minutes. */
const OFFSETS = [15, 60, 1440, 2880, 10080] as const;
const DEFAULT_OFFSET = 60;

export interface RemindersSectionProps {
  task: TaskDetail;
  /** The reader may change this Task — add reminders, and remove anybody's. */
  canChange: boolean;
  /** A reminder was added or removed: the screen reads the Task again, and says `notice`. */
  onChange: (notice: string) => void;
}

/**
 * A Task's reminders (`specs/165-task-management/` User Story 7, FR-034;
 * `contracts/admin-surfaces.md` §2, side column).
 *
 * The reminders come with the Task — the reader's own and those that name
 * them — so the section asks nothing on load. Each says when it fires (a
 * moment, or how long before the due date, with the moment that makes), for
 * whom, and whether it was sent. A writer adds one for themselves and the
 * assignees; the reminder's creator or a writer removes it. The server decides
 * again and answers a refusal in its own words.
 */
export function RemindersSection(props: RemindersSectionProps): ReactNode {
  const { task, canChange } = props;
  const t = useTranslation('tasks');
  const { language } = useAppLanguage();
  const me = useCurrentAdmin();
  const headingId = useId();
  const modeName = useId();
  const atId = useId();
  const offsetId = useId();
  const [adding, setAdding] = useState(false);
  const [mode, setMode] = useState<'absolute' | 'relative'>('absolute');
  const [at, setAt] = useState('');
  const [offset, setOffset] = useState<number>(DEFAULT_OFFSET);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasDue = task.dueOn !== null || task.dueAt !== null;
  const focus = useEditorFocus(adding);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Who may be reminded: the reader and the assignees, each once.
  const people = [...(me ? [me] : []), ...task.assignees.filter((assignee) => assignee.id !== me?.id)];

  const when = (reminder: TaskReminder): string => {
    const moment = momentLabel(reminder.remindAt, language);
    if (reminder.mode === 'absolute' || reminder.offsetMinutes === null) return moment;
    const offsetLabel = (OFFSETS as readonly number[]).includes(reminder.offsetMinutes)
      ? t(`reminders.before.${reminder.offsetMinutes}`)
      : t('reminders.beforeMinutes', { minutes: reminder.offsetMinutes });
    return `${offsetLabel} · ${moment}`;
  };

  const open = (): void => {
    setAdding(true);
    setMode('absolute');
    setAt('');
    setOffset(DEFAULT_OFFSET);
    setChosen(new Set(me ? [me.id] : []));
    setError(null);
  };

  const toggle = (id: string): void =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async (change: () => Promise<unknown>, notice: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await change();
      props.onChange(notice);
      return true;
    } catch (failure) {
      setError(errorMessage(failure, t('reminders.error')));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const recipientIds = people.map((person) => person.id).filter((id) => chosen.has(id));
  const ready = recipientIds.length > 0 && (mode === 'relative' ? hasDue : at !== '');

  const save = async (): Promise<void> => {
    if (!ready) return;
    const body = mode === 'relative' ? { offsetMinutes: offset, recipientIds } : { remindAt: new Date(at).toISOString(), recipientIds };
    if (await run(() => tasksApi.addReminder(task.id, body), t('reminders.added'))) setAdding(false);
  };

  const mayRemove = (reminder: TaskReminder): boolean => canChange || (me !== null && reminder.createdBy?.id === me.id);

  return (
    <section aria-labelledby={headingId} className="space-y-3 text-sm">
      <h2 ref={headingRef} id={headingId} tabIndex={-1} className="text-base font-semibold">
        {t('detail.reminders')}
      </h2>

      {task.reminders.length > 0 ? (
        <ul aria-label={t('detail.reminders')} className="space-y-2">
          {task.reminders.map((reminder) => (
            <li key={reminder.id} className="flex items-start justify-between gap-2">
              <span className="min-w-0 space-y-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="font-medium">{when(reminder)}</span>
                  {reminder.done ? <Badge variant="secondary">{t('reminders.sent')}</Badge> : null}
                </span>
                <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {t('reminders.for', { names: reminder.recipients.map((person) => person.name).join(', ') })}
                </span>
              </span>
              {mayRemove(reminder) ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11 min-w-11 shrink-0 px-2 sm:min-h-8 sm:min-w-8"
                  disabled={busy}
                  aria-label={t('reminders.remove', { when: when(reminder) })}
                  title={t('reminders.remove', { when: when(reminder) })}
                  onClick={(): void => {
                    void run(() => tasksApi.removeReminder(task.id, reminder.id), t('reminders.removed')).then((done) => {
                      // The removed row's button goes with it: focus rests on the section's heading.
                      if (done) headingRef.current?.focus();
                    });
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">{t('reminders.empty')}</p>
      )}

      {canChange && !adding ? (
        <Button
          ref={focus.openerRef}
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-8"
          disabled={busy}
          onClick={open}
        >
          <BellPlus aria-hidden="true" />
          {t('reminders.add')}
        </Button>
      ) : null}

      {adding ? (
        <div ref={focus.editorRef} className="space-y-3 rounded-md border p-3">
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('reminders.mode')}</legend>
            <label className="flex min-h-11 items-center gap-2 sm:min-h-8">
              <input
                type="radio"
                name={modeName}
                value="absolute"
                checked={mode === 'absolute'}
                disabled={busy}
                onChange={(): void => setMode('absolute')}
              />
              {t('reminders.mode.absolute')}
            </label>
            <label className="flex min-h-11 items-center gap-2 sm:min-h-8">
              <input
                type="radio"
                name={modeName}
                value="relative"
                checked={mode === 'relative'}
                disabled={busy || !hasDue}
                onChange={(): void => setMode('relative')}
              />
              {t('reminders.mode.relative')}
            </label>
            {!hasDue ? <p className="text-xs text-muted-foreground">{t('reminders.noDue')}</p> : null}
          </fieldset>

          {mode === 'absolute' ? (
            <div className="space-y-1">
              <Label htmlFor={atId}>{t('reminders.at')}</Label>
              <Input
                id={atId}
                type="datetime-local"
                value={at}
                disabled={busy}
                onChange={(event): void => setAt(event.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-1">
              <Label htmlFor={offsetId}>{t('reminders.offset')}</Label>
              <Select
                id={offsetId}
                value={String(offset)}
                disabled={busy}
                onChange={(event): void => setOffset(Number(event.target.value))}
              >
                {OFFSETS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {t(`reminders.offset.${minutes}`)}
                  </option>
                ))}
              </Select>
            </div>
          )}

          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{t('reminders.recipients')}</legend>
            <p className="text-xs text-muted-foreground">{t('reminders.recipientsHint')}</p>
            {people.map((person) => (
              <label key={person.id} className="flex min-h-11 items-center gap-2 sm:min-h-8">
                <Checkbox checked={chosen.has(person.id)} disabled={busy} onChange={(): void => toggle(person.id)} />
                {person.name}
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={busy || !ready}
              aria-busy={busy}
              onClick={(): void => void save()}
            >
              {t('reminders.save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 sm:min-h-8"
              disabled={busy}
              onClick={(): void => {
                setAdding(false);
                setError(null);
              }}
            >
              {t('reminders.cancel')}
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
