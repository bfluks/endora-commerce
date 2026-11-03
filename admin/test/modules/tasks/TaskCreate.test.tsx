import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { setMobileViewport } from '../../setup';
import { ME_ID, en, renderTasks, taskDetail } from './tasks-fixtures';

/**
 * Creating a Task (`specs/163-projects-and-tasks/`, User Story 2 — task T067).
 *
 * A Task created here belongs to no record: a Project's Tasks are created on
 * the Project's own *Tasks* tab, into a Stage. A title is required and said to
 * be; nothing is sent without one; the new Task opens.
 */

const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(() => Promise.resolve({ data: [] })),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { TaskCreate } = await import('../../../../packages/modules/tasks/src/admin/pages/TaskCreate');

beforeEach(() => {
  setMobileViewport(false);
  postSpy.mockReset();
});

function renderPage(): void {
  renderTasks(
    <Routes>
      <Route path="/tasks/new" element={<TaskCreate />} />
      <Route path="/tasks/:id" element={<p>task screen</p>} />
    </Routes>,
    { path: '/tasks/new' },
  );
}

describe('TaskCreate', () => {
  it('refuses to send without a title, and says so', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: en('create.submit') }));
    expect(screen.getByText(en('create.error.title'))).toBeTruthy();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('links the description’s hint to the field, and names the tag picker by its visible label (T092)', async () => {
    renderPage();
    const description = await screen.findByLabelText(en('field.description'));
    // The field adds its own shortcut hint after it.
    expect(description).toHaveAccessibleDescription(expect.stringContaining(en('field.descriptionHint')));
    const tags = screen.getByRole('button', { name: en('field.tags') });
    expect(tags).not.toHaveAttribute('aria-label');
    expect(document.getElementById(tags.getAttribute('aria-labelledby') ?? '')?.textContent).toBe(en('field.tags'));
  });

  it('creates a Task with the fields filled, assigned to the caller, and opens it', async () => {
    postSpy.mockResolvedValue({ data: taskDetail() });
    renderPage();
    await userEvent.type(await screen.findByLabelText(new RegExp(en('field.title'))), 'Order the racking');
    await userEvent.type(screen.getByLabelText(en('field.description')), 'Three bays.');
    await userEvent.type(screen.getByLabelText(en('field.dueOn')), '2026-11-05');
    await userEvent.click(screen.getByRole('button', { name: en('detail.assignToMe') }));
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/tasks', {
      title: 'Order the racking',
      description: 'Three bays.',
      dueOn: '2026-11-05',
      assigneeIds: [ME_ID],
    });
    expect(await screen.findByText('task screen')).toBeTruthy();
  });
});
