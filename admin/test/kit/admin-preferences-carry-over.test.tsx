import { StrictMode, useState, type ReactElement } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_PREFERENCES_DEFAULTS, type AdminPreferences } from '@endora-commerce/contracts';
import {
  AuthProvider,
  apiClient,
  useAdminPreference,
  useAuth,
  usePageSizePreference,
  type AdminMe,
} from '@endora-commerce/admin-kit/lib';
import { adminSession } from '../helpers/render-with-session';

/**
 * Feature 164 — carrying the browser's page sizes over, once
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-client.md` §4;
 * FR-022, FR-023, SC-005; US3 AS-4 – AS-6; owner ruling (d)).
 *
 * This admin's page sizes are imported insert-if-absent and removed only once
 * the server confirmed; another admin's are neither read nor removed; the two
 * unkeyed sidebar values are removed and never imported, so everyone opens in
 * the default sidebar layout.
 */

const ME = '00000000-0000-4000-8000-0000000164d1';
const OTHER = '00000000-0000-4000-8000-0000000164d2';
const IMPORT_URL = '/api/v1/admin/me/preferences/legacy-import';
const PREFS_URL = '/api/v1/admin/me/preferences';
const ME_URL = '/api/v1/admin/me';
const key = (scope: string, id: string = ME): string => `b2b-admin.page-size.${scope}.${id}`;

let server: AdminPreferences;
let postSpy: ReturnType<typeof vi.spyOn>;
let getSpy: ReturnType<typeof vi.spyOn>;

/** The server's insert-if-absent merge. */
function serverImport(body: unknown): { data: AdminPreferences } {
  const imported = (body as { listPageSizes: Record<string, number> }).listPageSizes;
  server = { ...server, listPageSizes: { ...imported, ...server.listPageSizes } };
  return { data: structuredClone(server) };
}

const importBodies = (): unknown[] =>
  (postSpy.mock.calls as unknown[][]).filter(([path]) => path === IMPORT_URL).map(([, body]) => body);

function session(preferences: AdminPreferences | null | undefined = server): AdminMe {
  const me = adminSession({ permissions: ['*'], id: ME });
  return preferences === undefined ? me : { ...me, preferences };
}

function SizeProbe({ scope }: { scope: string }): ReactElement {
  const { pageSize } = usePageSizePreference(scope);
  return <span data-testid={`size-${scope}`}>{String(pageSize)}</span>;
}

/** Mounts the size probes only when asked, so they read the store after the import. */
function LaterProbes({ scopes }: { scopes: string[] }): ReactElement {
  const [shown, setShown] = useState(false);
  const [rail] = useAdminPreference('sidebarRailMode');
  const [groups] = useAdminPreference('sidebarCollapsedGroups');
  const { status } = useAuth();
  return (
    <>
      <span data-testid="session">{status}</span>
      <span data-testid="layout">{`${String(rail)}|${groups.join(',')}`}</span>
      <button type="button" onClick={(): void => setShown(true)}>
        show
      </button>
      {shown ? scopes.map((scope) => <SizeProbe key={scope} scope={scope} />) : null}
    </>
  );
}

