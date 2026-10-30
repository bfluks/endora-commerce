import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setMobileViewport } from '../../setup';
import { en, renderTasks } from './tasks-fixtures';

/**
 * The general Task settings screen (`specs/165-task-management/` research
 * R-17, `contracts/admin-surfaces.md` §1): the time zone date-only due dates,
 * relative reminders and the digest hour are counted in —
 * `GET` / `PUT /tasks/settings/time-zone`, the configurators' screen.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => putSpy(...args),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { TaskGeneralSettingsPage } = await import(
  '../../../../packages/modules/tasks/src/admin/pages/settings/TaskGeneralSettingsPage'
);
const { contributions } = await import('../../../../packages/modules/tasks/src/admin/index');

const ZONE_PATH = '/api/v1/admin/tasks/settings/time-zone';
const CONFIGURER = ['tasks:read', 'tasks:write', 'tasks:configure'];

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  putSpy.mockReset();
  getSpy.mockImplementation((path: string) =>
    path === ZONE_PATH
      ? Promise.resolve({ data: { timeZone: 'Europe/Warsaw' } })
      : Promise.reject(new Error(`unexpected GET ${path}`)),
  );
  putSpy.mockImplementation((_path: string, body: { timeZone: string }) => Promise.resolve({ data: body }));
});

const zone = (): HTMLElement => screen.getByLabelText(en('settings.timeZone'));

describe('TaskGeneralSettingsPage (US7)', () => {
  it('is the configurators’ screen, at /tasks/settings/general', () => {
    const route = contributions.routes?.find((r) => r.path === '/tasks/settings/general');
    expect(route?.requiredPermission).toBe('tasks:configure');
  });

  it('shows the time zone and saves another', async () => {
    const user = userEvent.setup();
    renderTasks(<TaskGeneralSettingsPage />, { permissions: CONFIGURER });
    await waitFor(() => expect(zone()).toHaveValue('Europe/Warsaw'));
    expect(screen.getByRole('button', { name: en('settings.save') })).toBeDisabled();

    await user.selectOptions(zone(), 'America/New_York');
    await user.click(screen.getByRole('button', { name: en('settings.save') }));

    await waitFor(() => expect(putSpy).toHaveBeenCalledWith(ZONE_PATH, { timeZone: 'America/New_York' }));
    expect(await screen.findByText(en('settings.saved'))).toBeInTheDocument();
  });

  it('shows the server’s refusal', async () => {
    putSpy.mockRejectedValueOnce(
      new ApiError(422, { error: { code: 'VALIDATION_FAILED', message: 'The time zone must be an IANA time zone name.' } }),
    );
    const user = userEvent.setup();
    renderTasks(<TaskGeneralSettingsPage />, { permissions: CONFIGURER });
    await waitFor(() => expect(zone()).toHaveValue('Europe/Warsaw'));
    await user.selectOptions(zone(), 'UTC');
    await user.click(screen.getByRole('button', { name: en('settings.save') }));

    expect(await screen.findByText('The time zone must be an IANA time zone name.')).toBeInTheDocument();
  });

  it('says so when the setting cannot be read', async () => {
    getSpy.mockImplementation(() => Promise.reject(new Error('down')));
    renderTasks(<TaskGeneralSettingsPage />, { permissions: CONFIGURER });
    expect(await screen.findByText(en('settings.error'))).toBeInTheDocument();
  });
});
