import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { customFieldCarrySkipReasonSchema } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import ordersEn from '../../../../packages/modules/orders/i18n/en.json';
import ordersPl from '../../../../packages/modules/orders/i18n/pl.json';

/**
 * Feature 158 (T047, US1-4, FR-010a, SC-006) — the system note the platform
 * writes into an Order's comments when a custom-field value could not be
 * carried into it, read in the operator's language
 * (`specs/158-custom-fields-value-carry/contracts/admin-surfaces.md` §2).
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

const ORDER = {
  id: 'o1',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  status: 'new',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  billingAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  deliveryMethod: { code: 'dm', name: { en: 'DM' }, cost: 0 },
  paymentMethod: { code: 'pm', name: { en: 'PM' }, kind: 'bank_transfer' },
  items: [],
  subtotal: 10,
  taxTotal: 0,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 10,
  currency: 'PLN',
  customerNote: null,
  placedAt: '2026-05-22T12:00:00Z',
};

const LONG_KEY = `k${'x'.repeat(70)}`;

const SYSTEM_NOTE = {
  id: 'c-system',
  body: 'Not carried from quote request QR-000042: order_source (target_missing)',
  isCustomerVisible: false,
  notifyCustomer: false,
  authorAdminUserId: null,
  authorCustomerAccountId: null,
  systemNote: {
    kind: 'custom_field_carry_skipped',
    source: { entityType: 'quote_request', recordId: '00000000-0000-4000-8000-0000000000d1', reference: 'QR-000042' },
    skipped: [
      { key: 'order_source', reason: 'target_missing' },
      { key: 'fair', reason: 'value_invalid' },
      { key: LONG_KEY, reason: 'audience_mismatch' },
    ],
  },
  createdAt: '2026-05-22T12:30:00Z',
};

const STAFF_NOTE = {
  id: 'c-staff',
  body: 'called the buyer',
  isCustomerVisible: true,
  notifyCustomer: false,
  authorAdminUserId: 'a1',
  authorCustomerAccountId: null,
  systemNote: null,
  createdAt: '2026-05-22T12:40:00Z',
};

/** The Order definitions: `fair` is known by its label, the other keys are not. */
const ORDER_DEFINITIONS = [
  {
    id: '00000000-0000-4000-8000-0000000000e1',
    entityType: 'order',
    key: 'fair',
    label: { en: 'Trade fair', pl: 'Targi' },
    labelDefault: 'Trade fair',
    valueType: 'text',
    required: false,
    audience: 'internal',
    sortOrder: 0,
    config: {},
    listFilter: false,
    carryTo: [],
    options: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions?entityType=order';

let comments: unknown[] = [];

beforeEach(() => {
  comments = [SYSTEM_NOTE, STAFF_NOTE];
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: ORDER });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({ data: { statuses: [{ code: 'new', name: { en: 'New' }, isTerminal: false }], transitions: [] } });
    }
    if (path === '/api/v1/admin/orders/o1/comments') return Promise.resolve({ data: comments });
    if (path === DEFINITIONS_URL) return Promise.resolve({ data: ORDER_DEFINITIONS });
    return Promise.resolve({ data: [] });
  });
});

const CORE = passthroughBundle('core', [
  'orderDetail.tabs.comments',
  'orderDetail.comments.internal',
  'orderDetail.comments.byStaff',
  'orderDetail.comments.byCustomer',
]).core!;

type Bundle = Record<string, string>;
const text = (bundle: Bundle, key: string, params: Record<string, string> = {}): string =>
  bundle[key]!.replace(/\{(\w+)\}/g, (_m, name: string) => params[name] ?? '');

async function openComments(orders: Bundle, permissions: string[] = ['*']): Promise<HTMLElement[]> {
  renderWithI18n(
    <StrictMode>
      {withSession(
        <MemoryRouter initialEntries={['/orders/o1']}>
          <Routes>
            <Route path="/orders/:id" element={<OrderDetail />} />
          </Routes>
        </MemoryRouter>,
        { session: adminSession({ permissions }), presence: modulePresence({ present: ['orders', 'payments'] }) },
      )}
    </StrictMode>,
    { core: CORE, orders },
  );
  await userEvent.click(await screen.findByText('orderDetail.tabs.comments'));
  await waitFor(() => expect(screen.getAllByTestId('order-comment')).toHaveLength(comments.length));
  return screen.getAllByTestId('order-comment');
}