function renderSeeded(me: AdminMe = session(), scopes: string[] = []) {
  return render(
    <StrictMode>
      <AuthProvider initial={me}>
        <LaterProbes scopes={scopes} />
      </AuthProvider>
    </StrictMode>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  server = structuredClone(ADMIN_PREFERENCES_DEFAULTS);
  postSpy = vi.spyOn(apiClient, 'post').mockImplementation(async (path: string, body: unknown) => {
    if (path === IMPORT_URL) return serverImport(body);
    throw new Error(`unexpected POST ${path}`);
  });
  getSpy = vi.spyOn(apiClient, 'get').mockImplementation(async (path: string) => {
    if (path === PREFS_URL) return { data: structuredClone(server) };
    throw new Error(`unexpected GET ${path}`);
  });
  vi.spyOn(apiClient, 'patch').mockImplementation(async () => ({ data: structuredClone(server) }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('this admin’s page sizes (FR-022, SC-005)', () => {
  it('are sent in one import and removed once it succeeds, and the result is what lists open with', async () => {
    window.localStorage.setItem(key('orders'), '50');
    window.localStorage.setItem(key('catalog-products'), '100');
    renderSeeded(session(), ['orders', 'catalog-products']);
    await waitFor(() => expect(window.localStorage.getItem(key('orders'))).toBeNull());
    expect(importBodies()[0]).toEqual({ listPageSizes: { orders: 50, 'catalog-products': 100 } });
    expect(window.localStorage.getItem(key('catalog-products'))).toBeNull();
    await act(async () => screen.getByRole('button', { name: 'show' }).click());
    expect(screen.getByTestId('size-orders').textContent).toBe('50');
    expect(screen.getByTestId('size-catalog-products').textContent).toBe('100');
  });

  it('a value the server already holds wins, and the local key is still removed (US3 AS-5)', async () => {
    server.listPageSizes = { orders: 100 };
    window.localStorage.setItem(key('orders'), '10');
    window.localStorage.setItem(key('returns'), '50');
    renderSeeded(session(), ['orders', 'returns']);
    await waitFor(() => expect(window.localStorage.getItem(key('orders'))).toBeNull());
    expect(server.listPageSizes).toEqual({ orders: 100, returns: 50 });
    await act(async () => screen.getByRole('button', { name: 'show' }).click());
    expect(screen.getByTestId('size-orders').textContent).toBe('100');
    expect(screen.getByTestId('size-returns').textContent).toBe('50');
  });

  it('keys of another admin and of `anon` are neither sent nor removed (US3 AS-6)', async () => {
    window.localStorage.setItem(key('orders'), '50');
    window.localStorage.setItem(key('orders', OTHER), '100');
    window.localStorage.setItem(key('orders', 'anon'), '500');
    renderSeeded();
    await waitFor(() => expect(window.localStorage.getItem(key('orders'))).toBeNull());
    expect(importBodies()).toEqual(importBodies().map(() => ({ listPageSizes: { orders: 50 } })));
    expect(window.localStorage.getItem(key('orders', OTHER))).toBe('100');
    expect(window.localStorage.getItem(key('orders', 'anon'))).toBe('500');
  });

  it('an invalid value or scope is removed and not sent; with nothing valid no request is made', async () => {
    window.localStorage.setItem(key('orders'), 'abc');
    window.localStorage.setItem(key('returns'), '7');
    window.localStorage.setItem(key('Bad_Scope'), '50');
    renderSeeded();
    await waitFor(() => expect(window.localStorage.length).toBe(0));
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('a failed import keeps the keys, and the next mount retries (FR-023)', async () => {
    window.localStorage.setItem(key('orders'), '50');
    postSpy.mockRejectedValue(new Error('offline'));
    const first = renderSeeded();
    await waitFor(() => expect(importBodies().length).toBeGreaterThan(0));
    expect(window.localStorage.getItem(key('orders'))).toBe('50');
    first.unmount();
    postSpy.mockImplementation(async (_path: string, body: unknown) => serverImport(body));
    renderSeeded();
    await waitFor(() => expect(window.localStorage.getItem(key('orders'))).toBeNull());
    expect(server.listPageSizes).toEqual({ orders: 50 });
  });

  it('a double mount and two providers at once converge on one value per list', async () => {
    window.localStorage.setItem(key('orders'), '50');
    render(
      <StrictMode>
        <AuthProvider initial={session()}>
          <LaterProbes scopes={[]} />
        </AuthProvider>
        <AuthProvider initial={session()}>
          <span />
        </AuthProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(window.localStorage.getItem(key('orders'))).toBeNull());
    for (const body of importBodies()) expect(body).toEqual({ listPageSizes: { orders: 50 } });
    expect(server.listPageSizes).toEqual({ orders: 50 });
  });

  it('storage that throws on access is tolerated', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(() => renderSeeded()).not.toThrow();
      expect(postSpy).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});

describe('the two unkeyed sidebar values (owner ruling (d))', () => {
  it('are removed and never sent, and the sidebar opens in its default layout', async () => {
    window.localStorage.setItem('b2b-admin.nav.collapsed-groups', JSON.stringify(['sales', 'content']));
    window.localStorage.setItem('b2b-admin.nav.rail-mode', '1');
    renderSeeded();
    await waitFor(() => expect(window.localStorage.length).toBe(0));
    expect(screen.getByTestId('layout').textContent).toBe('false|');
    expect(postSpy).not.toHaveBeenCalled();
    expect(vi.mocked(apiClient.patch)).not.toHaveBeenCalled();
  });

  it('are removed in unavailable mode too, where the page-size import waits for availability', async () => {
    window.localStorage.setItem('b2b-admin.nav.rail-mode', '1');
    window.localStorage.setItem(key('orders'), '50');
    let loadOk = false;
    getSpy.mockImplementation(async (path: string) => {
      if (path === ME_URL) return { data: session(null) };
      if (path === PREFS_URL) {
        if (!loadOk) throw new Error('still down');
        return { data: structuredClone(server) };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    render(
      <StrictMode>
        <AuthProvider>
          <LaterProbes scopes={[]} />
        </AuthProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(screen.getByTestId('session').textContent).toBe('authenticated'));
    await waitFor(() => expect(window.localStorage.getItem('b2b-admin.nav.rail-mode')).toBeNull());
    expect(window.localStorage.getItem(key('orders'))).toBe('50');
    expect(postSpy).not.toHaveBeenCalled();
    loadOk = true;
    await act(async () => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(window.localStorage.getItem(key('orders'))).toBeNull());
    expect(importBodies()).toContainEqual({ listPageSizes: { orders: 50 } });
  });
});
