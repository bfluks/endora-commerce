import { StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { TranslationProvider } from '../../../../packages/admin-shell/src/i18n/TranslationProvider';
import seoEn from '../../../../packages/modules/seo/i18n/en.json';
import seoPl from '../../../../packages/modules/seo/i18n/pl.json';
import coreEn from '../../../../packages/modules/_i18n/i18n/en.json';
import corePl from '../../../../packages/modules/_i18n/i18n/pl.json';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 / T126 (US8, FR-075, FR-014, FR-015; owner decision SEO-1 A) — the SEO
 * meta editor addresses a product override by sales channel beside language: the
 * channel selector lists the product's **member** channels only, a channel's language
 * list is that channel's, "whole channel" is the channel row; the resolved values show
 * where each field comes from; "use inherited" deletes exactly the selected scope's row.
 * A category takes no channel.
 */

const getSpy = vi.fn();
const putSpy = vi.fn();
const deleteSpy = vi.fn();

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
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { SeoMetaScopeEditor } = await import(
  '../../../../packages/modules/seo/src/admin/pages/SeoMetaScopeEditor'
);

const PRODUCT_ID = '00000000-0000-4000-8000-0000000000a1';
const CATEGORY_ID = '00000000-0000-4000-8000-0000000000e1';
const B2B = '00000000-0000-4000-8000-00000000c001';
const B2C = '00000000-0000-4000-8000-00000000c002';
const META = `/api/v1/admin/seo/meta/product/${PRODUCT_ID}`;
const CONTEXT_PATH = `/api/v1/admin/catalog/products/${PRODUCT_ID}/scope-context`;

const scopeContext = {
  productId: PRODUCT_ID,
  // The read answers member channels only; the outlet the product left is not here.
  channels: [
    { id: B2B, code: 'b2b', name: 'B2B shop', languages: ['de-DE', 'en-US'], isDefault: true },
    { id: B2C, code: 'b2c', name: 'B2C shop', languages: ['pl-PL'], isDefault: false },
  ],
  languagesUnion: ['de-DE', 'en-US', 'pl-PL'],
  primaryAdminLanguage: 'en-US',
  preference: null,
};

function metaAnswer(override: Record<string, string | null> | null) {
  return {
    data: {
      resolved: {
        title: 'B2B German title',
        description: 'Channel description',
        openGraph: { title: 'Derived name', description: 'Derived description', image: null },
        source: 'override',
        locale: 'de-DE',
      },
      sources: {
        title: 'channel_language',
        description: 'channel',
        ogTitle: 'language',
        ogDescription: 'derived',
        ogImageUrl: 'derived',
      },
      override,
    },
  };
}

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
  deleteSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === CONTEXT_PATH) return Promise.resolve({ data: scopeContext });
    if (path.startsWith('/api/v1/admin/seo/meta/')) {
      return Promise.resolve(
        metaAnswer({ title: 'B2B German title', description: null, ogTitle: null, ogDescription: null, ogImageUrl: null }),
      );
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  putSpy.mockResolvedValue({ data: {} });
  deleteSpy.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

function wrap(ui: ReactElement, language: 'en' | 'pl' = 'en'): ReactElement {
  const seo = (language === 'en' ? seoEn : seoPl) as Record<string, string>;
  const core = (language === 'en' ? coreEn : corePl) as Record<string, string>;
  return (
    <StrictMode>
      <AppLanguageContext.Provider value={{ language, setLanguage: (): void => undefined }}>
        <TranslationProvider language={language} initialBundle={{ seo, core }}>
          {withSession(ui, { session: adminSession({ permissions: ['catalog:read', 'catalog:write'] }) })}
        </TranslationProvider>
      </AppLanguageContext.Provider>
    </StrictMode>
  );
}

async function chooseScope(user: ReturnType<typeof userEvent.setup>, channel: string, language: string): Promise<void> {
  await user.selectOptions(await screen.findByRole('combobox', { name: /^sales channel$/i }), channel);
  await user.selectOptions(screen.getByRole('combobox', { name: /^language$/i }), language);
  await user.click(screen.getByRole('button', { name: /^load$/i }));
}

describe('SeoMetaScopeEditor — a product override per sales channel × language', () => {
  it('lists only the product’s member channels, and a channel’s own languages plus the whole channel', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    const channel = await screen.findByRole('combobox', { name: /^sales channel$/i });
    const channelOptions = within(channel).getAllByRole('option').map((o) => o.textContent);
    expect(channelOptions).toEqual(['Every channel (language row)', 'B2B shop', 'B2C shop']);

    await user.selectOptions(channel, B2C);
    const language = screen.getByRole('combobox', { name: /^language$/i });
    expect(within(language).getAllByRole('option').map((o) => o.textContent)).toEqual(['Whole channel', 'PL-PL']);
  });

  it('loads the selected scope and shows where each field comes from', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2B, 'de-DE');
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(`${META}?channelId=${B2B}&locale=de-DE`));
    const table = await screen.findByRole('table', { name: /effective values/i });
    const row = (field: RegExp): HTMLElement => within(table).getByRole('rowheader', { name: field }).closest('tr') as HTMLElement;
    expect(within(row(/^title$/i)).getByText('Channel and language')).toBeInTheDocument();
    expect(within(row(/^description$/i)).getByText('Whole channel')).toBeInTheDocument();
    expect(within(row(/^og title$/i)).getByText('Language')).toBeInTheDocument();
    expect(within(row(/^og description$/i)).getByText('From the product')).toBeInTheDocument();
  });

  it('addresses the whole channel row with channelId only', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2B, '');
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(`${META}?channelId=${B2B}`));
  });

  it('saves to the selected scope', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2B, 'de-DE');
    const title = await screen.findByRole('textbox', { name: /^title$/i });
    await user.clear(title);
    await user.type(title, 'Neuer Titel');
    await user.click(screen.getByRole('button', { name: /save override/i }));
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    const [path, body] = putSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe(META);
    expect(body).toMatchObject({ channelId: B2B, locale: 'de-DE', title: 'Neuer Titel' });
  });

  it('"use inherited" deletes exactly the selected scope’s row, then reloads', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2B, 'de-DE');
    await user.click(await screen.findByRole('button', { name: /use inherited/i }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledTimes(1));
    expect(deleteSpy).toHaveBeenCalledWith(`${META}?channelId=${B2B}&locale=de-DE`);
    await waitFor(() =>
      expect(getSpy.mock.calls.filter(([p]) => p === `${META}?channelId=${B2B}&locale=de-DE`).length).toBe(2),
    );
  });

  it('offers no "use inherited" where the scope holds no row', async () => {
    const user = userEvent.setup();
    getSpy.mockImplementation((path: string) =>
      path === CONTEXT_PATH ? Promise.resolve({ data: scopeContext }) : Promise.resolve(metaAnswer(null)),
    );
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />));
    await chooseScope(user, B2C, 'pl-PL');
    await screen.findByRole('table', { name: /effective values/i });
    expect(screen.queryByRole('button', { name: /use inherited/i })).toBeNull();
  });

  it('keeps a category on the language row: no channel selector, the locale as before', async () => {
    const user = userEvent.setup();
    render(wrap(<SeoMetaScopeEditor entityType="category" entityId={CATEGORY_ID} />));
    await screen.findByRole('button', { name: /^load$/i });
    expect(screen.queryByRole('combobox', { name: /sales channel/i })).toBeNull();
    expect(getSpy).not.toHaveBeenCalledWith(expect.stringContaining('scope-context'));
    await user.click(screen.getByRole('button', { name: /^load$/i }));
    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith(`/api/v1/admin/seo/meta/category/${CATEGORY_ID}?locale=en-US`),
    );
  });

  it('renders in Polish from the Polish bundles', async () => {
    render(wrap(<SeoMetaScopeEditor entityType="product" entityId={PRODUCT_ID} />, 'pl'));
    expect(await screen.findByRole('combobox', { name: /^kanał sprzedaży$/i })).toBeInTheDocument();
  });
});
