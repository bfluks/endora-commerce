// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStoredScope } from '../editor/settings-scope-store.js';
import { fieldTabForName } from '../editor/field-tabs.js';
import { isResponsiveField } from '../types/responsive.js';
import { ASPECT_TOKENS } from '../types/page-builder-props.js';
import { createAspectRatioField } from './aspect-ratio-field.js';

/**
 * `specs/163-page-builder-marketing-pages/` T126, T127 — an aspect ratio per
 * breakpoint as a top-level prop (`cms.Video.aspectRatio`, `cms.Image.ratio`).
 * A **responsive** field, as `createSectionSpaceField` is (T117): it carries
 * the responsive metadata, so the editor shows it on the Responsive tab, and
 * it edits the breakpoint that tab's scope switcher selects. A preset aspect
 * token, or **Custom** with a `w:h` of whole numbers (1–100).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const SELECTED = 'pb163-ratio-under-test';
vi.mock('../editor/use-page-builder-puck.js', () => ({
  usePageBuilderPuck: (selector: (state: unknown) => unknown) =>
    selector({ selectedItem: { type: 'cms.Video', props: { id: SELECTED } }, appState: { ui: {} } }),
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

function control<T extends HTMLElement>(label: string): T {
  const element = Array.from(document.querySelectorAll<HTMLElement>('[aria-label]')).find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (!element) throw new Error(`no control "${label}"`);
  return element as T;
}

function change(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  act(() => {
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

function scope(next: 'base' | 'tablet' | 'desktop'): void {
  act(() => setStoredScope(SELECTED, next));
}

describe('createAspectRatioField (T126, T127)', () => {
  it('carries the responsive metadata, so the editor puts it on the Responsive tab', () => {
    const field = createAspectRatioField({ label: 'Aspect ratio', defaultRatio: '16:9' });
    expect(isResponsiveField(field)).toBe(true);
    expect(fieldTabForName('aspectRatio', field as never)).toBe('responsive');
  });

  it('offers every aspect token and Custom; without `auto` where the medium has no ratio of its own', () => {
    mount(createAspectRatioField({ label: 'Ratio', defaultRatio: 'auto' }));
    const withAuto = Array.from(control<HTMLSelectElement>('Ratio').options).map((o) => o.value);
    expect(withAuto).toEqual([...ASPECT_TOKENS, 'custom']);
    expect(control<HTMLSelectElement>('Ratio').value).toBe('auto');
    act(() => root?.unmount());

    mount(createAspectRatioField({ label: 'Aspect ratio', defaultRatio: '16:9', allowAuto: false }));
    const noAuto = Array.from(control<HTMLSelectElement>('Aspect ratio').options).map((o) => o.value);
    expect(noAuto).toEqual([...ASPECT_TOKENS.filter((t) => t !== 'auto'), 'custom']);
    // The default shows until a value is set.
    expect(control<HTMLSelectElement>('Aspect ratio').value).toBe('16:9');
  });

  it('writes the base plain and each breakpoint the scope selects as its own override', () => {
    const { value } = mount<unknown>(createAspectRatioField({ label: 'Aspect ratio', defaultRatio: '16:9', allowAuto: false }));
    change(control<HTMLSelectElement>('Aspect ratio'), '1:1');
    expect(value()).toBe('1:1');

    scope('desktop');
    expect(control<HTMLSelectElement>('Aspect ratio').value).toBe('');
    expect(control<HTMLSelectElement>('Aspect ratio').options[0]?.textContent).toBe('Inherit (1:1)');
    change(control<HTMLSelectElement>('Aspect ratio'), '21:9');
    expect(value()).toEqual({ base: '1:1', desktop: '21:9' });

    change(control<HTMLSelectElement>('Aspect ratio'), '');
    expect(value()).toBe('1:1');
  });

  it('seeds the base with the default when a breakpoint is set first', () => {
    const { value } = mount<unknown>(createAspectRatioField({ label: 'Aspect ratio', defaultRatio: '16:9', allowAuto: false }));
    scope('tablet');
    change(control<HTMLSelectElement>('Aspect ratio'), '4:3');
    expect(value()).toEqual({ base: '16:9', tablet: '4:3' });
  });

  it('takes a custom w:h for the breakpoint being edited, and only a valid one', () => {
    const { value } = mount<unknown>(createAspectRatioField({ label: 'Aspect ratio', defaultRatio: '16:9', allowAuto: false }));
    scope('desktop');
    change(control<HTMLSelectElement>('Aspect ratio'), 'custom');
    const input = control<HTMLInputElement>('Aspect ratio (w:h)');
    change(input, '67:0');
    expect(value()).toBeUndefined();
    change(input, '67:20');
    expect(value()).toEqual({ base: '16:9', desktop: '67:20' });
    // A stored custom value shows as Custom with its text.
    expect(control<HTMLSelectElement>('Aspect ratio').value).toBe('custom');
    expect(control<HTMLInputElement>('Aspect ratio (w:h)').value).toBe('67:20');
  });

  it('writes nothing until an edit', () => {
    const { value } = mount<unknown>(createAspectRatioField({ label: 'Aspect ratio', defaultRatio: '16:9' }));
    expect(value()).toBeUndefined();
  });
});
