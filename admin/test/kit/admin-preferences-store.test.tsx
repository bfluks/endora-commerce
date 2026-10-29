import { StrictMode, type ReactElement } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_PREFERENCES_DEFAULTS,
  type AdminPreferences,
} from '@endora-commerce/contracts';
import {
  AuthProvider,
  apiClient,
  useAdminPreference,
  useAdminPreferencesStatus,
  useAuth,
  type AdminMe,
} from '@endora-commerce/admin-kit/lib';
import { adminSession } from '../helpers/render-with-session';

/**
 * Feature 164 — the kit's preferences store
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-client.md` §1).
 *
 * Optimistic and synchronous (FR-017); one write in flight per key with only the
 * newest waiting; a failure keeps the value and raises one notice per episode;
 * retry on reconnect, foreground and the next change; refetch on foreground that
 * keeps local work (FR-019); an unavailable mode that saves nothing and replays
 * the admin's own deltas once loading succeeds (FR-018); one store per admin
 * (US1 AS-7). Every render is inside `<StrictMode>`.
 */

const PREFS_URL = '/api/v1/admin/me/preferences';
const ME_URL = '/api/v1/admin/me';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sessionWith(
  preferences: AdminPreferences | null | undefined,
  id = '00000000-0000-4000-8000-0000000164f1',
): AdminMe {
  const me = adminSession({ permissions: ['*'], id });
  return preferences === undefined ? me : { ...me, preferences };
}

