import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * `specs/193-product-visibility-rules/` T076 (FR-023, US1-6, US1-11; contracts/admin-api.md §2) —
 * the product list says when the operator's role narrows what it shows. The list answer's
 * `visibility` field drives it, and nothing else: absent (an unrestricted caller, or the module
 * off) ⇒ no banner; `no_category` ⇒ the role sees no products and the list says why instead of
 * inviting a first product; a category ⇒ its name, as text. No count of hidden products is ever
 * shown or derived (TM-2).
 *
 * Strings are asserted as their keys (an empty bundle renders `scope.key`).
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { ProductsList } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductsList');

const LIST = '/api/v1/admin/catalog/products?';
const k = (key: string): string => `catalog.${key}`;

function product(n: number): unknown {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    sku: `SKU-${n}`,
    slug: `p-${n}`,
    type: 'simple',
    status: 'active',
    name: `Product ${n}`,
    visibility: 'public',
    attributeValues: {},
    updatedAt: '2026-05-15T10:00:00.000Z',
  };
}

let answer: Record<string, unknown> = {};

function listAnswer(rows: unknown[], visibility?: unknown): Record<string, unknown> {
  return {
    data: rows,
    pagination: { page: 0, pageSize: 25, total: rows.length },
    counts: { all: rows.length, active: rows.length, inactive: 0, archived: 0 },
    stockFilterAvailable: false,
    ...(visibility === undefined ? {} : { visibility }),
  };
}

function renderList(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/catalog/products']}>
        <ProductsList />
      </MemoryRouter>,
      { presence: modulePresence({ present: ['catalog'] }), session: adminSession({ permissions: ['*'] }) },
    ),
  );
}

describe('ProductsList — the product visibility banner (T076)', () => {
  beforeEach(() => {
    getSpy.mockReset().mockImplementation(async (path: string) => (path.startsWith(LIST) ? answer : { data: [] }));
  });
  afterEach(() => cleanup());

  it('shows no banner when the answer carries no visibility (unrestricted, or the module off)', async () => {
    answer = listAnswer([product(1)]);
    renderList();
    expect(await screen.findByText('Product 1')).toBeInTheDocument();
    expect(screen.queryByTestId('product-visibility-banner')).toBeNull();
  });

  it('names the category a restricted role sees, as text', async () => {
    const name = '<b>export</b>';
    answer = listAnswer([product(1)], { restricted: true, categoryName: name });
    renderList();
    const banner = await screen.findByTestId('product-visibility-banner');
    expect(banner).toHaveTextContent(k('productsList.visibility.restricted'));
    expect(banner).toHaveTextContent(name);
    expect(banner.querySelector('b')).toBeNull();
  });

  it('says a role with no category sees no products, instead of inviting a first product (FR-023)', async () => {
    answer = listAnswer([], { restricted: true, reason: 'no_category' });
    renderList();
    const banner = await screen.findByTestId('product-visibility-banner');
    expect(banner).toHaveTextContent(k('productsList.visibility.noCategory'));
    expect(await screen.findByText(k('productsList.visibility.noCategoryEmpty'))).toBeInTheDocument();
    expect(screen.queryByText(k('productsList.empty.noData.title'))).toBeNull();
  });

  it('does not invite a mapped role whose category shows nothing to create the first product', async () => {
    answer = listAnswer([], { restricted: true, categoryName: 'domestic' });
    renderList();
    await screen.findByTestId('product-visibility-banner');
    expect(await screen.findByText(k('productsList.visibility.noneVisibleEmpty'))).toBeInTheDocument();
    expect(screen.queryByText(k('productsList.empty.noData.title'))).toBeNull();
  });

  it('never shows a number of hidden products', async () => {
    answer = listAnswer([product(1)], { restricted: true, categoryName: 'domestic' });
    renderList();
    const banner = await screen.findByTestId('product-visibility-banner');
    expect(banner.textContent ?? '').not.toMatch(/\d/);
  });
});
