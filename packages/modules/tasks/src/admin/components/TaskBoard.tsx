import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type {
  TaskBoard as TaskBoardData,
  TaskBoardCardField,
  TaskStatusRef,
  TaskSummary,
  TaskWorkflow,
} from '@endora-commerce/contracts';
import { ApiError, useAuth } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button } from '@endora-commerce/admin-kit/ui';
import {
  KanbanBoard,
  MoveToMenu,
  type KanbanBoardLabels,
  type KanbanCardRenderState,
} from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { tasksApi } from '../api.js';
import { errorMessage, workflowStatusName } from '../lib/labels.js';
import { TaskCard } from './TaskCard.js';

/** The most rows `GET /tasks` answers in one page (`TASK_LIST_LIMIT_MAX`). */
const LANE_PAGE_LIMIT = 100;

/** One lane as the board holds it: the server's column, plus what the screen knows about it. */
export interface TaskLaneView {
  status: TaskStatusRef;
  /** Every Task in the status that matches the filters — not only the cards shown. */
  count: number;
  items: TaskSummary[];
  hasMore: boolean;
  state: 'ready' | 'loading' | 'error';
  /** The "show more" read of this lane. */
  more: 'idle' | 'loading' | 'error';
}

export interface TaskBoardProps {
  /** The board's filters as the API takes them — the screen's address, implied filters added. */
  query: string;
  /** The workflow: the lanes before the board answers, and the moves. */
  workflow: TaskWorkflow | null;
  /** A filter is applied — an empty lane then says "nothing matches". */
  filtered: boolean;
}

/** A move the server refused: which card, where to, and the server's own sentence. */
interface MoveRefusal {
  title: string;
  status: string;
  reason: string;
}

function viewOf(board: TaskBoardData): TaskLaneView[] {
  return board.columns.map((column) => ({ ...column, state: 'ready', more: 'idle' }));
}

/** The lanes with one card moved to `toCode`, the counts following it; `index` puts it back where it was. */
function relocate(lanes: readonly TaskLaneView[], itemId: string, toCode: string, index = 0): TaskLaneView[] {
  if (!lanes.some((lane) => lane.status.code === toCode)) return [...lanes];
  let moved: TaskSummary | undefined;
  const without = lanes.map((lane) => {
    const found = lane.items.find((item) => item.id === itemId);
    if (!found) return lane;
    moved = found;
    return { ...lane, items: lane.items.filter((item) => item.id !== itemId), count: Math.max(0, lane.count - 1) };
  });
  const card = moved;
  if (!card) return [...lanes];
  return without.map((lane) => {
    if (lane.status.code !== toCode) return lane;
    const items = [...lane.items];
    items.splice(Math.min(index, items.length), 0, {
      ...card,
      status: lane.status,
      closed: lane.status.category !== 'open',
    });
    return { ...lane, items, count: lane.count + 1 };
  });
}

/** The status codes a `TASK_TRANSITION_FORBIDDEN` refusal names as permitted, or `null` for another failure. */
function allowedTargetsOf(failure: unknown): string[] | null {
  if (!(failure instanceof ApiError) || failure.envelope.error.code !== 'TASK_TRANSITION_FORBIDDEN') return null;
  const details = failure.envelope.error.details;
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return null;
  const targets = (details as Record<string, unknown>)['allowedTargets'];
  return Array.isArray(targets) ? targets.filter((code): code is string => typeof code === 'string') : null;
}

const columnId = (lane: TaskLaneView): string => lane.status.code;
const itemId = (item: TaskSummary): string => item.id;

/**
 * The Task board (`specs/165-task-management/` User Story 3 scenarios 2 and 3,
 * FR-019, FR-022; research R-11) — CRM's `OpportunityBoard` and its page, the
 * model, on the kit's `KanbanBoard` and `MoveToMenu`.
 *
 *  - **The lanes are the workflow's statuses**, in its order: drawn from
 *    `GET /tasks/workflow` before the board answers, then from
 *    `GET /tasks/board` with each lane's count and first cards.
 *  - **Which lanes accept a card** is the workflow's moves from the card's
 *    status — and after the server refused a move, exactly the
 *    `allowedTargets` it named, until the card moves (as `TaskDetail` does).
 *    A reader without `tasks:write` gets neither a drag nor a menu.
 *  - **A move is optimistic and honest**: the card changes lane at once and
 *    `POST /tasks/:id/status {from, to}` is asked — the one door every status
 *    change goes through. A refusal puts the card back and shows the server's
 *    sentence, which names the permitted statuses. Closing a Task whose
 *    sub-tasks are still open says so (FR-028).
 *  - **A lane holding more than the board sent continues from `GET /tasks`**,
 *    same filters, that one status, with the card fields — the first
 *    continuation replaces the lane with a longer page of the same order.
 */
