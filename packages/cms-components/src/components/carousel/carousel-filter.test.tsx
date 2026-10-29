// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CarouselShell, type CarouselShellProps } from './CarouselShell.js';
import { CmsRenderProvider } from '../render-context.js';
import { carouselFilterFromProps, itemTagsAttribute, parseItemTags } from './carousel-filter.js';

/**
 * `specs/163-page-builder-marketing-pages/` T131 (R5) — an optional category
 * filter over a carousel's or a grid's items.
 *
 * - An item carries tags (`data-pb-tags`, written by the item blocks); the
 *   block lists the tags to filter by, each with an editable label, after
 *   "All".
 * - **Every item is in the server HTML** and none is hidden there: with
 *   JavaScript off every item shows. Filtering only hides items on the client.
 * - The bar is a `toolbar` of toggle buttons (`aria-pressed`), one tab stop,
 *   Left/Right/Home/End moving the focus; a polite status announces how many
 *   items are shown after a change; the remaining slides are renumbered.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const FILTER = {
  allLabel: 'All',
  tags: [
    { tag: 'offices', label: 'Offices' },
    { tag: 'retail', label: 'Retail' },
    { tag: 'empty', label: 'Nothing here' },
  ],
};

/** Four items: two offices (one also retail), one retail, one untagged. */
function items(): ReactElement[] {
  return [
    <p key="a" data-pb-tags="offices">Item A</p>,
    <p key="b" data-pb-tags="offices,retail">Item B</p>,
    <p key="c" data-pb-tags="retail">Item C</p>,
    <p key="d">Item D</p>,
  ];
}

function serverDom(props: Partial<CarouselShellProps>): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(<CarouselShell {...props}>{items()}</CarouselShell>);
  return host;
}

function clientDom(props: Partial<CarouselShellProps>, context = false): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const shell = <CarouselShell {...props}>{items()}</CarouselShell>;
  act(() =>
    root!.render(
      context ? (
        <CmsRenderProvider
          embeds={{ blocks: {}, templates: {} }}
          carouselLabels={{ filter: 'Filtruj', filterCount: 'Pokazano {n} z {m}', filterAll: 'Wszystkie' }}
        >
          {shell}
        </CmsRenderProvider>
      ) : (
        shell
      ),
    ),
  );
  return host;
}

const toolbar = (host: HTMLElement) => host.querySelector<HTMLElement>('[role="toolbar"]');
const buttons = (host: HTMLElement) => Array.from(toolbar(host)?.querySelectorAll<HTMLButtonElement>('button') ?? []);
const itemWrappers = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLElement>('.cmsc-pb-carousel__slides > .cmsc-pb-carousel__slide'));
const shown = (host: HTMLElement) => itemWrappers(host).filter((item) => !item.hidden).map((item) => item.textContent);
const status = (host: HTMLElement) => host.querySelector<HTMLElement>('.cmsc-pb-carousel__filter-status');

describe('item tags (T131)', () => {
  it('parses a comma-separated list, trimmed, lower-cased, without blanks or repeats', () => {
    expect(parseItemTags(' Offices, retail ,, OFFICES ')).toEqual(['offices', 'retail']);
    expect(parseItemTags(undefined)).toEqual([]);
    expect(itemTagsAttribute('Offices, Retail')).toEqual({ 'data-pb-tags': 'offices,retail' });
    expect(itemTagsAttribute('  ')).toEqual({});
  });
});

