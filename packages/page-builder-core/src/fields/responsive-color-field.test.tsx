// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStoredScope } from '../editor/settings-scope-store.js';
import { fieldTabForName } from '../editor/field-tabs.js';
import { isResponsiveField } from '../types/responsive.js';
import { createColorField, createResponsiveColorField } from './color-field.js';

/**
 * `specs/163-page-builder-marketing-pages/` T181 (R13) — a colour per
 * breakpoint, for a block's top-level colour prop (`cms.LinkTile`'s resting
 * title and label colour). A **responsive** field, as the aspect-ratio field
 * is: the responsive metadata puts it on the Responsive tab, and it edits the
 * breakpoint that tab's scope switcher selects.
 *
 * A colour has no default: a breakpoint set first is stored without a base
 * (T170: below it, the block's own look), a value with only its base is
 * stored plain — what the single colour field writes — and clearing the last
 * value writes nothing.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const SELECTED = 'pb163-colour-under-test';
vi.mock('../editor/use-page-builder-puck.js', () => ({
  usePageBuilderPuck: (selector: (state: unknown) => unknown) =>
    selector({ selectedItem: { type: 'cms.LinkTile', props: { id: SELECTED } }, appState: { ui: {} } }),
}));

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  act(() => setStoredScope(SELECTED, 'base'));
});

function mount<V>(field: { render: unknown }, initial?: V): { value: () => V | undefined } {
  let current = initial;
  const onChange = vi.fn((next: V) => {
    current = next;
    render();
  });
  const Render = field.render as unknown as ComponentType<Record<string, unknown>>;
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const render = (): void => {
    act(() => root!.render(<Render field={field} name="f" id="f" value={current} onChange={onChange} />));
  };
  render();
  return { value: () => current };
}

function textBox(label: string): HTMLInputElement {
  const element = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="text"]')).find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (!element) throw new Error(`no text box "${label}"`);
  return element;
}

function type(element: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  act(() => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function scope(next: 'base' | 'tablet' | 'desktop'): void {
  act(() => setStoredScope(SELECTED, next));
}

describe('createResponsiveColorField (T181)', () => {
  it('carries the responsive metadata, so the editor puts it on the Responsive tab; the single colour field does not', () => {
    const field = createResponsiveColorField({ label: 'Title color' });
    expect(field.label).toBe('Title color');
    expect(isResponsiveField(field)).toBe(true);
    expect(fieldTabForName('titleColor', field as never)).toBe('responsive');
    expect(isResponsiveField(createColorField({ label: 'Title color' }))).toBe(false);
  });

  it('writes the base plain, as the single colour field does, and a breakpoint as its own override', () => {
    const { value } = mount<unknown>(createResponsiveColorField({ label: 'Title color' }));
    type(textBox('Title color'), '#ffffff');
    expect(value()).toBe('#ffffff');

    scope('desktop');
    // The breakpoint has no colour of its own: an empty box and the colour it inherits.
    expect(textBox('Title color').value).toBe('');
    expect(document.body.textContent).toContain('Inherit (#ffffff)');
    type(textBox('Title color'), '#334155');
    expect(value()).toEqual({ base: '#ffffff', desktop: '#334155' });
    expect(textBox('Title color').value).toBe('#334155');

    // Clearing the breakpoint's own colour inherits again; only the base is left, stored plain.
    type(textBox('Title color'), '');
    expect(value()).toBe('#ffffff');
  });

  it('a breakpoint set first is stored without a base (the block\'s own look below it)', () => {
    const { value } = mount<unknown>(createResponsiveColorField({ label: 'Title color' }));
    scope('tablet');
    type(textBox('Title color'), '#1d4ed8');
    expect(value()).toEqual({ tablet: '#1d4ed8' });
    scope('desktop');
    expect(document.body.textContent).toContain('Inherit (#1d4ed8)');
    scope('base');
    expect(textBox('Title color').value).toBe('');
    expect(document.body.textContent).not.toContain('Inherit');
    scope('tablet');
    type(textBox('Title color'), '');
    expect(value()).toBeUndefined();
  });

  it('reads a single stored colour as the base, and writes nothing until an edit', () => {
    mount<unknown>(createResponsiveColorField({ label: 'Title color' }), '#475569');
    expect(textBox('Title color').value).toBe('#475569');
    act(() => root?.unmount());
    const { value } = mount<unknown>(createResponsiveColorField({ label: 'Title color' }));
    expect(value()).toBeUndefined();
  });
});
