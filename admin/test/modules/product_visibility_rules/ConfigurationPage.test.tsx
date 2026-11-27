import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * `specs/193-product-visibility-rules/` T071 (US2, FR-020 – FR-026, FR-073, FR-086; TM-4 c) — the
 * configuration screen at `/product-visibility`: visibility categories, the catalogue price book
 * designated per currency, and each admin role's mapping.
 *
 * Strings are asserted as their translation keys (an empty bundle renders `scope.key`), so a
 * hard-coded literal shows up as a missing key. Data the operator typed (category, role and
 * price-book names) is rendered as given.
 */

const MODULE = 'product_visibility_rules';
const k = (key: string): string => `${MODULE}.${key}`;

const SELF_ROLE = '00000000-0000-4000-8000-00000000ad02';
const CAT_DOMESTIC = '00000000-0000-4000-8000-0000000000c1';
const CAT_EXPORT = '00000000-0000-4000-8000-0000000000c2';
const ROLE_PLATFORM = '00000000-0000-4000-8000-0000000000a1';
const ROLE_REP = '00000000-0000-4000-8000-0000000000a2';
const ROLE_MAPPED = '00000000-0000-4000-8000-0000000000a3';
const ROLE_STALE = '00000000-0000-4000-8000-0000000000a4';
const ROLE_CLERK = '00000000-0000-4000-8000-0000000000a5';
const BOOK_B = '00000000-0000-4000-8000-0000000000b1';
const BOOK_B2 = '00000000-0000-4000-8000-0000000000b2';
const CHANNEL_X = '00000000-0000-4000-8000-0000000000e1';
const CHANNEL_Y = '00000000-0000-4000-8000-0000000000e2';

function overview(selfEffect: ProductVisibilityOverviewResponse['roles'][number]['effect'] = 'unmappable_unrestricted'): ProductVisibilityOverviewResponse {
  return {
    currencies: [
      { code: 'PLN', active: true, designation: null, designationStatus: null, servedGeneration: 3, building: false },
      {
        code: 'EUR',
        active: true,
        designation: { priceListId: BOOK_B, salesChannelId: CHANNEL_X },
        designationStatus: { inForce: false, reason: 'outside_schedule', window: null } as never,
        servedGeneration: 2,
        building: true,
      },
    ],
    categories: [
      { id: CAT_DOMESTIC, name: 'domestic', version: 1, conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }], mappedRoleIds: [ROLE_MAPPED] },
      { id: CAT_EXPORT, name: 'export', version: 4, conditions: [{ currencyCode: 'EUR', threshold: 'gte_zero' }], mappedRoleIds: [] },
    ],
    roles: [
      { roleId: SELF_ROLE, code: 'test_role', name: 'Admin', effect: selfEffect, warnings: [] },
      { roleId: ROLE_PLATFORM, code: 'platform_admin', name: 'Platform administrator', effect: 'unmappable_unrestricted', warnings: [] },
      { roleId: ROLE_REP, code: 'rep', name: 'Sales rep', effect: 'sees_no_products', warnings: ['audit_logs_read'] },
      { roleId: ROLE_MAPPED, code: 'rep_domestic', name: 'Domestic rep', effect: 'mapped', categoryId: CAT_DOMESTIC, warnings: [] },
      { roleId: ROLE_STALE, code: 'ops', name: 'Ops', effect: 'mapping_without_effect', categoryId: CAT_EXPORT, warnings: [] },
      { roleId: ROLE_CLERK, code: 'clerk', name: 'Catalog clerk', effect: 'unrestricted', warnings: [] },
    ],
    productRules: [],
    websiteRuleAttachments: [],
  };
}

