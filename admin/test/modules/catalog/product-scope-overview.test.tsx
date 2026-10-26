import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import type { ScopeOverviewResponse } from '@endora-commerce/contracts';
import { TranslationProvider } from '../../../../packages/admin-shell/src/i18n/TranslationProvider';
import catalogEn from '../../../../packages/modules/catalog/i18n/en.json';
import catalogPl from '../../../../packages/modules/catalog/i18n/pl.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 / T093 (US4, FR-015, FR-041) — the product's scope overview: channels ×
 * languages, each cell's effective status and its source, the fields overridden at the
 * cell, the channel row and the language column, what the completeness gate would report
 * at the cell, and every override the resolution ignores (orphans) with a way to remove
 * it. "Reset to inherited" calls the field's owning endpoint with `null` for that one
 * field. Read-only for `catalog:read`; a product in no channel shows the global and
 * language scopes only.
 *
 * Rendered inside `<StrictMode>` with the catalogue's real `en` and `pl` bundles, so a key
 * missing in either file fails here.
 */

const getSpy = vi.fn();
const patchSpy = vi.fn();
const putSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: (...args: unknown[]) => putSpy(...args),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: vi.fn(),
    },
  };
});

const { ProductScopeOverview } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductScopeOverview'
);
const { resetRequestFor, orphanDeleteRequest, pickLocalized } = await import(
  '../../../../packages/modules/catalog/src/admin/lib/scope-overview'
);

type Overview = ScopeOverviewResponse['data'];

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const B2B = '00000000-0000-4000-8000-00000000c001';
const B2C = '00000000-0000-4000-8000-00000000c002';
const OLD = '00000000-0000-4000-8000-00000000c003';
const HOLDER = '00000000-0000-4000-8000-0000000000b9';
const BASE = `/api/v1/admin/catalog/products/${PRODUCT_ID}`;
const OVERVIEW_PATH = `${BASE}/scope-overview`;
const ATTRIBUTES_PATH = '/api/v1/admin/catalog/attributes';

function overviewFixture(): Overview {
  return {
    channels: [
      { channelId: B2B, name: { 'en-US': 'B2B shop', 'pl-PL': 'Sklep B2B' }, isMember: true, languages: ['de', 'en'] },
      { channelId: B2C, name: { 'en-US': 'B2C shop' }, isMember: true, languages: ['pl'] },
      { channelId: OLD, name: { 'en-US': 'Outlet' }, isMember: false, languages: ['pl'] },
    ],
    languages: ['de', 'en', 'pl'],
    cells: [
      {
        channelId: B2B,
        languageCode: 'de',
        available: false,
        effectiveStatus: 'inactive',
        statusSource: 'channel_language',
        overriddenFields: [
          { field: 'status', level: 'channel_language' },
          { field: 'window', level: 'channel' },
          { field: 'name', level: 'channel_language' },
          { field: 'description', level: 'language' },
        ],
        missing: ['name', 'attribute:material'],
      },
      {
        channelId: B2B,
        languageCode: 'en',
        available: true,
        effectiveStatus: 'active',
        statusSource: 'global',
        overriddenFields: [
          { field: 'window', level: 'channel' },
          { field: 'urlKey', level: 'language' },
        ],
        missing: [],
      },
      {
        channelId: B2B,
        languageCode: 'pl',
        available: false,
        effectiveStatus: 'active',
        statusSource: 'global',
        overriddenFields: [],
      },
      {
        channelId: B2C,
        languageCode: 'de',
        available: false,
        effectiveStatus: 'active',
        statusSource: 'global',
        overriddenFields: [],
      },
      {
        channelId: B2C,
        languageCode: 'en',
        available: false,
        effectiveStatus: 'active',
        statusSource: 'global',
        overriddenFields: [],
      },
      {
        channelId: B2C,
        languageCode: 'pl',
        available: true,
        effectiveStatus: 'active',
        statusSource: 'channel',
        overriddenFields: [{ field: 'status', level: 'channel' }],
        missing: [],
      },
      ...(['de', 'en', 'pl'] as const).map((languageCode) => ({
        channelId: OLD,
        languageCode,
        available: false,
        effectiveStatus: 'active' as const,
        statusSource: 'global' as const,
        overriddenFields: [],
      })),
    ],
    channelRows: [
      { channelId: B2B, overriddenFields: ['window'] },
      { channelId: B2C, overriddenFields: ['status'] },
      { channelId: OLD, overriddenFields: [] },
    ],
    languageColumns: [
      { languageCode: 'de', overriddenFields: ['description'] },
      { languageCode: 'en', overriddenFields: ['urlKey'] },
      { languageCode: 'pl', overriddenFields: [] },
    ],
    orphans: [
      { field: 'status', channelId: OLD, languageCode: null, reason: 'not_a_member' },
      { field: 'name', channelId: B2B, languageCode: 'fr', reason: 'language_not_offered' },
      { field: 'attribute:colour', channelId: B2C, languageCode: null, reason: 'attribute_scope_changed' },
      { field: 'urlKey', channelId: OLD, languageCode: 'pl', reason: 'not_a_member' },
    ],
  };
}