describe.each([
  ['en', ordersEn as Bundle],
  ['pl', ordersPl as Bundle],
] as const)('OrderDetail — the carry system note (%s)', (_language, orders) => {
  it('names System as its author, marks it internal and says where the values came from', async () => {
    const [note] = await openComments(orders);
    expect(within(note!).getByText(text(orders, 'orderDetail.comments.systemAuthor'))).toBeInTheDocument();
    expect(within(note!).queryByText('orderDetail.comments.byStaff')).toBeNull();
    expect(within(note!).getByText('orderDetail.comments.internal')).toBeInTheDocument();
    expect(
      within(note!).getByText(
        text(orders, 'orderDetail.comments.systemNote.customFieldCarrySkipped.quote_request', { reference: 'QR-000042' }),
      ),
    ).toBeInTheDocument();
    // The English fallback body is not shown beside the readable note.
    expect(within(note!).queryByText(SYSTEM_NOTE.body)).toBeNull();
  });

  it('lists one line per skipped key with its translated reason — the label where known, the key otherwise', async () => {
    const [note] = await openComments(orders);
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(DEFINITIONS_URL));
    const line = (field: string, reason: string): string =>
      text(orders, 'orderDetail.comments.carryLine', {
        field,
        reason: text(orders, `orderDetail.comments.carryReason.${reason}`),
      });
    // The provider's language is `en` here, whichever bundle the sentences come from.
    const label = 'Trade fair';
    expect(await within(note!).findByText(line(label, 'value_invalid'))).toBeInTheDocument();
    const items = within(note!).getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual([
      line('order_source', 'target_missing'),
      line(label, 'value_invalid'),
      line(`${LONG_KEY.slice(0, 64)}…`, 'audience_mismatch'),
    ]);
  });

  it('names the sales opportunity a note came from', async () => {
    comments = [
      { ...SYSTEM_NOTE, systemNote: { ...SYSTEM_NOTE.systemNote, source: { ...SYSTEM_NOTE.systemNote.source, entityType: 'opportunity', reference: 'OPP-000007' } } },
    ];
    const [note] = await openComments(orders);
    expect(
      within(note!).getByText(
        text(orders, 'orderDetail.comments.systemNote.customFieldCarrySkipped.opportunity', { reference: 'OPP-000007' }),
      ),
    ).toBeInTheDocument();
  });

  it('renders a comment without a system note as before', async () => {
    const [, staff] = await openComments(orders);
    expect(within(staff!).getByText('orderDetail.comments.byStaff')).toBeInTheDocument();
    expect(within(staff!).getByText('called the buyer')).toBeInTheDocument();
    expect(within(staff!).queryByText(text(orders, 'orderDetail.comments.systemAuthor'))).toBeNull();
  });
});

describe('OrderDetail — the carry system note, degraded', () => {
  it('names every field by its key without custom_fields:read', async () => {
    const [note] = await openComments(ordersEn as Bundle, ['orders:read', 'orders:write']);
    expect(within(note!).getByText(/^fair — /)).toBeInTheDocument();
    expect(within(note!).queryByText(/Trade fair/)).toBeNull();
  });

  it('names a field by its key when the definitions cannot be read', async () => {
    const answer = getSpy.getMockImplementation()!;
    getSpy.mockImplementation((path: string) =>
      path === DEFINITIONS_URL ? Promise.reject(new Error('offline')) : answer(path),
    );
    const [note] = await openComments(ordersEn as Bundle);
    expect(await within(note!).findByText(/^fair — /)).toBeInTheDocument();
  });

  it('falls back to the stored body for a reason it has no sentence for', async () => {
    comments = [{ ...SYSTEM_NOTE, systemNote: { ...SYSTEM_NOTE.systemNote, skipped: [{ key: 'order_source', reason: 'brand_new' }] } }];
    const [note] = await openComments(ordersEn as Bundle);
    expect(within(note!).getByText(SYSTEM_NOTE.body)).toBeInTheDocument();
    expect(within(note!).queryByText(/brand_new/)).toBeNull();
  });

  it('ships a reason sentence for every reason the contract can answer, in both languages', () => {
    for (const reason of customFieldCarrySkipReasonSchema.options) {
      const key = `orderDetail.comments.carryReason.${reason}`;
      expect((ordersEn as Bundle)[key], `en ${key}`).toBeTruthy();
      expect((ordersPl as Bundle)[key], `pl ${key}`).toBeTruthy();
      expect((ordersPl as Bundle)[key]).not.toBe((ordersEn as Bundle)[key]);
    }
  });
});