const state = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; url: string; body?: unknown; headers?: unknown }>,
  overview: null as unknown,
  failOverview: false,
  refuse: null as null | { url: string; status: number; code: string; message: string },
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const refuseIf = (url: string): void => {
    if (state.refuse && url.includes(state.refuse.url)) {
      const { status, code, message } = state.refuse;
      throw new actual.ApiError(status, { error: { code, message } } as never);
    }
  };
  const write = (method: string) => async (url: string, body?: unknown, options?: { headers?: unknown }) => {
    state.calls.push({ method, url, body, headers: options?.headers });
    refuseIf(url);
    return { data: body ?? null };
  };
  return {
    ...actual,
    apiClient: {
      get: async (url: string) => {
        state.calls.push({ method: 'GET', url });
        if (url.endsWith('/overview')) {
          if (state.failOverview) {
            state.failOverview = false;
            throw new actual.ApiError(500, { error: { code: 'INTERNAL', message: 'Down.' } } as never);
          }
          return { data: state.overview };
        }
        if (url.includes('/designations/EUR/options')) {
          return {
            data: {
              items: [
                { priceListId: BOOK_B, name: 'Export EUR', salesChannelIds: [CHANNEL_X] },
                { priceListId: BOOK_B2, name: 'Export EUR 2027', salesChannelIds: [CHANNEL_X, CHANNEL_Y] },
              ],
            },
          };
        }
        if (url.includes('/api/v1/admin/sales-channels')) {
          return {
            items: [
              { id: CHANNEL_X, code: 'x', name: { 'en-US': 'Channel X' }, active: true },
              { id: CHANNEL_Y, code: 'y', name: { 'en-US': 'Channel Y' }, active: true },
            ],
            page: 1,
            pageSize: 200,
            total: 2,
          };
        }
        return { data: null };
      },
      post: write('POST'),
      put: write('PUT'),
      patch: write('PATCH'),
      delete: async (url: string, options?: { headers?: unknown }) => write('DELETE')(url, undefined, options),
    },
  };
});

const { ConfigurationPage } = await import('../../../../packages/modules/product_visibility_rules/src/admin/pages/ConfigurationPage');

const READ = ['product_visibility:read'];
const MANAGE = ['product_visibility:read', 'product_visibility:manage'];

function render(permissions: readonly string[] = MANAGE) {
  return renderWithI18n(
    withSession(
      <MemoryRouter>
        <ConfigurationPage />
      </MemoryRouter>,
      { session: adminSession({ permissions }) },
    ),
  );
}

const roleRow = (name: string): HTMLElement => {
  const cell = screen.getAllByText(name).find((el) => el.closest('[data-role-row]'));
  if (!cell) throw new Error(`no role row for ${name}`);
  return cell.closest('[data-role-row]') as HTMLElement;
};

