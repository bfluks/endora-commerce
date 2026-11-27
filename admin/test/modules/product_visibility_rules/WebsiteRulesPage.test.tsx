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

let building = false;
/** Extra attachments: CHANNEL_Y too, so every channel has a rule. */
let allGoverned = false;
let selfEffect: ProductVisibilityOverviewResponse['roles'][number]['effect'] = 'unmappable_unrestricted';

/** T103 — what `GET /product-rules/:id` answers: RULE_A governs CHANNEL_X, RULE_EVIL governs nothing. */
const savedRules: Record<string, unknown> = {
  [RULE_A]: {
    id: RULE_A,
    name: 'Flag A',
    version: 2,
    definition: { match: 'all', conditions: [{ kind: 'attribute_boolean', attributeKey: 'flag_a', value: true }] },
    attachments: [{ salesChannelId: CHANNEL_X, attachedAt: '2026-11-20T10:00:00.000Z' }],
  },
  [RULE_EVIL]: {
    id: RULE_EVIL,
    name: EVIL,
    version: 1,
    definition: {
      match: 'any',
      conditions: [
        { kind: 'attribute_choice', attributeKey: 'segment', optionKeys: ['retail', 'gone_option'] },
        { kind: 'catalogue_price', currencyCode: 'PLN', threshold: 'gte_zero' },
      ],
    },
    attachments: [],
  },
};

function overview(): ProductVisibilityOverviewResponse {
  return {
    currencies: [
      { code: 'PLN', active: true, designation: null, designationStatus: null, servedGeneration: 1, building },
      { code: 'CZK', active: false, designation: null, designationStatus: null, servedGeneration: 1, building: false },
    ],
    categories: [],
    roles: [{ roleId: SELF_ROLE, code: 'test_role', name: 'Admin', effect: selfEffect, warnings: [] }],
    productRules: [
      { id: RULE_A, name: 'Flag A', version: 2 },
      { id: RULE_EVIL, name: EVIL, version: 1 },
    ],
    websiteRuleAttachments: [
      { salesChannelId: CHANNEL_X, productRuleId: RULE_A, attachedAt: '2026-11-20T10:00:00.000Z' },
      ...(allGoverned ? [{ salesChannelId: CHANNEL_Y, productRuleId: RULE_A, attachedAt: '2026-11-21T10:00:00.000Z' }] : []),
    ],
  };
}

