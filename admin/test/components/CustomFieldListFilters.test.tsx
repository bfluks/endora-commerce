import { StrictMode, useEffect, useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CustomFieldListFilters } from '@endora-commerce/admin-kit/components';
import type { CustomFieldFilter, CustomFieldFilters, CustomFieldListFilterField } from '@endora-commerce/contracts';
import { expectNoAxeViolations } from '../helpers/axe';
import { renderWithI18n } from '../helpers/render-with-i18n';
import en from '../../../packages/modules/_i18n/i18n/en.json';
import pl from '../../../packages/modules/_i18n/i18n/pl.json';

/**
 * Feature 157 (T039) — the kit's `CustomFieldListFilters` composite
 * (`specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §1.2):
 * one control per offered field, by value type, rendered in StrictMode against
 * the real `core` bundles.
 */

const EN_BUNDLE = { core: en as Record<string, string> };
const PL_BUNDLE = { core: pl as Record<string, string> };

const FIELDS: CustomFieldListFilterField[] = [
  { key: 'note', valueType: 'text', label: { en: 'Note', pl: 'Notatka' }, labelDefault: 'Note default', options: [] },
  { key: 'weight', valueType: 'number', label: { en: 'Weight' }, labelDefault: 'Weight default', options: [] },
  { key: 'due', valueType: 'date', label: { en: 'Due' }, labelDefault: 'Due default', options: [] },
  { key: 'vip', valueType: 'boolean', label: { en: 'VIP' }, labelDefault: 'VIP default', options: [] },
  {
    key: 'region',
    valueType: 'select',
    label: { en: 'Region', pl: 'Region PL' },
    labelDefault: 'Region default',
    options: [
      { value: 'north', label: { en: 'North', pl: 'Północ' }, labelDefault: 'North default' },
      { value: 'south', label: { en: 'South' }, labelDefault: 'South default' },
      { value: 'east', label: { en: 'East' }, labelDefault: 'East default' },
    ],
  },
  {
    key: 'tags',
    valueType: 'multiselect',
    label: {},
    labelDefault: 'Tags default',
    options: [
      { value: 'a', label: { en: 'Alpha' }, labelDefault: 'Alpha' },
      { value: 'b', label: { en: 'Beta' }, labelDefault: 'Beta' },
    ],
  },
];

type Calls = Array<[string, CustomFieldFilter | null]>;

/** A host that keeps the value, as a list page does, and records every change. */
function Host({ calls, language, initial }: { calls: Calls; language: string; initial?: CustomFieldFilters | undefined }): ReactElement {
  const [value, setValue] = useState<CustomFieldFilters>(initial ?? (Object.create(null) as CustomFieldFilters));
  return (
    <div className="grid">
      <CustomFieldListFilters
        idPrefix="t"
        fields={FIELDS}
        value={value}
        language={language}
        onChange={(key, filter): void => {
          calls.push([key, filter]);
          setValue((prev) => {
            const next = Object.assign(Object.create(null) as CustomFieldFilters, prev);
            if (filter === null) delete next[key];
            else next[key] = filter;
            return next;
          });
        }}
      />
    </div>
  );
}

function renderFilters(language = 'en', initial?: CustomFieldFilters): { calls: Calls; container: HTMLElement } {
  const calls: Calls = [];
  const { container } = renderWithI18n(
    <StrictMode>
      <Host calls={calls} language={language} initial={initial} />
    </StrictMode>,
    language.startsWith('pl') ? PL_BUNDLE : EN_BUNDLE,
  );
  return { calls, container };
}

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A host whose fields arrive later, as a list page's do: the controls first
 * commit outside `act`, so their passive effects run some time after they are
 * on screen.
 */
