import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { expectNoAxeViolations } from '../helpers/axe';
import { pinnedSection, renderShell, sidebar } from '../helpers/app-shell-preferences';

/**
 * Feature 164, SC-007 — the Pinned section and the palette's pin control are
 * free of WCAG 2.2 AA violations axe can see: the expanded sidebar with three
 * pins, the rail with the Pinned popover open, the open palette with a pinnable
 * result highlighted, and the reorder handles.
 */

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({
    actions: [
      {
        moduleId: 'orders',
        actionId: 'open-orders',
        label: 'Open orders',
        description: 'View orders',
        icon: 'Receipt',
        targetRoute: '/orders',
        keywords: [],
        weight: 1,
      },
    ],
    isLoading: false,
    error: null,
  }),
}));
vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));
vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

const { AppShell } = await import('../../../packages/admin-shell/src/components/AppShell');

const PINS = ['/orders', '/customers', '/quote-requests'];

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(apiClient, 'patch').mockImplementation(async (_path: string, body: unknown) => ({
    data: { sidebarPins: [], sidebarCollapsedGroups: [], sidebarRailMode: false, listPageSizes: {}, ...(body as object) },
  }));
  vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('not stubbed'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Pinned section accessibility (SC-007)', () => {
  it('the expanded sidebar with three pins', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: PINS } });
    await expectNoAxeViolations(sidebar());
  });

  it('the rail with the Pinned popover open', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: PINS } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar (⌘B)' })));
    const first = sidebar().querySelector('.b2b-sidebar__nav .b2b-sidebar__rail-row') as HTMLElement;
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: 'Pinned' })));
    await expectNoAxeViolations(sidebar());
  });

  it('the open palette with a pinnable result highlighted', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/customers'] } });
    await act(async () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true }));
    const dialog = await screen.findByRole('dialog');
    const row = [...dialog.querySelectorAll<HTMLElement>('.b2b-palette__item')].find((el) =>
      el.textContent?.includes('Open orders'),
    )!;
    fireEvent.mouseEnter(row);
    await expectNoAxeViolations(dialog);
  });

  it('the expanded sidebar with a pin grabbed for reordering (US4)', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: PINS } });
    const handle = within(pinnedSection()!).getByRole('button', { name: 'Move Customers' });
    handle.focus();
    await act(async () => fireEvent.keyDown(handle, { key: ' ' }));
    expect(handle.getAttribute('aria-pressed')).toBe('true');
    await expectNoAxeViolations(sidebar());
  });

  it('there is a Pinned section to examine', () => {
    renderShell(AppShell, { preferences: { sidebarPins: PINS } });
    if (pinnedSection() === null) throw new Error('no Pinned section rendered');
  });
});
