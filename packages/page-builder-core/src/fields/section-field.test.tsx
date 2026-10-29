// @vitest-environment jsdom
import { act, type ComponentType, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setStoredScope } from '../editor/settings-scope-store.js';
import { fieldTabForName } from '../editor/field-tabs.js';
import { isResponsiveField } from '../types/responsive.js';
import {
  createSectionAnchorField,
  createSectionBackgroundField,
  createSectionRevealField,
  createSectionSpaceField,
  isSectionBackgroundField,
  type SectionAssetInputProps,
  type SectionBackgroundField,
} from './section-field.js';

/**
 * `specs/163-page-builder-marketing-pages/` FR-000–FR-004, research R-8, R-9,
 * T117 — the custom fields of `cms.Section`'s flat props. Each is one
 * top-level prop: `background` (solid, gradient, image or video, with art
 * direction, an overlay and the decorative backdrop), `anchor` (normalised as
 * you type), `reveal`, and `spaceTop` / `spaceBottom`, which are **responsive**
 * fields: they carry the responsive metadata, so the editor puts them on its
 * Responsive tab and they edit the breakpoint chosen in that tab's scope
 * switcher, as `cms.Row`'s fields do — no switch of their own.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no
// ResizeObserver, and nothing here is resized.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

// The selected component, as Puck's store would report it to a responsive field.
const SELECTED = 'pb163-section-under-test';
vi.mock('../editor/use-page-builder-puck.js', () => ({
  usePageBuilderPuck: (selector: (state: unknown) => unknown) =>
    selector({ selectedItem: { type: 'cms.Section', props: { id: SELECTED } }, appState: { ui: {} } }),
}));

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  act(() => setStoredScope(SELECTED, 'base'));
});

/** Renders the field the way Puck does, holding its value like the editor store would. */
function mount<V>(field: { render: unknown }, initial?: V): { onChange: ReturnType<typeof vi.fn>; value: () => V | undefined } {
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
  return { onChange, value: () => current };
}

