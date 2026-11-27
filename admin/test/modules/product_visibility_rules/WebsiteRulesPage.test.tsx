import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { setMobileViewport } from '../../setup';

/**
 * `specs/193-product-visibility-rules/` T073 (US4, FR-050 – FR-053, FR-058; TM-11) — the website
 * rules screen at `/product-visibility/website-rules`: product rules, the editor whose attribute
 * picker offers only what the server lists (global boolean and choice attributes), attaching a
 * rule to a channel through a mandatory preview → confirm, the stale / expired / capped answers,
 * and detaching. A rule's name is operator text and renders as text, never as markup.
 */

const MODULE = 'product_visibility_rules';
const k = (key: string): string => `${MODULE}.${key}`;

const SELF_ROLE = '00000000-0000-4000-8000-00000000ad02';
const RULE_A = '00000000-0000-4000-8000-0000000000f1';
const RULE_EVIL = '00000000-0000-4000-8000-0000000000f2';
const CHANNEL_X = '00000000-0000-4000-8000-0000000000e1';
const CHANNEL_Y = '00000000-0000-4000-8000-0000000000e2';
const PREVIEW = '00000000-0000-4000-8000-0000000000d1';
const EVIL = '<img src=x onerror="window.__pwned=1">';

function overview(): ProductVisibilityOverviewResponse {
  return {
    currencies: [{ code: 'PLN', active: true, designation: null, designationStatus: null, servedGeneration: 1, building: false }],
    categories: [],
    roles: [{ roleId: SELF_ROLE, code: 'test_role', name: 'Admin', effect: 'unmappable_unrestricted', warnings: [] }],
    productRules: [
      { id: RULE_A, name: 'Flag A', version: 2 },
      { id: RULE_EVIL, name: EVIL, version: 1 },
    ],
    websiteRuleAttachments: [{ salesChannelId: CHANNEL_X, productRuleId: RULE_A, attachedAt: '2026-11-20T10:00:00.000Z' }],
  };
}

const state = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; url: string; body?: unknown; headers?: unknown }>,
  previewAnswers: [] as Array<{ status: string; counts: Record<string, { join: number; leave: number }> }>,
  refuse: null as null | { method: string; url: string; status: number; code: string; message: string },
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  const refuseIf = (method: string, url: string): void => {
    const r = state.refuse;
    if (r && r.method === method && url.includes(r.url)) {
      state.refuse = null;
      throw new actual.ApiError(r.status, { error: { code: r.code, message: r.message } } as never);
    }
  };
  return {
    ...actual,
    apiClient: {
      get: async (url: string) => {
        state.calls.push({ method: 'GET', url });
        refuseIf('GET', url);
        if (url.endsWith('/overview')) return { data: overview() };
        if (url.endsWith('/attributes')) {
          return {
            data: {
              items: [
                { key: 'flag_a', labelDefault: 'Flag A', label: { en: 'Flag A' }, kind: 'boolean', options: [] },
                { key: 'segment', labelDefault: 'Segment', label: { en: 'Segment' }, kind: 'choice', options: ['retail', 'export'] },
              ],
            },
          };
        }
        if (url.includes('/website-rules/previews/')) {
          const next = state.previewAnswers.length > 1 ? state.previewAnswers.shift() : state.previewAnswers[0];
          return { data: { ...next, expiresAt: '2026-11-27T12:00:00.000Z' } };
        }
        if (url.includes('/api/v1/admin/sales-channels')) {
          return {
            data: [
              { id: CHANNEL_X, code: 'x', name: { 'en-US': 'Channel X' }, active: true },
              { id: CHANNEL_Y, code: 'y', name: { 'en-US': 'Channel Y' }, active: true },
            ],
            meta: { page: 1, pageSize: 200, total: 2 },
          };
        }
        return { data: null };
      },
      post: async (url: string, body?: unknown) => {
        state.calls.push({ method: 'POST', url, body });
        refuseIf('POST', url);
        if (url.endsWith('/website-rules/previews')) return { data: { previewId: PREVIEW } };
        if (url.endsWith('/confirm')) return { data: { status: 'applied' } };
        return { data: { id: RULE_A, version: 1, ...(body as object) } };
      },
      patch: async (url: string, body?: unknown, options?: { headers?: unknown }) => {
        state.calls.push({ method: 'PATCH', url, body, headers: options?.headers });
        refuseIf('PATCH', url);
        return { data: { id: RULE_A, version: 3, ...(body as object) } };
      },
      delete: async (url: string, options?: { headers?: unknown }) => {
        state.calls.push({ method: 'DELETE', url, headers: options?.headers });
        refuseIf('DELETE', url);
        return null;
      },
      put: vi.fn(),
    },
  };
});

