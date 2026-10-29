import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { setMobileViewport } from '../setup';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { withLocalStorage } from '../helpers/with-local-storage';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * *Send feedback*, beside the release in the sidebar (issue #379).
 *
 * The link is there while the `admin_feedback` module is — an operator who does
 * not want feedback to leave the instance switches the module off and the link
 * goes with it. It opens a dialog: the words (required), the sender's address
 * (the signed-in administrator's, changeable) and an optional phone. What is
 * sent is the instance's `POST /api/v1/admin/feedback`; every way it can end is
 * said in the dialog, and a failure always leaves the support address to write
 * to by hand.
 */

const getPlatformInfo = vi.fn<() => Promise<{ version: string | null }>>();
const sendAdminFeedback = vi.fn<(body: unknown) => Promise<void>>();

vi.mock('../../../packages/admin-shell/src/lib/platform-info/api', () => ({
  getPlatformInfo: () => getPlatformInfo(),
}));
vi.mock('../../../packages/admin-shell/src/lib/admin-feedback/api', () => ({
  sendAdminFeedback: (body: unknown) => sendAdminFeedback(body),
}));
vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));
vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));
vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));
vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ enabled: false })),
  listUnseenPromptRequests: vi.fn(async () => ({ data: [] })),
}));

const CORE = JSON.parse(
  readFileSync(resolve(process.cwd(), '../packages/modules/_i18n/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const core = (key: string, params: Record<string, string> = {}): string =>
  Object.entries(params).reduce((text, [name, value]) => text.replace(`{${name}}`, value), CORE[key] ?? key);

const { AppShell } = await import('../../../packages/admin-shell/src/components/AppShell');

function renderShell(present: readonly string[] = ['admin_feedback']): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'], email: 'anna@acme.example' }),
        presence: modulePresence({ present }),
      },
    ),
    { core: CORE },
  );
}

async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: core('appShell.feedback.open') }));
  return screen.findByRole('dialog', { name: core('appShell.feedback.title') });
}

const field = (dialog: HTMLElement, key: string): HTMLElement =>
  within(dialog).getByLabelText(new RegExp(`^${core(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

beforeEach(() => {
  setMobileViewport(false);
  withLocalStorage();
  getPlatformInfo.mockReset();
  getPlatformInfo.mockResolvedValue({ version: '0.108.0' });
  sendAdminFeedback.mockReset();
});

describe('AppShell — Send feedback (#379)', () => {
  it('offers the link beside the release while the module is present, and not when it is off', async () => {
    renderShell();
    expect(await screen.findByRole('button', { name: core('appShell.feedback.open') })).toBeInTheDocument();
  });

  it('offers no link when the admin_feedback module is switched off', async () => {
    renderShell([]);
    await waitFor(() => expect(document.querySelector('.b2b-sidebar__brand-version')).not.toBeNull());
    expect(screen.queryByRole('button', { name: core('appShell.feedback.open') })).toBeNull();
  });

  it('opens on an empty message, the signed-in address and no phone, with the focus in the message', async () => {
    renderShell();
    const dialog = await openDialog();
    expect(field(dialog, 'appShell.feedback.message')).toHaveValue('');
    expect(field(dialog, 'appShell.feedback.message')).toHaveFocus();
    expect(field(dialog, 'appShell.feedback.email')).toHaveValue('anna@acme.example');
    expect(field(dialog, 'appShell.feedback.phone')).toHaveValue('');
  });

  it('opens the dialog outside the sidebar, which neither colours it nor confines it on a phone', async () => {
    // The sidebar sets the light text of its dark panel, and on a phone it is
    // a drawer moved with `transform` — which makes it the box a `fixed`
    // dialog is placed in. A dialog drawn inside it was faint and squeezed
    // into the drawer (#379, seen on the demo instance).
    renderShell();
    const dialog = await openDialog();
    expect(dialog.closest('.b2b-sidebar')).toBeNull();
    expect(dialog.closest('aside')).toBeNull();
  });

  it('refuses an empty message and an address that is not one, saying where, without a request', async () => {
    renderShell();
    const dialog = await openDialog();
    await userEvent.clear(field(dialog, 'appShell.feedback.email'));
    await userEvent.type(field(dialog, 'appShell.feedback.email'), 'anna');
    await userEvent.click(within(dialog).getByRole('button', { name: core('appShell.feedback.send') }));
    expect(within(dialog).getByText(core('appShell.feedback.error.message'))).toBeInTheDocument();
    expect(within(dialog).getByText(core('appShell.feedback.error.email'))).toBeInTheDocument();
    expect(field(dialog, 'appShell.feedback.message')).toHaveAttribute('aria-invalid', 'true');
    expect(field(dialog, 'appShell.feedback.message')).toHaveFocus();
    expect(sendAdminFeedback).not.toHaveBeenCalled();
  });

  it('sends the words, the address, the phone, the Admin UI address and its language, and thanks', async () => {
    sendAdminFeedback.mockResolvedValue(undefined);
    renderShell();
    const dialog = await openDialog();
    await userEvent.type(field(dialog, 'appShell.feedback.message'), 'The order list is slow.');
    await userEvent.type(field(dialog, 'appShell.feedback.phone'), '+48 22 123 45 67');
    await userEvent.click(within(dialog).getByRole('button', { name: core('appShell.feedback.send') }));

    await waitFor(() =>
      expect(sendAdminFeedback).toHaveBeenCalledWith({
        message: 'The order list is slow.',
        email: 'anna@acme.example',
        phone: '+48 22 123 45 67',
        adminUrl: window.location.origin,
        language: 'en',
      }),
    );
    expect(await within(dialog).findByText(core('appShell.feedback.sent'))).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: core('common.action.close') }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    ['sending is off on this instance', new ApiError(503, { error: { code: 'ADMIN_FEEDBACK_NOT_CONFIGURED', message: 'x' } }), 'appShell.feedback.error.notConfigured'],
    ['too many were sent', new ApiError(429, { error: { code: 'RATE_LIMITED', message: 'x' } }), 'appShell.feedback.error.rateLimited'],
    ['the relay could not take it', new ApiError(502, { error: { code: 'ADMIN_FEEDBACK_DELIVERY_FAILED', message: 'x' } }), 'appShell.feedback.error.delivery'],
    ['the network failed', new TypeError('Failed to fetch'), 'appShell.feedback.error.delivery'],
  ])('says so when %s, keeps what was typed, and names the support address', async (_case, failure, key) => {
    sendAdminFeedback.mockRejectedValue(failure);
    renderShell();
    const dialog = await openDialog();
    await userEvent.type(field(dialog, 'appShell.feedback.message'), 'Hello');
    await userEvent.click(within(dialog).getByRole('button', { name: core('appShell.feedback.send') }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(core(key, { email: 'support@endora.software' }));
    expect(alert).toHaveTextContent('support@endora.software');
    expect(field(dialog, 'appShell.feedback.message')).toHaveValue('Hello');
    expect(within(dialog).getByRole('button', { name: core('appShell.feedback.send') })).toBeEnabled();
  });
});
