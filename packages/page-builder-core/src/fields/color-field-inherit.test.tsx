// @vitest-environment jsdom
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createColorField } from './color-field.js';
import { colorFieldDisplayValue, isInheritedColor } from './color-field-utils.js';
import { PageBuilderFieldTextProvider } from './field-text.js';

/**
 * `specs/163-page-builder-marketing-pages/` R18 (T222) — a colour that inherits
 * the surrounding text colour (`currentColor`, the stored default of a new
 * `cms.Icons` / `cms.Social`) shows as an **Inherited (text color)** state —
 * an empty box with that placeholder and a swatch marked as inherited — never
 * as the literal `currentColor`. Picking a colour sets it; **Inherit** (and
 * clearing the box) returns to `currentColor` in a field that inherits. The
 * stored values are unchanged: `currentColor` is read and written as before.
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
});

function mount(
  field: { render: unknown },
  initial?: string,
  resolve?: (key: string) => string | undefined,
): { value: () => string | undefined; onChange: ReturnType<typeof vi.fn> } {
  let current = initial;
  const onChange = vi.fn((next: string | undefined) => {
    current = next;
    render();
  });
  const Render = field.render as unknown as ComponentType<Record<string, unknown>>;
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const render = (): void => {
    const element = <Render field={field} name="color" id="color" value={current} onChange={onChange} />;
    act(() => root!.render(resolve ? <PageBuilderFieldTextProvider resolve={resolve as never}>{element}</PageBuilderFieldTextProvider> : element));
  };
  render();
  return { value: () => current, onChange };
}

function textBox(): HTMLInputElement {
  const element = document.querySelector<HTMLInputElement>('input[type="text"]');
  if (!element) throw new Error('no text box');
  return element;
}

function type(element: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
  act(() => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function button(name: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll('button')).find((candidate) => candidate.textContent === name) ?? null;
}

describe('an inherited colour (R18, T222)', () => {
  it('recognises `currentColor` and `inherit`, and displays them as an empty box', () => {
    expect(isInheritedColor('currentColor')).toBe(true);
    expect(isInheritedColor('currentcolor')).toBe(true);
    expect(isInheritedColor('inherit')).toBe(true);
    expect(isInheritedColor('#15202b')).toBe(false);
    expect(isInheritedColor(undefined)).toBe(false);
    expect(colorFieldDisplayValue('currentColor')).toBe('');
    expect(colorFieldDisplayValue('inherit')).toBe('');
  });

  it('shows `currentColor` as "Inherited (text color)" with an inherited swatch, never the raw word', () => {
    mount(createColorField({ label: 'Color', inherit: true }), 'currentColor');
    expect(textBox().value).toBe('');
    expect(textBox().placeholder).toBe('Inherited (text color)');
    expect(document.querySelector('[data-pb-color-row]')?.hasAttribute('data-pb-color-inherited')).toBe(true);
    expect(document.querySelector('[data-pb-color-swatch-inherited]')).not.toBeNull();
    expect(document.body.innerHTML).not.toContain('currentColor');
    // Already inherited: no Inherit action.
    expect(button('Inherit')).toBeNull();
  });

  it('picking a colour sets it; Inherit returns to `currentColor`', () => {
    const { value } = mount(createColorField({ label: 'Color', inherit: true }), 'currentColor');
    type(textBox(), '#1d4ed8');
    expect(value()).toBe('#1d4ed8');
    expect(document.querySelector('[data-pb-color-row]')?.hasAttribute('data-pb-color-inherited')).toBe(false);
    const inherit = button('Inherit');
    expect(inherit).not.toBeNull();
    expect(inherit!.getAttribute('aria-label')).toBe('Color — inherit the text color');
    act(() => inherit!.click());
    expect(value()).toBe('currentColor');
    expect(textBox().value).toBe('');
  });

  it('clearing the box of a field that inherits returns to `currentColor`', () => {
    const { value } = mount(createColorField({ label: 'Color', inherit: true }), '#1d4ed8');
    type(textBox(), '');
    expect(value()).toBe('currentColor');
  });

  it('a field that does not inherit clears to nothing, as before, and offers no Inherit action', () => {
    const { value } = mount(createColorField({ label: 'Background color' }), '#1d4ed8');
    expect(button('Inherit')).toBeNull();
    expect(textBox().placeholder).toBe('transparent');
    type(textBox(), '');
    expect(value()).toBeUndefined();
  });

  it('a stored `currentColor` in a field that does not inherit still reads as inherited, not as the raw word', () => {
    mount(createColorField({ label: 'Color' }), 'currentColor');
    expect(textBox().value).toBe('');
    expect(textBox().placeholder).toBe('Inherited (text color)');
  });

  it('reads its words from the host', () => {
    const words: Record<string, string> = {
      'color.inherited': 'Dziedziczony (kolor tekstu)',
      'color.inherit': 'Dziedzicz',
      'color.inheritFor': '{label} — dziedzicz kolor tekstu',
      'color.transparent': 'przezroczysty',
    };
    mount(createColorField({ label: 'Kolor', inherit: true }), '#1d4ed8', (key) => words[key]);
    expect(button('Dziedzicz')?.getAttribute('aria-label')).toBe('Kolor — dziedzicz kolor tekstu');
    expect(textBox().placeholder).toBe('przezroczysty');
    act(() => button('Dziedzicz')!.click());
    expect(textBox().placeholder).toBe('Dziedziczony (kolor tekstu)');
  });
});
