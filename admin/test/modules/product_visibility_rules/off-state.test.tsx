import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RenderResult } from '@testing-library/react';
import { setMobileViewport } from '../../setup';
import { passthroughBundle, renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../../src/modules.generated.js';

/**
 * `specs/193-product-visibility-rules/` T078 (FR-073, FR-077; Principle XVII item 5) — the admin
 * surface of `product_visibility_rules` switched off, and on again: no sidebar entry, no screen
 * (deep links answer not-found), and no contribution to the role screens' zones while off; all
 * back when on. The product list banner is driven by a response field the backend omits while
 * the module is off (`ProductList.visibility-banner.test.tsx`, "module off"); the palette is
 * served from the presence-filtered actions endpoint, which drops an off module's actions.
 *
 * Each absence comes after a presence seen in the same file.
 */

let presentModules = new Set<string>();
let permissions = new Set<string>();

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

/** Every screen fetches on mount; a pending answer leaves each in its own loading state. */
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  const pending = (): Promise<never> => new Promise<never>(() => {});
  return {
    ...actual,
    apiClient: {
      get: vi.fn(pending),
      post: vi.fn(pending),
      put: vi.fn(pending),
      patch: vi.fn(pending),
      delete: vi.fn(pending),
    },
  };
});

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../../../packages/admin-shell/src/App');

const entry = MODULE_ADMIN_CONTRIBUTIONS.find((candidate) => candidate.moduleId === 'product_visibility_rules');
const routes = entry?.contributions.routes ?? [];
const zones = entry?.contributions.zones ?? [];

const bundle = {
  ...passthroughBundle('core', ['appShell.brand.text', 'appShell.section.access', 'app.moduleScreenLoading', 'app.notFound']),
  ...passthroughBundle('product_visibility_rules', (entry?.contributions.nav ?? []).map((item) => item.labelKey)),
};

let present = true;

function renderAt(path: string): RenderResult {
  setMobileViewport(false);
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <App
          contributions={MODULE_ADMIN_CONTRIBUTIONS}
          modulePresence={modulePresence(present ? { present: ['product_visibility_rules', 'admin_users'] } : { present: ['admin_users'], absent: ['product_visibility_rules'] })}
          translations={{}}
        />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['product_visibility:read', 'product_visibility:manage'] }) },
    ),
    bundle,
  );
}

const sidebarHrefs = (): (string | null)[] => [...document.querySelectorAll('.b2b-sidebar a')].map((a) => a.getAttribute('href'));
const notFoundIsRendered = (): boolean => screen.queryAllByText(/app\.notFound/).length > 0;

describe('product_visibility_rules admin surface, on and off (T078)', () => {
  afterEach(() => cleanup());

  it('is registered: the configuration screen, the website rules screen, and the two role-screen zones', () => {
    expect(routes.map((route) => route.path)).toEqual(['/product-visibility', '/product-visibility/website-rules']);
    expect(zones.map((zone) => zone.zone)).toEqual(['admin_users.roles.list.columns', 'admin_users.roles.editor.aside']);
  });

  it('contributes its sidebar entry and both screens while on', async () => {
    present = true;
    const shell = renderAt('/');
    expect(sidebarHrefs()).toContain('/product-visibility');
    shell.unmount();
    for (const route of routes) {
      const rendered = renderAt(route.path);
      await waitFor(() => expect(notFoundIsRendered(), route.path).toBe(false));
      rendered.unmount();
    }
  });

  it('contributes no sidebar entry and no screen while off (FR-073, FR-077)', async () => {
    present = false;
    const shell = renderAt('/');
    expect(sidebarHrefs()).not.toContain('/product-visibility');
    shell.unmount();
    for (const route of routes) {
      const deepLink = renderAt(route.path);
      await waitFor(() => expect(notFoundIsRendered(), route.path).toBe(true));
      deepLink.unmount();
    }
  });

  it('restores every surface when switched on again', async () => {
    present = true;
    const shell = renderAt('/');
    expect(sidebarHrefs()).toContain('/product-visibility');
    shell.unmount();
    const screenOn = renderAt('/product-visibility');
    await waitFor(() => expect(notFoundIsRendered()).toBe(false));
    screenOn.unmount();
  });
});