function noChannelFixture(): Overview {
  return {
    channels: [],
    languages: ['en', 'pl'],
    cells: [],
    channelRows: [],
    languageColumns: [
      { languageCode: 'en', overriddenFields: [] },
      { languageCode: 'pl', overriddenFields: ['name', 'urlKey'] },
    ],
    orphans: [],
  };
}

function primeGets(overview: Overview = overviewFixture()): void {
  getSpy.mockImplementation((path: string) => {
    if (path === OVERVIEW_PATH) return Promise.resolve({ data: overview });
    if (path === ATTRIBUTES_PATH) {
      return Promise.resolve({
        data: [
          { key: 'material', label: { 'en-US': 'Material', 'pl-PL': 'Materiał' }, labelDefault: 'material' },
          { key: 'colour', label: { 'en-US': 'Colour' }, labelDefault: 'colour' },
        ],
      });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

function wrap(
  ui: ReactElement,
  options: { permissions?: readonly string[]; language?: 'en' | 'pl' } = {},
): ReactElement {
  const language = options.language ?? 'en';
  const catalog = (language === 'en' ? catalogEn : catalogPl) as Record<string, string>;
  return (
    <StrictMode>
      <AppLanguageContext.Provider value={{ language, setLanguage: (): void => undefined }}>
        <TranslationProvider language={language} initialBundle={{ catalog }}>
          {withSession(ui, {
            session: adminSession({ permissions: options.permissions ?? ['catalog:read', 'catalog:write'] }),
          })}
        </TranslationProvider>
      </AppLanguageContext.Provider>
    </StrictMode>
  );
}

async function renderOverview(
  options: { permissions?: readonly string[]; language?: 'en' | 'pl' } = {},
): Promise<HTMLElement> {
  render(wrap(<ProductScopeOverview productId={PRODUCT_ID} />, options));
  return screen.findByRole('table', { name: /scope overview/i });
}

function cellOf(table: HTMLElement, channel: RegExp, language: RegExp): HTMLElement {
  const row = within(table).getByRole('rowheader', { name: channel }).closest('tr') as HTMLElement;
  const headers = within(table).getAllByRole('columnheader');
  const index = headers.findIndex((h) => language.test(h.textContent ?? ''));
  const cells = within(row).getAllByRole('cell');
  // The first column header is the channel column's own.
  return cells[index - 1] as HTMLElement;
}

beforeEach(() => {
  getSpy.mockReset();
  patchSpy.mockReset();
  putSpy.mockReset();
  patchSpy.mockResolvedValue({});
  putSpy.mockResolvedValue({});
  primeGets();
});
afterEach(() => vi.clearAllMocks());

describe('the owning endpoint of a reset (pure)', () => {
  it('a channel field resets through the scopes PATCH with null for that field only', () => {
    expect(resetRequestFor({ field: 'window', level: 'channel', channelId: B2B, languageCode: 'de' })).toEqual({
      kind: 'scopes',
      body: { channels: [{ channelId: B2B, window: null }] },
    });
    expect(resetRequestFor({ field: 'status', level: 'channel_language', channelId: B2B, languageCode: 'de' })).toEqual({
      kind: 'scopes',
      body: { channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'de', status: null }] }] },
    });
  });

  it('a value override resets through the value-overrides PATCH deletes; a language baseline has no reset', () => {
    expect(resetRequestFor({ field: 'name', level: 'channel_language', channelId: B2B, languageCode: 'de' })).toEqual({
      kind: 'valueOverrides',
      body: { upserts: [], deletes: [{ attributeKey: 'name', channelId: B2B, languageCode: 'de' }] },
    });
    expect(
      resetRequestFor({ field: 'attribute:material', level: 'channel', channelId: B2B, languageCode: 'de' }),
    ).toEqual({
      kind: 'valueOverrides',
      body: { upserts: [], deletes: [{ attributeKey: 'material', channelId: B2B, languageCode: null }] },
    });
    expect(resetRequestFor({ field: 'description', level: 'language', channelId: B2B, languageCode: 'de' })).toBeNull();
  });

  it('a URL key resets through the url-keys PUT at its own level', () => {
    expect(resetRequestFor({ field: 'urlKey', level: 'channel_language', channelId: B2B, languageCode: 'de' })).toEqual({
      kind: 'urlKeys',
      body: { channelKeys: [{ channelId: B2B, languageCode: 'de', key: null }] },
    });
    expect(resetRequestFor({ field: 'urlKey', level: 'language', channelId: B2B, languageCode: 'en' })).toEqual({
      kind: 'urlKeys',
      body: { languageKeys: [{ languageCode: 'en', key: null }] },
    });
  });

  it('every orphan kind has a delete (FR-015)', () => {
    for (const orphan of overviewFixture().orphans) expect(orphanDeleteRequest(orphan)).not.toBeNull();
    expect(
      orphanDeleteRequest({ field: 'status', channelId: B2B, languageCode: 'fr', reason: 'language_not_offered' }),
    ).toEqual({
      kind: 'scopes',
      body: { channels: [{ channelId: B2B, languageStatuses: [{ languageCode: 'fr', status: null }] }] },
    });
  });

  it('a multilingual name follows the admin language, then English', () => {
    expect(pickLocalized({ 'en-US': 'Shop', 'pl-PL': 'Sklep' }, 'pl')).toBe('Sklep');
    expect(pickLocalized({ 'en-US': 'Shop' }, 'pl')).toBe('Shop');
  });
});