describe('CarouselShell — the category filter (T131)', () => {
  it('server HTML: the bar with "All" pressed, every item present and none hidden', () => {
    for (const layout of ['carousel', 'grid'] as const) {
      const host = serverDom({ filter: FILTER, layout });
      const bar = toolbar(host);
      expect(bar, layout).not.toBeNull();
      expect(bar!.getAttribute('aria-label')).toBe('Filter');
      expect(buttons(host).map((button) => button.textContent)).toEqual(['All', 'Offices', 'Retail', 'Nothing here']);
      expect(buttons(host).map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
      expect(buttons(host).map((button) => button.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
      expect(shown(host)).toEqual(['Item A', 'Item B', 'Item C', 'Item D']);
      expect(host.innerHTML).not.toContain('hidden=""');
      expect(status(host)?.getAttribute('role')).toBe('status');
      expect(status(host)?.textContent).toBe('');
    }
  });

  it('no bar without tags to filter by', () => {
    expect(toolbar(serverDom({}))).toBeNull();
    expect(toolbar(serverDom({ filter: { allLabel: 'All', tags: [] } }))).toBeNull();
  });

  it('a tag shows only its items, renumbers the slides and announces the count; "All" shows every item again', () => {
    const host = clientDom({ filter: FILTER });
    act(() => buttons(host)[2]!.click());
    expect(shown(host)).toEqual(['Item B', 'Item C']);
    expect(buttons(host).map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true', 'false']);
    expect(status(host)?.textContent).toBe('2 of 4 shown');
    const visible = itemWrappers(host).filter((item) => !item.hidden);
    expect(visible.map((item) => item.getAttribute('aria-label'))).toEqual(['1 of 2', '2 of 2']);

    act(() => buttons(host)[3]!.click());
    expect(shown(host)).toEqual([]);
    expect(status(host)?.textContent).toBe('0 of 4 shown');

    act(() => buttons(host)[0]!.click());
    expect(shown(host)).toEqual(['Item A', 'Item B', 'Item C', 'Item D']);
    expect(status(host)?.textContent).toBe('4 of 4 shown');
  });

  it('filters the grid the same way', () => {
    const host = clientDom({ filter: FILTER, layout: 'grid' });
    act(() => buttons(host)[1]!.click());
    expect(shown(host)).toEqual(['Item A', 'Item B']);
  });

  it('one tab stop: Left, Right, Home and End move the focus between the buttons', () => {
    const host = clientDom({ filter: FILTER });
    const [all, offices, retail, empty] = buttons(host);
    act(() => all!.focus());
    act(() => {
      all!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(offices);
    expect(offices!.getAttribute('tabindex')).toBe('0');
    expect(all!.getAttribute('tabindex')).toBe('-1');
    act(() => {
      offices!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(document.activeElement).toBe(empty);
    act(() => {
      empty!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(all);
    act(() => {
      all!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(document.activeElement).toBe(empty);
    act(() => {
      empty!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(document.activeElement).toBe(all);
    // Moving the focus does not filter; a press does.
    expect(shown(host)).toHaveLength(4);
    expect(retail!.getAttribute('aria-pressed')).toBe('false');
  });

  it('speaks the page language from the render context; a block\'s own "All" label wins', () => {
    const host = clientDom({ filter: { tags: FILTER.tags } }, true);
    expect(toolbar(host)!.getAttribute('aria-label')).toBe('Filtruj');
    expect(buttons(host)[0]!.textContent).toBe('Wszystkie');
    act(() => buttons(host)[1]!.click());
    expect(status(host)?.textContent).toBe('Pokazano 2 z 4');
    expect(serverDom({ filter: { allLabel: 'Everything', tags: FILTER.tags } }).querySelector('[role="toolbar"] button')!.textContent).toBe(
      'Everything',
    );
  });
});

describe('CarouselShell — the filter bar\'s style and alignment (T143)', () => {
  const barClasses = (host: HTMLElement): string[] =>
    (toolbar(host)?.className.split(/\s+/) ?? []).filter((name) => name !== 'cmsc-pb-carousel__filter');

  it('pills at the start are today\'s: the bar carries no modifier class', () => {
    expect(barClasses(serverDom({ filter: FILTER }))).toEqual([]);
    expect(barClasses(serverDom({ filter: { ...FILTER, style: 'pills', align: 'start' } }))).toEqual([]);
  });

  it('underline tabs and an alignment are classes of the bar; the toolbar semantics stay', () => {
    const host = serverDom({ filter: { ...FILTER, style: 'underline', align: 'center' }, layout: 'grid' });
    expect(barClasses(host).sort()).toEqual(['cmsc-pb-carousel__filter--align-center', 'cmsc-pb-carousel__filter--underline']);
    expect(toolbar(host)!.getAttribute('aria-label')).toBe('Filter');
    expect(buttons(host).map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    expect(buttons(host).map((button) => button.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    expect(barClasses(serverDom({ filter: { ...FILTER, align: 'end' } }))).toEqual(['cmsc-pb-carousel__filter--align-end']);
  });

  it('the underline bar filters and moves the focus as the pills do', () => {
    const host = clientDom({ filter: { ...FILTER, style: 'underline' } });
    act(() => buttons(host)[1]!.click());
    expect(shown(host)).toEqual(['Item A', 'Item B']);
    const [, offices, retail] = buttons(host);
    act(() => {
      offices!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(retail);
  });

  it('the block\'s stored style and alignment reach the shell; anything unknown is left out', () => {
    expect(carouselFilterFromProps({ show: true, style: 'underline', align: 'end', tags: FILTER.tags })).toMatchObject({
      style: 'underline',
      align: 'end',
    });
    const unknown = carouselFilterFromProps({ show: true, style: 'boxed' as never, align: 'middle' as never, tags: FILTER.tags });
    expect(unknown).not.toHaveProperty('style');
    expect(unknown).not.toHaveProperty('align');
  });
});

/**
 * T161 (R9, owner gap list (a)5): on a narrow screen the filter bar either
 * wraps onto more lines (today) or stays one line that scrolls sideways inside
 * the block, snapping to a button, as T155 did for the tab bar. The toolbar,
 * `aria-pressed`, the one tab stop and the keys are the same; a focused button
 * is scrolled into view by the browser, one pressed with the pointer is
 * brought into the bar's view (`nearest`, so the page itself does not move).
 */
describe('CarouselShell — filter buttons that do not fit: wrap or one scrolling line (T161)', () => {
  const css = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

  it('unset or wrap: today\'s bar; scroll: one class more, the same toolbar', () => {
    for (const overflow of [undefined, 'wrap'] as const) {
      expect(toolbar(serverDom({ filter: { ...FILTER, ...(overflow ? { overflow } : {}) } }))!.className).toBe('cmsc-pb-carousel__filter');
    }
    const host = serverDom({ filter: { ...FILTER, style: 'underline', overflow: 'scroll' } });
    expect(toolbar(host)!.className).toBe('cmsc-pb-carousel__filter cmsc-pb-carousel__filter--underline cmsc-pb-carousel__filter--scroll');
    expect(buttons(host).map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
    expect(buttons(host).map((button) => button.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
  });

  it('the block\'s stored overflow reaches the shell; anything unknown is left out', () => {
    expect(carouselFilterFromProps({ show: true, overflow: 'scroll', tags: FILTER.tags })).toMatchObject({ overflow: 'scroll' });
    expect(carouselFilterFromProps({ show: true, overflow: 'clip' as never, tags: FILTER.tags })).not.toHaveProperty('overflow');
  });

  it('scroll: the keys still move the focus, and a pressed button still filters', () => {
    const host = clientDom({ filter: { ...FILTER, overflow: 'scroll' } });
    const [all, offices, , empty] = buttons(host);
    act(() => all!.focus());
    act(() => {
      all!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(document.activeElement).toBe(empty);
    act(() => offices!.click());
    expect(shown(host)).toEqual(['Item A', 'Item B']);
  });

  it('scroll: a button pressed with the pointer is brought into the bar\'s view (nearest); wrap does not', () => {
    const calls: Array<{ text: string | null; options: unknown }> = [];
    const original = (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = function (this: HTMLElement, options: unknown) {
      calls.push({ text: this.textContent, options });
    };
    try {
      const scrolling = clientDom({ filter: { ...FILTER, overflow: 'scroll' } });
      act(() => buttons(scrolling)[2]!.click());
      expect(calls).toEqual([{ text: 'Retail', options: { block: 'nearest', inline: 'nearest' } }]);
      act(() => root!.unmount());
      root = null;
      const wrapping = clientDom({ filter: FILTER });
      act(() => buttons(wrapping)[2]!.click());
      expect(calls).toHaveLength(1);
    } finally {
      (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = original;
    }
  });

  it('the stylesheet keeps the bar one line that scrolls inside the block, snapping, with a visible focus ring', () => {
    const sheet = css();
    expect(sheet).toContain(
      '.cmsc-pb-carousel__filter--scroll { flex-wrap: nowrap; max-width: 100%; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scroll-snap-type: x proximity;',
    );
    expect(sheet).toContain('.cmsc-pb-carousel__filter--scroll .cmsc-pb-carousel__filter-button { flex-shrink: 0; white-space: nowrap; scroll-snap-align: start; }');
    expect(sheet).toContain('.cmsc-pb-carousel__filter--scroll .cmsc-pb-carousel__filter-button:focus-visible { outline-offset: -2px; }');
    // Centred or at the end, the first buttons stay reachable: auto margins instead of `justify-content`.
    expect(sheet).toContain('.cmsc-pb-carousel__filter--scroll.cmsc-pb-carousel__filter--align-center, .cmsc-pb-carousel__filter--scroll.cmsc-pb-carousel__filter--align-end { justify-content: flex-start; }');
    // Underlined: the bar's line is drawn inside the scrolling box, which would clip the -1 px overlap.
    expect(sheet).toContain('.cmsc-pb-carousel__filter--underline.cmsc-pb-carousel__filter--scroll { border-bottom-style: none; box-shadow: inset 0 -1px 0 var(--cmsb-border, #d9e0e7); }');
  });
});
