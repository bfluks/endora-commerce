import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserCheck } from 'lucide-react';
import type { CreateTaskBody } from '@endora-commerce/contracts';
import { TASK_DESCRIPTION_MAX, TASK_TITLE_MAX } from '@endora-commerce/contracts';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  PageHeader,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { AssigneePicker } from '../components/AssigneePicker.js';
import { useCurrentAdmin } from '../lib/current-admin.js';
import { errorMessage } from '../lib/labels.js';

/**
 * Creating a Task (`specs/163-projects-and-tasks/`, User Story 2;
 * `contracts/admin-surfaces.md` §2).
 *
 * A Task created here belongs to no record — a Project's Tasks are created on
 * the Project's own *Tasks* tab, into a Stage, which is the only place that
 * knows the Stage. A title is required; a description, a due date and an
 * assignee are not. The new Task starts as *To do* and opens.
 */
export function TaskCreate(): ReactNode {
  const t = useTranslation('tasks');
  const navigate = useNavigate();
  const me = useCurrentAdmin();
  const ids = { title: useId(), description: useId(), dueOn: useId(), assignee: useId() };
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [assignee, setAssignee] = useState<{ id: string; name: string } | null>(null);
  const [missingTitle, setMissingTitle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (title.trim() === '') {
      setMissingTitle(true);
      return;
    }
    const body: CreateTaskBody = {
      title: title.trim(),
      ...(description.trim() ? { description } : {}),
      ...(dueOn ? { dueOn } : {}),
      ...(assignee ? { assignedAdminUserId: assignee.id } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      const created = await tasksApi.createTask(body);
      void navigate(`/tasks/${created.id}`);
    } catch (failure) {
      setError(errorMessage(failure, t('create.error.generic')));
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t('create.title')} description={t('create.description')} back={{ label: t('create.back'), to: '/tasks' }} />
      <Card className="max-w-3xl">
        <CardContent className="pt-6">
          <form className="space-y-5" noValidate onSubmit={(event): void => void submit(event)}>
            <p className="text-xs text-muted-foreground">{t('create.requiredHint')}</p>

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
                {me && assignee?.id !== me.id ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-11 px-2 sm:min-h-8"
                    onClick={(): void => setAssignee(me)}
                  >
                    <UserCheck aria-hidden="true" />
                    {t('detail.assignToMe')}
                  </Button>
                ) : null}
              </div>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy} aria-busy={busy}>
                {busy ? t('create.submitting') : t('create.submit')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TaskCreate;
