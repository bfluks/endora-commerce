import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskDetail as TaskDetailData } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import {
  ME_ID,
  PROJECT_ID,
  TASK_ID,
  core,
  en,
  historyEntry,
  historyPage,
  renderTasks,
  taskDetail,
} from './tasks-fixtures';

/**
 * One Task (`specs/163-projects-and-tasks/`, User Story 2 — tasks T064 and
 * T067; `contracts/admin-surfaces.md` §2).
 *
 * The header names the Task and its status; the **status control** writes at
 * once; the details are edited in place and only what changed is sent; the
 * **context card** names the record the Task belongs to — linked while it is
 * available, plain text when it is not — with the group (a Project's Stage)
 * and the owner's note; the history lists what happened. A reader sees all of
 * it and can change none of it.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();

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
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { TaskDetail } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskDetail');

const TASK_PATH = `/api/v1/admin/tasks/${TASK_ID}`;

let current: TaskDetailData = taskDetail();

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, patchSpy, deleteSpy]) spy.mockReset();
  current = taskDetail();
  getSpy.mockImplementation((path: string) => {
    if (path === TASK_PATH) return Promise.resolve({ data: current });
    if (path.startsWith(`${TASK_PATH}/history`)) {
      return Promise.resolve(
        historyPage([
          historyEntry({ id: 'h2', action: 'tasks.task.status_change', actedAt: '2026-10-21T10:00:00.000Z' }),
          historyEntry(),
        ]),
      );
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function renderPage(permissions?: readonly string[]): Promise<void> {
  renderTasks(<TaskDetail />, {
    path: `/tasks/${TASK_ID}`,
    pattern: '/tasks/:id',
    ...(permissions ? { permissions } : {}),
  });
  await screen.findByRole('heading', { name: /Order the racking/ });
}

const contextCard = (): HTMLElement => screen.getByRole('region', { name: en('detail.context') });

describe('TaskDetail — the header and the context card', () => {
  it('names the Task, its number and its status', async () => {
    await renderPage();
    expect(screen.getAllByText('TSK-000001').length).toBeGreaterThan(0);
    expect((screen.getByLabelText(en('field.status')) as HTMLSelectElement).value).toBe('todo');
  });

  it('links the context card to the Project, with its Stage and the owner note', async () => {
    current = taskDetail({ contextNote: 'Responsible role: Installer' });
    await renderPage();
    const link = within(contextCard()).getByRole('link', { name: 'PRJ-000001 Warehouse fit-out' });
    expect(link.getAttribute('href')).toBe(`/projects/${PROJECT_ID}`);
    expect(within(contextCard()).getByText('Design')).toBeTruthy();
    expect(within(contextCard()).getByText('Responsible role: Installer')).toBeTruthy();
  });

  it('names an unavailable context without a link, and says why', async () => {
    current = taskDetail({
      context: {
        type: 'project',
        available: false,
        label: 'Unavailable record',
        href: null,
        groupLabel: null,
        id: PROJECT_ID,
        groupId: null,
        canChangeTasks: false,
      },
    });
    await renderPage();
    expect(within(contextCard()).getByText('Unavailable record')).toBeTruthy();
    expect(within(contextCard()).queryByRole('link')).toBeNull();
    expect(within(contextCard()).getByText(en('detail.contextUnavailable'))).toBeTruthy();
  });

  it('says a Task without a context belongs to no record', async () => {
    current = taskDetail({ context: null });
    await renderPage();
    expect(within(contextCard()).getByText(en('detail.contextNone'))).toBeTruthy();
  });

  it("shows the server's sentence for a Task that does not exist or is hidden", async () => {
    getSpy.mockRejectedValue(
      new ApiError(404, {
        error: { code: 'TASK_NOT_FOUND', message: 'This task does not exist or is not available to you.' },
      }),
    );
    renderTasks(<TaskDetail />, { path: `/tasks/${TASK_ID}`, pattern: '/tasks/:id' });
    expect(await screen.findByText('This task does not exist or is not available to you.')).toBeTruthy();
  });
});

describe('TaskDetail — writing', () => {
  it('changes the status at once, and shows the answer', async () => {
    patchSpy.mockResolvedValue({ data: taskDetail({ status: 'in_progress' }) });
    await renderPage();
    await userEvent.selectOptions(screen.getByLabelText(en('field.status')), 'in_progress');
    expect(patchSpy).toHaveBeenCalledWith(TASK_PATH, { status: 'in_progress' });
    await waitFor(() =>
      expect((screen.getByLabelText(en('field.status')) as HTMLSelectElement).value).toBe('in_progress'),
    );
  });

  it('edits the details in place and sends only what changed', async () => {
    patchSpy.mockResolvedValue({ data: taskDetail({ title: 'Order the galvanised racking' }) });
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.edit') }));
    const title = screen.getByLabelText(new RegExp(en('field.title')));
    await userEvent.clear(title);
    await userEvent.type(title, 'Order the galvanised racking');
    await userEvent.click(screen.getByRole('button', { name: core('common.action.save') }));
    expect(patchSpy).toHaveBeenCalledWith(TASK_PATH, { title: 'Order the galvanised racking' });
    expect(await screen.findByRole('heading', { name: /Order the galvanised racking/ })).toBeTruthy();
  });

  it('assigns the Task to the caller in one step', async () => {
    current = taskDetail({ assignee: null });
    patchSpy.mockResolvedValue({ data: taskDetail({ assignee: { id: ME_ID, name: 'Ada Min', active: true } }) });
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.assignToMe') }));
    expect(patchSpy).toHaveBeenCalledWith(TASK_PATH, { assignedAdminUserId: ME_ID });
  });

  it("shows a refusal in the server's words", async () => {
    patchSpy.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'TASK_ASSIGNEE_INVALID',
          message: 'This person cannot be assigned: they are not an active administrator.',
        },
      }),
    );
    current = taskDetail({ assignee: null });
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.assignToMe') }));
    expect(
      await screen.findByText('This person cannot be assigned: they are not an active administrator.'),
    ).toBeTruthy();
  });

  it('deletes the Task after a confirmation and returns to the list', async () => {
    deleteSpy.mockResolvedValue(undefined);
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.delete') }));
    const dialog = await screen.findByRole('dialog', { name: en('delete.title') });
    expect(deleteSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: en('delete.confirm') }));
    expect(deleteSpy).toHaveBeenCalledWith(TASK_PATH);
    expect(await screen.findByText('tasks list screen')).toBeTruthy();
  });

  it('offers no Delete for a Task whose record does not let the caller remove it, and says why (T147)', async () => {
    current = taskDetail({ context: { ...taskDetail().context!, canChangeTasks: false } });
    await renderPage();
    expect(await screen.findByRole('button', { name: en('detail.edit') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: en('detail.delete') })).toBeNull();
    expect(screen.getByText(en('detail.deleteNotAllowed'))).toBeTruthy();
  });

  it('is read-only for a reader: no status control, no edit, no delete', async () => {
    await renderPage(['tasks:read']);
    expect(screen.queryByLabelText(en('field.status'))).toBeNull();
    expect(screen.getAllByText(en('status.todo')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: en('detail.edit') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('detail.delete') })).toBeNull();
    expect(screen.getByText(en('detail.readOnly'))).toBeTruthy();
  });
});

describe('TaskDetail — history and the zone', () => {
  it('lists the history, each entry by what happened', async () => {
    await renderPage();
    const history = screen.getByRole('region', { name: en('detail.history') });
    expect(await within(history).findByText(en('auditLog.tasks.task.create'))).toBeTruthy();
    expect(within(history).getByText(en('auditLog.tasks.task.status_change'))).toBeTruthy();
  });

  it('shows what each entry changed, field by field, and reads earlier entries a page at a time (kit RecordHistory)', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === TASK_PATH) return Promise.resolve({ data: current });
      if (path.startsWith(`${TASK_PATH}/history`)) {
        const second = path.includes('cursor=');
        return Promise.resolve({
          data: second
            ? [historyEntry({ id: 'h1', after: { title: 'Approve the drawings', status: 'todo' } })]
            : [
                historyEntry({
                  id: 'h2',
                  action: 'tasks.task.status_change',
                  actedAt: '2026-10-21T10:00:00.000Z',
                  before: { title: 'Approve the drawings', status: 'todo', contextId: PROJECT_ID },
                  after: { title: 'Approve the drawings', status: 'done', contextId: PROJECT_ID },
                }),
              ],
          pagination: second ? { cursor: null, hasMore: false, limit: 50 } : { cursor: 'next', hasMore: true, limit: 50 },
          truncated: false,
        });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    await renderPage();
    const history = screen.getByRole('region', { name: en('detail.history') });
    expect(await within(history).findByRole('heading', { name: en('auditLog.tasks.task.status_change') })).toBeTruthy();
    expect(within(history).getByText(en('history.field.status'))).toBeTruthy();
    expect(within(history).getByText(en('status.done'))).toBeTruthy();
    // An identifier is never a row.
    expect(within(history).queryByText(PROJECT_ID)).toBeNull();
    await userEvent.click(within(history).getByRole('button', { name: core('history.more') }));
    expect(await within(history).findByRole('heading', { name: en('auditLog.tasks.task.create') })).toBeTruthy();
  });

  it('mounts the task.detail.after zone with the Task id, naming no contributor', () => {
    const source = readFileSync(
      resolve(process.cwd(), '../packages/modules/tasks/src/admin/pages/TaskDetail.tsx'),
      'utf8',
    );
    expect(source).toContain('<AdminZone name="task.detail.after" props={{ taskId: task.id }} />');
    expect(source).not.toMatch(/mod-projects|projects:/);
  });
});