function LateFieldsHost({ calls, initial }: { calls: Calls; initial: CustomFieldFilters }): ReactElement {
  const [fields, setFields] = useState<CustomFieldListFilterField[] | null>(null);
  const [value, setValue] = useState<CustomFieldFilters>(initial);
  useEffect(() => {
    let alive = true;
    void Promise.resolve(FIELDS).then((loaded) => {
      if (alive) setFields(loaded);
    });
    return (): void => {
      alive = false;
    };
  }, []);
  return (
    <div className="grid">
      <CustomFieldListFilters
        idPrefix="t"
        fields={fields ?? []}
        status={fields === null ? 'loading' : 'ready'}
        value={value}
        language="en"
        onChange={(key, filter): void => {
          calls.push([key, filter]);
          setValue((prev) => {
            const next = Object.assign(Object.create(null) as CustomFieldFilters, prev);
            if (filter === null) delete next[key];
            else next[key] = filter;
            return next;
          });
        }}
      />
    </div>
  );
}

/**
 * Types `text` into the control `id` in the very microtask it first commits —
 * before any passive effect of that commit has run, the earliest a person or a
 * loaded test host's `findBy*` can reach it (issue #524). The commit pause is
 * then on fake timers, so the test steps over it rather than waiting.
 */
function typeTheMomentItAppears(id: string, text: string): Promise<HTMLInputElement> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const input = document.getElementById(id);
      if (!(input instanceof HTMLInputElement)) return;
      observer.disconnect();
      vi.useFakeTimers();
      fireEvent.change(input, { target: { value: text } });
      resolve(input);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

