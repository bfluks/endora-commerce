import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import type { OrganizationSalesChannelsResponse } from '@endora-commerce/contracts';
import { adminSession, renderWithSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * `specs/154-sales-channel-access/` T062 — the Organization's *Sales channels*
 * panel (contracts/admin-api-and-ui.md §2, US5).
 *
 * The stores an Organization's members may sign in and shop on, edited on the
 * Organization's own page with the customer permissions: every channel offered,
 * an inactive one suffixed and the system default badged; *Save* only once the
 * selection differs from what is stored, and never for an empty selection —
 * which says why; and a read-only list for an operator without
 * `customers:manage`.
 */

const getSpy = vi.fn();
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
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { SalesChannelsPanel } = await import(
  '../../../../packages/modules/organizations/src/admin/panels/SalesChannelsPanel'
);

const enPath = resolve(process.cwd(), '../packages/modules/organizations/i18n/en.json');
const en = JSON.parse(readFileSync(enPath, 'utf8')) as Record<string, string>;
const pl = JSON.parse(readFileSync(enPath.replace('en.json', 'pl.json'), 'utf8')) as Record<
  string,
  string
>;
const bundle = { organizations: en };

const ORG = '00000000-0000-4000-8000-0000000000aa';
const RETAIL = '00000000-0000-4000-8000-00000000c001';
const TRADE = '00000000-0000-4000-8000-00000000c002';
const ARCHIVE = '00000000-0000-4000-8000-00000000c003';

function response(assigned: string[]): OrganizationSalesChannelsResponse {
  return {
    data: {
      organizationId: ORG,
      assignedSalesChannelIds: assigned,
      options: [
        { id: RETAIL, code: 'retail', name: { 'en-US': 'Retail' }, active: true, systemDefault: true },
        { id: TRADE, code: 'trade', name: { 'en-US': 'Trade' }, active: true, systemDefault: false },
        { id: ARCHIVE, code: 'archive', name: { 'en-US': 'Archive' }, active: false, systemDefault: false },
      ],
    },
  };
}

function renderPanel(permissions: readonly string[]) {
  return renderWithSession(
    <StrictMode>
      <SalesChannelsPanel organizationId={ORG} />
    </StrictMode>,
    { session: adminSession({ permissions }), bundle },
  );
}

function box(name: RegExp): HTMLInputElement {
  return screen.getByRole('checkbox', { name });
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: en['salesChannels.save']! });
}

beforeEach(() => {
  getSpy.mockReset();
  putSpy.mockReset();
  getSpy.mockResolvedValue(response([RETAIL]));
});

describe('bundle', () => {
  it('ships the panel keys in English and Polish', () => {
    for (const key of [
      'salesChannels.title',
      'salesChannels.description',
      'salesChannels.atLeastOne',
      'salesChannels.inactiveSuffix',
      'salesChannels.systemDefault',
      'salesChannels.save',
    ]) {
      expect(en[key], key).toBeTruthy();
      expect(pl[key], key).toBeTruthy();
    }
    expect(en['salesChannels.atLeastOne']).toBe(
      'An organization must be assigned at least one sales channel.',
    );
  });
});

describe('SalesChannelsPanel — with customers:manage', () => {
  it('offers every channel, the inactive one suffixed and the default badged', async () => {
    const { container } = renderPanel(['customers:manage']);
    await waitFor(() => expect(box(/Retail/).checked).toBe(true));
    expect(getSpy).toHaveBeenCalledWith(`/api/v1/admin/organizations/${ORG}/sales-channels`);
    expect(box(/Trade/).checked).toBe(false);
    const archive = box(/Archive/);
    expect(archive.labels?.[0]?.textContent).toContain(en['salesChannels.inactiveSuffix']);
    expect(box(/Retail/).closest('[data-sales-channel-option]')?.textContent).toContain(en['salesChannels.systemDefault']);
    expect(box(/Trade/).closest('[data-sales-channel-option]')?.textContent).not.toContain(en['salesChannels.systemDefault']);
    await expectNoAxeViolations(container);
  });

  it('keeps Save disabled until the selection changes', async () => {
    renderPanel(['customers:manage']);
    await waitFor(() => expect(box(/Retail/).checked).toBe(true));
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(box(/Trade/));
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(box(/Trade/));
    expect(saveButton().disabled).toBe(true);
  });

  it('refuses an empty selection and says why', async () => {
    renderPanel(['customers:manage']);
    await waitFor(() => expect(box(/Retail/).checked).toBe(true));
    expect(screen.queryByText(en['salesChannels.atLeastOne']!)).toBeNull();
    fireEvent.click(box(/Retail/));
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toBe(en['salesChannels.atLeastOne']);
  });

  it('saves the whole set and shows what the server stored', async () => {
    putSpy.mockResolvedValue(response([RETAIL, TRADE]));
    renderPanel(['customers:manage']);
    await waitFor(() => expect(box(/Retail/).checked).toBe(true));
    fireEvent.click(box(/Trade/));
    fireEvent.click(saveButton());
    await waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
    expect(putSpy).toHaveBeenCalledWith(`/api/v1/admin/organizations/${ORG}/sales-channels`, {
      salesChannelIds: [RETAIL, TRADE],
    });
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(box(/Trade/).checked).toBe(true);
  });
});

describe('SalesChannelsPanel — read only', () => {
  it('lists the assigned channels without controls for customers:read', async () => {
    getSpy.mockResolvedValue(response([RETAIL, ARCHIVE]));
    const { container } = renderPanel(['customers:read']);
    await waitFor(() => expect(screen.getByText(/Retail/)).toBeTruthy());
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: en['salesChannels.save']! })).toBeNull();
    expect(screen.getByText(/Archive/).textContent).toContain(en['salesChannels.inactiveSuffix']);
    expect(screen.queryByText(/Trade/)).toBeNull();
    await expectNoAxeViolations(container);
  });
});

describe('the host', () => {
  it('renders the panel on the Organization page, and sales_channels no longer contributes there', async () => {
    const host = readFileSync(
      resolve(process.cwd(), '../packages/modules/organizations/src/admin/pages/OrganizationDetail.tsx'),
      'utf8',
    );
    expect(host).toContain('<SalesChannelsPanel organizationId={org.id} />');
    expect(host).not.toContain('EntityChannelMembership');
    const salesChannels = await import('@endora-commerce/mod-sales-channels/admin');
    expect(
      (salesChannels.contributions.zones ?? []).some((zone) => zone.zone === 'organization.detail.after'),
    ).toBe(false);
  });
});
