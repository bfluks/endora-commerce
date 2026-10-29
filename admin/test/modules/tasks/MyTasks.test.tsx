import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { setMobileViewport } from '../../setup';
import { OTHER_TASK_ID, TASK_ID, en, renderTasks, taskSummary } from './tasks-fixtures';

/**
 * *My Tasks* (`specs/163-projects-and-tasks/`, User Story 2 — tasks T064 and
 * T067; FR-033).
 *
 * The caller's open Tasks, in the order the server answers them — the earliest
 * due date first, undated ones last — each overdue one marked in words, each
 * with the record it belongs to.
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

const { MyTasks } = await import('../../../../packages/modules/tasks/src/admin/pages/MyTasks');

const OVERDUE = taskSummary({
  id: OTHER_TASK_ID,
  number: 'TSK-000002',
  title: 'Sign the handover',
  dueOn: '2026-10-01',
  overdue: true,
});
const UNDATED = taskSummary({
  id: '00000000-0000-4000-8000-0000000007a3',
  number: 'TSK-000003',
  title: 'Photograph the hall',
  dueOn: null,
  context: null,
});

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) =>
    path === '/api/v1/admin/tasks/mine'
      ? Promise.resolve({ data: [OVERDUE, taskSummary(), UNDATED] })
      : Promise.reject(new Error(`unexpected GET ${path}`)),
  );
});

describe('MyTasks', () => {
  it("reads the caller's open Tasks and keeps the server's order", async () => {
    renderTasks(<MyTasks />);
    await screen.findByText('Sign the handover');
    const numbers = screen
      .getAllByRole('link')
      .map((link) => link.textContent)
      .filter((text) => text?.startsWith('TSK-'));
    expect(numbers).toEqual(['TSK-000002', 'TSK-000001', 'TSK-000003']);
    expect(screen.getByRole('link', { name: 'TSK-000001' }).getAttribute('href')).toBe(`/tasks/${TASK_ID}`);
  });

  it('marks the overdue Task in words', async () => {
    renderTasks(<MyTasks />);
    const row = (await screen.findByText('Sign the handover')).closest('tr') as HTMLElement;
    expect(within(row).getByText(en('list.overdue'))).toBeTruthy();
    const onTime = screen.getByText('Order the racking').closest('tr') as HTMLElement;
    expect(within(onTime).queryByText(en('list.overdue'))).toBeNull();
  });

  it('names the record a Task belongs to', async () => {
    renderTasks(<MyTasks />);
    expect(await screen.findAllByRole('link', { name: /PRJ-000001 Warehouse fit-out/ })).toHaveLength(2);
  });

  it('says when nothing open is assigned to the caller', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderTasks(<MyTasks />);
    expect(await screen.findByText(en('mine.empty.title'))).toBeTruthy();
  });

  it("shows the server's sentence when the read fails", async () => {
    const { ApiError } = await import('@endora-commerce/admin-kit/lib');
    getSpy.mockRejectedValue(new ApiError(503, { error: { code: 'MODULE_DISABLED', message: 'Tasks is switched off.' } }));
    renderTasks(<MyTasks />);
    expect(await screen.findByText('Tasks is switched off.')).toBeTruthy();
  });
});
