import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskDetail as TaskDetailData, TaskReminder } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { setMobileViewport } from '../../setup';
import { ANNA_ID, ME_ID, TASK_ID, en, historyPage, renderTasks, taskDetail, workflow } from './tasks-fixtures';

/**
 * Reminders on a Task's screen (`specs/165-task-management/` User Story 7,
 * FR-034; `contracts/admin-surfaces.md` §2, side column).
 *
 * The reminders come with the Task — the reader's own and those that name
 * them — so the section asks no request of its own on load. A writer adds one
 * at a moment or some time before the due date, for themselves and the
 * assignees; the reminder's creator or a writer removes one.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const deleteSpy = vi.fn();

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
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { TaskDetail } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskDetail');

const BASE = '/api/v1/admin/tasks';
const TASK_PATH = `${BASE}/${TASK_ID}`;
const OTHER_ID = '00000000-0000-4000-8000-000000000c09';

function reminder(overrides: Partial<TaskReminder> = {}): TaskReminder {
  return {
    id: '00000000-0000-4000-8000-0000000002b1',
    mode: 'absolute',
    remindAt: '2026-11-04T08:00:00.000Z',
    offsetMinutes: null,
    recipients: [
      { id: ME_ID, name: 'Ada Min', active: true },
      { id: ANNA_ID, name: 'Anna Nowak', active: true },
    ],
    createdBy: { id: ME_ID, name: 'Ada Min' },
    done: false,
    createdAt: '2026-10-20T10:00:00.000Z',
    ...overrides,
  };
}

const RELATIVE = reminder({
  id: '00000000-0000-4000-8000-0000000002b2',
  mode: 'relative',
  offsetMinutes: 60,
  remindAt: '2026-11-04T23:00:00.000Z',
  recipients: [{ id: ME_ID, name: 'Ada Min', active: true }],
});
const SENT_BY_OTHER = reminder({
  id: '00000000-0000-4000-8000-0000000002b3',
  done: true,
  createdBy: { id: OTHER_ID, name: 'Olek Inny' },
});

let current: TaskDetailData = taskDetail();

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, deleteSpy]) spy.mockReset();
  current = taskDetail({ reminders: [reminder(), RELATIVE, SENT_BY_OTHER] });
  getSpy.mockImplementation((path: string) => {
    if (path === TASK_PATH) return Promise.resolve({ data: current });
    if (path === `${BASE}/workflow`) return Promise.resolve({ data: workflow() });
    if (path === `${BASE}/priorities`) return Promise.resolve({ data: [] });
    if (path === `${BASE}/tags`) return Promise.resolve({ data: [] });
    if (path === `${TASK_PATH}/attachments`) return Promise.resolve({ data: [] });
    if (path === `${TASK_PATH}/comments`) return Promise.resolve({ data: [] });
    if (path.startsWith(`${TASK_PATH}/history`)) return Promise.resolve(historyPage([]));
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  postSpy.mockImplementation((_path: string, body: unknown) => Promise.resolve({ data: { ...reminder(), ...(body as object) } }));
  deleteSpy.mockResolvedValue(undefined);
});

async function renderPage(permissions: readonly string[] = ['tasks:read', 'tasks:write']): Promise<void> {
  renderTasks(<TaskDetail />, { path: `/tasks/${TASK_ID}`, pattern: '/tasks/:id', permissions });
  await screen.findByRole('heading', { name: /Order the racking/ });
}

const section = (): HTMLElement => screen.getByRole('region', { name: en('detail.reminders') });
/** Each remove control names the reminder it removes, by when it fires. */
const REMOVE = new RegExp(`^${en('reminders.remove', { when: '' }).trim()}`);
const taskReads = (): number => getSpy.mock.calls.filter(([path]) => path === TASK_PATH).length;

