import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import { setMobileViewport } from '../../setup';
import { PROJECT_ID, ROLES, detail, en, renderProjects } from './projects-fixtures';

/**
 * Deleting a Project (`specs/163-projects-and-tasks/`, task T071's addendum;
 * the API exists since User Story 1).
 *
 * Offered to a writer only, behind a confirmation that says what goes with the
 * Project; a Project with linked records is refused (409 `PROJECT_HAS_LINKS`)
 * and the refusal is shown in the server's words, in the dialog, with nothing
 * deleted. A deleted Project leaves its screen for the list.
 */

const getSpy = vi.fn();
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
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { ProjectDetail: ProjectDetailPage } = await import(
  '../../../../packages/modules/projects/src/admin/pages/ProjectDetail'
);

const DETAIL_PATH = `/api/v1/admin/projects/${PROJECT_ID}`;

let canWrite = true;

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  deleteSpy.mockReset();
  canWrite = true;
  getSpy.mockImplementation((path: string) => {
    if (path === DETAIL_PATH) {
      return Promise.resolve({ data: detail({ permissions: { canWrite, canConfigure: false } }) });
    }
    if (path === '/api/v1/admin/projects/roles') return Promise.resolve({ data: ROLES });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function renderPage(permissions?: readonly string[]): Promise<void> {
  renderProjects(<ProjectDetailPage />, {
    path: `/projects/${PROJECT_ID}`,
    pattern: '/projects/:id',
    routes: <Route path="/projects" element={<p>projects list screen</p>} />,
    ...(permissions ? { permissions } : {}),
  });
  await screen.findByRole('heading', { name: /Warehouse fit-out/ });
}

describe('ProjectDetail — deleting the Project', () => {
  it('deletes after a confirmation and returns to the list', async () => {
    deleteSpy.mockResolvedValue(undefined);
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.delete') }));
    const dialog = await screen.findByRole('dialog', { name: en('delete.title') });
    expect(within(dialog).getByText(en('delete.body', { number: 'PRJ-000001' }))).toBeTruthy();
    expect(deleteSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: en('delete.confirm') }));
    expect(deleteSpy).toHaveBeenCalledWith(DETAIL_PATH);
    expect(await screen.findByText('projects list screen')).toBeTruthy();
  });

  it("shows a refusal for linked records in the server's words and deletes nothing", async () => {
    deleteSpy.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'PROJECT_HAS_LINKS',
          message: 'This project has linked records. Unlink them before deleting the project.',
        },
      }),
    );
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: en('detail.delete') }));
    const dialog = await screen.findByRole('dialog', { name: en('delete.title') });
    await userEvent.click(within(dialog).getByRole('button', { name: en('delete.confirm') }));
    expect(
      await within(dialog).findByText('This project has linked records. Unlink them before deleting the project.'),
    ).toBeTruthy();
    expect(screen.queryByText('projects list screen')).toBeNull();
  });

  it('is not offered to somebody who may not write the Project', async () => {
    canWrite = false;
    await renderPage(['projects:read']);
    expect(screen.queryByRole('button', { name: en('detail.delete') })).toBeNull();
  });
});
