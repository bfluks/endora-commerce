import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskBoard as TaskBoardData, TaskStatusRef, TaskSummary, TaskWorkflow } from '@endora-commerce/contracts';
import type { KanbanBoardProps } from '@endora-commerce/admin-kit/components';
import { core, en, renderTasks, STATUS, taskDetail, taskSummary, workflow } from './tasks-fixtures';

/**
 * The Task board (`specs/165-task-management/` User Story 3 scenarios 2 and 3,
 * FR-019, FR-022; research R-11).
 *
 * The `KanbanBoard` primitive is proven by its own test; what is proven here is
 * what Tasks hands it and what Tasks does when it calls back — CRM's board
 * test, the model:
 *
 *  - `canDrop` is the workflow's transitions from the card's status, and a
 *    reader without `tasks:write` gets no drag and no menu;
 *  - a drop is `POST /tasks/:id/status {from, to}` — the one door every status
 *    change goes through — and a refusal puts the card back and says why, in
 *    the server's words; after a `TASK_TRANSITION_FORBIDDEN` the card's menu
 *    offers exactly the `allowedTargets` the server named;
 *  - the *Move to…* menu is the same move by keyboard (WCAG 2.2 SC 2.5.7);
 *  - a lane holding more than the board sent continues from `GET /tasks`
 *    filtered to that status, with the card fields;
 *  - closing a Task with open sub-tasks says so (FR-028).
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

type BoardProps = KanbanBoardProps<TaskSummary, { status: TaskStatusRef }>;
let handed: BoardProps | null = null;

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  const Real = actual.KanbanBoard as unknown as (props: BoardProps) => React.ReactNode;
  return {
    ...actual,
    KanbanBoard: (props: BoardProps) => {
      handed = props;
      return <Real {...props} />;
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { TaskBoard } = await import('../../../../packages/modules/tasks/src/admin/components/TaskBoard');

const BOARD_PATH = '/api/v1/admin/tasks/board';
const CARD_FIELDS_PATH = '/api/v1/admin/tasks/board/card-fields';
const LIST_PATH = '/api/v1/admin/tasks?';

const ID = (n: number): string => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;
const RACKING = taskSummary({ id: ID(1), number: 'TSK-000001', title: 'Order the racking' });
const GATE = taskSummary({ id: ID(2), number: 'TSK-000002', title: 'Install the gate', status: STATUS.in_progress });
const MORE = taskSummary({ id: ID(3), number: 'TSK-000003', title: 'Paint the lines' });

/** The seeded statuses; only To do → In progress, In progress → Done and anything → Cancelled. */
function narrowWorkflow(): TaskWorkflow {
  return {
    ...workflow(),
    transitions: [
      { from: 'todo', to: 'in_progress' },
      { from: 'todo', to: 'cancelled' },
      { from: 'in_progress', to: 'done' },
      { from: 'in_progress', to: 'cancelled' },
    ],
  };
}

