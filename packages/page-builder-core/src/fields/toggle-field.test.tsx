// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStoredScope } from '../editor/settings-scope-store.js';
import { PB_RESPONSIVE_METADATA } from '../types/responsive.js';
import { createToggleField } from './toggle-field.js';

const SELECTED = 'pb163-r17-toggle';
vi.mock('../editor/use-page-builder-puck.js', () => ({
  usePageBuilderPuck: (selector: (state: unknown) => unknown) =>
    selector({ selectedItem: { type: 'catalog.ProductGrid', props: { id: SELECTED } }, appState: { ui: {} } }),
}));

/**
 * `specs/163-page-builder-marketing-pages/` R17 (T199) — one control for every
 * true/false setting of a block: a switch. It stores the same booleans the
 * Yes/No radios stored, shows the block's render default while the prop is
 * unset, and is operable by pointer (the switch or its label) and keyboard.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  act(() => setStoredScope(SELECTED, 'base'));
});

function mount(field: { render: unknown; label?: string }, initial: unknown, readOnly = false) {
  let current = initial;
  const onChange = vi.fn((next: unknown) => {
    current = next;
    render();
  });
  const Render = field.render as unknown as ComponentType<Record<string, unknown>>;
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const render = (): void => {
    act(() =>
      root!.render(<Render field={field} name="f" id="f" value={current} onChange={onChange} readOnly={readOnly} />),
    );
  };
  render();
  const toggle = (): HTMLButtonElement => host.querySelector('[role="switch"]') as HTMLButtonElement;
  return { host, toggle, onChange, value: () => current };
}

describe('createToggleField (T199)', () => {
  it('is a custom field carrying its label and any metadata', () => {
    const field = createToggleField({ label: 'Loop at the ends', metadata: { pageBuilder: { responsive: true } } });
    expect(field.type).toBe('custom');
    expect(field.label).toBe('Loop at the ends');
    expect((field as { metadata?: unknown }).metadata).toEqual({ pageBuilder: { responsive: true, toggle: true } });
  });

  it('renders a named switch whose state is the stored boolean', () => {
    const { toggle } = mount(createToggleField({ label: 'Show arrows' }), true);
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(toggle().type).toBe('button');
    expect(toggle().getAttribute('aria-label')).toBe('Show arrows');
    expect(toggle().closest('label')?.textContent).toBe('Show arrows');
  });

  it('shows the block\'s default while the prop is unset, and stores booleans only', () => {
    const on = mount(createToggleField({ label: 'Loop', defaultValue: true }), undefined);
    expect(on.toggle().getAttribute('aria-checked')).toBe('true');
    act(() => on.toggle().click());
    expect(on.onChange).toHaveBeenLastCalledWith(false);
    act(() => root?.unmount());
    root = null;
    const off = mount(createToggleField({ label: 'Autoplay' }), undefined);
    expect(off.toggle().getAttribute('aria-checked')).toBe('false');
    act(() => off.toggle().click());
    expect(off.onChange).toHaveBeenLastCalledWith(true);
    expect(off.toggle().getAttribute('aria-checked')).toBe('true');
  });

  it('toggles from its visible label too', () => {
    const { host, onChange } = mount(createToggleField({ label: 'Striped rows' }), false);
    const label = host.querySelector('label') as HTMLLabelElement;
    act(() => label.click());
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('is a native button, so Space and Enter operate it, and it is disabled when read-only', () => {
    const { toggle } = mount(createToggleField({ label: 'Muted' }), false, true);
    expect(toggle().tagName).toBe('BUTTON');
    expect(toggle().disabled).toBe(true);
  });

  it('uses the translated label the host hands it', () => {
    const field = createToggleField({ label: 'Show arrows' });
    const { toggle } = mount({ ...field, label: 'Pokaż strzałki' }, false);
    expect(toggle().getAttribute('aria-label')).toBe('Pokaż strzałki');
  });
});

describe('createToggleField per breakpoint (T199, T219)', () => {
  const field = (): ReturnType<typeof createToggleField> =>
    createToggleField({ label: 'Equal items height', defaultValue: true, metadata: PB_RESPONSIVE_METADATA });

  it('a plain stored boolean is every breakpoint\'s; a change at a larger breakpoint stores one per breakpoint', () => {
    const mounted = mount(field(), false);
    expect(mounted.toggle().getAttribute('aria-checked')).toBe('false');
    act(() => setStoredScope(SELECTED, 'desktop'));
    expect(mounted.toggle().getAttribute('aria-checked')).toBe('false');
    act(() => mounted.toggle().click());
    expect(mounted.value()).toEqual({ base: false, desktop: true });
  });

  it('unset, shows the block\'s default at every breakpoint and stores plain on the phone\'s', () => {
    const mounted = mount(field(), undefined);
    expect(mounted.toggle().getAttribute('aria-checked')).toBe('true');
    act(() => mounted.toggle().click());
    expect(mounted.value()).toBe(false);
  });
});