const { WebsiteRulesPage } = await import('../../../../packages/modules/product_visibility_rules/src/admin/pages/WebsiteRulesPage');

const MANAGE = ['product_visibility:read', 'product_visibility:manage'];

function render(permissions: readonly string[] = MANAGE) {
  return renderWithI18n(
    withSession(
      <MemoryRouter>
        <WebsiteRulesPage pollIntervalMs={5} />
      </MemoryRouter>,
      { session: adminSession({ permissions }) },
    ),
  );
}

async function openAttach(): Promise<HTMLElement> {
  render();
  const governed = await screen.findByRole('region', { name: k('rules.channels.title') });
  fireEvent.click(within(governed).getByRole('button', { name: k('rules.attach.open') }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(k('rules.attach.field.rule')), { target: { value: RULE_A } });
  fireEvent.change(within(dialog).getByLabelText(k('rules.attach.field.channel')), { target: { value: CHANNEL_Y } });
  return dialog;
}

describe('WebsiteRulesPage (T073)', () => {
  beforeEach(() => {
    setMobileViewport(false);
    state.calls.length = 0;
    state.previewAnswers = [
      { status: 'pending', counts: {} },
      { status: 'ready', counts: { [CHANNEL_Y]: { join: 12, leave: 3 } } },
    ];
    state.refuse = null;
    delete (window as unknown as { __pwned?: number }).__pwned;
  });
  afterEach(() => cleanup());

  it('renders a rule name as text, never as markup', async () => {
    render();
    const rules = await screen.findByRole('region', { name: k('rules.list.title') });
    expect(within(rules).getByText(EVIL)).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('lists the governed channels by name with the rule that governs each', async () => {
    render();
    const governed = await screen.findByRole('region', { name: k('rules.channels.title') });
    const row = (await within(governed).findByText('Channel X')).closest('[data-attachment-row]') as HTMLElement;
    expect(within(row).getByText('Flag A')).toBeInTheDocument();
  });

  it('offers only the attributes the server lists, and builds the definition from them (FR-050)', async () => {
    render();
    const rules = await screen.findByRole('region', { name: k('rules.list.title') });
    fireEvent.click(within(rules).getByRole('button', { name: k('rules.editor.new') }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(k('rules.editor.field.name')), { target: { value: 'Retail flag' } });
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.addAttribute') }));
    const attribute = await within(dialog).findByLabelText(k('rules.editor.field.attribute'));
    await waitFor(() =>
      expect(within(attribute).getAllByRole('option').filter((o) => (o as HTMLOptionElement).value !== '').map((o) => (o as HTMLOptionElement).value)).toEqual([
        'flag_a',
        'segment',
      ]),
    );
    fireEvent.change(attribute, { target: { value: 'flag_a' } });
    fireEvent.change(within(dialog).getByLabelText(k('rules.editor.field.booleanValue')), { target: { value: 'true' } });
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.addPrice') }));
    fireEvent.change(within(dialog).getByLabelText(k('rules.editor.field.currency')), { target: { value: 'PLN' } });
    fireEvent.change(within(dialog).getByLabelText(k('rules.editor.field.threshold')), { target: { value: 'gt_zero' } });
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.save') }));
    await waitFor(() =>
      expect(state.calls).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          url: '/api/v1/admin/product-visibility/product-rules',
          body: {
            name: 'Retail flag',
            definition: {
              match: 'all',
              conditions: [
                { kind: 'attribute_boolean', attributeKey: 'flag_a', value: true },
                { kind: 'catalogue_price', currencyCode: 'PLN', threshold: 'gt_zero' },
              ],
            },
          },
        }),
      ),
    );
  });

  it('refuses a rule with no condition in its own words, and sends nothing', async () => {
    render();
    const rules = await screen.findByRole('region', { name: k('rules.list.title') });
    fireEvent.click(within(rules).getByRole('button', { name: k('rules.editor.new') }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(k('rules.editor.field.name')), { target: { value: 'Empty' } });
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.save') }));
    expect(await within(dialog).findByText(k('rules.editor.error.noConditions'))).toBeInTheDocument();
    expect(state.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('applies nothing until the preview is ready and confirmed; the counts are announced (FR-053)', async () => {
    const dialog = await openAttach();
    expect(within(dialog).queryByRole('button', { name: k('rules.attach.confirm') })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
    await waitFor(() =>
      expect(state.calls).toContainEqual(
        expect.objectContaining({ method: 'POST', url: '/api/v1/admin/product-visibility/website-rules/previews', body: { kind: 'attach', productRuleId: RULE_A, salesChannelIds: [CHANNEL_Y] } }),
      ),
    );
    const live = within(dialog).getByTestId('preview-status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    const confirm = await within(dialog).findByRole('button', { name: k('rules.attach.confirm') });
    const counts = within(dialog).getByText('Channel Y').closest('[data-preview-row]') as HTMLElement;
    expect(counts).toHaveTextContent('12');
    expect(counts).toHaveTextContent('3');
    expect(state.calls.some((c) => c.url.endsWith('/confirm'))).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(state.calls).toContainEqual(expect.objectContaining({ method: 'POST', url: `/api/v1/admin/product-visibility/website-rules/previews/${PREVIEW}/confirm` })),
    );
  });

  it('offers a new preview when the confirm answers stale', async () => {
    state.refuse = { method: 'POST', url: '/confirm', status: 409, code: 'WEBSITE_RULE_PREVIEW_STALE', message: 'This preview is no longer current.' };
    const dialog = await openAttach();
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
    fireEvent.click(await within(dialog).findByRole('button', { name: k('rules.attach.confirm') }));
    expect(await within(dialog).findByText('This preview is no longer current.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: k('rules.attach.confirm') })).toBeNull();
    expect(within(dialog).getByRole('button', { name: k('rules.attach.preview') })).toBeInTheDocument();
  });

  it('says an expired preview has expired and offers a new one', async () => {
    state.previewAnswers = [{ status: 'expired', counts: {} }];
    const dialog = await openAttach();
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
    expect(await within(dialog).findByText(k('previewStatus.expired'))).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: k('rules.attach.confirm') })).toBeNull();
    expect(within(dialog).getByRole('button', { name: k('rules.attach.preview') })).toBeInTheDocument();
  });

  it('shows the server\'s sentence when too many previews are waiting (capped)', async () => {
    state.refuse = { method: 'POST', url: '/website-rules/previews', status: 409, code: 'WEBSITE_RULE_PREVIEW_LIMIT', message: 'Too many previews are waiting.' };
    const dialog = await openAttach();
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
    expect(await within(dialog).findByText('Too many previews are waiting.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: k('rules.attach.confirm') })).toBeNull();
  });

  it('does not offer a channel that already has a rule (FR-051)', async () => {
    render();
    const governed = await screen.findByRole('region', { name: k('rules.channels.title') });
    fireEvent.click(within(governed).getByRole('button', { name: k('rules.attach.open') }));
    const dialog = await screen.findByRole('dialog');
    const channel = within(dialog).getByLabelText(k('rules.attach.field.channel'));
    await waitFor(() => expect(within(channel).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toContain(CHANNEL_Y));
    expect(within(channel).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).not.toContain(CHANNEL_X);
  });

  it('detaches a channel after a confirmation (FR-058)', async () => {
    render();
    const governed = await screen.findByRole('region', { name: k('rules.channels.title') });
    const row = (await within(governed).findByText('Channel X')).closest('[data-attachment-row]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: k('rules.detach') }));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: k('rules.detach') }));
    await waitFor(() =>
      expect(state.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', url: `/api/v1/admin/product-visibility/website-rules/attachments/${CHANNEL_X}` })),
    );
  });

  it('sends the version it read when deleting a rule, and shows the refusal for an attached one', async () => {
    state.refuse = { method: 'DELETE', url: `/product-rules/${RULE_A}`, status: 409, code: 'PRODUCT_RULE_ATTACHED', message: 'This product rule governs a sales channel.' };
    render();
    const rules = await screen.findByRole('region', { name: k('rules.list.title') });
    const row = within(rules).getByText('Flag A').closest('[data-rule-row]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: k('rules.delete') }));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: k('rules.delete') }));
    expect(await screen.findByText('This product rule governs a sales channel.')).toBeInTheDocument();
    expect(state.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', headers: { 'If-Match': '"2"' } }));
  });

  it('is read-only for an operator holding only the read permission', async () => {
    render(['product_visibility:read']);
    await screen.findByRole('region', { name: k('rules.list.title') });
    expect(screen.queryByRole('button', { name: k('rules.editor.new') })).toBeNull();
    expect(screen.queryByRole('button', { name: k('rules.attach.open') })).toBeNull();
    expect(screen.queryByRole('button', { name: k('rules.detach') })).toBeNull();
  });
});
