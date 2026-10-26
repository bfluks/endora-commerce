import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TranslationProvider } from '../../../../packages/admin-shell/src/i18n/TranslationProvider';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';

/**
 * Feature 163 / T096 (US5, FR-050–FR-052; US6 #4, FR-061) — the bulk dialog's "Status in
 * one channel": a channel, optionally one of its languages, and Active, Inactive or Use
 * inherited. It sends `fields.scopedStatus` and never beside `fields.status` (the route
 * refuses the pair), so the two groups exclude each other. The result names the products
 * skipped because they are not in the channel (`scope_invalid`) or because the
 * completeness check refused them (`completeness_gate`), and those saved with values
 * missing (`warn` mode: `details.code = 'SCOPE_INCOMPLETE'`).
 *
 * Real `en` and `pl` bundles, under `<StrictMode>`.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

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

const { ProductsBulkEditDialog } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductsBulkEditDialog'
);

const B2B = '00000000-0000-4000-8000-00000000c001';
const B2C = '00000000-0000-4000-8000-00000000c002';
const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';
const P3 = '00000000-0000-4000-8000-0000000000a3';

function primeGets(): void {
  getSpy.mockImplementation((path: string) => {
    if (path.includes('attributes/by-flag')) return Promise.resolve({ data: { items: [] } });
    if (path === '/api/v1/admin/sales-channels') {
      return Promise.resolve({
        items: [
          { id: B2B, code: 'b2b', name: { 'en-US': 'B2B shop' } },
          { id: B2C, code: 'b2c', name: { 'en-US': 'B2C shop' } },
        ],
      });
    }
    if (path === '/api/v1/admin/sales-channels/b2c') {
      return Promise.resolve({ id: B2C, code: 'b2c', languages: ['de', 'pl'], defaultLanguage: 'pl' });
    }
    if (path === '/api/v1/admin/sales-channels/b2b') {
      return Promise.resolve({ id: B2B, code: 'b2b', languages: ['en'], defaultLanguage: 'en' });
    }
    return Promise.resolve({ data: [] });
  });
}

function wrap(ui: ReactElement, language: 'en' | 'pl' = 'en'): ReactElement {
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  return (
    <StrictMode>
      <MemoryRouter>
        <TranslationProvider language={language} initialBundle={{ catalog, core: {} }}>
          {ui}
        </TranslationProvider>
      </MemoryRouter>
    </StrictMode>
  );
}

function renderDialog(language: 'en' | 'pl' = 'en'): void {
  render(wrap(<ProductsBulkEditDialog productIds={[P1, P2, P3]} onClose={(): void => undefined} />, language));
}

async function scopedGroup(): Promise<HTMLElement> {
  return screen.findByRole('group', { name: /status in one channel/i });
}

async function chooseScope(user: ReturnType<typeof userEvent.setup>, value: string, language = 'de'): Promise<void> {
  await user.click(screen.getByRole('checkbox', { name: /status in one channel/i }));
  const group = await scopedGroup();
  await user.selectOptions(within(group).getByRole('combobox', { name: /sales channel/i }), B2C);
  const languageSelect = within(group).getByRole('combobox', { name: /language/i });
  await waitFor(() => expect(within(languageSelect).getByRole('option', { name: 'DE' })).toBeTruthy());
  await user.selectOptions(languageSelect, language);
  await user.selectOptions(within(group).getByRole('combobox', { name: /^status$/i }), value);
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  primeGets();
});
afterEach(() => vi.clearAllMocks());

describe('bulk status in one channel (US5)', () => {
  it('sends scopedStatus for the chosen channel and language, nothing else', async () => {
    const user = userEvent.setup();
    postSpy.mockResolvedValue({
      data: {
        bulkOperationId: 'op-1',
        summary: { succeeded: 3, skipped: 0, failed: 0, total: 3 },
        results: [P1, P2, P3].map((productId) => ({ productId, status: 'succeeded', changedFields: ['scopedStatus'] })),
      },
    });
    renderDialog();
    await chooseScope(user, 'inactive');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/products/bulk-update', {
      productIds: [P1, P2, P3],
      fields: { scopedStatus: { channelId: B2C, languageCode: 'de', value: 'inactive' } },
    });
  });

  it('“All languages” is the channel scope (languageCode null); “Use inherited” resets it', async () => {
    const user = userEvent.setup();
    postSpy.mockResolvedValue({ data: { queued: true, bulkOperationId: 'op-2', total: 3 } });
    renderDialog();
    await chooseScope(user, 'inherit', '');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    await waitFor(() =>
      expect(postSpy.mock.calls[0]?.[1]).toEqual({
        productIds: [P1, P2, P3],
        fields: { scopedStatus: { channelId: B2C, languageCode: null, value: 'inherit' } },
      }),
    );
  });

  it('offers Active, Inactive and Use inherited — never draft', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('checkbox', { name: /status in one channel/i }));
    const group = await scopedGroup();
    const values = within(within(group).getByRole('combobox', { name: /^status$/i }))
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(['active', 'inactive', 'inherit']);
  });

  it('cannot be combined with the global status: each disables the other and says why', async () => {
    const user = userEvent.setup();
    renderDialog();
    const scoped = await screen.findByRole('checkbox', { name: /status in one channel/i });
    await user.click(screen.getByRole('checkbox', { name: /^status/i }));
    expect((scoped as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/not together with status/i)).toBeTruthy();
  });

  it('asks for a channel before applying', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole('checkbox', { name: /status in one channel/i }));
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const channel = within(await scopedGroup()).getByRole('combobox', { name: /sales channel/i });
    expect(channel.getAttribute('aria-invalid')).toBe('true');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('reports products skipped as not in the channel or refused by the completeness check, and those saved with values missing', async () => {
    const user = userEvent.setup();
    postSpy.mockResolvedValue({
      data: {
        bulkOperationId: 'op-3',
        summary: { succeeded: 1, skipped: 2, failed: 0, total: 3 },
        results: [
          { productId: P1, status: 'skipped', reason: 'scope_invalid', details: { code: 'SCOPE_INVALID' } },
          { productId: P2, status: 'skipped', reason: 'completeness_gate', details: { code: 'SCOPE_INCOMPLETE' } },
          {
            productId: P3,
            status: 'succeeded',
            changedFields: ['scopedStatus'],
            details: { code: 'SCOPE_INCOMPLETE' },
          },
        ],
      },
    });
    renderDialog();
    await chooseScope(user, 'active');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toMatch(/not in this sales channel/i);
    expect(rows[1]?.textContent).toMatch(/missing/i);
    expect(rows[2]?.textContent).toMatch(/saved with values missing/i);
  });

  it('renders in Polish', async () => {
    renderDialog('pl');
    expect(await screen.findByRole('checkbox', { name: /status w jednym kanale/i })).toBeTruthy();
  });
});
