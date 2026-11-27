import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * `specs/193-product-visibility-rules/` Phase 8, QA pass (FR-074, TM-2) — the two screens, with
 * their dialogs open, rendered against the module's **real** `en.json` and `pl.json` instead of
 * the key-echo bundle the component tests use. Two things only a real bundle can show:
 *
 * - every key a screen asks for exists in both languages (a missing key is reported through
 *   `console.warn("[i18n] missing …")` and renders the key);
 * - no sentence on either screen states how many products a role cannot see (TM-2). Only the
 *   preview's join / leave counts are numbers about products, and they are announced by FR-053.
 */

const MODULE = 'product_visibility_rules';
const SELF = '00000000-0000-4000-8000-00000000ad02';
const REP = '00000000-0000-4000-8000-0000000000a2';
const CAT = '00000000-0000-4000-8000-0000000000c1';
const RULE = '00000000-0000-4000-8000-0000000000f1';
const CH_X = '00000000-0000-4000-8000-0000000000e1';
const CH_Y = '00000000-0000-4000-8000-0000000000e2';
const BOOK = '00000000-0000-4000-8000-0000000000b1';
const PREVIEW = '00000000-0000-4000-8000-0000000000d1';

const OVERVIEW: ProductVisibilityOverviewResponse = {
  currencies: [
    { code: 'PLN', active: true, designation: null, designationStatus: null, servedGeneration: 3, building: false },
    { code: 'EUR', active: true, designation: { priceListId: BOOK, salesChannelId: CH_X }, designationStatus: { inForce: false, reason: 'outside_schedule', window: null } as never, servedGeneration: 2, building: true },
  ],
  categories: [{ id: CAT, name: 'domestic', version: 1, conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }], mappedRoleIds: [] }],
  roles: [
    { roleId: SELF, code: 'test_role', name: 'Admin', effect: 'unmappable_unrestricted', warnings: [] },
    { roleId: REP, code: 'rep', name: 'Sales rep', effect: 'sees_no_products', warnings: ['audit_logs_read'] },
  ],
  productRules: [{ id: RULE, name: 'Flag A', version: 1 }],
  websiteRuleAttachments: [{ salesChannelId: CH_X, productRuleId: RULE, attachedAt: '2026-11-20T10:00:00.000Z' }],
};

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: async (url: string) => {
        if (url.endsWith('/overview')) return { data: OVERVIEW };
        if (url.endsWith('/attributes')) {
          return { data: { items: [{ key: 'segment', labelDefault: 'Segment', label: { en: 'Segment', pl: 'Segment' }, kind: 'choice', options: ['retail'] }] } };
        }
        if (url.includes('/designations/EUR/options')) return { data: { items: [{ priceListId: BOOK, name: 'Export EUR', salesChannelIds: [CH_X] }] } };
        if (url.includes('/website-rules/previews/')) {
          return { data: { status: 'ready', counts: { [CH_Y]: { join: 12, leave: 3 } }, expiresAt: '2026-11-27T12:00:00.000Z' } };
        }
        if (url.includes('/api/v1/admin/sales-channels')) {
          return {
            items: [
              { id: CH_X, code: 'x', name: { 'en-US': 'Channel X' }, active: true },
              { id: CH_Y, code: 'y', name: { 'en-US': 'Channel Y' }, active: true },
            ],
            page: 1,
            pageSize: 200,
            total: 2,
          };
        }
        return { data: null };
      },
      post: async (url: string) => (url.endsWith('/website-rules/previews') ? { data: { previewId: PREVIEW } } : { data: null }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { ConfigurationPage } = await import('../../../../packages/modules/product_visibility_rules/src/admin/pages/ConfigurationPage');
const { WebsiteRulesPage } = await import('../../../../packages/modules/product_visibility_rules/src/admin/pages/WebsiteRulesPage');

type Language = 'en' | 'pl';

function realBundle(language: Language): Record<string, Record<string, string>> {
  const file = resolve(__dirname, `../../../../packages/modules/${MODULE}/i18n/${language}.json`);
  return { [MODULE]: JSON.parse(readFileSync(file, 'utf8')) as Record<string, string> };
}

const NOT_OURS = /^\[i18n\] missing \w+: (?!product_visibility_rules\.)/;

function render(ui: React.ReactElement, language: Language) {
  return renderWithI18n(
    withSession(<MemoryRouter>{ui}</MemoryRouter>, { session: adminSession({ permissions: ['product_visibility:read', 'product_visibility:manage'] }) }),
    realBundle(language),
    { language },
  );
}

/** "12 products", "products: 12", "12 produktów", "produkty: 12" — a number stated about products. */
const PRODUCT_COUNT = /\d+\s*(products?|produkt\p{L}*)|(products?|produkt\p{L}*)\s*[:(]\s*\d+/iu;

describe('the admin screens against the real en and pl bundles (QA)', () => {
  let warn: { mock: { calls: unknown[][] }; mockRestore: () => void };
  beforeEach(() => {
    setMobileViewport(false);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    cleanup();
    warn.mockRestore();
  });

  const missingOwnKeys = (): string[] =>
    warn.mock.calls.map((c: unknown[]) => String(c[0])).filter((line: string) => line.startsWith('[i18n] missing') && !NOT_OURS.test(line));

  for (const language of ['en', 'pl'] as const) {
    it(`configuration screen: every string exists in ${language}, and none states a product count (TM-2)`, async () => {
      render(<ConfigurationPage />, language);
      const roles = await screen.findByRole('region', { name: realBundle(language)[MODULE]!['config.roles.title']! });
      const page = document.body;
      // The create-category dialog and the designation dialog: the strings behind buttons.
      fireEvent.click(within(await screen.findByRole('region', { name: realBundle(language)[MODULE]!['config.categories.title']! })).getByRole('button', { name: realBundle(language)[MODULE]!['config.categories.add']! }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: realBundle(language)[MODULE]!['config.categories.save']! }));
      expect(roles).toBeInTheDocument();
      expect(page.textContent ?? '').not.toMatch(PRODUCT_COUNT);
      expect(missingOwnKeys()).toEqual([]);
    });

    it(`website rules screen with the attach dialog and the preview: every string exists in ${language}, no product count outside the preview (TM-2)`, async () => {
      const t = realBundle(language)[MODULE]!;
      render(<WebsiteRulesPage pollIntervalMs={5} />, language);
      const governed = await screen.findByRole('region', { name: t['rules.channels.title']! });
      expect(document.body.textContent ?? '').not.toMatch(PRODUCT_COUNT);
      fireEvent.click(within(governed).getByRole('button', { name: t['rules.attach.open']! }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText(t['rules.attach.field.rule']!, { exact: false }), { target: { value: RULE } });
      fireEvent.change(within(dialog).getByLabelText(t['rules.attach.field.channel']!, { exact: false }), { target: { value: CH_Y } });
      fireEvent.click(within(dialog).getByRole('button', { name: t['rules.attach.preview']! }));
      await within(dialog).findByRole('button', { name: t['rules.attach.confirm']! });
      // Join and leave are announced with their words, and they are the only numbers about products.
      const row = dialog.querySelector('[data-preview-row]') as HTMLElement;
      expect(row).toHaveTextContent(t['rules.attach.join']!);
      expect(row).toHaveTextContent('12');
      expect(missingOwnKeys()).toEqual([]);
    });
  }
});