describe('ConfigurationPage (T071)', () => {
  beforeEach(() => {
    setMobileViewport(false);
    state.calls.length = 0;
    state.overview = overview();
    state.failOverview = false;
    state.refuse = null;
  });
  afterEach(() => cleanup());

  it('warns that switching the module off lifts every product restriction (FR-073, TM-13)', async () => {
    render();
    expect(await screen.findByText(k('config.offWarning'))).toBeInTheDocument();
  });

  it('lists the categories with their conditions, labelled rather than as codes', async () => {
    render();
    const section = await screen.findByRole('region', { name: k('config.categories.title') });
    expect(within(section).getByText('domestic')).toBeInTheDocument();
    expect(within(section).getByText('export')).toBeInTheDocument();
    expect(within(section).getAllByText(k('threshold.gt_zero')).length).toBeGreaterThan(0);
    expect(within(section).queryByText('gt_zero')).toBeNull();
  });

  it('shows each currency\'s book, a not-in-force reason, and a generation being built', async () => {
    render();
    const section = await screen.findByRole('region', { name: k('config.designations.title') });
    const eur = within(section).getByText('EUR').closest('[data-currency-row]') as HTMLElement;
    expect(within(eur).getByText(k('designationReason.outside_schedule'))).toBeInTheDocument();
    expect(within(eur).getByText(k('config.designations.building'))).toBeInTheDocument();
    const pln = within(section).getByText('PLN').closest('[data-currency-row]') as HTMLElement;
    expect(within(pln).getByText(k('config.designations.baseBook'))).toBeInTheDocument();
  });

  it('offers only the designatable books, and only the channels the chosen book is on (US2-8, US2-10)', async () => {
    render();
    const section = await screen.findByRole('region', { name: k('config.designations.title') });
    const eur = within(section).getByText('EUR').closest('[data-currency-row]') as HTMLElement;
    fireEvent.click(within(eur).getByRole('button', { name: k('config.designations.change') }));
    const dialog = await screen.findByRole('dialog');
    const book = await within(dialog).findByLabelText(k('config.designations.field.book'), { exact: false });
    await waitFor(() => expect(within(book).getAllByRole('option').map((o) => o.textContent)).toEqual(
      expect.arrayContaining(['Export EUR', 'Export EUR 2027']),
    ));
    expect(within(book).getAllByRole('option').filter((o) => (o as HTMLOptionElement).value !== '')).toHaveLength(2);
    fireEvent.change(book, { target: { value: BOOK_B } });
    const channel = within(dialog).getByLabelText(k('config.designations.field.channel'), { exact: false });
    await waitFor(() => expect(within(channel).getAllByRole('option').filter((o) => (o as HTMLOptionElement).value !== '')).toHaveLength(1));
    fireEvent.change(channel, { target: { value: CHANNEL_X } });
    fireEvent.click(within(dialog).getByRole('button', { name: k('config.designations.save') }));
    await waitFor(() =>
      expect(state.calls).toContainEqual(
        expect.objectContaining({ method: 'PUT', url: '/api/v1/admin/product-visibility/designations/EUR', body: { priceListId: BOOK_B, salesChannelId: CHANNEL_X } }),
      ),
    );
  });

  it('shows every role\'s effect: cannot be mapped, sees no products, mapped, mapping without effect (FR-024, FR-026)', async () => {
    render();
    await screen.findByRole('region', { name: k('config.roles.title') });
    expect(within(roleRow('Platform administrator')).getByText(k('roleEffect.unmappable_unrestricted'))).toBeInTheDocument();
    expect(within(roleRow('Platform administrator')).queryByRole('combobox')).toBeNull();
    expect(within(roleRow('Sales rep')).getByText(k('roleEffect.sees_no_products'))).toBeInTheDocument();
    expect(within(roleRow('Ops')).getByText(k('roleWarning.mapping_without_effect'))).toBeInTheDocument();
    expect(within(roleRow('Sales rep')).getByText(k('roleWarning.audit_logs_read'))).toBeInTheDocument();
    expect(within(roleRow('Catalog clerk')).getByText(k('roleEffect.unrestricted'))).toBeInTheDocument();
  });

  it('says how many roles see no products until mapped (US2-9)', async () => {
    render();
    expect(await screen.findByText(k('config.roles.unmappedNotice'))).toBeInTheDocument();
  });

  it('offers "unrestricted" and every category as a mapping target, and saves the choice (I-2)', async () => {
    render();
    await screen.findByRole('region', { name: k('config.roles.title') });
    const select = within(roleRow('Sales rep')).getByRole('combobox', { name: k('config.roles.mappingFor') });
    const values = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(expect.arrayContaining(['', 'unrestricted', CAT_DOMESTIC, CAT_EXPORT]));
    fireEvent.change(select, { target: { value: 'unrestricted' } });
    await waitFor(() =>
      expect(state.calls).toContainEqual(
        expect.objectContaining({ method: 'PUT', url: `/api/v1/admin/product-visibility/role-mappings/${ROLE_REP}`, body: { target: { kind: 'unrestricted' } } }),
      ),
    );
    fireEvent.change(within(roleRow('Domestic rep')).getByRole('combobox', { name: k('config.roles.mappingFor') }), { target: { value: '' } });
    await waitFor(() =>
      expect(state.calls).toContainEqual(
        expect.objectContaining({ method: 'PUT', url: `/api/v1/admin/product-visibility/role-mappings/${ROLE_MAPPED}`, body: { target: null } }),
      ),
    );
  });

  it('shows the server\'s sentence when a mapping is refused', async () => {
    state.refuse = { url: '/role-mappings/', status: 409, code: 'ROLE_NOT_MAPPABLE', message: 'This role always sees every product, so it cannot be mapped.' };
    render();
    await screen.findByRole('region', { name: k('config.roles.title') });
    fireEvent.change(within(roleRow('Sales rep')).getByRole('combobox', { name: k('config.roles.mappingFor') }), { target: { value: CAT_EXPORT } });
    expect(await screen.findByText('This role always sees every product, so it cannot be mapped.')).toBeInTheDocument();
    expect(screen.queryByText('ROLE_NOT_MAPPABLE')).toBeNull();
  });

  it('puts a refused mapping back as it was, and reads the configuration again (QA)', async () => {
    state.refuse = { url: '/role-mappings/', status: 409, code: 'ROLE_NOT_MAPPABLE', message: 'This role always sees every product, so it cannot be mapped.' };
    render();
    await screen.findByRole('region', { name: k('config.roles.title') });
    const reads = (): number => state.calls.filter((c) => c.method === 'GET' && c.url.endsWith('/overview')).length;
    expect(reads()).toBe(1);
    const select = within(roleRow('Sales rep')).getByRole('combobox', { name: k('config.roles.mappingFor') }) as HTMLSelectElement;
    expect(select.value).toBe('');
    fireEvent.change(select, { target: { value: CAT_EXPORT } });
    await screen.findByText('This role always sees every product, so it cannot be mapped.');
    await waitFor(() => expect(reads()).toBe(2));
    const after = within(roleRow('Sales rep')).getByRole('combobox', { name: k('config.roles.mappingFor') }) as HTMLSelectElement;
    await waitFor(() => expect(after.value).toBe(''));
    expect(after).not.toBeDisabled();
  });

  it('reads the configuration again after a mapping is saved (QA)', async () => {
    render();
    await screen.findByRole('region', { name: k('config.roles.title') });
    fireEvent.change(within(roleRow('Sales rep')).getByRole('combobox', { name: k('config.roles.mappingFor') }), { target: { value: CAT_DOMESTIC } });
    await waitFor(() => expect(state.calls.filter((c) => c.method === 'GET' && c.url.endsWith('/overview'))).toHaveLength(2));
    expect(await screen.findByText(k('config.roles.saved'))).toBeInTheDocument();
  });

  it('creates a category from its name and conditions, and refuses an empty name in its own words', async () => {
    render();
    const section = await screen.findByRole('region', { name: k('config.categories.title') });
    fireEvent.click(within(section).getByRole('button', { name: k('config.categories.add') }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: k('config.categories.save') }));
    expect(await within(dialog).findByText(k('config.categories.error.nameRequired'))).toBeInTheDocument();
    expect(state.calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(k('config.categories.field.name'), { exact: false }), { target: { value: 'management' } });
    fireEvent.change(within(dialog).getByLabelText(k('config.categories.field.currency')), { target: { value: 'PLN' } });
    fireEvent.change(within(dialog).getByLabelText(k('config.categories.field.threshold')), { target: { value: 'gte_zero' } });
    fireEvent.click(within(dialog).getByRole('button', { name: k('config.categories.save') }));
    await waitFor(() =>
      expect(state.calls).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          url: '/api/v1/admin/product-visibility/categories',
          body: { name: 'management', conditions: [{ currencyCode: 'PLN', threshold: 'gte_zero' }] },
        }),
      ),
    );
  });

  it('sends the category version it read with a delete, and shows a refusal for a category in use', async () => {
    state.refuse = { url: `/categories/${CAT_DOMESTIC}`, status: 409, code: 'VISIBILITY_CATEGORY_IN_USE', message: 'Roles are mapped to this visibility category.' };
    render();
    const section = await screen.findByRole('region', { name: k('config.categories.title') });
    const row = within(section).getByText('domestic').closest('[data-category-row]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: k('config.categories.delete') }));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: k('config.categories.delete') }));
    expect(await screen.findByText('Roles are mapped to this visibility category.')).toBeInTheDocument();
    expect(state.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', headers: { 'If-Match': '"1"' } }));
  });

  it('is read-only for an operator holding only the read permission (US2-4)', async () => {
    render(READ);
    await screen.findByRole('region', { name: k('config.roles.title') });
    expect(screen.getByText(k('config.readOnly.permission'))).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: k('config.categories.add') })).toBeNull();
    expect(screen.queryByRole('button', { name: k('config.designations.change') })).toBeNull();
    expect(within(roleRow('Domestic rep')).getByText('domestic')).toBeInTheDocument();
  });

  it('is read-only for a caller who is not unrestricted, even with the manage permission (TM-4 c)', async () => {
    state.overview = overview('mapped');
    render();
    await screen.findByRole('region', { name: k('config.roles.title') });
    expect(screen.getByText(k('config.readOnly.restricted'))).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: k('config.categories.add') })).toBeNull();
  });

  it('is read-only when the overview does not list the caller\'s own role (TM-4 c, fail closed) (QA)', async () => {
    const o = overview();
    o.roles = o.roles.filter((r) => r.roleId !== SELF_ROLE);
    state.overview = o;
    render();
    await screen.findByRole('region', { name: k('config.roles.title') });
    expect(screen.getByText(k('config.readOnly.restricted'))).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: k('config.designations.change') })).toBeNull();
  });

  it('shows a skeleton while loading, and an error with a retry when the read fails', async () => {
    state.failOverview = true;
    render();
    expect(screen.getByText(k('config.loading')).closest('[role="status"]')).not.toBeNull();
    const retry = await screen.findByRole('button', { name: k('config.retry') });
    fireEvent.click(retry);
    expect(await screen.findByRole('region', { name: k('config.roles.title') })).toBeInTheDocument();
  });
});