const state = vi.hoisted(() => ({
  calls: [] as Array<{ method: string; url: string; body?: unknown; headers?: unknown }>,
  previewAnswers: [] as Array<{ status: string; counts: Record<string, { join: number; leave: number }> }>,
  refuse: null as null | { method: string; url: string; status: number; code: string; message: string },
  /** While set, a confirm waits for it. */
  confirmGate: null as null | Promise<void>,
  /** How many preview reads fail in transport (no answer) before one answers. */
  transportFailures: 0,
  failChannels: false,
  /** `/attributes`: the list, an empty list, or no answer until the gate opens. */
  attributes: 'listed' as 'listed' | 'empty',
  attributesGate: null as null | Promise<void>,
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
          if (state.attributesGate) await state.attributesGate;
          if (state.attributes === 'empty') return { data: { items: [] } };
          return {
            data: {
              items: [
                { key: 'flag_a', labelDefault: 'Flag A', label: { en: 'Flag A' }, kind: 'boolean', options: [] },
                {
                  key: 'segment',
                  labelDefault: 'Segment',
                  label: { en: 'Segment' },
                  kind: 'choice',
                  options: [
                    { key: 'retail', labelDefault: 'Retail (default)', label: { 'en-US': 'Retail' } },
                    { key: 'export', labelDefault: 'Export', label: {} },
                  ],
                },
              ],
            },
          };
        }
        const rule = /\/product-rules\/([^/]+)$/.exec(url);
        if (rule) return { data: savedRules[rule[1]!] };
        if (url.includes('/website-rules/previews/')) {
          if (state.transportFailures > 0) {
            state.transportFailures -= 1;
            throw new TypeError('Failed to fetch');
          }
          const next = state.previewAnswers.length > 1 ? state.previewAnswers.shift() : state.previewAnswers[0];
          return { data: { ...next, expiresAt: '2026-11-27T12:00:00.000Z' } };
        }
        if (url.includes('/api/v1/admin/sales-channels')) {
          if (state.failChannels) throw new actual.ApiError(500, { error: { code: 'INTERNAL', message: 'Down.' } } as never);
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
      post: async (url: string, body?: unknown, options?: { headers?: unknown }) => {
        state.calls.push({ method: 'POST', url, body, headers: options?.headers });
        refuseIf('POST', url);
        if (url.endsWith('/website-rules/previews')) return { data: { previewId: PREVIEW } };
        if (url.endsWith('/confirm')) {
          if (state.confirmGate) await state.confirmGate;
          return { data: { status: 'applied' } };
        }
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

function render(permissions: readonly string[] = MANAGE, props: { slowAfterMs?: number } = {}, bundle: Record<string, string> = {}) {
  return renderWithI18n(
    withSession(
      <MemoryRouter>
        <WebsiteRulesPage pollIntervalMs={5} {...props} />
      </MemoryRouter>,
      { session: adminSession({ permissions }) },
    ),
    { [MODULE]: bundle },
  );
}

async function openEditor(ruleName: string): Promise<HTMLElement> {
  render();
  const rules = await screen.findByRole('region', { name: k('rules.list.title') });
  const row = within(rules).getByText(ruleName).closest('[data-rule-row]') as HTMLElement;
  fireEvent.click(within(row).getByRole('button', { name: k('rules.editNamed') }));
  return screen.findByRole('dialog');
}

async function openAttach(props: { slowAfterMs?: number } = {}): Promise<HTMLElement> {
  render(MANAGE, props);
  const governed = await screen.findByRole('region', { name: k('rules.channels.title') });
  fireEvent.click(within(governed).getByRole('button', { name: k('rules.attach.open') }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText(k('rules.attach.field.rule'), { exact: false }), { target: { value: RULE_A } });
  fireEvent.change(within(dialog).getByLabelText(k('rules.attach.field.channel'), { exact: false }), { target: { value: CHANNEL_Y } });
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
    state.confirmGate = null;
    state.transportFailures = 0;
    state.failChannels = false;
    state.attributes = 'listed';
    state.attributesGate = null;
    allGoverned = false;
    selfEffect = 'unmappable_unrestricted';
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
    fireEvent.change(within(dialog).getByLabelText(k('rules.editor.field.name'), { exact: false }), { target: { value: 'Retail flag' } });
    // A new rule starts with one attribute condition (checkpoint 2).
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
    fireEvent.change(within(dialog).getByLabelText(k('rules.editor.field.name'), { exact: false }), { target: { value: 'Empty' } });
    await within(dialog).findByRole('option', { name: 'Flag A' });
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.removeConditionN') }));
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
    const counts = within(dialog).getAllByText('Channel Y').map((el) => el.closest('[data-preview-row]')).find(Boolean) as HTMLElement;
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

  it('offers a new preview when the confirm answers that the channel got another rule meanwhile (FR-051) (QA)', async () => {
    state.refuse = { method: 'POST', url: '/confirm', status: 409, code: 'CHANNEL_ALREADY_GOVERNED', message: 'This sales channel already follows another product rule.' };
    const dialog = await openAttach();
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
    fireEvent.click(await within(dialog).findByRole('button', { name: k('rules.attach.confirm') }));
    expect(await within(dialog).findByText('This sales channel already follows another product rule.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: k('rules.attach.confirm') })).toBeNull();
    expect(within(dialog).getByRole('button', { name: k('rules.attach.preview') })).toBeEnabled();
  });

  it('stops asking for a pending preview once the dialog is closed (polling cleanup) (QA)', async () => {
    state.previewAnswers = [{ status: 'pending', counts: {} }];
    const dialog = await openAttach();
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
    const polls = (): number => state.calls.filter((c) => c.method === 'GET' && c.url.includes('/website-rules/previews/')).length;
    await waitFor(() => expect(polls()).toBeGreaterThanOrEqual(2));
    fireEvent.click(within(dialog).getByRole('button', { name: k('config.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const settled = polls() + 1; // one answer may already be in flight
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(polls()).toBeLessThanOrEqual(settled);
  });

  it('stops asking for a pending preview when the whole screen unmounts (sign-out) (QA)', async () => {
    state.previewAnswers = [{ status: 'pending', counts: {} }];
    const view = render();
    const governed = await screen.findByRole('region', { name: k('rules.channels.title') });
    fireEvent.click(within(governed).getByRole('button', { name: k('rules.attach.open') }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(k('rules.attach.field.rule'), { exact: false }), { target: { value: RULE_A } });
    fireEvent.change(within(dialog).getByLabelText(k('rules.attach.field.channel'), { exact: false }), { target: { value: CHANNEL_Y } });
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
    const polls = (): number => state.calls.filter((c) => c.method === 'GET' && c.url.includes('/website-rules/previews/')).length;
    await waitFor(() => expect(polls()).toBeGreaterThanOrEqual(2));
    view.unmount();
    const settled = polls() + 1;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(polls()).toBeLessThanOrEqual(settled);
  });

  it('drops a preview when the channel is changed while it is pending: nothing to confirm (QA)', async () => {
    state.previewAnswers = [
      { status: 'pending', counts: {} },
      { status: 'ready', counts: { [CHANNEL_Y]: { join: 12, leave: 3 } } },
    ];
    const dialog = await openAttach();
    fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
    const channel = within(dialog).getByLabelText(k('rules.attach.field.channel'), { exact: false });
    fireEvent.change(channel, { target: { value: '' } });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(within(dialog).queryByRole('button', { name: k('rules.attach.confirm') })).toBeNull();
    expect(within(dialog).queryByText('12')).toBeNull();
    expect(state.calls.some((c) => c.url.endsWith('/confirm'))).toBe(false);
  });

  it('does not offer a channel that already has a rule (FR-051)', async () => {
    render();
    const governed = await screen.findByRole('region', { name: k('rules.channels.title') });
    fireEvent.click(within(governed).getByRole('button', { name: k('rules.attach.open') }));
    const dialog = await screen.findByRole('dialog');
    const channel = within(dialog).getByLabelText(k('rules.attach.field.channel'), { exact: false });
    await waitFor(() => expect(within(channel).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).toContain(CHANNEL_Y));
    expect(within(channel).getAllByRole('option').map((o) => (o as HTMLOptionElement).value)).not.toContain(CHANNEL_X);
  });

  it('detaches a channel after a confirmation (FR-058)', async () => {
    render();
    const governed = await screen.findByRole('region', { name: k('rules.channels.title') });
    const row = (await within(governed).findByText('Channel X')).closest('[data-attachment-row]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: k('rules.detachFrom') }));
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
    fireEvent.click(within(row).getByRole('button', { name: k('rules.deleteNamed') }));
    const confirm = await screen.findByRole('dialog');
    fireEvent.click(within(confirm).getByRole('button', { name: k('rules.delete') }));
    expect(await screen.findByText('This product rule governs a sales channel.')).toBeInTheDocument();
    expect(state.calls).toContainEqual(expect.objectContaining({ method: 'DELETE', headers: { 'If-Match': '"2"' } }));
  });

  it('says governed channels keep their products while catalogue prices are being rebuilt (T079, US4-11)', async () => {
    building = true;
    render();
    expect(await screen.findByText(k('rules.building'))).toBeInTheDocument();
    building = false;
  });

  it('is read-only for an operator holding only the read permission', async () => {
    render(['product_visibility:read']);
    await screen.findByRole('region', { name: k('rules.list.title') });
    expect(screen.queryByRole('button', { name: k('rules.editor.new') })).toBeNull();
    expect(screen.queryByRole('button', { name: k('rules.attach.open') })).toBeNull();
    expect(screen.queryByRole('button', { name: k('rules.detachFrom') })).toBeNull();
  });

  it('is read-only for a manage holder whose own role is restricted (TM-4 c) (QA)', async () => {
    selfEffect = 'mapped';
    render();
    await screen.findByRole('region', { name: k('rules.list.title') });
    expect(screen.getByText(k('config.readOnly.restricted'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: k('rules.editor.new') })).toBeNull();
    expect(screen.queryByRole('button', { name: k('rules.attach.open') })).toBeNull();
    expect(screen.queryByRole('button', { name: k('rules.detachFrom') })).toBeNull();
    expect(screen.queryByRole('button', { name: k('rules.deleteNamed') })).toBeNull();
    expect(screen.queryByRole('button', { name: k('rules.renameNamed') })).toBeNull();
  });

  describe('preview flow, checkpoint 2 fix round', () => {
    it('moves focus to Confirm when the preview is ready', async () => {
      const dialog = await openAttach();
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
      const confirm = await within(dialog).findByRole('button', { name: k('rules.attach.confirm') });
      await waitFor(() => expect(document.activeElement).toBe(confirm));
    });

    it('keeps the buttons and selects focusable while busy: aria-disabled, not disabled', async () => {
      state.previewAnswers = [{ status: 'pending', counts: {} }];
      const dialog = await openAttach();
      const preview = within(dialog).getByRole('button', { name: k('rules.attach.preview') });
      fireEvent.click(preview);
      await waitFor(() => expect(preview).toHaveAttribute('aria-disabled', 'true'));
      expect(preview).not.toBeDisabled();
      cleanup();

      let release = (): void => undefined;
      state.confirmGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      state.previewAnswers = [{ status: 'ready', counts: { [CHANNEL_Y]: { join: 1, leave: 0 } } }];
      const again = await openAttach();
      fireEvent.click(within(again).getByRole('button', { name: k('rules.attach.preview') }));
      const confirm = await within(again).findByRole('button', { name: k('rules.attach.confirm') });
      fireEvent.click(confirm);
      const channel = within(again).getByLabelText(k('rules.attach.field.channel'), { exact: false });
      await waitFor(() => expect(confirm).toHaveAttribute('aria-disabled', 'true'));
      expect(confirm).not.toBeDisabled();
      expect(channel).toHaveAttribute('aria-disabled', 'true');
      expect(channel).not.toBeDisabled();
      expect(within(again).getByRole('button', { name: k('config.cancel') })).toHaveAttribute('aria-disabled', 'true');
      fireEvent.change(channel, { target: { value: '' } });
      expect((channel as HTMLSelectElement).value).toBe(CHANNEL_Y);
      release();
    });

    it('says a refusal in the always-mounted polite region, not in a freshly mounted alert', async () => {
      state.refuse = { method: 'POST', url: '/confirm', status: 409, code: 'WEBSITE_RULE_PREVIEW_STALE', message: 'This preview is no longer current.' };
      const dialog = await openAttach();
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
      fireEvent.click(await within(dialog).findByRole('button', { name: k('rules.attach.confirm') }));
      await waitFor(() => expect(within(dialog).getByTestId('preview-status')).toHaveTextContent('This preview is no longer current.'));
      expect(within(dialog).getAllByText('This preview is no longer current.')).toHaveLength(1);
      expect(within(dialog).queryByRole('alert')).toBeNull();
    });

    it('says when a preview takes longer than usual, and offers a new preview', async () => {
      state.previewAnswers = [{ status: 'pending', counts: {} }];
      const dialog = await openAttach({ slowAfterMs: 30 });
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
      expect(await within(dialog).findByText(k('preview.slow'))).toBeInTheDocument();
      const creates = (): number => state.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/website-rules/previews')).length;
      expect(creates()).toBe(1);
      fireEvent.click(within(dialog).getByRole('button', { name: k('preview.again') }));
      await waitFor(() => expect(creates()).toBe(2));
      // The button leaves with the slow state: focus goes to the (waiting) preview button, not the page.
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
    });

    it('asks once more after a transport error before it gives up', async () => {
      state.transportFailures = 1;
      state.previewAnswers = [{ status: 'ready', counts: { [CHANNEL_Y]: { join: 2, leave: 1 } } }];
      const dialog = await openAttach();
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
      expect(await within(dialog).findByRole('button', { name: k('rules.attach.confirm') })).toBeInTheDocument();
      cleanup();

      state.transportFailures = 2;
      const failing = await openAttach();
      fireEvent.click(within(failing).getByRole('button', { name: k('rules.attach.preview') }));
      await waitFor(() => expect(within(failing).getByTestId('preview-status')).toHaveTextContent(k('rules.attach.previewFailed')));
      expect(within(failing).queryByRole('button', { name: k('rules.attach.confirm') })).toBeNull();
    });

    it('says "nothing will change" for a preview with nothing joining or leaving', async () => {
      state.previewAnswers = [{ status: 'ready', counts: { [CHANNEL_Y]: { join: 0, leave: 0 } } }];
      const dialog = await openAttach();
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
      expect(await within(dialog).findByText(k('rules.attach.nothingChanges'))).toBeInTheDocument();
    });

    it('says when every sales channel already has a rule', async () => {
      allGoverned = true;
      render();
      const governed = await screen.findByRole('region', { name: k('rules.channels.title') });
      fireEvent.click(within(governed).getByRole('button', { name: k('rules.attach.open') }));
      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText(k('rules.attach.allGoverned'))).toBeInTheDocument();
    });

    it('says when the sales channels could not be loaded, once', async () => {
      state.failChannels = true;
      render();
      await screen.findByRole('region', { name: k('rules.channels.title') });
      expect(await screen.findAllByText(k('config.error.channels'))).toHaveLength(1);
    });

    it('gives repeated row buttons unique names that start with the visible text', async () => {
      render(MANAGE, {}, {
        'rules.detach': 'Detach rule',
        'rules.detachFrom': 'Detach rule from {channel}',
        'rules.deleteNamed': 'Delete rule {name}',
        'rules.editNamed': 'Edit conditions of {name}',
        'rules.renameNamed': 'Rename rule {name}',
      });
      const governed = await screen.findByRole('region', { name: k('rules.channels.title') });
      expect(await within(governed).findByRole('button', { name: 'Detach rule from Channel X' })).toHaveTextContent('Detach rule');
      const rules = screen.getByRole('region', { name: k('rules.list.title') });
      expect(within(rules).getByRole('button', { name: 'Delete rule Flag A' })).toBeInTheDocument();
      expect(within(rules).getByRole('button', { name: 'Edit conditions of Flag A' })).toBeInTheDocument();
      expect(within(rules).getByRole('button', { name: 'Rename rule Flag A' })).toBeInTheDocument();
    });
  });

  describe('a saved rule (T103, FR-053, US4-5)', () => {
    it('shows a choice attribute\'s options by their labels in the operator\'s language and sends their keys', async () => {
      render();
      const rules = await screen.findByRole('region', { name: k('rules.list.title') });
      fireEvent.click(within(rules).getByRole('button', { name: k('rules.editor.new') }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.change(within(dialog).getByLabelText(k('rules.editor.field.name'), { exact: false }), { target: { value: 'Retail' } });
      const attribute = await within(dialog).findByLabelText(k('rules.editor.field.attribute'));
      await waitFor(() => expect(within(attribute).getAllByRole('option').length).toBeGreaterThan(1));
      fireEvent.change(attribute, { target: { value: 'segment' } });
      // A label in the operator's language (`en` reads `en-US`), else the default label.
      expect(within(dialog).queryByText('retail')).toBeNull();
      fireEvent.click(within(dialog).getByLabelText('Retail'));
      expect(within(dialog).getByLabelText('Export')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.save') }));
      await waitFor(() =>
        expect(state.calls).toContainEqual(
          expect.objectContaining({
            method: 'POST',
            url: '/api/v1/admin/product-visibility/product-rules',
            body: { name: 'Retail', definition: { match: 'all', conditions: [{ kind: 'attribute_choice', attributeKey: 'segment', optionKeys: ['retail'] }] } },
          }),
        ),
      );
    });

    it('opens an unattached rule with its conditions and saves a change directly against the version it read', async () => {
      const dialog = await openEditor(EVIL);
      expect(state.calls).toContainEqual(expect.objectContaining({ method: 'GET', url: `/api/v1/admin/product-visibility/product-rules/${RULE_EVIL}` }));
      expect(await within(dialog).findByLabelText('Retail')).toBeChecked();
      // A saved value the attribute no longer offers is still shown by its key, so it can be removed.
      expect(within(dialog).getByLabelText('gone_option')).toBeChecked();
      expect(within(dialog).getByLabelText(k('rules.editor.field.match'))).toHaveValue('any');
      expect(within(dialog).getByLabelText(k('rules.editor.field.threshold'))).toHaveValue('gte_zero');
      expect(within(dialog).queryByRole('button', { name: k('rules.attach.preview') })).toBeNull();
      fireEvent.click(within(dialog).getByLabelText('gone_option'));
      fireEvent.click(within(dialog).getByLabelText('Export'));
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.save') }));
      await waitFor(() =>
        expect(state.calls).toContainEqual({
          method: 'PATCH',
          url: `/api/v1/admin/product-visibility/product-rules/${RULE_EVIL}`,
          body: {
            definition: {
              match: 'any',
              conditions: [
                { kind: 'attribute_choice', attributeKey: 'segment', optionKeys: ['retail', 'export'] },
                { kind: 'catalogue_price', currencyCode: 'PLN', threshold: 'gte_zero' },
              ],
            },
          },
          headers: { 'If-Match': '"1"' },
        }),
      );
      expect(state.calls.some((c) => c.url.endsWith('/website-rules/previews'))).toBe(false);
    });

    it('shows the server\'s sentence when the rule changed since it was read', async () => {
      state.refuse = { method: 'PATCH', url: `/product-rules/${RULE_EVIL}`, status: 409, code: 'VERSION_CONFLICT', message: 'The product rule changed since it was read.' };
      const dialog = await openEditor(EVIL);
      await within(dialog).findByLabelText('Retail');
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.save') }));
      expect(await within(dialog).findByText('The product rule changed since it was read.')).toBeInTheDocument();
    });

    it('changes an attached rule only through a preview of the governed channels, then a confirm (FR-053)', async () => {
      state.previewAnswers = [
        { status: 'pending', counts: {} },
        { status: 'ready', counts: { [CHANNEL_X]: { join: 4, leave: 9 } } },
      ];
      const dialog = await openEditor('Flag A');
      expect(await within(dialog).findByLabelText(k('rules.editor.field.booleanValue'))).toHaveValue('true');
      expect(within(dialog).getByText(k('rules.editor.governed'))).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: k('rules.editor.save') })).toBeNull();
      expect(within(dialog).queryByRole('button', { name: k('rules.attach.confirm') })).toBeNull();
      fireEvent.change(within(dialog).getByLabelText(k('rules.editor.field.booleanValue')), { target: { value: 'false' } });
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
      await waitFor(() =>
        expect(state.calls).toContainEqual({
          method: 'POST',
          url: '/api/v1/admin/product-visibility/website-rules/previews',
          body: { kind: 'change', productRuleId: RULE_A, definition: { match: 'all', conditions: [{ kind: 'attribute_boolean', attributeKey: 'flag_a', value: false }] } },
          headers: { 'If-Match': '"2"' },
        }),
      );
      expect(within(dialog).getByTestId('preview-status')).toHaveAttribute('aria-live', 'polite');
      const confirm = await within(dialog).findByRole('button', { name: k('rules.attach.confirm') });
      const row = within(dialog).getByText('Channel X').closest('[data-preview-row]') as HTMLElement;
      expect(row).toHaveTextContent('4');
      expect(row).toHaveTextContent('9');
      expect(state.calls.some((c) => c.method === 'PATCH')).toBe(false);
      fireEvent.click(confirm);
      await waitFor(() =>
        expect(state.calls).toContainEqual(expect.objectContaining({ method: 'POST', url: `/api/v1/admin/product-visibility/website-rules/previews/${PREVIEW}/confirm` })),
      );
      expect(await screen.findByText(k('rules.editor.changeApplied'))).toBeInTheDocument();
    });

    it('drops a preview when a condition changes after it, and offers a new one', async () => {
      state.previewAnswers = [{ status: 'ready', counts: { [CHANNEL_X]: { join: 1, leave: 0 } } }];
      const dialog = await openEditor('Flag A');
      await within(dialog).findByLabelText(k('rules.editor.field.booleanValue'));
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
      await within(dialog).findByRole('button', { name: k('rules.attach.confirm') });
      fireEvent.change(within(dialog).getByLabelText(k('rules.editor.field.match')), { target: { value: 'any' } });
      expect(within(dialog).queryByRole('button', { name: k('rules.attach.confirm') })).toBeNull();
      expect(within(dialog).getByRole('button', { name: k('rules.attach.preview') })).toBeInTheDocument();
    });

    it('says a stale or expired change preview is spent and offers a new one; a capped one shows the server\'s sentence', async () => {
      state.refuse = { method: 'POST', url: '/confirm', status: 409, code: 'WEBSITE_RULE_PREVIEW_STALE', message: 'This preview is no longer current.' };
      let dialog = await openEditor('Flag A');
      await within(dialog).findByLabelText(k('rules.editor.field.booleanValue'));
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
      fireEvent.click(await within(dialog).findByRole('button', { name: k('rules.attach.confirm') }));
      expect(await within(dialog).findByText('This preview is no longer current.')).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: k('rules.attach.preview') })).toBeInTheDocument();
      cleanup();

      state.previewAnswers = [{ status: 'expired', counts: {} }];
      dialog = await openEditor('Flag A');
      await within(dialog).findByLabelText(k('rules.editor.field.booleanValue'));
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
      expect(await within(dialog).findByText(k('previewStatus.expired'))).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: k('rules.attach.confirm') })).toBeNull();
      cleanup();

      state.refuse = { method: 'POST', url: '/website-rules/previews', status: 409, code: 'WEBSITE_RULE_PREVIEW_LIMIT', message: 'Too many previews are waiting.' };
      dialog = await openEditor('Flag A');
      await within(dialog).findByLabelText(k('rules.editor.field.booleanValue'));
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
      expect(await within(dialog).findByText('Too many previews are waiting.')).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: k('rules.attach.confirm') })).toBeNull();
    });

    it('says when a failed preview could not be prepared', async () => {
      state.previewAnswers = [{ status: 'failed', counts: {} }];
      const dialog = await openEditor('Flag A');
      await within(dialog).findByLabelText(k('rules.editor.field.booleanValue'));
      fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
      expect(await within(dialog).findByText(k('previewStatus.failed'))).toBeInTheDocument();
    });

    it('says when the rule could not be loaded, and offers nothing to save', async () => {
      state.refuse = { method: 'GET', url: `/product-rules/${RULE_A}`, status: 404, code: 'NOT_FOUND', message: 'Product rule not found.' };
      const dialog = await openEditor('Flag A');
      expect(await within(dialog).findByText(k('rules.editor.loadFailed'))).toBeInTheDocument();
      expect(within(dialog).queryByRole('button', { name: k('rules.editor.save') })).toBeNull();
      expect(within(dialog).queryByRole('button', { name: k('rules.attach.preview') })).toBeNull();
    });

    it('does not open a rule whose conditions are grouped (API only), so a save cannot drop its groups', async () => {
      const kept = savedRules[RULE_EVIL];
      savedRules[RULE_EVIL] = {
        ...(kept as object),
        definition: {
          match: 'all',
          conditions: [{ kind: 'group', match: 'any', conditions: [{ kind: 'attribute_boolean', attributeKey: 'flag_a', value: true }] }],
        },
      };
      try {
        const dialog = await openEditor(EVIL);
        expect(await within(dialog).findByText(k('rules.editor.grouped'))).toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: k('rules.editor.save') })).toBeNull();
        expect(within(dialog).queryByLabelText(k('rules.editor.field.match'))).toBeNull();
      } finally {
        savedRules[RULE_EVIL] = kept;
      }
    });

    describe('the rule editor, checkpoint 2 fix round', () => {
      const openNew = async (): Promise<HTMLElement> => {
        render();
        const rules = await screen.findByRole('region', { name: k('rules.list.title') });
        fireEvent.click(within(rules).getByRole('button', { name: k('rules.editor.new') }));
        return screen.findByRole('dialog');
      };

      it('starts a new rule with one condition row', async () => {
        const dialog = await openNew();
        expect(within(dialog).getAllByLabelText(k('rules.editor.field.attribute'))).toHaveLength(1);
      });

      it('says when no attribute can be used in a rule', async () => {
        state.attributes = 'empty';
        const dialog = await openNew();
        expect(await within(dialog).findByText(k('rules.editor.noAttributes'))).toBeInTheDocument();
      });

      it('moves focus to the first invalid field on a refused save', async () => {
        const dialog = await openNew();
        await within(dialog).findByRole('option', { name: 'Flag A' });
        fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.save') }));
        await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText(k('rules.editor.field.name'), { exact: false })));
        fireEvent.change(within(dialog).getByLabelText(k('rules.editor.field.name'), { exact: false }), { target: { value: 'Named' } });
        fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.save') }));
        await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText(k('rules.editor.field.attribute'))));
      });

      it('names each remove button by its condition and moves focus on after a removal', async () => {
        const dialog = await openNew();
        fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.addPrice') }));
        const removes = within(dialog).getAllByRole('button', { name: k('rules.editor.removeConditionN') });
        expect(removes).toHaveLength(2);
        fireEvent.click(removes[0]!);
        const [next] = within(dialog).getAllByRole('button', { name: k('rules.editor.removeConditionN') });
        await waitFor(() => expect(document.activeElement).toBe(next));
        fireEvent.click(next!);
        await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: k('rules.editor.addAttribute') })));
      });

      it('moves focus to "add condition" when the last of several conditions is removed', async () => {
        const dialog = await openNew();
        fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.addPrice') }));
        fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.addPrice') }));
        const removes = within(dialog).getAllByRole('button', { name: k('rules.editor.removeConditionN') });
        expect(removes).toHaveLength(3);
        fireEvent.click(removes[2]!);
        await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: k('rules.editor.addAttribute') })));
      });

      it('offers only active currencies for a price condition', async () => {
        const dialog = await openNew();
        fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.addPrice') }));
        const currency = within(dialog).getByLabelText(k('rules.editor.field.currency'));
        const codes = within(currency).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
        expect(codes).toContain('PLN');
        expect(codes).not.toContain('CZK');
      });

      it('holds Save, with its reason, until the attribute list has loaded', async () => {
        let release = (): void => undefined;
        state.attributesGate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const dialog = await openEditor(EVIL);
        const save = await within(dialog).findByRole('button', { name: k('rules.editor.save') });
        expect(save).toHaveAttribute('aria-disabled', 'true');
        expect(save).toHaveAccessibleDescription(k('rules.editor.waitingAttributes'));
        fireEvent.click(save);
        expect(state.calls.some((c) => c.method === 'PATCH')).toBe(false);
        release();
        await waitFor(() => expect(save).not.toHaveAttribute('aria-disabled', 'true'));
      });

      it('says a refused save in the dialog\'s polite region, and offers to load the current version after a conflict', async () => {
        state.refuse = { method: 'PATCH', url: `/product-rules/${RULE_EVIL}`, status: 409, code: 'VERSION_CONFLICT', message: 'The product rule changed since it was read.' };
        const dialog = await openEditor(EVIL);
        await within(dialog).findByLabelText('Retail');
        fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.save') }));
        const message = await within(dialog).findByText('The product rule changed since it was read.');
        expect(message.closest('[role="status"]')).not.toBeNull();
        expect(within(dialog).queryByRole('alert')).toBeNull();
        const kept = savedRules[RULE_EVIL] as { version: number };
        savedRules[RULE_EVIL] = { ...kept, version: 5 };
        try {
          fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.reload') }));
          await waitFor(() => expect(state.calls.filter((c) => c.method === 'GET' && c.url.endsWith(`/product-rules/${RULE_EVIL}`))).toHaveLength(2));
          expect(screen.getByRole('dialog')).toBe(dialog);
          await waitFor(() => expect(within(dialog).queryByRole('button', { name: k('rules.editor.reload') })).toBeNull());
          // The button leaves once the rule is re-read: focus goes to the first field, not the page.
          await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByLabelText(k('rules.editor.field.match'))));
          fireEvent.click(within(dialog).getByRole('button', { name: k('rules.editor.save') }));
          await waitFor(() => expect(state.calls).toContainEqual(expect.objectContaining({ method: 'PATCH', headers: { 'If-Match': '"5"' } })));
        } finally {
          savedRules[RULE_EVIL] = kept;
        }
      });

      it('offers to load the current version after a stale change confirm', async () => {
        state.refuse = { method: 'POST', url: '/confirm', status: 409, code: 'WEBSITE_RULE_PREVIEW_STALE', message: 'This preview is no longer current.' };
        const dialog = await openEditor('Flag A');
        await within(dialog).findByLabelText(k('rules.editor.field.booleanValue'));
        fireEvent.click(within(dialog).getByRole('button', { name: k('rules.attach.preview') }));
        fireEvent.click(await within(dialog).findByRole('button', { name: k('rules.attach.confirm') }));
        expect(await within(dialog).findByRole('button', { name: k('rules.editor.reload') })).toBeInTheDocument();
      });
    });

    it('offers no edit to an operator holding only the read permission', async () => {
      render(['product_visibility:read']);
      await screen.findByRole('region', { name: k('rules.list.title') });
      expect(screen.queryByRole('button', { name: k('rules.editNamed') })).toBeNull();
    });
  });
});
