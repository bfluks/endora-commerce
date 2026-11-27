import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { setMobileViewport } from '../setup';
import { adminSession } from '../helpers/render-with-session';
import { pinnedSection, realBundle, renderShell, sidebar } from '../helpers/app-shell-preferences';

/**
 * Feature 164, US4 — reorder my pins (FR-005, FR-009; US4 AS-1 – AS-4).
 *
 * Pointer drag, the keyboard grab mode and the touch up/down buttons, through
 * the kit's `useReorderList`; announced; focus kept on the moved row; and
 * slot-preserving, so pins hidden today keep their stored places.
 */

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));
vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));
vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

const { AppShell } = await import('../../../packages/admin-shell/src/components/AppShell');

const PREFS_URL = '/api/v1/admin/me/preferences';
const FOUR = ['/quote-requests', '/customers', '/catalog/categories', '/orders'];
let patchSpy: ReturnType<typeof vi.spyOn>;
const patchBodies = (): unknown[] =>
  (patchSpy.mock.calls as unknown[][]).filter(([path]) => path === PREFS_URL).map(([, body]) => body);

const pinnedNames = (): string[] =>
  within(pinnedSection()!)
    .getAllByRole('link')
    .map((el) => el.textContent ?? '');

function pinnedRows(): HTMLElement[] {
  return [...pinnedSection()!.querySelectorAll<HTMLElement>('.b2b-nav-row')];
}

function status(): string {
  return pinnedSection()!.querySelector('[role="status"]')?.textContent ?? '';
}

beforeEach(() => {
  window.localStorage.clear();
  patchSpy = vi.spyOn(apiClient, 'patch').mockImplementation(async (_path: string, body: unknown) => ({
    data: { sidebarPins: [], sidebarCollapsedGroups: [], sidebarRailMode: false, listPageSizes: {}, ...(body as object) },
  }));
  vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('not stubbed'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setMobileViewport(false);
});

describe('reordering pins — US4', () => {
  it('AS-1: dragging the last of four pins to the top reorders and saves the new order', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: FOUR } });
    const before = pinnedNames();
    const rows = pinnedRows();
    // Three events, three tasks — as a browser dispatches them.
    await act(async () => fireEvent.dragStart(rows[3]!));
    await act(async () => fireEvent.dragOver(rows[0]!));
    await act(async () => fireEvent.drop(rows[0]!));
    expect(pinnedNames()).toEqual([before[3], before[0], before[1], before[2]]);
    await waitFor(() =>
      expect(patchBodies()).toEqual([
        { sidebarPins: ['/orders', '/quote-requests', '/customers', '/catalog/categories'] },
      ]),
    );
  });

  it('AS-2 / FR-005: Space, ArrowUp, Space moves a pin up, keeps focus on it, and announces the position', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/quote-requests', '/orders', '/customers', '/catalog/categories'] } });
    const handle = within(pinnedSection()!).getByRole('button', { name: 'Move Orders' });
    handle.focus();
    await act(async () => fireEvent.keyDown(handle, { key: ' ' }));
    expect(status()).toContain('Orders grabbed, position 2 of 4');
    await act(async () => fireEvent.keyDown(handle, { key: 'ArrowUp' }));
    expect(status()).toBe('Orders, position 1 of 4');
    await act(async () => fireEvent.keyDown(within(pinnedSection()!).getByRole('button', { name: 'Move Orders' }), { key: ' ' }));
    expect(status()).toBe('Orders dropped, position 1 of 4');
    expect(pinnedNames()[0]).toBe('Orders');
    expect(document.activeElement).toBe(within(pinnedSection()!).getByRole('button', { name: 'Move Orders' }));
    await waitFor(() =>
      expect(patchBodies().at(-1)).toEqual({
        sidebarPins: ['/orders', '/quote-requests', '/customers', '/catalog/categories'],
      }),
    );
  });

  it('Escape during a grab cancels and says so; the bounds are announced', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders', '/customers'] } });
    const handle = within(pinnedSection()!).getByRole('button', { name: 'Move Customers' });
    handle.focus();
    await act(async () => fireEvent.keyDown(handle, { key: ' ' }));
    await act(async () => fireEvent.keyDown(handle, { key: 'ArrowUp' }));
    await act(async () =>
      fireEvent.keyDown(within(pinnedSection()!).getByRole('button', { name: 'Move Customers' }), { key: 'Escape' }),
    );
    expect(status()).toBe('Move cancelled. Customers is back at position 2 of 2');
    expect(pinnedNames()).toEqual(['Orders', 'Customers']);
    const first = within(pinnedSection()!).getByRole('button', { name: 'Move Orders' });
    await act(async () => fireEvent.keyDown(first, { key: 'ArrowUp', altKey: true }));
    expect(status()).toBe('Orders is already first');
    const last = within(pinnedSection()!).getByRole('button', { name: 'Move Customers' });
    await act(async () => fireEvent.keyDown(last, { key: 'ArrowDown', altKey: true }));
    expect(status()).toBe('Customers is already last');
  });

  it('the touch up/down buttons in the mobile drawer do the same (WCAG 2.2 SC 2.5.7)', async () => {
    setMobileViewport(true);
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders', '/customers'] } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open menu' })));
    const second = pinnedRows()[1]!;
    const moveUp = realBundle('en').core!['reorder.moveUp']!;
    await act(async () => fireEvent.click(within(second).getByRole('button', { name: moveUp })));
    expect(pinnedNames()).toEqual(['Customers', 'Orders']);
    await waitFor(() => expect(patchBodies().at(-1)).toEqual({ sidebarPins: ['/customers', '/orders'] }));
  });

  it('AS-4 / FR-009: with two of six pins hidden, reordering the visible four keeps the hidden two in their slots', async () => {
    const six = ['/quote-requests', '/hidden-one', '/customers', '/orders', '/hidden-two', '/catalog/categories'];
    renderShell(AppShell, {
      session: adminSession({ permissions: ['*'] }),
      preferences: { sidebarPins: six },
    });
    expect(pinnedRows()).toHaveLength(4);
    const rows = pinnedRows();
    // Three events, three tasks — as a browser dispatches them.
    await act(async () => fireEvent.dragStart(rows[3]!));
    await act(async () => fireEvent.dragOver(rows[0]!));
    await act(async () => fireEvent.drop(rows[0]!));
    await waitFor(() =>
      expect(patchBodies().at(-1)).toEqual({
        sidebarPins: ['/catalog/categories', '/hidden-one', '/quote-requests', '/customers', '/hidden-two', '/orders'],
      }),
    );
  });

  it('the rail popover offers no reorder control', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders', '/customers'], sidebarRailMode: true } });
    const first = sidebar().querySelector('.b2b-sidebar__nav .b2b-sidebar__rail-row') as HTMLElement;
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: 'Pinned' })));
    const popover = first.querySelector('.b2b-sidebar__rail-popover') as HTMLElement;
    expect(within(popover).queryByRole('button', { name: /^Move / })).toBeNull();
    expect(popover.querySelector('[draggable="true"]')).toBeNull();
  });

  it('in Polish the sentences are Polish', async () => {
    renderShell(AppShell, { language: 'pl', preferences: { sidebarPins: ['/orders', '/customers'] } });
    const handle = within(pinnedSection()!).getByRole('button', { name: 'Przenieś: Klienci' });
    handle.focus();
    await act(async () => fireEvent.keyDown(handle, { key: ' ' }));
    expect(status()).toContain('Chwycono: Klienci, pozycja 2 z 2');
  });
});