function control<T extends HTMLElement = HTMLInputElement>(label: string): T {
  const element = Array.from(document.querySelectorAll<HTMLElement>('[aria-label]')).find(
    (candidate) => candidate.getAttribute('aria-label') === label,
  );
  if (!element) {
    const labels = Array.from(document.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label'));
    throw new Error(`no control "${label}" among: ${labels.join(' | ')}`);
  }
  return element as T;
}

function has(label: string): boolean {
  return Array.from(document.querySelectorAll('[aria-label]')).some((e) => e.getAttribute('aria-label') === label);
}

function options(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((option) => option.value);
}

/** Sets a form control's value the way React listens for it. */
function change(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  act(() => {
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

function click(element: HTMLElement): void {
  act(() => element.click());
}

function scope(next: 'base' | 'tablet' | 'desktop'): void {
  act(() => setStoredScope(SELECTED, next));
}

describe('createSectionSpaceField (T117: a responsive field on the Responsive tab)', () => {
  it('carries the responsive metadata, so the editor puts it on the Responsive tab', () => {
    const field = createSectionSpaceField({ label: 'Space above' });
    expect(isResponsiveField(field)).toBe(true);
    expect(fieldTabForName('spaceTop', field as never)).toBe('responsive');
  });

  it('shows one control — no Mobile / Tablet / Desktop switch of its own', () => {
    mount(createSectionSpaceField({ label: 'Space above' }));
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(document.querySelectorAll('select')).toHaveLength(1);
    const select = control<HTMLSelectElement>('Space above');
    expect(options(select)).toEqual(['none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom']);
    // The default spacing shows until one is set.
    expect(select.value).toBe('l');
  });

  it('writes the base value plain, and each breakpoint the scope switcher selects as its own override', () => {
    const { value } = mount<unknown>(createSectionSpaceField({ label: 'Space above' }));
    change(control<HTMLSelectElement>('Space above'), 'm');
    expect(value()).toBe('m');

    scope('desktop');
    const desktop = control<HTMLSelectElement>('Space above');
    // A higher breakpoint inherits the one below it until set, and says which.
    expect(desktop.value).toBe('');
    expect(desktop.options[0]?.textContent).toBe('Inherit (M)');
    change(desktop, 'xl');
    expect(value()).toEqual({ base: 'm', desktop: 'xl' });

    scope('tablet');
    expect(control<HTMLSelectElement>('Space above').value).toBe('');
    change(control<HTMLSelectElement>('Space above'), 's');
    expect(value()).toEqual({ base: 'm', tablet: 's', desktop: 'xl' });

    // Back to inheriting: the override goes, and a value left with only its base is stored plain.
    change(control<HTMLSelectElement>('Space above'), '');
    scope('desktop');
    change(control<HTMLSelectElement>('Space above'), '');
    expect(value()).toBe('m');
  });

  it('seeds the base with the default spacing when a breakpoint is set first', () => {
    const { value } = mount<unknown>(createSectionSpaceField({ label: 'Space below' }));
    scope('tablet');
    expect(control<HTMLSelectElement>('Space below').options[0]?.textContent).toBe('Inherit (L)');
    change(control<HTMLSelectElement>('Space below'), 'none');
    expect(value()).toEqual({ base: 'l', tablet: 'none' });
  });

  it('takes a custom px value for the scope being edited', () => {
    const { value } = mount<unknown>(createSectionSpaceField({ label: 'Space below' }));
    change(control<HTMLSelectElement>('Space below'), 'custom');
    expect(has('Space below (px)')).toBe(true);
    change(control('Space below (px)'), '12');
    expect(value()).toEqual({ px: 12 });

    scope('desktop');
    expect(has('Space below (px)')).toBe(false);
    change(control<HTMLSelectElement>('Space below'), 'custom');
    change(control('Space below (px)'), '96');
    expect(value()).toEqual({ base: { px: 12 }, desktop: { px: 96 } });
  });

  it('writes nothing until an edit', () => {
    const { onChange } = mount(createSectionSpaceField({ label: 'Space above' }));
    scope('desktop');
    expect(onChange).not.toHaveBeenCalled();
  });

  // T148: the section overlap reuses the field with `none` as what shows until it is set.
  it('takes another default — shown, inherited and seeded in its place', () => {
    const { value } = mount<unknown>(createSectionSpaceField({ label: 'Overlap', defaultValue: 'none' }));
    expect(control<HTMLSelectElement>('Overlap').value).toBe('none');
    scope('desktop');
    expect(control<HTMLSelectElement>('Overlap').options[0]?.textContent).toBe('Inherit (None)');
    change(control<HTMLSelectElement>('Overlap'), 'xl');
    expect(value()).toEqual({ base: 'none', desktop: 'xl' });
  });
});

describe('createSectionBackgroundField (T117: a main-tab field)', () => {
  it('is not responsive, and is recognisable by the host that gives it an asset picker', () => {
    const field = createSectionBackgroundField({ label: 'Background' });
    expect(isResponsiveField(field)).toBe(false);
    expect(fieldTabForName('background', field as never)).toBe('general');
    expect(isSectionBackgroundField(field)).toBe(true);
    expect(isSectionBackgroundField({ type: 'custom', render: () => null })).toBe(false);
    expect(isSectionBackgroundField(undefined)).toBe(false);
  });

  it('builds an image background with a mobile image, position and an overlay', () => {
    const { value } = mount<Record<string, unknown>>(createSectionBackgroundField({ label: 'Background' }));
    const kind = control<HTMLSelectElement>('Background');
    expect(options(kind)).toEqual(['none', 'solid', 'gradient', 'image', 'video']);
    change(kind, 'image');
    change(control('Image URL'), '/media/wide.jpg');
    change(control('Mobile image URL'), '/media/tall.jpg');
    change(control<HTMLSelectElement>('Image position'), 'top');
    change(control<HTMLSelectElement>('Overlay'), 'gradient');
    change(control<HTMLSelectElement>('Overlay direction'), 'to-bottom');
    change(control('Overlay strength (%)'), '60');
    expect(value()).toMatchObject({
      kind: 'image',
      imageUrl: '/media/wide.jpg',
      mobileImageUrl: '/media/tall.jpg',
      position: 'top',
      overlay: { kind: 'gradient', direction: 'to-bottom', strength: 60 },
    });
  });

  it('builds a video background with a poster and a mobile video', () => {
    const { value } = mount<Record<string, unknown>>(createSectionBackgroundField({ label: 'Background' }));
    change(control<HTMLSelectElement>('Background'), 'video');
    change(control<HTMLSelectElement>('Video source'), 'library');
    change(control('Video'), '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d');
    change(control('Poster image'), '3d4e5f60-7182-4c9d-8e1f-2a3b4c5d6e7f');
    change(control('Mobile video'), '2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e');
    expect(value()).toMatchObject({
      kind: 'video',
      videoSource: 'library',
      videoAssetId: '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d',
      videoPosterAssetId: '3d4e5f60-7182-4c9d-8e1f-2a3b4c5d6e7f',
      mobileVideoAssetId: '2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e',
    });
    expect(has('Overlay')).toBe(true);
  });

  it('marks the decorative backdrop, and clears to nothing when set back to none', () => {
    const { value } = mount<Record<string, unknown> | undefined>(createSectionBackgroundField({ label: 'Background' }));
    click(control('Decorative backdrop (dark scheme)'));
    expect(value()).toMatchObject({ kind: 'none', decorative: true });
    click(control('Decorative backdrop (dark scheme)'));
    expect(value()).toBeUndefined();
  });

  // T167: an image's size and repeat; cover and no repeat are today's and are stored as nothing.
  it('sets an image\'s size (keyword, px or %) and repeat, and stores today\'s cover and no repeat as nothing', () => {
    const { value } = mount<Record<string, unknown>>(createSectionBackgroundField({ label: 'Background' }), { kind: 'image', imageUrl: '/a.jpg' });
    const size = control<HTMLSelectElement>('Image size');
    expect(options(size)).toEqual(['cover', 'contain', 'auto', 'px', 'percent']);
    expect(size.value).toBe('cover');
    expect(options(control<HTMLSelectElement>('Image repeat'))).toEqual(['no-repeat', 'repeat', 'repeat-x', 'repeat-y']);

    change(size, 'px');
    expect(value()).toMatchObject({ size: { px: 480 } });
    change(control('Image size (px)'), '240');
    expect(value()).toMatchObject({ size: { px: 240 } });
    change(control<HTMLSelectElement>('Image size'), 'percent');
    change(control('Image size (%)'), '50');
    expect(value()).toMatchObject({ size: { percent: 50 } });
    change(control<HTMLSelectElement>('Image repeat'), 'repeat-y');
    expect(value()).toMatchObject({ repeat: 'repeat-y' });

    change(control<HTMLSelectElement>('Image size'), 'cover');
    change(control<HTMLSelectElement>('Image repeat'), 'no-repeat');
    expect(value()).not.toHaveProperty('size');
    expect(value()).not.toHaveProperty('repeat');
    expect(has('Image size (px)')).toBe(false);
  });

  it('offers the decorative layer\'s size, repeat and position with its toggle, and clears them with it (T167)', () => {
    const { value } = mount<Record<string, unknown> | undefined>(createSectionBackgroundField({ label: 'Background' }));
    expect(has('Backdrop size')).toBe(false);
    click(control('Decorative backdrop (dark scheme)'));
    expect(control<HTMLSelectElement>('Backdrop size').value).toBe('cover');
    expect(control<HTMLSelectElement>('Backdrop repeat').value).toBe('no-repeat');
    const position = control<HTMLSelectElement>('Backdrop position');
    expect(options(position)).toEqual(['center', 'top', 'bottom', 'left', 'right']);
    expect(position.value).toBe('top');

    change(control<HTMLSelectElement>('Backdrop size'), 'px');
    change(control('Backdrop size (px)'), '720');
    change(control<HTMLSelectElement>('Backdrop repeat'), 'repeat-y');
    change(control<HTMLSelectElement>('Backdrop position'), 'center');
    expect(value()).toEqual({ kind: 'none', decorative: true, decorativeSize: { px: 720 }, decorativeRepeat: 'repeat-y', decorativePosition: 'center' });

    change(control<HTMLSelectElement>('Backdrop position'), 'top');
    expect(value()).not.toHaveProperty('decorativePosition');
    click(control('Decorative backdrop (dark scheme)'));
    expect(value()).toBeUndefined();
  });

  it('uses the asset input the host supplies for asset ids (the admin\'s asset picker)', () => {
    const seen: string[] = [];
    function AssetInput({ label, kind, onChange }: SectionAssetInputProps): ReactElement {
      seen.push(`${kind}:${label}`);
      return (
        <button type="button" aria-label={`Pick ${label}`} onClick={() => onChange('6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b')}>
          pick
        </button>
      );
    }
    const field: SectionBackgroundField = { ...createSectionBackgroundField({ label: 'Background' }), assetInput: AssetInput };
    const { value } = mount<Record<string, unknown>>(field);
    change(control<HTMLSelectElement>('Background'), 'image');
    change(control<HTMLSelectElement>('Image source'), 'library');
    click(control('Pick Image'));
    click(control('Pick Mobile image'));
    expect(value()).toMatchObject({
      imageAssetId: '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b',
      mobileImageAssetId: '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b',
    });
    expect(seen).toContain('image:Image');
  });
});

describe('createSectionAnchorField (T117)', () => {
  it('normalises the anchor as you type and shows the result', () => {
    const { value } = mount<string>(createSectionAnchorField({ label: 'Anchor' }));
    change(control('Anchor'), 'Kontakt Us!');
    expect(value()).toBe('kontakt-us');
    expect(document.body.textContent).toContain('#kontakt-us');
    // What was typed stays in the box; the stored value is the normalised one.
    expect(control('Anchor').value).toBe('Kontakt Us!');

    change(control('Anchor'), '');
    expect(value()).toBeUndefined();
  });

  it('is a main-tab field', () => {
    expect(isResponsiveField(createSectionAnchorField({ label: 'Anchor' }))).toBe(false);
  });
});

// T090 (US10, FR-036, research R-21): the section's entrance reveal. A
// section fades its content up; the word reveal belongs to a block's text.
describe('createSectionRevealField (T117)', () => {
  it('offers none or fade-up, restrictable to desktop', () => {
    const { value } = mount<unknown>(createSectionRevealField({ label: 'Entrance reveal' }));
    const effect = control<HTMLSelectElement>('Entrance reveal');
    expect(options(effect)).toEqual(['none', 'fade-up']);
    expect(effect.value).toBe('none');
    expect(has('Reveal on desktop only')).toBe(false);

    change(effect, 'fade-up');
    expect(value()).toEqual({ effect: 'fade-up', desktopOnly: false });
    click(control('Reveal on desktop only'));
    expect(value()).toEqual({ effect: 'fade-up', desktopOnly: true });

    change(control<HTMLSelectElement>('Entrance reveal'), 'none');
    expect(value()).toBeUndefined();
  });

  it('is a main-tab field', () => {
    expect(isResponsiveField(createSectionRevealField({ label: 'Entrance reveal' }))).toBe(false);
  });
});
