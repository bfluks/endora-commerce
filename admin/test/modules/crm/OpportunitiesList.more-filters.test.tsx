import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CustomFieldListFilterField } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { WORKFLOW, crmLookupResponse, renderCrm, summary } from './crm-fixtures';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Feature 157, owner ruling U1 A (2026-10-19) — the Opportunities list's
 * filter panel is always open, so it shows the first three custom-field
 * filters and puts the rest behind a "More filters (n)" disclosure. A hidden
 * field whose filter is active is shown without expanding.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OpportunitiesList } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunitiesList'
);

const LIST_PATH = '/api/v1/admin/crm/opportunities';
const OFFERED_PATH = '/api/v1/admin/crm/opportunities/custom-field-filters';

const NAMES = ['Region', 'Fleet size', 'Industry', 'Source', 'Partner', 'Tier'] as const;

function textField(index: number): CustomFieldListFilterField {
  const name = NAMES[index]!;
  return {
    key: `field_${index + 1}`,
    valueType: 'text',
    label: { en: name, pl: `${name} PL` },
    labelDefault: name,
    options: [],
  };
}

const SIX = NAMES.map((_, index) => textField(index));

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === OFFERED_PATH) return Promise.resolve({ data: SIX });
    if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) {
      return Promise.resolve({ data: [summary()], pagination: { cursor: null, hasMore: false, limit: 20 } });
    }
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * The kit commits a typed filter after a 300 ms pause. A test that waits for
 * that commit on real timers spends the pause plus every `waitFor` poll under
 * StrictMode, which a loaded CI runner stretched past the 5 s test timeout.
 * So the pause is stepped over instead of waited for.
 *
 * Install the fake timers only after the page has rendered and its first
 * `findBy*` has resolved on real timers: installed before `renderList()`, the
 * typed change was observed to be lost (the input kept its old value and no
 * commit followed). `shouldAdvanceTime` keeps the faked clock following the
 * wall clock, because `waitFor` polls on the global `setTimeout`, which vitest
 * fakes — without it the `waitFor` after the step would never poll.
 */
function installSteppedTimers(): void {
  vi.useFakeTimers({ shouldAdvanceTime: true });
}