function boardData(): TaskBoardData {
  const items: Record<string, TaskSummary[]> = { todo: [RACKING], in_progress: [GATE] };
  return {
    columns: (['todo', 'in_progress', 'done', 'cancelled'] as const).map((code) => ({
      status: STATUS[code],
      count: code === 'todo' ? 2 : (items[code]?.length ?? 0),
      items: items[code] ?? [],
      hasMore: code === 'todo',
    })),
  };
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  handed = null;
  getSpy.mockImplementation((path: string) => {
    if (path === CARD_FIELDS_PATH) return Promise.resolve({ data: { fields: [], available: [], maxFields: 6 } });
    if (path.startsWith(BOARD_PATH)) return Promise.resolve({ data: boardData() });
    if (path.startsWith(LIST_PATH)) return Promise.resolve({ items: [RACKING, MORE], nextCursor: null });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

function lane(name: string): HTMLElement {
  return screen.getByRole('group', { name: en('board.column.label', { status: name }) });
}

function cardTitles(name: string): string[] {
  return within(lane(name))
    .queryAllByRole('link')
    .map((link) => link.textContent ?? '');
}

async function renderBoard(options: { permissions?: readonly string[]; query?: string } = {}): Promise<void> {
  renderTasks(<TaskBoard query={options.query ?? 'priority=high'} workflow={narrowWorkflow()} filtered />, {
    ...(options.permissions ? { permissions: options.permissions } : {}),
  });
  await screen.findByRole('link', { name: 'Order the racking' });
}

function moved(task: TaskSummary, status: TaskStatusRef, openSubtasks = 0) {
  const { context: _context, cardFields: _cardFields, ...summary } = task;
  return { data: { task: taskDetail({ ...summary, status, closed: status.category !== 'open' }), openSubtasks } };
}

describe('TaskBoard — lanes and reads', () => {
  it('reads the board with the filters it was handed, one lane per column, with the count', async () => {
    await renderBoard();
    const boardRead = getSpy.mock.calls.map(([path]) => path as string).find((path) => path.startsWith(`${BOARD_PATH}?`))!;
    expect(new URLSearchParams(boardRead.split('?')[1]).get('priority')).toBe('high');
    expect(cardTitles('To do')).toEqual(['Order the racking']);
    expect(cardTitles('In progress')).toEqual(['Install the gate']);
    expect(within(lane('To do')).getByText(en('board.column.count', { count: 2 }))).toBeTruthy();
  });

  it('continues a lane from the list, filtered to that status, with the card fields', async () => {
    await renderBoard();
    await userEvent.click(screen.getByRole('button', { name: en('board.column.more', { status: 'To do' }) }));
    await waitFor(() => expect(cardTitles('To do')).toEqual(['Order the racking', 'Paint the lines']));
    const listRead = getSpy.mock.calls.map(([path]) => path as string).find((path) => path.startsWith(LIST_PATH))!;
    const query = new URLSearchParams(listRead.split('?')[1]);
    expect(query.getAll('status')).toEqual(['todo']);
    expect(query.get('priority')).toBe('high');
    expect(query.get('cardValues')).toBe('true');
  });
});

describe('TaskBoard — feedback while it reads (T092)', () => {
  it('says the board is loading, rather than drawing an empty one, until the workflow arrives', async () => {
    getSpy.mockImplementation((path: string) =>
      path === CARD_FIELDS_PATH ? Promise.resolve({ data: { fields: [], available: [], maxFields: 6 } }) : new Promise(() => {}),
    );
    renderTasks(<TaskBoard query="" workflow={null} filtered={false} />);
    expect(await screen.findByText(en('board.loading'))).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('group', { name: en('board.column.label', { status: 'To do' }) })).toBeNull();
  });

  it('is aria-busy while the board is read, and not once it answered', async () => {
    let answer: (value: unknown) => void = () => {};
    getSpy.mockImplementation((path: string) => {
      if (path === CARD_FIELDS_PATH) return Promise.resolve({ data: { fields: [], available: [], maxFields: 6 } });
      if (path.startsWith(BOARD_PATH)) return new Promise((resolve) => (answer = resolve));
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderTasks(<TaskBoard query="" workflow={narrowWorkflow()} filtered={false} />);
    await waitFor(() => expect(lane('To do').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'true'));
    await act(async () => answer({ data: boardData() }));
    await screen.findByRole('link', { name: 'Order the racking' });
    expect(lane('To do').closest('[aria-busy]')).toHaveAttribute('aria-busy', 'false');
  });

  it('marks a draft, a private Task and a sub-task on its card', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === CARD_FIELDS_PATH) return Promise.resolve({ data: { fields: [], available: [], maxFields: 6 } });
      if (path.startsWith(BOARD_PATH)) {
        const data = boardData();
        data.columns[0]!.items = [
          { ...RACKING, draft: true, private: true, parent: { id: ID(9), number: 'TSK-000009', available: true } },
        ];
        return Promise.resolve({ data });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    await renderBoard();
    const todo = lane('To do');
    expect(within(todo).getByText(en('detail.draftBadge'))).toBeTruthy();
    expect(within(todo).getByText(en('detail.privateBadge'))).toBeTruthy();
    expect(within(todo).getByText(en('list.subtaskOf', { number: 'TSK-000009' }))).toBeTruthy();
    // The title stays the card's only link: a link never starts a drag.
    expect(cardTitles('To do')).toEqual(['Order the racking']);
    expect(within(lane('In progress')).queryByText(en('detail.draftBadge'))).toBeNull();
  });
});

describe('TaskBoard — moving a card', () => {
  it('accepts a drop only where the workflow allows a move from the card’s status', async () => {
    await renderBoard();
    expect(handed?.canDrop?.(RACKING, 'in_progress', RACKING.status.code)).toBe(true);
    expect(handed?.canDrop?.(RACKING, 'cancelled', RACKING.status.code)).toBe(true);
    expect(handed?.canDrop?.(RACKING, 'done', RACKING.status.code)).toBe(false);
    expect(handed?.canDrop?.(GATE, 'done', GATE.status.code)).toBe(true);
  });

  it('moves a dropped card through `POST /tasks/:id/status` with the status it was seen in', async () => {
    postSpy.mockResolvedValue(moved(RACKING, STATUS.in_progress));
    await renderBoard();
    await act(async () => {
      await handed?.onMove?.(RACKING.id, 'todo', 'in_progress');
    });
    expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/tasks/${RACKING.id}/status`, { from: 'todo', to: 'in_progress' });
    expect(cardTitles('In progress')).toEqual(['Order the racking', 'Install the gate']);
    expect(cardTitles('To do')).toEqual([]);
  });

  it('puts a refused card back, shows the server’s reason, and then offers only the targets it named', async () => {
    postSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'TASK_TRANSITION_FORBIDDEN',
          message: 'This move is not allowed. Allowed: Cancelled.',
          details: { allowedTargets: ['cancelled'], allowed: ['Cancelled'] },
        },
      }),
    );
    await renderBoard();
    let refusal: unknown = null;
    await act(async () => {
      await (handed?.onMove?.(RACKING.id, 'todo', 'in_progress') as Promise<void>).catch((failure: unknown) => {
        refusal = failure;
      });
    });
    expect(refusal).toBeInstanceOf(ApiError);
    expect(cardTitles('To do')).toEqual(['Order the racking']);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(en('board.move.refused', { title: 'Order the racking', status: 'In progress' }))).toBeTruthy();
    expect(within(alert).getByText('This move is not allowed. Allowed: Cancelled.')).toBeTruthy();

    // The menu now offers exactly what the server allowed, and so does `canDrop`.
    await userEvent.click(screen.getByRole('button', { name: core('kanban.moveTo.label', { title: 'Order the racking' }) }));
    const menu = screen.getByRole('group', { name: core('kanban.moveTo.label', { title: 'Order the racking' }) });
    expect(within(menu).getAllByRole('button').map((button) => button.textContent)).toEqual(['Cancelled']);
    expect(handed?.canDrop?.(RACKING, 'in_progress', RACKING.status.code)).toBe(false);
  });

  it('moves a card from its *Move to…* menu by keyboard alone', async () => {
    postSpy.mockResolvedValue(moved(GATE, STATUS.done));
    await renderBoard();
    const trigger = screen.getByRole('button', { name: core('kanban.moveTo.label', { title: 'Install the gate' }) });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const menu = screen.getByRole('group', { name: core('kanban.moveTo.label', { title: 'Install the gate' }) });
    expect(within(menu).getAllByRole('button').map((button) => button.textContent)).toEqual(['Done', 'Cancelled']);
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/tasks/${GATE.id}/status`, { from: 'in_progress', to: 'done' }),
    );
    expect(await screen.findByText(en('board.move.done', { title: 'Install the gate', status: 'Done' }))).toBeTruthy();
  });

  it('says so when the Task closed still has open sub-tasks', async () => {
    postSpy.mockResolvedValue(moved(GATE, STATUS.done, 2));
    await renderBoard();
    await act(async () => {
      await handed?.onMove?.(GATE.id, 'in_progress', 'done');
    });
    expect(await screen.findByText(en('board.move.openSubtasks', { title: 'Install the gate', count: 2 }))).toBeTruthy();
  });

  it('offers neither a drag nor a menu to a reader who may not write', async () => {
    await renderBoard({ permissions: ['tasks:read'] });
    expect(handed?.disabled).toBe(true);
    expect(handed?.canDrop?.(RACKING, 'in_progress', RACKING.status.code)).toBe(false);
    expect(screen.queryByRole('button', { name: core('kanban.moveTo.label', { title: 'Order the racking' }) })).toBeNull();
  });
});
