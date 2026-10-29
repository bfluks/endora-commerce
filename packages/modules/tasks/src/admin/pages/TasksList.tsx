import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ListChecks, Plus, SearchX, X } from 'lucide-react';
import { TASK_STATUSES, type TaskStatus, type TaskSummary } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
  PageHeader,
  Select,
} from '@endora-commerce/admin-kit/ui';
import { ResponsiveTable } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi, type TaskListParams } from '../api.js';
import { errorMessage } from '../lib/labels.js';
import { useTaskColumns } from '../components/task-columns.js';

const PAGE_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 300;

type AssigneeFilter = '' | 'me' | 'none';

interface Filters {
  q: string;
  status: TaskStatus | '';
  assignee: AssigneeFilter;
  overdue: boolean;
}

const NO_FILTERS: Filters = { q: '', status: '', assignee: '', overdue: false };

/**
 * The Tasks list (`specs/163-projects-and-tasks/`, User Story 2;
 * `contracts/admin-surfaces.md` §2).
 *
 * Every Task the operator may see — the server hides a Task whose context they
 * may not see, so nothing here filters for safety — narrowed by status,
 * assignee ("me", "unassigned"), "only overdue" and a search over number and
 * title. The list is keyset-paged and knows no total, so it pages forward and
 * back by the cursors it was given.
 */
export function TasksList(): ReactNode {
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('tasks:write');
  const columns = useTaskColumns();

  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [search, setSearch] = useState('');
  /** The cursors that led to the page on screen; empty on the first page. */
  const [trail, setTrail] = useState<string[]>([]);
  const [rows, setRows] = useState<TaskSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);

  // The search box is typed into; the request follows once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((previous) => (previous.q === search ? previous : { ...previous, q: search }));
      setTrail((previous) => (previous.length === 0 ? previous : []));
    }, SEARCH_DEBOUNCE_MS);
    return (): void => clearTimeout(timer);
  }, [search]);

  const params = useMemo<TaskListParams>(() => {
    const cursor = trail[trail.length - 1];
    return {
      ...(filters.q.trim() ? { q: filters.q.trim() } : {}),
      ...(filters.status ? { status: [filters.status] } : {}),
      ...(filters.assignee ? { assignee: filters.assignee } : {}),
      ...(filters.overdue ? { overdue: true } : {}),
      ...(cursor ? { cursor } : {}),
      limit: PAGE_LIMIT,
    };
  }, [filters, trail]);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const page = await tasksApi.listTasks(params);
      // A slower, older answer must not overwrite a newer one.
      if (current !== sequence.current) return;
      setRows(page.items);
      setNextCursor(page.nextCursor);
      setLoaded(true);
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('list.error')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [params, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Any change of what is asked for starts again from the first page. */
  const change = (patch: Partial<Filters>): void => {
    setFilters((previous) => ({ ...previous, ...patch }));
    setTrail([]);
  };

  const clear = (): void => {
    setSearch('');
    setFilters(NO_FILTERS);
    setTrail([]);
  };

  const filtered = search.trim() !== '' || filters.status !== '' || filters.assignee !== '' || filters.overdue;

  const newTask = (
    <Button className="min-h-11 sm:min-h-9" asChild>
      <Link to="/tasks/new">
        <Plus aria-hidden="true" />
        {t('list.new')}
      </Link>
    </Button>
  );

  const emptyState = filtered ? (
    <div className="b2b-empty">
      <div className="b2b-empty__icon">
        <SearchX aria-hidden="true" />
      </div>
      <div className="b2b-empty__title">{t('list.noResults.title')}</div>
      <div className="b2b-empty__sub">{t('list.noResults.body')}</div>
      <Button className="min-h-11 sm:min-h-9" variant="outline" onClick={clear}>
        <X aria-hidden="true" />
        {t('list.filter.clear')}
      </Button>
    </div>
  ) : (
    <div className="b2b-empty">
      <div className="b2b-empty__icon">
        <ListChecks aria-hidden="true" />
      </div>
      <div className="b2b-empty__title">{t('list.empty.title')}</div>
      <div className="b2b-empty__sub">{canWrite ? t('list.empty.body') : t('list.empty.bodyReadOnly')}</div>
      {canWrite ? newTask : null}
    </div>
  );

  return (
    <>
      <PageHeader
        title={t('list.title')}
        description={t('list.description')}
        // With nothing listed the empty state carries the one action.
        actions={canWrite && (rows.length > 0 || filtered || !loaded) ? newTask : undefined}
      />

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="tasks-search">{t('list.search')}</Label>
              <Input
                id="tasks-search"
                type="search"
                value={search}
                placeholder={t('list.searchPlaceholder')}
                onChange={(event): void => setSearch(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tasks-status">{t('list.filter.status')}</Label>
              <Select
                id="tasks-status"
                value={filters.status}
                onChange={(event): void => change({ status: event.target.value as TaskStatus | '' })}
              >
                <option value="">{t('list.filter.statusAll')}</option>
                {TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tasks-assignee">{t('list.filter.assignee')}</Label>
              <Select
                id="tasks-assignee"
                value={filters.assignee}
                onChange={(event): void => change({ assignee: event.target.value as AssigneeFilter })}
              >
                <option value="">{t('list.filter.assigneeAny')}</option>
                <option value="me">{t('list.filter.assigneeMe')}</option>
                <option value="none">{t('list.filter.assigneeNone')}</option>
              </Select>
            </div>
            <div className="flex items-end">
              <label htmlFor="tasks-overdue" className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
                <Checkbox
                  id="tasks-overdue"
                  checked={filters.overdue}
                  onChange={(event): void => change({ overdue: event.target.checked })}
                />
                {t('list.filter.overdue')}
              </label>
            </div>
          </div>
          {filtered ? (
            <div className="mt-4 flex justify-end">
              <Button className="min-h-11 sm:min-h-8" variant="ghost" size="sm" onClick={clear}>
                <X aria-hidden="true" />
                {t('list.filter.clear')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6" aria-busy={loading}>
          {/* Mounted before it has text, so a reload is announced (WCAG 4.1.3). */}
          <p role="status" className="sr-only">
            {loading && loaded ? t('list.loading') : ''}
          </p>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>{error}</span>
                <Button className="min-h-11 sm:min-h-8" variant="outline" size="sm" onClick={(): void => void load()}>
                  {tCore('common.action.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : !loaded ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t('list.loading')}
            </p>
          ) : (
            <>
              <ResponsiveTable
                data={rows}
                columns={columns}
                keyExtractor={(row): string => row.id}
                emptyState={emptyState}
              />
              {rows.length > 0 && (trail.length > 0 || nextCursor) ? (
                <nav className="mt-4 flex justify-end gap-2" aria-label={t('list.title')}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-8"
                    disabled={trail.length === 0 || loading}
                    onClick={(): void => setTrail((previous) => previous.slice(0, -1))}
                  >
                    <ChevronLeft aria-hidden="true" />
                    {t('list.previous')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-8"
                    disabled={nextCursor === null || loading}
                    onClick={(): void => {
                      if (nextCursor) setTrail((previous) => [...previous, nextCursor]);
                    }}
                  >
                    {t('list.next')}
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </nav>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** The default export the route declaration's dynamic-import factory resolves. */
export default TasksList;