describe('TaskDetail — reminders (US7)', () => {
  it('lists the reminders that came with the Task: when, for whom, and which were sent — asking nothing more', async () => {
    await renderPage();
    const items = within(within(section()).getByRole('list', { name: en('detail.reminders') })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Ada Min');
    expect(items[0]).toHaveTextContent('Anna Nowak');
    expect(items[0]).toHaveTextContent(new Date('2026-11-04T08:00:00.000Z').toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }));
    expect(items[1]).toHaveTextContent(en('reminders.before.60'));
    expect(items[2]).toHaveTextContent(en('reminders.sent'));
    expect(getSpy.mock.calls.map(([path]) => String(path)).filter((path) => path.includes('/reminders'))).toEqual([]);
  });

  it('adds a reminder at a moment for the reader and an assignee', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(section()).getByRole('button', { name: en('reminders.add') }));
    const form = within(section());
    await user.type(form.getByLabelText(en('reminders.at')), '2026-11-04T09:30');
    // The reader is offered and chosen; each assignee is offered.
    expect(form.getByRole('checkbox', { name: 'Ada Min' })).toBeChecked();
    await user.click(form.getByRole('checkbox', { name: 'Anna Nowak' }));
    const before = taskReads();
    await user.click(form.getByRole('button', { name: en('reminders.save') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalled());
    expect(postSpy).toHaveBeenCalledWith(`${TASK_PATH}/reminders`, {
      remindAt: new Date('2026-11-04T09:30').toISOString(),
      recipientIds: [ME_ID, ANNA_ID],
    });
    await waitFor(() => expect(taskReads()).toBeGreaterThan(before));
    expect(await screen.findByText(en('reminders.added'))).toBeInTheDocument();
    await waitFor(() => expect(within(section()).getByRole('button', { name: en('reminders.add') })).toHaveFocus());
  });

  it('moves focus into the form when it opens and back to Add reminder on Cancel (WCAG 2.4.3)', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(section()).getByRole('button', { name: en('reminders.add') }));
    await waitFor(() =>
      expect(within(section()).getByRole('radio', { name: en('reminders.mode.absolute') })).toHaveFocus(),
    );
    await user.click(within(section()).getByRole('button', { name: en('reminders.cancel') }));
    await waitFor(() => expect(within(section()).getByRole('button', { name: en('reminders.add') })).toHaveFocus());
  });

  it('adds a reminder some time before the due date', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(section()).getByRole('button', { name: en('reminders.add') }));
    const form = within(section());
    await user.click(form.getByRole('radio', { name: en('reminders.mode.relative') }));
    await user.selectOptions(form.getByLabelText(en('reminders.offset')), '1440');
    await user.click(form.getByRole('button', { name: en('reminders.save') }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`${TASK_PATH}/reminders`, { offsetMinutes: 1440, recipientIds: [ME_ID] }));
  });

  it('offers no reminder before the due date on a Task without one', async () => {
    current = taskDetail({ dueOn: null, dueAt: null, reminders: [] });
    const user = userEvent.setup();
    await renderPage();
    expect(within(section()).getByText(en('reminders.empty'))).toBeInTheDocument();
    await user.click(within(section()).getByRole('button', { name: en('reminders.add') }));
    expect(within(section()).getByRole('radio', { name: en('reminders.mode.relative') })).toBeDisabled();
    expect(within(section()).getByText(en('reminders.noDue'))).toBeInTheDocument();
  });

  it('asks for a recipient and a moment before it sends anything', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(section()).getByRole('button', { name: en('reminders.add') }));
    const form = within(section());
    expect(form.getByRole('button', { name: en('reminders.save') })).toBeDisabled();
    await user.type(form.getByLabelText(en('reminders.at')), '2026-11-04T09:30');
    await user.click(form.getByRole('checkbox', { name: 'Ada Min' }));
    expect(form.getByRole('button', { name: en('reminders.save') })).toBeDisabled();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('shows the server’s refusal and keeps the form', async () => {
    postSpy.mockRejectedValueOnce(
      new ApiError(422, { error: { code: 'TASK_REMINDER_INVALID', message: 'A task has at most 10 reminders.' } }),
    );
    const user = userEvent.setup();
    await renderPage();
    await user.click(within(section()).getByRole('button', { name: en('reminders.add') }));
    await user.type(within(section()).getByLabelText(en('reminders.at')), '2026-11-04T09:30');
    await user.click(within(section()).getByRole('button', { name: en('reminders.save') }));

    expect(await within(section()).findByText('A task has at most 10 reminders.')).toBeInTheDocument();
    expect(within(section()).getByRole('button', { name: en('reminders.save') })).toBeInTheDocument();
  });

  it('lets a writer remove a reminder and reads the Task again', async () => {
    const user = userEvent.setup();
    await renderPage();
    const before = taskReads();
    const when = new Date('2026-11-04T08:00:00.000Z').toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' });
    // The first and the third fire at the same moment; the first is the reader's.
    const [first] = within(section()).getAllByRole('button', { name: en('reminders.remove', { when }) });
    await user.click(first!);

    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(`${TASK_PATH}/reminders/${reminder().id}`));
    await waitFor(() => expect(taskReads()).toBeGreaterThan(before));
    expect(within(section()).getByRole('heading', { name: en('detail.reminders') })).toHaveFocus();
  });

  it('gives a reader no add control, and a remove control only on a reminder they set', async () => {
    current = taskDetail({
      permissions: { canChange: false, canDelete: false, canPublish: false },
      reminders: [reminder(), SENT_BY_OTHER],
    });
    await renderPage(['tasks:read']);
    expect(within(section()).queryByRole('button', { name: en('reminders.add') })).toBeNull();
    // The first was set by the reader (ME_ID), the second by someone else.
    expect(within(section()).getAllByRole('button', { name: REMOVE })).toHaveLength(1);
  });
});
