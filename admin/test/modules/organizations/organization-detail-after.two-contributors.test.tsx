import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import type { AdminComponentFactory, AdminZoneContribution } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `<AdminZone>`'s per-contributor presence gate in its **two-contributor** form, over
 * real declarations (feature 134, T114; `contracts/extraction-procedure.md` W2.3,
 * `research.md` D13 §4).
 *
 * ## Why this file exists
 *
 * Two real declarations in one zone, one switched off and the other still rendered, is
 * a member of the mechanism of its own: a gate that withdrew the whole zone, or the
 * wrong contributor, passes every single-contributor test. Its last driver was the
 * `pim_pimcore` half of `admin/test/modules/pim_ergonode/field-protection-zone.test.tsx`,
 * removed by `039e78c67`, and that file's header records the premise that
 * `product.editor.*` is the only multi-contributor zone over real declarations. The
 * premise is false: `organization.detail.after` has several free contributors —
 * `price_lists` (200), `quick_order` (300), `carts` (400) among them — each tested alone
 * by its own zone file and none mounted beside another.
 *
 * W2.3 refuses deleting the last driver of a mechanism member, so this is the surviving
 * driver `pim_ergonode`'s extraction names: `quick_order`, which is switchable, beside a
 * contributor that is not. That was `sales_channels` (100) until feature 154 withdrew its
 * contribution here — `organizations` edits an Organization's channels in a panel of its
 * own — and it is `carts` (400) since: also `nonDeactivatable`, and weighted on the
 * **other** side of `quick_order`, so the weight-order case still has two weights to
 * order.
 *
 * ## What is real and what is instrumented
 *
 * The declarations are each package's own `contributions`, imported from its `./admin`
 * subpath — zone, weight and `requiredPermission` are the ones a bundler reads, and
 * drift in any of them fails here. The one thing wrapped is each `component` factory,
 * in a pass-through that records the call, because *"fetches no chunk"* is a claim about
 * that factory and not about the network. The wrappers are built afresh per render:
 * `<AdminZone>` caches one `lazy()` per factory identity, so a wrapper shared across
 * renders would be loaded once and could not be counted again.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const carts = await import('@endora-commerce/mod-carts/admin');
const { manifest: cartsManifest } = await import('@endora-commerce/mod-carts');
const quickOrder = await import('@endora-commerce/mod-quick-order/admin');
const { manifest: quickOrderManifest } = await import('@endora-commerce/mod-quick-order');

const ZONE = 'organization.detail.after';
const ORG_ID = '00000000-0000-4000-8000-0000000000a1';

/** The text each panel renders first, through a passthrough bundle. */
const CARTS_PANEL = 'policy.title';
const QUICK_ORDER_PANEL = 'defaultPreferences.title';

const BUNDLE = {
  carts: Object.fromEntries(
    [
      'policy.title',
      'policy.description',
      'policy.on',
      'policy.off',
      'policy.hint',
      'policy.saving',
      'policy.turnedOn',
      'policy.turnedOff',
      'policy.loadError',
      'policy.saveError',
    ].map((key) => [key, key]),
  ),
  core: Object.fromEntries(
    [
      'defaultPreferences.title',
      'defaultPreferences.description',
      'defaultPreferences.paymentMethod',
      'defaultPreferences.deliveryMethod',
      'defaultPreferences.billingAddress',
      'defaultPreferences.shippingAddress',
      'defaultPreferences.inherit',
      'defaultPreferences.none',
      'defaultPreferences.save',
      'defaultPreferences.saved',
      'defaultPreferences.saveError',
      'defaultPreferences.loadError',
      'common.state.loading',
    ].map((key) => [key, key]),
  ),
};

function zoneOf(
  moduleId: string,
  zones: readonly AdminZoneContribution[] | undefined,
): AdminZoneContribution {
  const found = (zones ?? []).filter((zone) => zone.zone === ZONE);
  expect(found, `${moduleId} declares ${ZONE} exactly once`).toHaveLength(1);
  return found[0]!;
}

/**
 * The registry, with every factory wrapped in a recorder. `quick_order` is listed
 * **first** on purpose: the order the panels render in must then come from the weights
 * and not from the registry, and not from the module-id tie-break either, which would
 * also put `quick_order` first.
 */
function instrumentedRegistry(): {
  readonly entries: {
    readonly moduleId: string;
    readonly contributions: { readonly zones: readonly AdminZoneContribution[] };
  }[];
  readonly loads: Map<string, number>;
} {
  const loads = new Map<string, number>();
  const wrap = (moduleId: string, zones: readonly AdminZoneContribution[] | undefined) =>
    (zones ?? []).map((zone) => {
      const load: AdminComponentFactory = () => {
        loads.set(moduleId, (loads.get(moduleId) ?? 0) + 1);
        return zone.component();
      };
      return { ...zone, component: load };
    });
  return {
    entries: [
      { moduleId: 'quick_order', contributions: { zones: wrap('quick_order', quickOrder.contributions.zones) } },
      { moduleId: 'carts', contributions: { zones: wrap('carts', carts.contributions.zones) } },
    ],
    loads,
  };
}

