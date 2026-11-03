import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { formatMoney } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';
import en from '../../../../packages/modules/orders/i18n/en.json';
import pl from '../../../../packages/modules/orders/i18n/pl.json';

/**
 * Feature 159, T064 — the admin order screen shows the order's line groups
 * read-only (`specs/159-quote-request-item-groups/contracts/ui.md` §2; FR-032,
 * FR-033, FR-063): each group a headed section with its lines and its summary
 * (item count, net, VAT, gross), then *Other items*; nothing on the screen
 * changes the grouping; an order without groups is shown as it always was.
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

const { OrderDetail } = await import('../../../../packages/modules/orders/src/admin/pages/OrderDetail');

const HALL_A = { id: '00000000-0000-4000-8000-00000000a001', name: 'Hall A', position: 0 };

const item = (id: string, name: string, unitPrice: number, quantity: number, groupId: string | null, position: number) => ({
  id,
  productId: `prod-${id}`,
  productSnapshot: { sku: `SKU-${id}`, name, primaryAssetUrl: null },
  variantSnapshot: null,
  quantity,
  unitPrice,
  taxRate: 0.23,
  lineTotal: Math.round(unitPrice * quantity * 1.23 * 100) / 100,
  groupId,
  position,
});

const LINES = [
  item('1', 'Widget', 10, 2, HALL_A.id, 0),
  item('2', 'Gadget', 5, 1, HALL_A.id, 1),
  item('3', 'Sprocket', 100, 1, null, 0),
];

const ORDER = {
  id: 'o1',
  businessId: '1001',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  status: 'new',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  billingAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  deliveryMethod: { code: 'dm', name: { en: 'DM' }, cost: 0 },
  paymentMethod: { code: 'pm', name: { en: 'PM' }, kind: 'bank_transfer' },
  itemGroups: [HALL_A],
  items: LINES,
  subtotal: 125,
  taxTotal: 28.75,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 153.75,
  currency: 'PLN',
  customerNote: null,
  placedAt: '2026-10-20T12:00:00Z',
};

function serveOrder(order: Record<string, unknown>): void {
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: order });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({
        data: { statuses: [{ code: 'new', name: { en: 'New' }, isTerminal: false }], transitions: [] },
      });
    }
    return Promise.resolve({ data: [] });
  });
}

function renderDetail(bundle: Record<string, string> = en): { container: HTMLElement } {
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/orders/o1']}>
        <Routes>
          <Route path="/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['orders', 'payments'] }),
      },
    ),
    { core: {}, orders: bundle },
  );
}

/** toHaveTextContent collapses whitespace, the currency's no-break space included. */
const money = (amount: number): string => formatMoney(amount, 'PLN').replace(/\s/g, ' ');

beforeEach(() => {
  getSpy.mockReset();
});

describe('OrderDetail — line groups, read-only (T064)', () => {
  it('shows each group as a headed section with its lines and summary, then Other items', async () => {
    serveOrder(ORDER);
    const { container } = renderDetail();

    const hallA = await screen.findByRole('rowgroup', { name: 'Hall A' });
    expect(within(hallA).getByRole('columnheader', { name: 'Hall A' })).toBeInTheDocument();
    expect(within(hallA).getByText('Widget')).toBeInTheDocument();
    expect(within(hallA).getByText('Gadget')).toBeInTheDocument();
    // Net 25.00, VAT 5.75, gross 30.75 — the lines' own amounts.
    expect(hallA).toHaveTextContent(`2 items · Net ${money(25)} · VAT ${money(5.75)} · Gross ${money(30.75)}`);

    const other = screen.getByRole('rowgroup', { name: en['lineGroups.otherItems'] });
    expect(within(other).getByText('Sprocket')).toBeInTheDocument();
    expect(other).toHaveTextContent(`1 item · Net ${money(100)} · VAT ${money(23)} · Gross ${money(123)}`);

    // Lines in the display order: the group's, then the others.
    const names = screen.getAllByRole('link').map((link) => link.textContent).filter((text) => ['Widget', 'Gadget', 'Sprocket'].includes(text ?? ''));
    expect(names).toEqual(['Widget', 'Gadget', 'Sprocket']);

    await expectNoAxeViolations(container);
  });

  it('offers no control that changes the grouping (FR-063)', async () => {
    serveOrder(ORDER);
    renderDetail();
    await screen.findByRole('rowgroup', { name: 'Hall A' });
    expect(screen.queryByRole('textbox', { name: en['lineGroups.groupName'] })).toBeNull();
    expect(screen.queryByRole('button', { name: en['lineGroups.addGroup'] })).toBeNull();
    expect(screen.queryByRole('button', { name: /group/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Move/ })).toBeNull();
  });

  it('names Other items in Polish', async () => {
    serveOrder(ORDER);
    renderDetail(pl);
    const other = await screen.findByRole('rowgroup', { name: pl['lineGroups.otherItems'] });
    expect(other).toHaveTextContent('1 pozycja');
  });

  it.each([
    ['an order placed before the feature (no itemGroups)', (({ itemGroups: _omit, ...rest }) => rest)(ORDER)],
    ['an order with no group', { ...ORDER, itemGroups: [], items: LINES.map((line) => ({ ...line, groupId: null })) }],
  ])('shows %s as it always was', async (_label, order) => {
    serveOrder(order);
    renderDetail();
    await screen.findByText('Sprocket');
    expect(screen.queryByRole('rowgroup', { name: en['lineGroups.otherItems'] })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Hall A' })).toBeNull();
    expect(screen.queryByText(/items · Net/)).toBeNull();
  });
});
