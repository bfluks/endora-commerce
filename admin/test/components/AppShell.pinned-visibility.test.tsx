import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { AdminModulePresenceResponse, ModulePresence } from '@endora-commerce/contracts';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { setMobileViewport } from '../setup';
import { adminSession, everyDeclaredModule } from '../helpers/render-with-session';
import {
  pinnedSection,
  renderShell,
  sidebar,
  type RenderShellOptions,
} from '../helpers/app-shell-preferences';

/**
 * Feature 164, US2 — a pin never reveals a surface I can no longer reach
 * (FR-006, SC-006; `specs/conventions/module-activation.md` item 5).
 *
 * The full matrix: the pinned entry's permission withdrawn, its module switched
 * off by the operator, and its module unavailable on the platform — each in the
 * expanded sidebar, the rail popover and the mobile drawer. The pin is absent,
 * nothing names it, and restoring access puts it back at its old index. No
 * pin is ever written while it is hidden (T041).
 */

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({
    actions: [
      {
        moduleId: 'orders',
        actionId: 'open-orders',
        label: 'Open orders',
        description: '',
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

const PINS = ['/quote-requests', '/orders', '/customers'];

function row(id: string, state: 'present' | 'operator-off' | 'platform-unavailable'): ModulePresence {
  return {
    id,
    present: state === 'present',
    platformState: state === 'platform-unavailable' ? 'disabled' : 'installed',
    activated: state !== 'operator-off',
    deactivatable: true,
    nonDeactivatableReason: null,
  };
}

function presence(orders: 'present' | 'operator-off' | 'platform-unavailable'): AdminModulePresenceResponse {
  return {
    modules: everyDeclaredModule().map((id) => row(id, id === 'orders' ? orders : 'present')),
    degraded: false,
  };
}

type Case = 'permission withdrawn' | 'operator-off' | 'platform-unavailable';
const CASES: Case[] = ['permission withdrawn', 'operator-off', 'platform-unavailable'];

function hiddenOptions(hidden: Case): RenderShellOptions {
  if (hidden === 'permission withdrawn') {
    return {
      session: adminSession({ permissions: ['customers:read', 'rfqs:handle'] }),
      presence: presence('present'),
    };
  }
  return { presence: presence(hidden) };
}

const restored: RenderShellOptions = {
  session: adminSession({ permissions: ['customers:read', 'rfqs:handle', 'orders:read'] }),
  presence: presence('present'),
};

let patchSpy: ReturnType<typeof vi.spyOn>;

/** Nothing on screen names the hidden pin: no text, no label, no tooltip, no count. */
function expectNothingNamesOrders(): void {
  const pinned = pinnedSection();
  if (pinned !== null) {
    expect(pinned.textContent ?? '').not.toMatch(/\bOrders\b/);
    expect(pinned.textContent ?? '').not.toMatch(/\d/);
  }
  expect(document.body.textContent ?? '').not.toMatch(/\bOrders\b/);
  const named = [...document.querySelectorAll('[aria-label], [title]')].filter((el) =>
    /\bOrders\b/.test(`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`),
  );
  expect(named).toEqual([]);
}

function pinnedNames(container: HTMLElement): string[] {
  return within(container)
    .getAllByRole('link')
    .map((el) => el.textContent ?? '');
}

beforeEach(() => {
  window.localStorage.clear();
  patchSpy = vi.spyOn(apiClient, 'patch').mockImplementation(async () => ({ data: {} }));
  vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('not stubbed'));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setMobileViewport(false);
});

describe.each(CASES)('a pinned entry whose %s', (hidden) => {
  it('is absent from the expanded sidebar, and nothing names it (US2 AS-1, AS-2, SC-006)', () => {
    renderShell(AppShell, { ...hiddenOptions(hidden), preferences: { sidebarPins: PINS } });
    expect(pinnedNames(pinnedSection()!)).toEqual(['Quote requests', 'Customers']);
    expectNothingNamesOrders();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('is absent from the rail popover', async () => {
    renderShell(AppShell, { ...hiddenOptions(hidden), preferences: { sidebarPins: PINS } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar (⌘B)' })));
    const first = sidebar().querySelector('.b2b-sidebar__nav .b2b-sidebar__rail-row') as HTMLElement;
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: 'Pinned' })));
    const popover = first.querySelector('.b2b-sidebar__rail-popover') as HTMLElement;
    expect(pinnedNames(popover)).toEqual(['Quote requests', 'Customers']);
    expectNothingNamesOrders();
  });

  it('is absent from the mobile drawer', async () => {
    setMobileViewport(true);
    renderShell(AppShell, { ...hiddenOptions(hidden), preferences: { sidebarPins: PINS } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open menu' })));
    expect(pinnedNames(pinnedSection()!)).toEqual(['Quote requests', 'Customers']);
    expectNothingNamesOrders();
  });

  it('with every pin hidden there is no Pinned heading and no rail icon (US2 AS-4)', async () => {
    renderShell(AppShell, { ...hiddenOptions(hidden), preferences: { sidebarPins: ['/orders'] } });
    expect(pinnedSection()).toBeNull();
    expect(within(sidebar()).queryByText('Pinned')).toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar (⌘B)' })));
    expect(within(sidebar()).queryByRole('button', { name: 'Pinned' })).toBeNull();
  });

  it('comes back at its previous index once access is restored (US2 AS-3)', () => {
    renderShell(AppShell, { ...hiddenOptions(hidden), preferences: { sidebarPins: PINS } });
    expect(pinnedNames(pinnedSection()!)).toEqual(['Quote requests', 'Customers']);
    cleanup();
    renderShell(AppShell, { ...restored, preferences: { sidebarPins: PINS } });
    expect(pinnedNames(pinnedSection()!)).toEqual(['Quote requests', 'Orders', 'Customers']);
    // Hiding and showing wrote nothing: the stored pins were never touched.
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('gets no pin control in the palette (FR-027)', async () => {
    renderShell(AppShell, { ...hiddenOptions(hidden), preferences: { sidebarPins: PINS } });
    await act(async () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true }));
    const dialog = await screen.findByRole('dialog');
    const rowEl = [...dialog.querySelectorAll<HTMLElement>('.b2b-palette__item')].find((el) =>
      el.textContent?.includes('Open orders'),
    )!;
    expect(within(rowEl).queryByRole('button')).toBeNull();
  });
});

describe('a stored destination no entry contributes (US2 AS-5)', () => {
  it('renders nothing and logs no error', () => {
    const errors = vi.spyOn(console, 'error');
    renderShell(AppShell, { preferences: { sidebarPins: ['/retired-screen'] } });
    expect(pinnedSection()).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});