/** What a server holding `doc` answers to a PATCH of `body`. */
function applyPatch(doc: AdminPreferences, body: Record<string, unknown>): AdminPreferences {
  const next: AdminPreferences = structuredClone(doc);
  for (const [key, value] of Object.entries(body)) {
    if (key === 'listPageSizes') {
      for (const [list, size] of Object.entries(value as Record<string, number | null>)) {
        if (size === null) delete next.listPageSizes[list];
        else next.listPageSizes[list] = size;
      }
    } else {
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

let server: AdminPreferences;
let patchSpy: ReturnType<typeof vi.spyOn>;
let getSpy: ReturnType<typeof vi.spyOn>;
let postSpy: ReturnType<typeof vi.spyOn>;

function serverPatches(): void {
  patchSpy.mockImplementation(async (_path: string, body: unknown) => {
    server = applyPatch(server, body as Record<string, unknown>);
    return { data: structuredClone(server) };
  });
}

let setPins: (next: string[]) => void = () => undefined;
let setRail: (next: boolean) => void = () => undefined;
let dismiss: () => void = () => undefined;

function Probe(): ReactElement {
  const [pins, pinsSetter] = useAdminPreference('sidebarPins');
  const [rail, railSetter] = useAdminPreference('sidebarRailMode');
  const [groups] = useAdminPreference('sidebarCollapsedGroups');
  const status = useAdminPreferencesStatus();
  const { status: session } = useAuth();
  setPins = pinsSetter;
  setRail = railSetter;
  dismiss = status.dismissNotice;
  return (
    <div>
      <span data-testid="pins">{pins.join(',')}</span>
      <span data-testid="rail">{String(rail)}</span>
      <span data-testid="groups">{groups.join(',')}</span>
      <span data-testid="availability">{status.availability}</span>
      <span data-testid="notice">{String(status.unsavedNotice)}</span>
      <span data-testid="session">{session}</span>
    </div>
  );
}

function renderSeeded(me: AdminMe) {
  return render(
    <StrictMode>
      <AuthProvider initial={me}>
        <Probe />
      </AuthProvider>
    </StrictMode>,
  );
}

const text = (id: string): string => screen.getByTestId(id).textContent ?? '';
const patchBodies = (): unknown[] =>
  (patchSpy.mock.calls as unknown[][])
    .filter(([path]) => path === PREFS_URL)
    .map(([, body]) => body);

function fireVisible(): void {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  server = structuredClone(ADMIN_PREFERENCES_DEFAULTS);
  patchSpy = vi.spyOn(apiClient, 'patch');
  getSpy = vi.spyOn(apiClient, 'get');
  postSpy = vi.spyOn(apiClient, 'post');
  serverPatches();
  getSpy.mockImplementation(async (path: string) => {
    if (path === PREFS_URL) return { data: structuredClone(server) };
    throw new Error(`unexpected GET ${path}`);
  });
  postSpy.mockImplementation(async () => ({ data: structuredClone(server) }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('writes (FR-017)', () => {
  it('applies a change synchronously, before any request settles', () => {
    renderSeeded(sessionWith(ADMIN_PREFERENCES_DEFAULTS));
    patchSpy.mockImplementation(() => new Promise(() => undefined));
    act(() => setPins(['/orders']));
    expect(text('pins')).toBe('/orders');
  });

  it('coalesces rapid changes: at most two PATCHes, in order, the last carrying the newest value', async () => {
    renderSeeded(sessionWith(ADMIN_PREFERENCES_DEFAULTS));
    const first = deferred<void>();
    let calls = 0;
    patchSpy.mockImplementation(async (_path: string, body: unknown) => {
      calls += 1;
      if (calls === 1) await first.promise;
      server = applyPatch(server, body as Record<string, unknown>);
      return { data: structuredClone(server) };
    });
    act(() => {
      setPins(['/a']);
      setPins(['/a', '/b']);
      setPins(['/a', '/b', '/c']);
      setPins(['/a', '/b', '/c', '/d']);
      setPins(['/a', '/b', '/c', '/d', '/e']);
    });
    expect(patchBodies()).toEqual([{ sidebarPins: ['/a'] }]);
    await act(async () => first.resolve());
    await waitFor(() => expect(patchBodies()).toHaveLength(2));
    expect(patchBodies()[1]).toEqual({ sidebarPins: ['/a', '/b', '/c', '/d', '/e'] });
    await waitFor(() => expect(server.sidebarPins).toEqual(['/a', '/b', '/c', '/d', '/e']));
    expect(text('pins')).toBe('/a,/b,/c,/d,/e');
  });

  it('keeps the value on a failed save, raises the notice once per episode, and clears it on success', async () => {
    renderSeeded(sessionWith(ADMIN_PREFERENCES_DEFAULTS));
    patchSpy.mockRejectedValue(new Error('offline'));
    await act(async () => setPins(['/orders']));
    await waitFor(() => expect(text('notice')).toBe('true'));
    expect(text('pins')).toBe('/orders');

    act(() => dismiss());
    expect(text('notice')).toBe('false');
    // A second failure in the same episode does not raise it again.
    await act(async () => setPins(['/orders', '/returns']));
    await waitFor(() => expect(patchBodies()).toHaveLength(2));
    expect(text('notice')).toBe('false');

    // A success ends the episode; the next failure raises it again.
    serverPatches();
    await act(async () => setPins(['/orders', '/returns', '/invoices']));
    await waitFor(() => expect(server.sidebarPins).toEqual(['/orders', '/returns', '/invoices']));
    patchSpy.mockRejectedValue(new Error('offline'));
    await act(async () => setRail(true));
    await waitFor(() => expect(text('notice')).toBe('true'));
  });

  it('retries the latest unsaved value on `online`', async () => {
    renderSeeded(sessionWith(ADMIN_PREFERENCES_DEFAULTS));
    patchSpy.mockRejectedValue(new Error('offline'));
    await act(async () => setPins(['/orders']));
    await waitFor(() => expect(text('notice')).toBe('true'));
    serverPatches();
    await act(async () => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(server.sidebarPins).toEqual(['/orders']));
    await waitFor(() => expect(text('notice')).toBe('false'));
  });

  it('retries the latest unsaved value when the page comes to the foreground', async () => {
    renderSeeded(sessionWith(ADMIN_PREFERENCES_DEFAULTS));
    patchSpy.mockRejectedValue(new Error('offline'));
    await act(async () => setRail(true));
    await waitFor(() => expect(text('notice')).toBe('true'));
    serverPatches();
    await act(async () => fireVisible());
    await waitFor(() => expect(server.sidebarRailMode).toBe(true));
  });

  it('a write adopts from its response only the key it wrote', async () => {
    renderSeeded(sessionWith(ADMIN_PREFERENCES_DEFAULTS));
    // Another device folded a group meanwhile; this write's response carries it.
    server.sidebarCollapsedGroups = ['sales'];
    await act(async () => setPins(['/orders']));
    await waitFor(() => expect(server.sidebarPins).toEqual(['/orders']));
    expect(text('groups')).toBe('');
  });
});

describe('refetch on foreground (FR-019)', () => {
  it('issues one GET, adopts idle keys and keeps a key with a write in flight', async () => {
    renderSeeded(sessionWith(ADMIN_PREFERENCES_DEFAULTS));
    const hold = deferred<void>();
    patchSpy.mockImplementation(async (_path: string, body: unknown) => {
      await hold.promise;
      server = applyPatch(server, body as Record<string, unknown>);
      return { data: structuredClone(server) };
    });
    act(() => setPins(['/mine']));
    server = { ...server, sidebarPins: ['/theirs'], sidebarRailMode: true };
    const refetch = deferred<{ data: AdminPreferences }>();
    getSpy.mockImplementation(() => refetch.promise);
    act(() => {
      fireVisible();
      fireVisible();
    });
    expect((getSpy.mock.calls as unknown[][]).filter(([path]) => path === PREFS_URL)).toHaveLength(
      1,
    );
    await act(async () => refetch.resolve({ data: structuredClone(server) }));
    await waitFor(() => expect(text('rail')).toBe('true'));
    expect(text('pins')).toBe('/mine');
    await act(async () => hold.resolve());
  });
});

describe('unavailable mode (FR-018)', () => {
  /**
   * Mounts a provider that fetches `/admin/me`, and returns once the session is
   * signed in **and the store it created is subscribed to**.
   *
   * The session arrives from a resolved promise, outside `act`, so the render
   * that creates the store is committed by React's scheduler, and the
   * `useSyncExternalStore` subscription to that store is a passive effect that
   * runs in a later scheduler task. `waitFor` returns after a `setTimeout(0)`,
   * which a loaded runner can run first: a change made then reached a store
   * nobody listened to yet, and a synchronous read of the DOM saw the old value
   * (`master` after #478: expected '' to be '/orders'). Re-rendering the same
   * tree inside `act` settles it, because React runs every pending passive
   * effect before it commits the next render.
   */
  async function renderFetched(preferences: AdminPreferences | null | undefined): Promise<void> {
    const me = sessionWith(preferences);
    getSpy.mockImplementation(async (path: string) => {
      if (path === ME_URL) return { data: me };
      if (path === PREFS_URL) return { data: structuredClone(server) };
      throw new Error(`unexpected GET ${path}`);
    });
    const tree = (
      <StrictMode>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </StrictMode>
    );
    const view = render(tree);
    await waitFor(() => expect(text('session')).toBe('authenticated'));
    await act(async () => view.rerender(tree));
  }

  it.each([
    ['`preferences: null`', null],
    ['no `preferences` field', undefined],
  ] as const)('a fetched session with %s is unavailable and sends nothing', async (_label, value) => {
    const loads = deferred<{ data: AdminPreferences }>();
    await renderFetched(value);
    expect(text('availability')).toBe('unavailable');
    getSpy.mockImplementation(async (path: string) => {
      if (path === PREFS_URL) return loads.promise;
      throw new Error(`unexpected GET ${path}`);
    });
    expect(text('pins')).toBe('');
    act(() => setPins(['/orders']));
    expect(text('pins')).toBe('/orders');
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('replays the deltas onto the loaded values once loading succeeds, writing only touched keys', async () => {
    server = {
      ...structuredClone(ADMIN_PREFERENCES_DEFAULTS),
      sidebarPins: ['/stored'],
      sidebarRailMode: true,
      sidebarCollapsedGroups: ['sales'],
    };
    let loadOk = false;
    await renderFetched(null);
    expect(text('availability')).toBe('unavailable');
    getSpy.mockImplementation(async (path: string) => {
      if (path === PREFS_URL) {
        if (!loadOk) throw new Error('still down');
        return { data: structuredClone(server) };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    // Pin two, then take one back: an add then a remove cancels.
    await act(async () => setPins(['/orders']));
    await act(async () => setPins(['/orders', '/returns']));
    await act(async () => setPins(['/returns']));
    expect(patchSpy).not.toHaveBeenCalled();
    loadOk = true;
    await act(async () => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(text('availability')).toBe('available'));
    await waitFor(() => expect(server.sidebarPins).toEqual(['/stored', '/returns']));
    expect(text('pins')).toBe('/stored,/returns');
    // Untouched keys are never written: the stored rail mode and groups stand.
    expect(text('rail')).toBe('true');
    expect(patchBodies()).toEqual([{ sidebarPins: ['/stored', '/returns'] }]);
  });

  it('a seeded session without the field is available with the defaults', async () => {
    renderSeeded(sessionWith(undefined));
    expect(text('availability')).toBe('available');
    expect(text('pins')).toBe('');
    await act(async () => setPins(['/orders']));
    await waitFor(() => expect(patchBodies()).toEqual([{ sidebarPins: ['/orders'] }]));
  });
});

describe('isolation (US1 AS-7)', () => {
  it("another admin's session shows that admin's values and nothing of the first", () => {
    const first = sessionWith(
      { ...ADMIN_PREFERENCES_DEFAULTS, sidebarPins: ['/first'] },
      '00000000-0000-4000-8000-0000000164f1',
    );
    const second = sessionWith(
      { ...ADMIN_PREFERENCES_DEFAULTS, sidebarPins: ['/second'] },
      '00000000-0000-4000-8000-0000000164f2',
    );
    const { unmount } = renderSeeded(first);
    expect(text('pins')).toBe('/first');
    unmount();
    renderSeeded(second);
    expect(text('pins')).toBe('/second');
  });

  it('the hooks throw outside an AuthProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow();
    spy.mockRestore();
  });
});
