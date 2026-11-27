// @vitest-environment jsdom
import { act, type ComponentType, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStoredScope } from '../editor/settings-scope-store.js';
import { PB_RESPONSIVE_METADATA } from '../types/responsive.js';
import { createBorderField } from './border-field.js';
import { PAGE_BUILDER_FIELD_TEXT, PageBuilderFieldTextProvider, type PageBuilderFieldTextKey } from './field-text.js';
import { renderResponsiveNumberField, renderResponsiveSelectField } from './responsive-field-types.js';
import { createSpacingField } from './spacing-field.js';

/**
 * `specs/163-page-builder-marketing-pages/` R17 (T201, T202) — the words
 * inside the page builder's own controls (spacing, border, the per-breakpoint
 * hints) come from the host's translation like every other field text, and a
 * border side names its width, style and colour.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const SELECTED = 'pb163-r17-copy';
vi.mock('../editor/use-page-builder-puck.js', () => ({
  usePageBuilderPuck: (selector: (state: unknown) => unknown) =>
    selector({ selectedItem: { type: 'cms.Row', props: { id: SELECTED } }, appState: { ui: {} } }),
}));

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  act(() => setStoredScope(SELECTED, 'base'));
});

/**
 * Every key answered as `«key»`, so English left in the markup is copy the host
 * cannot translate; a template keeps its placeholders, so what fills it shows.
 */
const translated = (key: PageBuilderFieldTextKey): string =>
  [`«${key}»`, ...(PAGE_BUILDER_FIELD_TEXT[key].match(/\{\w+\}/g) ?? [])].join(' ');

function mount(node: ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<PageBuilderFieldTextProvider resolve={translated}>{node}</PageBuilderFieldTextProvider>));
  return host;
}

function renderField(field: object, value: unknown): ReactElement {
  const Render = (field as { render: unknown }).render as unknown as ComponentType<Record<string, unknown>>;
  return <Render field={field} name="f" id="f" value={value} onChange={() => undefined} />;
}

/** The English strings these controls used to spell out. */
const ENGLISH = [
  'All sides',
  'Each side',
  'Show border',
  'Solid',
  'Dashed',
  'Dotted',
  'Inherited value shown',
  'Reset to inherited',
  'Applies:',
  'top',
  'right',
  'bottom',
  'left',
];

/** Every text node and option of the markup, checked one by one (concatenated text would hide a word). */
function englishIn(host: HTMLElement): string[] {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const texts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push((node.textContent ?? '').trim());
  return ENGLISH.filter((word) => texts.some((text) => text === word || text.startsWith(`${word} `)));
}

describe('the controls\' copy is the host\'s (T201)', () => {
  it('spacing: modes and sides', () => {
    const host = mount(renderField(createSpacingField({ label: 'Outer spacing' }), { mode: 'sides', top: 0, right: 4, bottom: 8, left: 0 }));
    expect(englishIn(host)).toEqual([]);
    expect(host.textContent).toContain('«spacing.uniform»');
    expect(host.textContent).toContain('«side.top»');
  });

  it('border: the switch, the modes, the sides and the styles', () => {
    const host = mount(renderField(createBorderField(), { mode: 'sides', top: { width: 1, style: 'solid', color: '#000000' }, right: { width: 1, style: 'dashed', color: '#000000' }, bottom: { width: 1, style: 'dotted', color: '#000000' }, left: { width: 1, style: 'solid', color: '#000000' } }));
    expect(englishIn(host)).toEqual([]);
    expect(host.textContent).toContain('«border.show»');
    expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
  });

  it('a breakpoint\'s inherited hint and reset', () => {
    act(() => setStoredScope(SELECTED, 'tablet'));
    const numberField = { type: 'number', label: 'Gap', min: 0, metadata: PB_RESPONSIVE_METADATA };
    const host = mount(
      <>
        {renderResponsiveNumberField({ name: 'gap', field: numberField, value: 8, onChange: () => undefined, children: null } as never)}
        {renderResponsiveSelectField({
          name: 'align',
          field: { type: 'select', label: 'Align', options: [{ label: 'L', value: 'left' }], metadata: PB_RESPONSIVE_METADATA },
          value: { base: 'left', tablet: 'left' },
          onChange: () => undefined,
          children: null,
        } as never)}
      </>,
    );
    expect(englishIn(host)).toEqual([]);
    expect(host.textContent).toContain('«scope.inherited»');
    expect(host.textContent).toContain('«scope.reset»');
  });
});

describe('a border side names its width, style and colour (T202)', () => {
  it('shows small labels over the three controls and names each control', () => {
    const host = mount(renderField(createBorderField(), { mode: 'uniform', width: 2, style: 'solid', color: '#112233' }));
    for (const key of ['border.width', 'border.style', 'border.color'] as const) {
      expect(host.textContent).toContain(`«${key}»`);
    }
    const width = host.querySelector('input[type="number"]') as HTMLInputElement;
    const style = host.querySelector('select') as HTMLSelectElement;
    expect(width.getAttribute('aria-label')).toBe('«border.width»');
    expect(style.getAttribute('aria-label')).toBe('«border.style»');
    expect(host.querySelector('input[type="color"]')?.getAttribute('aria-label')).toBe('«border.color»');
  });

  it('names a side\'s controls with the side in the "each side" mode', () => {
    const side = { width: 1, style: 'solid', color: '#000000' };
    const host = mount(renderField(createBorderField(), { mode: 'sides', top: side, right: side, bottom: side, left: side }));
    const labels = Array.from(host.querySelectorAll('input[type="number"]')).map((input) => input.getAttribute('aria-label'));
    expect(labels).toEqual(
      ['top', 'right', 'bottom', 'left'].map((side) => `«side.control» «side.${side}» «border.width»`),
    );
  });

  it('ships an English default for every key it reads', () => {
    for (const key of ['border.width', 'border.style', 'border.color', 'border.show', 'side.top', 'spacing.uniform', 'scope.inherited', 'scope.reset'] as const) {
      expect(PAGE_BUILDER_FIELD_TEXT[key]).toBeTruthy();
    }
  });
});
