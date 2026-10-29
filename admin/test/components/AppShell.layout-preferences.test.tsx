import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { setMobileViewport } from '../setup';
import { pinnedSection, realBundle, renderShell, sidebar } from '../helpers/app-shell-preferences';

/**
 * Feature 164, US3 — folded groups and rail mode are the admin's, kept on the
 * server (FR-010, FR-013, FR-015, FR-016, SC-003; US3 AS-1, AS-2, AS-8).
 *
 * The first render is already folded, railed and pinned — nothing moves once
 * effects settle — and a change is written to the server, never to browser
 * storage. Rail mode has no effect on the mobile tier.
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
const core = realBundle('en').core!;
let patchSpy: ReturnType<typeof vi.spyOn>;
const patchBodies = (): unknown[] =>
  (patchSpy.mock.calls as unknown[][]).filter(([path]) => path === PREFS_URL).map(([, body]) => body);

function groupOf(label: string): HTMLElement {
  const button = within(sidebar()).getByRole('button', { name: label });
  return button.closest('.b2b-sidebar__group') as HTMLElement;
}

const isFolded = (label: string): boolean =>
  groupOf(label).classList.contains('b2b-sidebar__group--collapsed');

/** Structural changes to the sidebar after the first render, while effects settle. */
async function mutationsAfterSettling(): Promise<MutationRecord[]> {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((list) => records.push(...list));
  observer.observe(sidebar(), { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  observer.disconnect();
  return records;
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

describe('the first render already carries the stored layout (FR-016, SC-003)', () => {
  it('folded groups and a folded Pinned section, and nothing moves afterwards', async () => {
    renderShell(AppShell, {
      preferences: { sidebarCollapsedGroups: ['content', 'newsletter', 'pinned'], sidebarPins: ['/orders'] },
    });
    expect(isFolded(core['appShell.section.content']!)).toBe(true);
    expect(isFolded(core['appShell.section.sales']!)).toBe(false);
    expect(pinnedSection()!.classList.contains('b2b-sidebar__group--collapsed')).toBe(true);
    expect(await mutationsAfterSettling()).toEqual([]);
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('rail mode with the Pinned rail icon first, and nothing moves afterwards (US1 AS-6)', async () => {
    renderShell(AppShell, { preferences: { sidebarRailMode: true, sidebarPins: ['/orders'] } });
    expect(sidebar().classList.contains('b2b-sidebar--rail')).toBe(true);
    const first = sidebar().querySelector('.b2b-sidebar__nav .b2b-sidebar__rail-row') as HTMLElement;
    expect(within(first).getByRole('button', { name: core['appShell.pinned.heading']! })).toBeTruthy();
    expect(await mutationsAfterSettling()).toEqual([]);
  });

  it('with nothing stored every group is open and the rail is off (US3 AS-8)', () => {
    renderShell(AppShell);
    expect(sidebar().classList.contains('b2b-sidebar--rail')).toBe(false);
    expect(sidebar().querySelectorAll('.b2b-sidebar__group--collapsed')).toHaveLength(0);
  });
});

describe('a change is written to the server, not to the browser (FR-010)', () => {
  it('folding a group (US3 AS-1)', async () => {
    renderShell(AppShell);
    await act(async () => fireEvent.click(within(sidebar()).getByRole('button', { name: core['appShell.section.sales']! })));
    expect(isFolded(core['appShell.section.sales']!)).toBe(true);
    await waitFor(() => expect(patchBodies()).toEqual([{ sidebarCollapsedGroups: ['sales'] }]));
    expect(window.localStorage.length).toBe(0);
  });

  it('folding the Pinned section, under the key `pinned` (FR-013)', async () => {
    renderShell(AppShell, { preferences: { sidebarPins: ['/orders'] } });
    await act(async () =>
      fireEvent.click(within(pinnedSection()!).getByRole('button', { name: core['appShell.pinned.heading']! })),
    );
    await waitFor(() => expect(patchBodies()).toEqual([{ sidebarCollapsedGroups: ['pinned'] }]));
    expect(window.localStorage.length).toBe(0);
  });

  it('rail mode, by the button and by ⌘B (US3 AS-2)', async () => {
    renderShell(AppShell);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: core['appShell.sidebarToggle.collapse']! })));
    expect(sidebar().classList.contains('b2b-sidebar--rail')).toBe(true);
    await waitFor(() => expect(patchBodies()).toEqual([{ sidebarRailMode: true }]));
    await act(async () => fireEvent.keyDown(window, { key: 'b', ctrlKey: true }));
    expect(sidebar().classList.contains('b2b-sidebar--rail')).toBe(false);
    await waitFor(() => expect(patchBodies().at(-1)).toEqual({ sidebarRailMode: false }));
    expect(window.localStorage.length).toBe(0);
  });

  it('a stored token this release does not know is ignored, and kept in the next write (FR-015)', async () => {
    renderShell(AppShell, { preferences: { sidebarCollapsedGroups: ['retiredGroup'] } });
    expect(sidebar().querySelectorAll('.b2b-sidebar__group--collapsed')).toHaveLength(0);
    await act(async () => fireEvent.click(within(sidebar()).getByRole('button', { name: core['appShell.section.sales']! })));
    await waitFor(() => expect(patchBodies()).toEqual([{ sidebarCollapsedGroups: ['retiredGroup', 'sales'] }]));
  });
});

describe('the mobile tier (FR-013)', () => {
  it('a stored rail mode has no effect, and ⌘B does nothing', async () => {
    setMobileViewport(true);
    renderShell(AppShell, { preferences: { sidebarRailMode: true, sidebarPins: ['/orders'] } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: core['appShell.mobileMenu.open']! })));
    expect(sidebar().classList.contains('b2b-sidebar--rail')).toBe(false);
    expect(sidebar().querySelector('.b2b-sidebar__rail-row')).toBeNull();
    expect(pinnedSection()).not.toBeNull();
    await act(async () => fireEvent.keyDown(window, { key: 'b', ctrlKey: true }));
    expect(patchSpy).not.toHaveBeenCalled();
  });
});
