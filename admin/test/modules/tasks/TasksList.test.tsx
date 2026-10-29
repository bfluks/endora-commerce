import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setMobileViewport } from '../../setup';
import { OTHER_TASK_ID, PROJECT_ID, TASK_ID, en, renderTasks, taskSummary } from './tasks-fixtures';

/**
 * The Tasks list (`specs/163-projects-and-tasks/`, User Story 2 — tasks T064
 * and T067; `contracts/admin-surfaces.md` §2).
 *
 * Every Task the operator may see — the server hides a Task whose context they
 * may not see, so nothing here filters for safety — narrowed by status,
 * assignee, "overdue" and a search over number and title, keyset-paged. A
 * Task's context is shown with its label, linked to the record while the
 * record is available and as plain text when it is not.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { TasksList } = await import('../../../../packages/modules/tasks/src/admin/pages/TasksList');

const LIST_PATH = '/api/v1/admin/tasks';

const UNAVAILABLE = taskSummary({
  id: OTHER_TASK_ID,
  number: 'TSK-000002',
  title: 'Sign the handover',
  status: 'in_progress',
  dueOn: '2026-10-01',
  overdue: true,
  assignee: null,
  context: { type: 'project', available: false, label: 'Unavailable record', href: null, groupLabel: null },
});

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  getSpy.mockResolvedValue({ items: [taskSummary(), UNAVAILABLE], nextCursor: null });
});

/** The query of the last list read, as parameters. */
function lastQuery(): URLSearchParams {
  const paths = getSpy.mock.calls.map(([path]) => path as string).filter((path) => path.startsWith(LIST_PATH));
  const last = paths[paths.length - 1] ?? '';
  return new URLSearchParams(last.split('?')[1] ?? '');
}

describe('TasksList', () => {
  it('lists each Task with its number, title, status, due date and assignee', async () => {
    renderTasks(<TasksList />);
    const link = await screen.findByRole('link', { name: 'TSK-000001' });
    expect(link.getAttribute('href')).toBe(`/tasks/${TASK_ID}`);
    expect(screen.getByText('Order the racking')).toBeTruthy();
    expect(screen.getAllByText(en('status.todo')).length).toBeGreaterThan(0);
    expect(screen.getByText('Anna Nowak')).toBeTruthy();
    const unassigned = screen.getByText('Sign the handover').closest('tr') as HTMLElement;
    expect(within(unassigned).getByText(en('list.unassigned'))).toBeTruthy();
  });

  it('marks an overdue Task in words, not by colour alone', async () => {
    renderTasks(<TasksList />);
    const row = (await screen.findByText('Sign the handover')).closest('tr') as HTMLElement;
    expect(within(row).getByText(en('list.overdue'))).toBeTruthy();
  });

  it('links an available context to its record, and names an unavailable one without a link', async () => {
    renderTasks(<TasksList />);
    const context = await screen.findByRole('link', { name: /PRJ-000001 Warehouse fit-out/ });
    expect(context.getAttribute('href')).toBe(`/projects/${PROJECT_ID}`);
    const row = screen.getByText('Sign the handover').closest('tr') as HTMLElement;
    expect(within(row).getByText('Unavailable record')).toBeTruthy();
    expect(within(row).queryByRole('link', { name: 'Unavailable record' })).toBeNull();
  });

  it('asks the server for the filters chosen', async () => {
    renderTasks(<TasksList />);
    await screen.findByText('Order the racking');
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.status')), 'done');
    await waitFor(() => expect(lastQuery().getAll('status')).toEqual(['done']));
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.assignee')), 'me');
    await waitFor(() => expect(lastQuery().get('assignee')).toBe('me'));
    await userEvent.click(screen.getByLabelText(en('list.filter.overdue')));
    await waitFor(() => expect(lastQuery().get('overdue')).toBe('true'));
    await userEvent.type(screen.getByLabelText(en('list.search')), 'rack');
    await waitFor(() => expect(lastQuery().get('q')).toBe('rack'));
  });

  it('pages forward with the cursor the server answered, and back', async () => {
    getSpy.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('cursor=c2')
          ? { items: [UNAVAILABLE], nextCursor: null }
          : { items: [taskSummary()], nextCursor: 'c2' },
      ),
    );
    renderTasks(<TasksList />);
    await screen.findByText('Order the racking');
    await userEvent.click(screen.getByRole('button', { name: en('list.next') }));
    expect(await screen.findByText('Sign the handover')).toBeTruthy();
    expect(lastQuery().get('cursor')).toBe('c2');
    expect((screen.getByRole('button', { name: en('list.next') }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: en('list.previous') }));
    expect(await screen.findByText('Order the racking')).toBeTruthy();
  });

  it('offers "New task" to a writer only', async () => {
    const writer = renderTasks(<TasksList />);
    expect((await screen.findByRole('link', { name: en('list.new') })).getAttribute('href')).toBe('/tasks/new');
    writer.unmount();
    renderTasks(<TasksList />, { permissions: ['tasks:read'] });
    await screen.findByText('Order the racking');
    expect(screen.queryByRole('link', { name: en('list.new') })).toBeNull();
  });

  it('says there is nothing yet, and offers to clear filters when filtering found nothing', async () => {
    getSpy.mockResolvedValue({ items: [], nextCursor: null });
    renderTasks(<TasksList />);
    expect(await screen.findByText(en('list.empty.title'))).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText(en('list.filter.status')), 'done');
    expect(await screen.findByText(en('list.noResults.title'))).toBeTruthy();
  });
});
