import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import type { ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../../src/modules.generated.js';
import AdminRolesPage from '../../../../packages/modules/admin_users/src/admin/pages/AdminRolesPage';

/**
 * `specs/193-product-visibility-rules/` T075 (FR-024, research R-14) — the role list and the role
 * editor show each role's product visibility, through two read-only zones `admin_users` hosts
 * (`admin_users.roles.list.columns`, `admin_users.roles.editor.aside`) and
 * `product_visibility_rules` contributes. The mapping itself is edited only on the module's own
 * screen, which the aside links to. Module off ⇒ nothing (FR-073); without
 * `product_visibility:read` ⇒ nothing.
 *
 * Strings are asserted as their keys (an empty bundle renders `scope.key`).
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return { ...actual, apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } };
});

const k = (key: string): string => `product_visibility_rules.${key}`;

const REP = { id: '00000000-0000-4000-8000-0000000000a2', code: 'rep', name: 'Sales rep', permissions: ['rfqs:handle'], requiresTwoFactor: false, updatedAt: '2026-11-07T00:00:00.000Z' };
const DOMESTIC = { ...REP, id: '00000000-0000-4000-8000-0000000000a3', code: 'rep_domestic', name: 'Domestic rep' };
const OPS = { ...REP, id: '00000000-0000-4000-8000-0000000000a4', code: 'ops', name: 'Ops', permissions: ['*'] };
const CAT = '00000000-0000-4000-8000-0000000000c1';

const OVERVIEW: ProductVisibilityOverviewResponse = {
  currencies: [],
  categories: [{ id: CAT, name: 'domestic', version: 1, conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }], mappedRoleIds: [DOMESTIC.id] }],
  roles: [
    { roleId: REP.id, code: REP.code, name: REP.name, effect: 'sees_no_products', warnings: [] },
    { roleId: DOMESTIC.id, code: DOMESTIC.code, name: DOMESTIC.name, effect: 'mapped', categoryId: CAT, warnings: [] },
    { roleId: OPS.id, code: OPS.code, name: OPS.name, effect: 'unmappable_unrestricted', warnings: [] },
  ],
  productRules: [],
  websiteRuleAttachments: [],
};

let overviewReads = 0;

function mockApi(): void {
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url === '/api/v1/admin/admin-roles') return { data: [REP, DOMESTIC, OPS] } as never;
    if (url === '/api/v1/admin/permissions') return { data: [] } as never;
    if (url === '/api/v1/admin/product-visibility/overview') {
      overviewReads += 1;
      return { data: OVERVIEW } as never;
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

function render(options: { present: boolean; permissions?: readonly string[] }) {
  return renderWithI18n(
    withSession(
      <MemoryRouter>
        <AdminRolesPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: options.permissions ?? ['*'] }),
        presence: modulePresence(options.present ? { present: ['admin_users', 'product_visibility_rules'] } : { present: ['admin_users'], absent: ['product_visibility_rules'] }),
        contributions: MODULE_ADMIN_CONTRIBUTIONS,
      },
    ),
  );
}

const listItem = async (code: string): Promise<HTMLElement> => (await screen.findByText(code)).closest('li') as HTMLElement;

describe('AdminRolesPage — product visibility zones (T075)', () => {
  beforeEach(() => {
    overviewReads = 0;
    mockApi();
  });
  afterEach(() => {
    cleanup();
    vi.mocked(apiClient.get).mockReset();
  });

  it('shows each role\'s visibility in the role list, from one overview read', async () => {
    render({ present: true });
    expect(await within(await listItem('rep')).findByText(k('roleEffect.sees_no_products'))).toBeInTheDocument();
    expect(await within(await listItem('rep_domestic')).findByText('domestic')).toBeInTheDocument();
    expect(await within(await listItem('ops')).findByText(k('roleEffect.unmappable_unrestricted'))).toBeInTheDocument();
    expect(overviewReads).toBe(1);
  });

  it('adds nothing interactive inside a role-list button', async () => {
    render({ present: true });
    const item = await listItem('rep');
    await within(item).findByText(k('roleEffect.sees_no_products'));
    const button = within(item).getByRole('button');
    expect(button.querySelectorAll('a, button, input, select, textarea')).toHaveLength(0);
  });

  it('shows the open role\'s visibility in the editor, linking to the mapping screen', async () => {
    render({ present: true });
    fireEvent.click(await screen.findByText('rep_domestic'));
    const aside = await screen.findByRole('region', { name: k('roleZone.title') });
    expect(within(aside).getByText('domestic')).toBeInTheDocument();
    expect(within(aside).getByRole('link', { name: k('roleZone.manage') })).toHaveAttribute('href', '/product-visibility');
  });

  it('contributes nothing while the module is off', async () => {
    render({ present: false });
    await screen.findByText('rep');
    fireEvent.click(screen.getByText('rep_domestic'));
    await screen.findAllByText('Domestic rep');
    expect(screen.queryByText(k('roleEffect.sees_no_products'))).toBeNull();
    expect(screen.queryByRole('region', { name: k('roleZone.title') })).toBeNull();
    expect(overviewReads).toBe(0);
  });

  it('contributes nothing to an operator without product_visibility:read', async () => {
    render({ present: true, permissions: ['admin_roles:read', 'admin_roles:manage'] });
    await screen.findByText('rep');
    expect(screen.queryByText(k('roleEffect.sees_no_products'))).toBeNull();
    expect(overviewReads).toBe(0);
  });
});
