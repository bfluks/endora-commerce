import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck } from 'lucide-react';
import type { TaskSummary } from '@endora-commerce/contracts';
import { Alert, AlertDescription, Button, Card, CardContent, PageHeader } from '@endora-commerce/admin-kit/ui';
import { ResponsiveTable } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { useTaskColumns } from '../components/task-columns.js';
import { errorMessage } from '../lib/labels.js';

/**
 * *My Tasks* (`specs/163-projects-and-tasks/`, User Story 2; FR-033).
 *
 * The caller's open Tasks — neither done nor cancelled — in the order the
 * server answers them: the earliest due date first, undated ones last. An
 * overdue Task says so in words. Each Task names the record it belongs to;
 * a Task whose record the caller may not see is not in the answer at all.
 */
export function MyTasks(): ReactNode {
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const columns = useTaskColumns();
  const [rows, setRows] = useState<TaskSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setError(null);
    try {
      const loaded = await tasksApi.myTasks();
      if (current === sequence.current) setRows(loaded);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('mine.error')));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title={t('mine.title')}
        description={t('mine.description')}
        actions={
          <Button className="min-h-11 sm:min-h-9" variant="outline" asChild>
            <Link to="/tasks">{t('mine.all')}</Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="pt-6">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
                  {tCore('common.action.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : rows === null ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('mine.loading')}
            </p>
          ) : (
            <ResponsiveTable
              data={rows}
              columns={columns}
              keyExtractor={(row): string => row.id}
              emptyState={
                <div className="b2b-empty">
                  <div className="b2b-empty__icon">
                    <CircleCheck aria-hidden="true" />
                  </div>
                  <div className="b2b-empty__title">{t('mine.empty.title')}</div>
                  <div className="b2b-empty__sub">{t('mine.empty.body')}</div>
                </div>
              }
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default MyTasks;
