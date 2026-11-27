import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, apiClient, useAuth, type AdminMe } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../../src/modules.generated.js';

/**
 * `specs/193-product-visibility-rules/` T078, threat model TM-14 — a second administrator who
 * signs in on the same tab sees no list rows cached from the first. A restricted role's list must
 * never show what an unrestricted predecessor loaded.
 *
 * Driven end to end through the real session: the real `AuthProvider`, the real `apiClient` and
 * its 401 trap (`onUnauthorized`), over a stubbed `fetch` that answers as two different
 * administrators. Both ways a session ends are covered — `logout()`, and a `401` from any request
 * (an expired session) — and each is followed by a second administrator's sign-in, whose list is
 * read afresh. It holds today without a fix: the SPA keeps no query cache, and `App` unmounts the
 * signed-in tree (every screen's rows with it) whenever the session is not authenticated.
 */

vi.mock('../../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));
vi.mock('../../../../packages/admin-shell/src/lib/admin-actions/AdminActionsProvider', () => ({
  AdminActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));
vi.mock('../../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));
vi.mock('../../../../packages/admin-shell/src/components/IdleLogout', () => ({
  IdleLogout: () => null,
}));
vi.mock('../../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../../../packages/admin-shell/src/App');

const FIRST = adminSession({ permissions: ['*'], id: '00000000-0000-4000-8000-0000000000a1', email: 'first@test.com' });
const SECOND = adminSession({ permissions: ['catalog:read'], id: '00000000-0000-4000-8000-0000000000a2', email: 'second@test.com' });

/** What the stubbed server answers: who is signed in, and each one's product list. */
const server = {
  user: null as AdminMe | null,
  listReads: [] as string[],
};

function row(name: string, n: number): unknown {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    sku: `SKU-${n}`,
    slug: `p-${n}`,
    type: 'simple',
    status: 'active',
    name,
    visibility: 'public',
    attributeValues: {},
    updatedAt: '2026-05-15T10:00:00.000Z',
  };
}

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function answer(url: string, method: string): Response {
  const path = new URL(url, 'http://localhost').pathname;
  if (path === '/api/v1/auth/admin/logout' && method === 'POST') {
    server.user = null;
    return json(204, null);
  }
  if (server.user === null) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Sign in.' } });
  if (path === '/api/v1/admin/me') return json(200, { data: server.user });
  if (path === '/api/v1/admin/catalog/products') {
    server.listReads.push(server.user.adminUser.email);
    const first = server.user.adminUser.id === FIRST.adminUser.id;
    const rows = first ? [row('Alpha hidden from the second', 1)] : [row('Bravo visible to the second', 2)];
    return json(200, {
      data: rows,
      pagination: { page: 0, pageSize: 25, total: rows.length },
      counts: { all: rows.length, active: rows.length, inactive: 0, archived: 0 },
      stockFilterAvailable: false,
      ...(first ? {} : { visibility: { restricted: true, categoryName: 'domestic' } }),
    });
  }
  return json(200, { data: [] });
}

/** The session's own controls, reached from inside the provider the app reads. */
const session: { logout: () => Promise<void>; refresh: () => Promise<void> } = {
  logout: async () => undefined,
  refresh: async () => undefined,
};

function SessionHandle(): null {
  const auth = useAuth();
  session.logout = auth.logout;
  session.refresh = auth.refresh;
  return null;
}

function renderApp(): void {
  setMobileViewport(false);
  renderWithI18n(
    <AuthProvider>
      <SessionHandle />
      <MemoryRouter initialEntries={['/catalog/products']}>
        <App contributions={MODULE_ADMIN_CONTRIBUTIONS} modulePresence={modulePresence({ present: ['catalog'] })} translations={{}} />
      </MemoryRouter>
    </AuthProvider>,
  );
}

async function signInAs(me: AdminMe): Promise<void> {
  server.user = me;
  await act(async () => {
    await session.refresh();
  });
}

describe('TM-14 — a second administrator on the same tab sees nothing the first loaded', () => {
  beforeEach(() => {
    server.user = FIRST;
    server.listReads = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => answer(String(input instanceof Request ? input.url : input), (init?.method ?? 'GET').toUpperCase())));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('after sign-out', async () => {
    renderApp();
    expect(await screen.findByText('Alpha hidden from the second')).toBeInTheDocument();

    await act(async () => {
      await session.logout();
    });
    expect(screen.queryByText('Alpha hidden from the second')).toBeNull();

    await signInAs(SECOND);
    expect(await screen.findByText('Bravo visible to the second')).toBeInTheDocument();
    expect(screen.queryByText('Alpha hidden from the second')).toBeNull();
    expect(server.listReads).toEqual(['first@test.com', 'second@test.com']);
  });

  it('after a 401 ends the session', async () => {
    renderApp();
    expect(await screen.findByText('Alpha hidden from the second')).toBeInTheDocument();

    server.user = null;
    await act(async () => {
      await apiClient.get('/api/v1/admin/me').catch(() => undefined);
    });
    await waitFor(() => expect(screen.queryByText('Alpha hidden from the second')).toBeNull());

    await signInAs(SECOND);
    expect(await screen.findByText('Bravo visible to the second')).toBeInTheDocument();
    expect(screen.queryByText('Alpha hidden from the second')).toBeNull();
    expect(server.listReads).toEqual(['first@test.com', 'second@test.com']);
  });
});