async function stepPastCommitPause(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

function renderList(path = '/crm/opportunities', language: 'en' | 'pl' = 'en'): ReturnType<typeof renderCrm> {
  return renderCrm(
    <StrictMode>
      <OpportunitiesList />
    </StrictMode>,
    { path, language },
  );
}

function shownLabels(): string[] {
  return NAMES.filter((name) => screen.queryByLabelText(name) !== null);
}

function lastListQuery(): URLSearchParams {
  const path = getSpy.mock.calls
    .map(([called]) => called as string)
    .filter((called) => called === LIST_PATH || called.startsWith(`${LIST_PATH}?`))
    .at(-1)!;
  return new URLSearchParams(path.split('?')[1] ?? '');
}

describe('OpportunitiesList — More filters disclosure (U1 A)', () => {
  it('shows the first three of six offered filters and "More filters (3)"', async () => {
    renderList();
    const more = await screen.findByRole('button', { name: 'More filters (3)' });
    expect(shownLabels()).toEqual(['Region', 'Fleet size', 'Industry']);
    expect(more).toHaveAttribute('aria-expanded', 'false');
    const controlled = more.getAttribute('aria-controls');
    expect(controlled).toBeTruthy();
    expect(document.getElementById(controlled!)).not.toBeNull();
  });

  it('shows all six once expanded and three again once collapsed', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'More filters (3)' }));
    const fewer = screen.getByRole('button', { name: 'Fewer filters' });
    expect(fewer).toHaveAttribute('aria-expanded', 'true');
    expect(shownLabels()).toEqual([...NAMES]);
    fireEvent.click(fewer);
    expect(screen.getByRole('button', { name: 'More filters (3)' })).toHaveAttribute('aria-expanded', 'false');
    expect(shownLabels()).toEqual(['Region', 'Fleet size', 'Industry']);
  });

  it('offers no disclosure when three or fewer fields are offered', async () => {
    getSpy.mockImplementation((path: string) => {
      if (path === OFFERED_PATH) return Promise.resolve({ data: SIX.slice(0, 3) });
      if (path.startsWith(LIST_PATH)) {
        return Promise.resolve({ data: [summary()], pagination: { cursor: null, hasMore: false, limit: 20 } });
      }
      if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
      return crmLookupResponse(path) ?? Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderList();
    await screen.findByLabelText('Industry');
    expect(screen.queryByRole('button', { name: /More filters/ })).toBeNull();
  });

  it('shows an active filter on a hidden field without expanding', async () => {
    renderList('/crm/opportunities?cf.field_5.contains=acme');
    const more = await screen.findByRole('button', { name: 'More filters (2)' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(shownLabels()).toEqual(['Region', 'Fleet size', 'Industry', 'Partner']);
    expect(screen.getByLabelText('Partner')).toHaveValue('acme');
    await waitFor(() =>
      expect(JSON.parse(lastListQuery().get('fieldFilters') ?? 'null')).toEqual({
        'custom:field_5': { contains: 'acme' },
      }),
    );
  });

  it('keeps the filters already visible in place when expanding', async () => {
    renderList('/crm/opportunities?cf.field_5.contains=acme');
    await screen.findByRole('button', { name: 'More filters (2)' });
    const visibleBefore = ['Region', 'Fleet size', 'Industry', 'Partner'].map((name) => screen.getByLabelText(name));
    const inputs = (): HTMLElement[] => NAMES.map((name) => screen.getByLabelText(name));
    fireEvent.click(screen.getByRole('button', { name: 'More filters (2)' }));
    // The same nodes, in the same order, first; the newly shown ones follow.
    for (const input of visibleBefore) expect(input).toBeInTheDocument();
    const order = inputs().sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    expect(order.slice(0, 4)).toEqual(visibleBefore);
  });

  it('does not reorder the grid while expanded when a later filter turns active', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'More filters (3)' }));
    installSteppedTimers();
    const tier = screen.getByLabelText('Tier');
    tier.focus();
    fireEvent.change(tier, { target: { value: 'gold' } });
    await stepPastCommitPause();
    await waitFor(() =>
      expect(JSON.parse(lastListQuery().get('fieldFilters') ?? 'null')).toEqual({
        'custom:field_6': { contains: 'gold' },
      }),
    );
    expect(screen.getByLabelText('Tier')).toBe(tier);
    expect(tier).toHaveFocus();
    const inputs = NAMES.map((name) => screen.getByLabelText(name));
    const order = [...inputs].sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    expect(order).toEqual(inputs);
    // Collapsing keeps the now-active field on screen.
    fireEvent.click(screen.getByRole('button', { name: 'Fewer filters' }));
    expect(shownLabels()).toEqual(['Region', 'Fleet size', 'Industry', 'Tier']);
    expect(screen.getByRole('button', { name: 'More filters (2)' })).toBeInTheDocument();
  });

  it('keeps a field shown while its filter is cleared, collapsed', async () => {
    renderList('/crm/opportunities?cf.field_5.contains=acme');
    const partner = await screen.findByLabelText('Partner');
    installSteppedTimers();
    fireEvent.change(partner, { target: { value: '' } });
    await stepPastCommitPause();
    await waitFor(() => expect(lastListQuery().get('fieldFilters')).toBeNull());
    expect(screen.getByLabelText('Partner')).toBe(partner);
  });

  it('clears a filter cleared the moment it appears (#524)', async () => {
    // The field appears when the offered fields load; clearing it in that very
    // commit, before its passive effects run, is what a loaded host's
    // `findByLabelText` did once — and the clear was lost.
    const cleared = new Promise<HTMLInputElement>((resolve) => {
      const observer = new MutationObserver(() => {
        const input = document.getElementById('crm-opportunity-cf-field_5');
        if (!(input instanceof HTMLInputElement)) return;
        observer.disconnect();
        installSteppedTimers();
        fireEvent.change(input, { target: { value: '' } });
        resolve(input);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    renderList('/crm/opportunities?cf.field_5.contains=acme');
    const partner = await cleared;
    await stepPastCommitPause();
    await waitFor(() => expect(lastListQuery().get('fieldFilters')).toBeNull());
    expect(partner).toHaveValue('');
    expect(screen.getByLabelText('Partner')).toBe(partner);
  });

  it('is a real button operable from the keyboard', async () => {
    const user = userEvent.setup();
    renderList();
    const more = await screen.findByRole('button', { name: 'More filters (3)' });
    expect(more.tagName).toBe('BUTTON');
    expect(more).toHaveAttribute('type', 'button');
    more.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Fewer filters' })).toHaveFocus();
    expect(shownLabels()).toEqual([...NAMES]);
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'More filters (3)' })).toHaveFocus();
    expect(shownLabels()).toEqual(['Region', 'Fleet size', 'Industry']);
  });

  it('has no axe violations collapsed or expanded', async () => {
    const { container } = renderList();
    await screen.findByRole('button', { name: 'More filters (3)' });
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole('button', { name: 'More filters (3)' }));
    await expectNoAxeViolations(container);
  });

  it('speaks Polish', async () => {
    renderList('/crm/opportunities', 'pl');
    fireEvent.click(await screen.findByRole('button', { name: 'Więcej filtrów (3)' }));
    expect(screen.getByRole('button', { name: 'Mniej filtrów' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Tier PL')).toBeInTheDocument();
  });
});