describe('CustomFieldListFilters', () => {
  it('renders one control per field, labelled in the language, then the base language, then labelDefault', () => {
    renderFilters('pl-PL');
    expect(screen.getByLabelText('Notatka')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Weight default' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Due default' })).toBeInTheDocument();
    expect(screen.getByLabelText('VIP default')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Region PL' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tags default' })).toBeInTheDocument();
  });

  it('labels options likewise', async () => {
    const user = userEvent.setup();
    renderFilters('pl');
    await user.click(screen.getByRole('button', { name: 'Region PL' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getByLabelText('Północ')).toBeInTheDocument();
    expect(within(list).getByLabelText('South default')).toBeInTheDocument();
  });

  it('commits text once, after the 300 ms pause', async () => {
    vi.useFakeTimers();
    const { calls } = renderFilters();
    const note = screen.getByLabelText('Note');
    for (const text of ['a', 'ac', 'acm', 'acme']) {
      fireEvent.change(note, { target: { value: text } });
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }
    // 100 ms since the last keystroke; the commit is due 200 ms later.
    expect(calls).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(calls).toEqual([]);
    expect(calls).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(calls).toEqual([['note', { contains: 'acme' }]]);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(calls).toHaveLength(1);
    fireEvent.change(note, { target: { value: '  ' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(calls.at(-1)).toEqual(['note', null]);
  });

  it('accepts a decimal comma for a number, and clearing both bounds sends null', async () => {
    vi.useFakeTimers();
    const { calls } = renderFilters();
    const group = screen.getByRole('group', { name: 'Weight' });
    const [min, max] = within(group).getAllByRole('textbox');
    fireEvent.change(min!, { target: { value: '1,5' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(calls.at(-1)).toEqual(['weight', { min: '1.5' }]);
    fireEvent.change(max!, { target: { value: '9' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(calls.at(-1)).toEqual(['weight', { min: '1.5', max: '9' }]);
    fireEvent.change(max!, { target: { value: 'ten' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // A bound that is not a number yet is not sent; the last filter stands.
    expect(calls.at(-1)).toEqual(['weight', { min: '1.5', max: '9' }]);
    expect(max).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(min!, { target: { value: '' } });
    fireEvent.change(max!, { target: { value: '' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(calls.at(-1)).toEqual(['weight', null]);
  });

  it('sends a date range from/to, and null once both are cleared', () => {
    const { calls } = renderFilters();
    const group = screen.getByRole('group', { name: 'Due' });
    const from = within(group).getByLabelText(/from/i);
    const to = within(group).getByLabelText(/to/i);
    fireEvent.change(from, { target: { value: '2026-01-01' } });
    expect(calls.at(-1)).toEqual(['due', { from: '2026-01-01' }]);
    fireEvent.change(to, { target: { value: '2026-01-31' } });
    expect(calls.at(-1)).toEqual(['due', { from: '2026-01-01', to: '2026-01-31' }]);
    fireEvent.change(from, { target: { value: '' } });
    fireEvent.change(to, { target: { value: '' } });
    expect(calls.at(-1)).toEqual(['due', null]);
  });

  it('maps boolean Any / Yes / No to null / { is: true } / { is: false }', async () => {
    const user = userEvent.setup();
    const { calls } = renderFilters();
    const select = screen.getByLabelText('VIP');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Any', 'Yes', 'No']);
    await user.selectOptions(select, 'Yes');
    expect(calls.at(-1)).toEqual(['vip', { is: true }]);
    await user.selectOptions(select, 'No');
    expect(calls.at(-1)).toEqual(['vip', { is: false }]);
    await user.selectOptions(select, 'Any');
    expect(calls.at(-1)).toEqual(['vip', null]);
  });

  it('sends select and multiselect choices as { in } in the options\' order, and null when cleared', async () => {
    const user = userEvent.setup();
    const { calls } = renderFilters();
    await user.click(screen.getByRole('button', { name: 'Region' }));
    await user.click(screen.getByLabelText('East'));
    await user.click(screen.getByLabelText('North'));
    expect(calls.at(-1)).toEqual(['region', { in: ['north', 'east'] }]);
    await user.click(screen.getByLabelText('North'));
    await user.click(screen.getByLabelText('East'));
    expect(calls.at(-1)).toEqual(['region', null]);
    await user.click(screen.getByRole('button', { name: 'Tags default' }));
    await user.click(screen.getByLabelText('Beta'));
    expect(calls.at(-1)).toEqual(['tags', { in: ['b'] }]);
  });

  it('shows the value it is given, and adopts an outside change', () => {
    const calls: Calls = [];
    const initial = Object.assign(Object.create(null) as CustomFieldFilters, {
      note: { contains: 'acme' },
      weight: { min: '2' },
    });
    const view = renderWithI18n(
      <StrictMode>
        <CustomFieldListFilters idPrefix="t" fields={FIELDS} value={initial} language="en" onChange={(k, f): void => void calls.push([k, f])} />
      </StrictMode>,
      EN_BUNDLE,
    );
    expect(screen.getByLabelText('Note')).toHaveValue('acme');
    expect(within(screen.getByRole('group', { name: 'Weight' })).getAllByRole('textbox')[0]).toHaveValue('2');
    view.rerender(
      <StrictMode>
        <CustomFieldListFilters
          idPrefix="t"
          fields={FIELDS}
          value={Object.create(null) as CustomFieldFilters}
          language="en"
          onChange={(k, f): void => void calls.push([k, f])}
        />
      </StrictMode>,
    );
    expect(screen.getByLabelText('Note')).toHaveValue('');
    expect(calls).toEqual([]);
  });

  it('lays a range out as a column on narrow screens, with a visible label on each bound', () => {
    renderFilters();
    const weight = screen.getByRole('group', { name: 'Weight' });
    expect(weight.className).toContain('flex-col');
    expect(weight.className).toContain('sm:flex-row');
    expect(within(weight).getByText('Min')).toBeVisible();
    expect(within(weight).getByText('Max')).toBeVisible();
    const due = screen.getByRole('group', { name: 'Due' });
    expect(within(due).getByText('From')).toBeVisible();
    expect(within(due).getByText('To')).toBeVisible();
  });

  it('explains a bound that is not a number, linked to the input', () => {
    renderFilters();
    const max = screen.getByLabelText('Weight: Maximum');
    fireEvent.change(max, { target: { value: 'ten' } });
    const message = screen.getByText('Enter a number, e.g. 12.5');
    expect(max).toHaveAttribute('aria-invalid', 'true');
    expect(max.getAttribute('aria-describedby')).toContain(message.id);
  });

  it('refuses an inverted range in place, sending nothing for it', () => {
    vi.useFakeTimers();
    const { calls } = renderFilters();
    fireEvent.change(screen.getByLabelText('Weight: Minimum'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Weight: Maximum'), { target: { value: '1' } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("The minimum can't be greater than the maximum.")).toBeInTheDocument();
    expect(calls.filter(([key]) => key === 'weight')).toEqual([]);
    fireEvent.change(screen.getByLabelText('Due: From'), { target: { value: '2026-03-01' } });
    fireEvent.change(screen.getByLabelText('Due: To'), { target: { value: '2026-02-01' } });
    expect(screen.getByText("The start date can't be after the end date.")).toBeInTheDocument();
    expect(calls.filter(([key]) => key === 'due')).toEqual([['due', { from: '2026-03-01' }]]);
  });

  it('drops a pending commit when the value changes from outside', () => {
    vi.useFakeTimers();
    const calls: Calls = [];
    const props = (value: CustomFieldFilters) => ({
      idPrefix: 't',
      fields: FIELDS,
      value,
      language: 'en',
      onChange: (k: string, f: CustomFieldFilter | null): void => void calls.push([k, f]),
    });
    const view = renderWithI18n(
      <StrictMode>
        <CustomFieldListFilters {...props(Object.create(null) as CustomFieldFilters)} />
      </StrictMode>,
      EN_BUNDLE,
    );
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'abc' } });
    view.rerender(
      <StrictMode>
        <CustomFieldListFilters
          {...props(Object.assign(Object.create(null) as CustomFieldFilters, { note: { contains: 'zzz' } }))}
        />
      </StrictMode>,
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(calls).toEqual([]);
    expect(screen.getByLabelText('Note')).toHaveValue('zzz');
  });

  it('shows a placeholder while the fields load, and on failure a sentence with a retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const base = { idPrefix: 't', fields: [], value: Object.create(null) as CustomFieldFilters, language: 'en', onChange: vi.fn() };
    const view = renderWithI18n(<CustomFieldListFilters {...base} status="loading" onRetry={onRetry} />, EN_BUNDLE);
    expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    view.rerender(<CustomFieldListFilters {...base} status="error" onRetry={onRetry} />);
    const message = screen.getByText('Custom-field filters could not be loaded.');
    expect(message.className).toContain('text-destructive');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('reads “Wszystkie”, “Min.” and “Maks.” in Polish', () => {
    renderFilters('pl');
    expect(within(screen.getByLabelText('VIP default')).getAllByRole('option')[0]).toHaveTextContent('Wszystkie');
    const weight = screen.getByRole('group', { name: 'Weight default' });
    expect(within(weight).getByText('Min.')).toBeVisible();
    expect(within(weight).getByText('Maks.')).toBeVisible();
  });

  it('is reachable by keyboard', async () => {
    const user = userEvent.setup();
    renderFilters();
    await user.tab();
    expect(screen.getByLabelText('Note')).toHaveFocus();
    for (const name of ['Weight: Minimum', 'Weight: Maximum', 'Due: From', 'Due: To']) {
      await user.tab();
      expect(screen.getByLabelText(name)).toHaveFocus();
    }
    await user.tab();
    expect(screen.getByLabelText('VIP')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Region' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it.each([
    ['in StrictMode', true],
    ['outside StrictMode', false],
  ])('commits what is typed the moment a control appears, %s (#524)', async (_, strict) => {
    const calls: Calls = [];
    const initial = Object.assign(Object.create(null) as CustomFieldFilters, { note: { contains: 'acme' } });
    const typed = typeTheMomentItAppears('t-cf-note', '');
    const host = <LateFieldsHost calls={calls} initial={initial} />;
    renderWithI18n(strict ? <StrictMode>{host}</StrictMode> : host, EN_BUNDLE);
    const note = await typed;
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(calls).toEqual([['note', null]]);
    expect(note).toHaveValue('');
    expect(screen.getByLabelText('Note')).toBe(note);
  });

  it('has no axe violations', async () => {
    const { container } = renderFilters();
    await expectNoAxeViolations(container);
  });
});