function renderZone(options: {
  readonly permissions: readonly string[];
  readonly present: readonly string[];
}): { readonly container: HTMLElement; readonly loads: Map<string, number>; unmount(): void } {
  const registry = instrumentedRegistry();
  const { container, unmount } = renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/organizations/${ORG_ID}`]}>
        <AdminZone name={ZONE} props={{ organizationId: ORG_ID }} />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...options.permissions] }),
        presence: modulePresence({ present: [...options.present] }),
        contributions: registry.entries,
      },
    ),
    BUNDLE,
  );
  return { container, loads: registry.loads, unmount };
}

const BOTH_PERMISSIONS = ['customers:manage', 'orders:write'] as const;
const BOTH_PRESENT = ['carts', 'quick_order'] as const;

const quickOrderRequests = (): unknown[] =>
  getSpy.mock.calls
    .map((call) => call[0])
    .filter((url) => typeof url === 'string' && url.startsWith('/api/v1/admin/quick-order/'));

async function bothRenderedInWeightOrder(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    expect(container.textContent).toContain(CARTS_PANEL);
    expect(container.textContent).toContain(QUICK_ORDER_PANEL);
  });
  const text = container.textContent ?? '';
  expect(text.indexOf(QUICK_ORDER_PANEL)).toBeLessThan(text.indexOf(CARTS_PANEL));
}

describe('organization.detail.after — two real contributors, one switchable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSpy.mockImplementation(async (url: string) => {
      if (url === `/api/v1/admin/organizations/${ORG_ID}/cart-approval-policy`) {
        return { data: { organizationId: ORG_ID, requiresCartApproval: false, updatedAt: 'x' } };
      }
      if (url.startsWith('/api/v1/admin/quick-order/preferences')) return { data: null };
      if (url.includes('/addresses')) return { data: [] };
      if (url.startsWith('/api/v1/admin/payment-methods')) return { data: [] };
      if (url.startsWith('/api/v1/admin/delivery-methods')) return { data: [] };
      throw new Error(`unexpected url ${url}`);
    });
  });

  it('has the population this file depends on — one locked contributor, one switchable, weights apart', () => {
    // Read from the real manifests and declarations, so a change to either axis or to
    // the order re-opens the question this driver answers instead of passing over it.
    expect(cartsManifest.activation).toEqual(expect.objectContaining({ nonDeactivatable: true }));
    expect(quickOrderManifest.activation).toEqual(
      expect.objectContaining({ settingCode: 'quick_order.enabled' }),
    );

    const locked = zoneOf('carts', carts.contributions.zones);
    const quick = zoneOf('quick_order', quickOrder.contributions.zones);
    expect(locked.requiredPermission).toBe('customers:manage');
    expect(quick.requiredPermission).toBe('orders:write');
    expect(quick.weight).toBeLessThan(locked.weight);
  });

  it('renders both panels, in weight order, each chunk loaded once', async () => {
    const { container, loads } = renderZone({
      permissions: BOTH_PERMISSIONS,
      present: BOTH_PRESENT,
    });
    await bothRenderedInWeightOrder(container);
    expect(Object.fromEntries(loads)).toEqual({ carts: 1, quick_order: 1 });
  });

  it('withdraws only the quick_order panel while it is switched off, and fetches no chunk of it', async () => {
    const { container, loads } = renderZone({
      permissions: BOTH_PERMISSIONS,
      present: ['carts'],
    });
    await waitFor(() => expect(container.textContent).toContain(CARTS_PANEL));
    expect(container.textContent).not.toContain(QUICK_ORDER_PANEL);
    expect(loads.get('quick_order')).toBeUndefined();
    expect(loads.get('carts')).toBe(1);
    expect(quickOrderRequests()).toEqual([]);
  });

  it('withdraws only the quick_order panel without orders:write, and fetches no chunk of it', async () => {
    const { container, loads } = renderZone({
      permissions: ['customers:manage'],
      present: BOTH_PRESENT,
    });
    await waitFor(() => expect(container.textContent).toContain(CARTS_PANEL));
    expect(container.textContent).not.toContain(QUICK_ORDER_PANEL);
    expect(loads.get('quick_order')).toBeUndefined();
    expect(loads.get('carts')).toBe(1);
    expect(quickOrderRequests()).toEqual([]);
  });

  it('puts the quick_order panel back in its place when the module comes back, with no rebuild', async () => {
    // Same imported declarations, same bundle: only the presence projection changes,
    // which is all an operator's activation flip changes on the client.
    const off = renderZone({ permissions: BOTH_PERMISSIONS, present: ['carts'] });
    await waitFor(() => expect(off.container.textContent).toContain(CARTS_PANEL));
    expect(off.container.textContent).not.toContain(QUICK_ORDER_PANEL);
    off.unmount();

    const back = renderZone({ permissions: BOTH_PERMISSIONS, present: BOTH_PRESENT });
    await bothRenderedInWeightOrder(back.container);
    expect(back.loads.get('quick_order')).toBe(1);
  });
});