describe('ProductScopeOverview (US4)', () => {
  it('renders a channel row per channel and a column per language, with each cell’s status and source (US4 #1)', async () => {
    const table = await renderOverview();
    expect(within(table).getByRole('rowheader', { name: /B2B shop/ })).toBeTruthy();
    expect(within(table).getByRole('rowheader', { name: /B2C shop/ })).toBeTruthy();
    for (const code of ['DE', 'EN', 'PL']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(`^${code}`) })).toBeTruthy();
    }
    const deCell = cellOf(table, /B2B shop/, /^DE/);
    expect(deCell.textContent).toMatch(/Inactive/);
    expect(deCell.textContent).toMatch(/set for this channel and language/i);
    expect(deCell.textContent).toMatch(/Name/);
    expect(deCell.textContent).toMatch(/Publication window/);
    const enCell = cellOf(table, /B2B shop/, /^EN/);
    expect(enCell.textContent).toMatch(/Active/);
    expect(enCell.textContent).toMatch(/Live now/);
    expect(enCell.textContent).toMatch(/inherited from global/i);
    // A language the channel does not offer.
    expect(cellOf(table, /B2B shop/, /^PL/).textContent).toMatch(/not offered/i);
    // The non-member channel says so.
    expect(within(table).getByRole('rowheader', { name: /Outlet/ }).textContent).toMatch(/not a member/i);
  });

  it('names the channel row’s and the language column’s overrides', async () => {
    const table = await renderOverview();
    expect(within(table).getByRole('rowheader', { name: /B2C shop/ }).textContent).toMatch(/Status/);
    expect(within(table).getByRole('columnheader', { name: /^DE/ }).textContent).toMatch(/Description/);
    expect(within(table).getByRole('columnheader', { name: /^EN/ }).textContent).toMatch(/URL key/);
  });

  it('lists what a cell is missing by name, with an accessible marker; nothing for [] or absent (FR-041)', async () => {
    const table = await renderOverview();
    const deCell = cellOf(table, /B2B shop/, /^DE/);
    const marker = within(deCell).getByText(/Incomplete/);
    expect(marker.textContent).toMatch(/Name/);
    expect(marker.textContent).toMatch(/Material/);
    expect(within(cellOf(table, /B2B shop/, /^EN/)).queryByText(/Incomplete/)).toBeNull();
    expect(within(cellOf(table, /B2C shop/, /^DE/)).queryByText(/Incomplete/)).toBeNull();
  });

  it('“reset to inherited” removes one field’s override through its owner, then reloads (US4 #2)', async () => {
    const user = userEvent.setup();
    const table = await renderOverview();
    const deCell = cellOf(table, /B2B shop/, /^DE/);
    const loadsBefore = getSpy.mock.calls.filter(([p]) => p === OVERVIEW_PATH).length;
    await user.click(within(deCell).getByRole('button', { name: 'Reset Name in B2B shop · DE to inherited' }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith(`${BASE}/value-overrides`, {
      upserts: [],
      deletes: [{ attributeKey: 'name', channelId: B2B, languageCode: 'de' }],
    });
    await waitFor(() =>
      expect(getSpy.mock.calls.filter(([p]) => p === OVERVIEW_PATH).length).toBeGreaterThan(loadsBefore),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(/reset to inherited/i);
  });

  it('a channel-level field resets once, from the channel row, through the scopes PATCH', async () => {
    const user = userEvent.setup();
    const table = await renderOverview();
    const row = within(table).getByRole('rowheader', { name: /B2B shop/ });
    await user.click(within(row).getByRole('button', { name: 'Reset Publication window in B2B shop to inherited' }));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(`${BASE}/scopes`, { channels: [{ channelId: B2B, window: null }] }),
    );
  });

  it('offers no reset for a value the language itself holds (the product’s own description in German)', async () => {
    const table = await renderOverview();
    const header = within(table).getByRole('columnheader', { name: /^DE/ });
    expect(within(header).queryByRole('button', { name: /Description/ })).toBeNull();
  });

  it('a language URL key reset that would hand the key back to another product names the holder', async () => {
    const user = userEvent.setup();
    putSpy.mockRejectedValueOnce(
      new ApiError(409, {
        error: {
          code: 'URL_KEY_TAKEN',
          message: 'taken',
          details: {
            conflicts: [{ languageCode: 'en', key: 'drill', heldByProductId: HOLDER, heldByProductName: 'Hammer drill' }],
          },
        },
      }),
    );
    const table = await renderOverview();
    const header = within(table).getByRole('columnheader', { name: /^EN/ });
    await user.click(within(header).getByRole('button', { name: 'Reset URL key in EN to inherited' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Hammer drill/);
  });

  it('lists orphaned overrides with a warning and deletes each through its owner (FR-015)', async () => {
    const user = userEvent.setup();
    await renderOverview();
    const region = screen.getByRole('region', { name: /no longer apply/i });
    const items = within(region).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    expect(items[0]?.textContent).toMatch(/Outlet/);
    expect(items[0]?.textContent).toMatch(/not in this channel/i);
    expect(items[1]?.textContent).toMatch(/FR/);
    expect(items[2]?.textContent).toMatch(/Colour/);

    await user.click(within(items[0] as HTMLElement).getByRole('button', { name: /Delete/ }));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith(`${BASE}/scopes`, { channels: [{ channelId: OLD, status: null }] }),
    );
    await user.click(within(items[3] as HTMLElement).getByRole('button', { name: /Delete/ }));
    await waitFor(() =>
      expect(putSpy).toHaveBeenCalledWith(`${BASE}/url-keys`, {
        channelKeys: [{ channelId: OLD, languageCode: 'pl', key: null }],
      }),
    );
  });

  it('is read-only for catalog:read — no reset, no delete (US4 #3)', async () => {
    const table = await renderOverview({ permissions: ['catalog:read'] });
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
    const region = screen.getByRole('region', { name: /no longer apply/i });
    expect(within(region).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(/read-only/i)).toBeTruthy();
  });

  it('a product in no channel says so and shows the global and language scopes only (US4 #4)', async () => {
    primeGets(noChannelFixture());
    render(wrap(<ProductScopeOverview productId={PRODUCT_ID} />));
    expect(await screen.findByText(/in no sales channel/i)).toBeTruthy();
    expect(screen.queryByRole('table', { name: /scope overview/i })).toBeNull();
    const table = screen.getByRole('table', { name: /language/i });
    expect(within(table).queryAllByRole('rowheader')).toHaveLength(2);
    expect(within(table).getByRole('rowheader', { name: /^PL/ }).textContent).toMatch(/Name/);
  });

  it('keyboard: Tab reaches the first reset; every control has an accessible name', async () => {
    const user = userEvent.setup();
    const table = await renderOverview();
    await user.tab();
    expect(document.activeElement?.tagName).toBe('BUTTON');
    for (const button of within(table).getAllByRole('button')) {
      expect(button.getAttribute('aria-label') ?? button.textContent).toMatch(/\S/);
    }
  });

  it('a failed load says so and offers a retry', async () => {
    const user = userEvent.setup();
    let failing = true;
    getSpy.mockImplementation((path: string) => {
      if (path === OVERVIEW_PATH) {
        return failing ? Promise.reject(new Error('boom')) : Promise.resolve({ data: overviewFixture() });
      }
      return Promise.resolve({ data: [] });
    });
    render(wrap(<ProductScopeOverview productId={PRODUCT_ID} />));
    const retry = await screen.findByRole('button', { name: /try again/i });
    failing = false;
    await user.click(retry);
    expect(await screen.findByRole('table', { name: /scope overview/i })).toBeTruthy();
  });

  it('renders in Polish from the pl bundle', async () => {
    render(wrap(<ProductScopeOverview productId={PRODUCT_ID} />, { language: 'pl' }));
    const table = await screen.findByRole('table', { name: /przegląd zakresów/i });
    expect(within(table).getByRole('rowheader', { name: /Sklep B2B/ })).toBeTruthy();
  });
});
