import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';

/**
 * Feature 155, owner ruling R1 — a complaint may name a line that was not
 * returnable at purchase. The case view marks such a line ("Not returnable at
 * purchase") in both the items table and the settlement table, and the
 * settlement prefill starts from the stored approved amount — 0 for that line —
 * rather than from the amount paid, so nothing is refunded for it unless the
 * operator sets an amount.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

// The screen is `@endora-commerce/mod-returns`' since feature 091's batch 8, so it
// takes `apiClient` from the kit rather than from the admin's re-export shim.
// The shim forwards the kit's own binding, so mocking it would replace a module
// this screen never imports — reference equality across that seam is what
// `admin/test/kit/admin-kit-shims.test.ts` asserts, and it is what makes the
// distinction matter here.
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ReturnDetail } = await import(
  '../../../../packages/modules/returns/src/admin/pages/ReturnDetail'
);

const CASE = {
  id: 'r1',
  rmaNumber: 'RMA-1',
  kind: 'complaint',
  orderId: '00000000-0000-4000-8000-000000000001',
  statusCode: 'received',
  statusLabel: 'Received',
  totalRefundAmount: 0,
  currency: 'PLN',
  submittedAt: '2026-08-01T10:00:00Z',
  salesChannelId: '00000000-0000-4000-8000-000000000001',
  customerAccountId: '00000000-0000-4000-8000-000000000002',
  organizationId: '00000000-0000-4000-8000-000000000003',
  returnDeliveryMethodId: null,
  appliedReturnCost: 0,
  returnCostBearer: 'customer',
  freeReturnEligible: false,
  resolutionType: null,
  rejectionReason: null,
  items: [
    {
      id: 'itR',
      orderItemId: '00000000-0000-4000-8000-000000000004',
      productId: '00000000-0000-4000-8000-000000000005',
      productName: 'Returnable widget',
      quantity: 1,
      reasonId: '00000000-0000-4000-8000-000000000006',
      description: null,
      defaultRefundAmount: 50,
      approvedRefundAmount: 50,
      returnableAtPurchase: true,
    },
    {
      id: 'itN',
      orderItemId: '00000000-0000-4000-8000-000000000007',
      productId: '00000000-0000-4000-8000-000000000008',
      productName: 'Final-sale widget',
      quantity: 1,
      reasonId: '00000000-0000-4000-8000-000000000006',
      description: null,
      defaultRefundAmount: 30,
      approvedRefundAmount: 0,
      returnableAtPurchase: false,
    },
  ],
  comments: [],
};

const PREFILL = {
  currency: 'PLN',
  resolutionOptions: ['refund', 'credit', 'replacement', 'repair'],
  items: [
    { returnCaseItemId: 'itR', productName: 'Returnable widget', quantity: 1, defaultRefundAmount: 50, approvedRefundAmount: 50 },
    { returnCaseItemId: 'itN', productName: 'Final-sale widget', quantity: 1, defaultRefundAmount: 30, approvedRefundAmount: 0 },
  ],
};

const BUNDLE = passthroughBundle('core', [
  'returns.detail.settlement.title',
  'returns.detail.settlement.createCorrectiveInvoice',
  'returns.detail.settlement.settle',
  'returns.detail.notReturnableAtPurchase',
]);

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/r1') return Promise.resolve({ data: CASE });
    if (path === '/api/v1/admin/returns/statuses') {
      return Promise.resolve({ data: { statuses: [], transitions: [] } });
    }
    if (path === '/api/v1/admin/returns/r1/settlement') return Promise.resolve({ data: PREFILL });
    return Promise.resolve({ data: [] });
  });
});

function renderDetail(): void {
  renderWithI18n(
    <MemoryRouter initialEntries={['/returns/r1']}>
      <Routes>
        <Route path="/returns/:id" element={<ReturnDetail />} />
      </Routes>
    </MemoryRouter>,
    BUNDLE,
  );
}

describe('ReturnDetail — a complaint line not returnable at purchase (R1)', () => {
  it('marks the line in the items and settlement tables, and only that line', async () => {
    renderDetail();
    await waitFor(() =>
      expect(screen.getByText('returns.detail.settlement.settle')).toBeInTheDocument(),
    );
    const markers = screen.getAllByText('returns.detail.notReturnableAtPurchase');
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      expect(marker.closest('tr')).toHaveTextContent('Final-sale widget');
    }
  });

  it('prefills the settlement from the approved amount: 0 for that line, the amount paid for the other', async () => {
    postSpy.mockResolvedValue({ data: { totalRefundAmount: 50 } });
    renderDetail();
    await waitFor(() =>
      expect(screen.getByText('returns.detail.settlement.settle')).toBeInTheDocument(),
    );
    await userEvent.click(screen.getByText('returns.detail.settlement.settle'));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(
        '/api/v1/admin/returns/r1/settlement',
        expect.objectContaining({
          lines: [
            { returnCaseItemId: 'itR', approvedRefundAmount: 50 },
            { returnCaseItemId: 'itN', approvedRefundAmount: 0 },
          ],
        }),
      ),
    );
  });
});