export function TaskBoard(props: TaskBoardProps): ReactNode {
  const { query, workflow, filtered } = props;
  const t = useTranslation('tasks');
  const tCore = useTranslation('core');
  const { language } = useAppLanguage();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('tasks:write');

  const [columns, setColumns] = useState<TaskLaneView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** A board read is in flight — the first or a reload after a filter change (`aria-busy`). */
  const [loading, setLoading] = useState(true);
  const [cardFields, setCardFields] = useState<TaskBoardCardField[]>([]);
  const [movingIds, setMovingIds] = useState<ReadonlySet<string>>(() => new Set());
  /** Per card: the targets the server named when it refused a move — they stand until the card moves. */
  const [allowedOverride, setAllowedOverride] = useState<ReadonlyMap<string, readonly string[]>>(() => new Map());
  const [refusal, setRefusal] = useState<MoveRefusal | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  /** Spoken after a move made from the menu; a drag is spoken by the board itself. */
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  /** Per lane: where its continuation from the list stands. Reset by every board read. */
  const cursors = useRef(new Map<string, string | null>());

  useEffect(() => {
    let alive = true;
    tasksApi
      .boardCardFields()
      .then((config) => {
        if (alive) setCardFields(config.fields);
      })
      // Without the configuration a card shows its title alone; the board still works.
      .catch(() => undefined);
    return (): void => {
      alive = false;
    };
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const current = ++sequence.current;
    setLoading(true);
    setError(null);
    try {
      const board = await tasksApi.board(new URLSearchParams(query));
      if (current !== sequence.current) return;
      cursors.current = new Map();
      setColumns(viewOf(board));
    } catch (failure) {
      if (current === sequence.current) setError(errorMessage(failure, t('board.error')));
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [query, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The lanes on screen: the board's once it answered, the workflow's own until then. */
  const lanes = useMemo<TaskLaneView[]>(() => {
    if (columns) return columns;
    if (!workflow) return [];
    return [...workflow.statuses]
      .sort((a, b) => a.weight - b.weight)
      .map((status) => ({
        status: {
          code: status.code,
          name: workflowStatusName(status, language),
          color: status.color,
          category: status.category,
        },
        count: 0,
        items: [],
        hasMore: false,
        state: error ? 'error' : 'loading',
        more: 'idle',
      }));
  }, [columns, workflow, language, error]);

  const targetsOf = useCallback(
    (item: TaskSummary): readonly TaskStatusRef[] => {
      if (!canWrite) return [];
      const override = allowedOverride.get(item.id);
      const allowed = new Set(
        override ??
          (workflow?.transitions ?? [])
            .filter((edge) => edge.from === item.status.code)
            .map((edge) => edge.to),
      );
      allowed.delete(item.status.code);
      // In board order, so the menu reads left to right like the lanes do.
      return lanes.filter((lane) => allowed.has(lane.status.code)).map((lane) => lane.status);
    },
    [canWrite, allowedOverride, workflow, lanes],
  );

  const move = useCallback(
    async (item: TaskSummary, toCode: string, announce: boolean): Promise<void> => {
      const fromCode = item.status.code;
      const target = lanes.find((lane) => lane.status.code === toCode)?.status;
      const index = lanes.find((lane) => lane.status.code === fromCode)?.items.findIndex((card) => card.id === item.id);
      setRefusal(null);
      setWarning(null);
      setNotice('');
      setMovingIds((previous) => new Set(previous).add(item.id));
      setColumns((previous) => (previous ? relocate(previous, item.id, toCode) : previous));
      try {
        const result = await tasksApi.changeStatus(item.id, fromCode, toCode);
        setAllowedOverride((previous) => {
          if (!previous.has(item.id)) return previous;
          const next = new Map(previous);
          next.delete(item.id);
          return next;
        });
        const status = result.task.status;
        if (result.task.closed && result.openSubtasks > 0) {
          setWarning(t('board.move.openSubtasks', { title: item.title, count: result.openSubtasks }));
        }
        if (announce) setNotice(t('board.move.done', { title: item.title, status: status.name }));
      } catch (failure) {
        setColumns((previous) => (previous ? relocate(previous, item.id, fromCode, Math.max(0, index ?? 0)) : previous));
        setRefusal({
          title: item.title,
          status: target?.name ?? toCode,
          reason: errorMessage(failure, t('board.move.error')),
        });
        const allowed = allowedTargetsOf(failure);
        if (allowed) setAllowedOverride((previous) => new Map(previous).set(item.id, allowed));
        // A conflict says the Task is not where this board had it: show what is true now.
        if (failure instanceof ApiError && failure.envelope.error.code === 'TASK_TRANSITION_CONFLICT') void load();
        // The board's own rollback and its spoken message hang on this rejection.
        throw failure;
      } finally {
        setMovingIds((previous) => {
          const next = new Set(previous);
          next.delete(item.id);
          return next;
        });
      }
    },
    [lanes, load, t],
  );

  const showMore = useCallback(
    async (statusCode: string): Promise<void> => {
      const generation = sequence.current;
      const cursor = cursors.current.get(statusCode);
      const mark = (more: TaskLaneView['more']): void =>
        setColumns((previous) =>
          previous ? previous.map((lane) => (lane.status.code === statusCode ? { ...lane, more } : lane)) : previous,
        );
      mark('loading');
      try {
        const params = new URLSearchParams(query);
        params.delete('status');
        params.append('status', statusCode);
        params.set('cardValues', 'true');
        params.set('limit', String(LANE_PAGE_LIMIT));
        if (cursor) params.set('cursor', cursor);
        const page = await tasksApi.listTasksBy(params);
        if (generation !== sequence.current) return;
        cursors.current.set(statusCode, page.nextCursor);
        setColumns((previous) =>
          previous
            ? previous.map((lane) => {
                if (lane.status.code !== statusCode) return lane;
                const fetched = new Set(page.items.map((item) => item.id));
                // The first continuation starts the lane again from the list's
                // first page; a card moved here meanwhile stays on top.
                const kept = cursor ? lane.items : lane.items.filter((item) => !fetched.has(item.id));
                const known = new Set(kept.map((item) => item.id));
                return {
                  ...lane,
                  items: [...kept, ...page.items.filter((item) => !known.has(item.id))],
                  hasMore: page.nextCursor !== null,
                  more: 'idle',
                };
              })
            : previous,
        );
      } catch {
        if (generation === sequence.current) mark('error');
      }
    },
    [query],
  );

  const itemsByColumn = useMemo(
    () => Object.fromEntries(lanes.map((lane) => [lane.status.code, lane.items])),
    [lanes],
  );

  const labels = useMemo<KanbanBoardLabels<TaskSummary, TaskLaneView>>(
    () => ({
      board: t('board.label'),
      column: (lane) => t('board.column.label', { status: lane.status.name }),
      dragHandle: (item) => t('board.drag.handle', { title: item.title }),
      dragHandleRoleDescription: t('board.drag.role'),
      instructions: t('board.drag.instructions'),
      pickedUp: (item, from) => t('board.announce.pickedUp', { title: item.title, status: from.status.name }),
      over: (item, lane, allowed) =>
        t(allowed ? 'board.announce.overAllowed' : 'board.announce.overRefused', {
          title: item.title,
          status: lane.status.name,
        }),
      dropped: (item, _from, to) => t('board.announce.dropped', { title: item.title, status: to.status.name }),
      refused: (item, from, to) =>
        t('board.announce.refused', { title: item.title, from: from.status.name, to: to.status.name }),
      cancelled: (item, from) => t('board.announce.cancelled', { title: item.title, status: from.status.name }),
      moveFailed: (item, from, _to, failure) =>
        t('board.announce.moveFailed', {
          title: item.title,
          status: from.status.name,
          reason: errorMessage(failure, t('board.move.error')),
        }),
    }),
    [t],
  );

  const renderCard = (item: TaskSummary, state: KanbanCardRenderState): ReactNode => {
    const targets = targetsOf(item);
    return (
      <div className="space-y-1.5">
        <TaskCard task={item} fields={cardFields} />
        {/* Not on the copy that follows the pointer: it is a picture of the card. */}
        {!state.isOverlay && targets.length > 0 ? (
          <MoveToMenu
            title={item.title}
            targets={targets}
            busy={movingIds.has(item.id) || state.isPending}
            onMove={(code): void => {
              // The board has already shown the reason; nothing is left to handle.
              move(item, code, true).catch(() => undefined);
            }}
          />
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={(): void => void load()}>
              {tCore('common.action.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {refusal ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-start justify-between gap-3">
            <span className="space-y-1">
              <span className="block font-medium">
                {t('board.move.refused', { title: refusal.title, status: refusal.status })}
              </span>
              <span className="block">{refusal.reason}</span>
            </span>
            <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={(): void => setRefusal(null)}>
              {tCore('common.action.close')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {warning ? (
        <Alert>
          <AlertDescription className="flex flex-wrap items-start justify-between gap-3">
            <span>{warning}</span>
            <Button variant="ghost" size="sm" className="min-h-11 sm:min-h-9" onClick={(): void => setWarning(null)}>
              {tCore('common.action.close')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {canWrite ? null : <p className="text-sm text-muted-foreground">{t('board.readOnly')}</p>}
      {/* Mounted before it has text, so a move from the menu is spoken reliably. */}
      <p role="status" className="sr-only">
        {notice}
      </p>
      {lanes.length === 0 ? (
        // Neither the workflow nor the board has answered: say so, rather than draw an empty board (WCAG 4.1.3).
        error ? null : (
          <p role="status" className="text-sm text-muted-foreground">
            {t('board.loading')}
          </p>
        )
      ) : (
        <div aria-busy={loading}>
          <KanbanBoard<TaskSummary, TaskLaneView>
            columns={lanes}
            getColumnId={columnId}
            itemsByColumn={itemsByColumn}
            getItemId={itemId}
            disabled={!canWrite}
            canDrop={(item, toColumnId): boolean => targetsOf(item).some((target) => target.code === toColumnId)}
            onMove={(movedId, fromColumnId, toColumnId): Promise<void> | void => {
              const item = itemsByColumn[fromColumnId]?.find((candidate) => candidate.id === movedId);
              return item ? move(item, toColumnId, false) : undefined;
            }}
            getColumnState={(lane): TaskLaneView['state'] => lane.state}
            renderColumnHeader={(lane): ReactNode => (
              <div className="space-y-1">
                <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full border border-black/10"
                    style={{ backgroundColor: lane.status.color }}
                  />
                  {lane.status.name}
                </h2>
                {lane.state === 'ready' ? (
                  <p className="text-xs text-muted-foreground">{t('board.column.count', { count: lane.count })}</p>
                ) : null}
              </div>
            )}
            renderColumnLoading={(): ReactNode => (
              <p role="status" className="text-xs text-muted-foreground">
                {t('board.column.loading')}
              </p>
            )}
            renderColumnError={(): ReactNode => <p className="text-xs text-destructive">{t('board.column.error')}</p>}
            renderColumnEmpty={(): ReactNode => (
              <p className="text-xs text-muted-foreground">
                {filtered ? t('board.column.emptyFiltered') : t('board.column.empty')}
              </p>
            )}
            renderColumnFooter={(lane): ReactNode =>
              lane.state === 'ready' && (lane.hasMore || lane.more !== 'idle') ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {t('board.column.shown', { shown: lane.items.length, count: lane.count })}
                  </p>
                  {lane.more === 'error' ? (
                    <p role="alert" className="text-xs text-destructive">
                      {t('board.column.moreError')}
                    </p>
                  ) : null}
                  {lane.hasMore ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 w-full sm:min-h-8"
                      disabled={lane.more === 'loading'}
                      aria-busy={lane.more === 'loading'}
                      aria-label={t('board.column.more', { status: lane.status.name })}
                      onClick={(): void => void showMore(lane.status.code)}
                    >
                      {t('board.column.moreAction')}
                    </Button>
                  ) : null}
                </div>
              ) : null
            }
            renderCard={renderCard}
            labels={labels}
            // Never taller than the window, so a long lane scrolls in itself; never
            // lower than 28rem, so a short window still shows cards.
            className="max-h-[max(28rem,calc(100dvh-8rem))]"
          />
        </div>
      )}
    </div>
  );
}
