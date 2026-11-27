// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * `specs/163-page-builder-marketing-pages/` T058, US5, FR-023, FR-024, research
 * R-13 — tab panels hold blocks.
 *
 * - Ids come from `useId()`, so two tab blocks on one page never share one.
 * - The WAI-ARIA tabs keyboard model: arrows (wrapping), Home and End move the
 *   focus and the visible panel; only the selected tab is in the tab order.
 * - Every panel is in the server HTML; inactive panels carry `hidden`.
 * - `pills` and the optional fade between panels.
 * - A panel stored as HTML before the reshape still renders, as today.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.Tabs']?.defaultProps ?? {}) as Record<string, unknown>;

function rich(id: string, text: string) {
  return { type: 'cms.RichContent', props: { id, content: null, html: `<p>${text}</p>` } };
}

function tabsNode(id: string, props: Record<string, unknown> = {}) {
  return {
    type: 'cms.Tabs',
    props: {
      ...defaults,
      id,
      items: [
        { label: 'Buyers', panel: [rich(`${id}-r0`, 'Panel for buyers')] },
        { label: 'Sellers', panel: [rich(`${id}-r1`, 'Panel for sellers')] },
        { label: 'Partners', panel: [rich(`${id}-r2`, 'Panel for partners')] },
      ],
      ...props,
    },
  };
}

function page(...content: unknown[]) {
  return (
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content: content as Data['content'] }} />
    </CmsRenderProvider>
  );
}

/** Server-rendered markup, parsed: what a crawler and the first paint receive. */
function serverDom(...content: unknown[]): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(page(...content));
  return host;
}

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
});

/** A client render, effects run. */
function clientDom(...content: unknown[]): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(page(...content)));
  return host;
}

function tabs(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
}

function panels(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
}

function press(target: HTMLElement, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('cms.Tabs (T058)', () => {
  it('default props render tabs whose panels hold blocks, not HTML', () => {
    const items = defaults['items'] as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(Array.isArray(item['panel'])).toBe(true);
      expect(item).not.toHaveProperty('content');
    }
    const host = serverDom({ type: 'cms.Tabs', props: { ...defaults, id: 'tabs-default' } });
    expect(tabs(host)).toHaveLength(items.length);
    expect(panels(host)).toHaveLength(items.length);
  });

  it('gives two tab blocks on one page distinct ids, each tab and panel pointing at the other', () => {
    const host = serverDom(tabsNode('tabs-a'), tabsNode('tabs-b'));
    const ids = [...tabs(host), ...panels(host)].map((element) => element.id);
    expect(ids).toHaveLength(12);
    expect(ids.every((id) => id !== '')).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tab of tabs(host)) {
      const panel = host.querySelector(`[id="${tab.getAttribute('aria-controls')}"]`);
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    }
  });

  it('puts every panel\'s content in the server HTML, the inactive ones hidden', () => {
    const host = serverDom(tabsNode('tabs-ssr', { defaultTab: 1 }));
    const [first, second, third] = panels(host);
    expect(first!.textContent).toContain('Panel for buyers');
    expect(second!.textContent).toContain('Panel for sellers');
    expect(third!.textContent).toContain('Panel for partners');
    expect(first!.hasAttribute('hidden')).toBe(true);
    expect(second!.hasAttribute('hidden')).toBe(false);
    expect(third!.hasAttribute('hidden')).toBe(true);
    expect(tabs(host).map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    // Roving tab index: only the selected tab is in the tab order.
    expect(tabs(host).map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('moves focus and the visible panel with the arrow keys (wrapping), Home and End', () => {
    const host = clientDom(tabsNode('tabs-keys'));
    const visible = () => panels(host).findIndex((panel) => !panel.hasAttribute('hidden'));
    const focused = () => tabs(host).indexOf(document.activeElement as HTMLElement);

    act(() => tabs(host)[0]!.focus());
    press(tabs(host)[0]!, 'ArrowRight');
    expect([focused(), visible()]).toEqual([1, 1]);
    expect(tabs(host)[1]!.getAttribute('aria-selected')).toBe('true');
    expect(tabs(host)[1]!.getAttribute('tabindex')).toBe('0');
    expect(tabs(host)[0]!.getAttribute('tabindex')).toBe('-1');

    press(tabs(host)[1]!, 'End');
    expect([focused(), visible()]).toEqual([2, 2]);
    press(tabs(host)[2]!, 'ArrowRight');
    expect([focused(), visible()]).toEqual([0, 0]);
    press(tabs(host)[0]!, 'ArrowLeft');
    expect([focused(), visible()]).toEqual([2, 2]);
    press(tabs(host)[2]!, 'Home');
    expect([focused(), visible()]).toEqual([0, 0]);

    // Any other key is left to the browser.
    const other = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    act(() => {
      tabs(host)[0]!.dispatchEvent(other);
    });
    expect(other.defaultPrevented).toBe(false);
  });

  it('selects a tab on click', () => {
    const host = clientDom(tabsNode('tabs-click'));
    act(() => tabs(host)[2]!.click());
    expect(panels(host).map((panel) => panel.hasAttribute('hidden'))).toEqual([true, true, false]);
  });

  it('offers the pills style', () => {
    const host = serverDom(tabsNode('tabs-pills', { variant: 'pills' }));
    expect(host.querySelector('.cmsc-pb-tabs')?.classList.contains('cmsc-pb-tabs--pills')).toBe(true);
  });

  it('fades between panels only when asked, and never under reduced motion', () => {
    expect(serverDom(tabsNode('tabs-plain')).querySelector('.cmsc-pb-tabs--fade')).toBeNull();
    expect(serverDom(tabsNode('tabs-fade', { effect: 'fade' })).querySelector('.cmsc-pb-tabs')?.classList.contains('cmsc-pb-tabs--fade')).toBe(true);

    // T174: the fade is a crossfade driven by classes on the changing panels (its rules and the
    // reduced-motion case are asserted in the T174 describe below), no longer a load-time animation.
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8');
    expect(css).toMatch(/\.cmsc-pb-tabs__panel--entering\s*\{[^}]*animation:/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^@]*\.cmsc-pb-tabs__panel--entering[^}]*animation: none/);
  });

  it('still renders a panel stored as HTML before the reshape, sanitised, as today', () => {
    const host = serverDom({
      type: 'cms.Tabs',
      props: {
        ...defaults,
        id: 'tabs-stored',
        items: [
          { label: 'Stored', content: '<p>Stored <strong>panel</strong></p><script>alert(1)</script>' },
          { label: 'New', panel: [rich('tabs-stored-r1', 'Block panel')] },
        ],
      },
    });
    const [stored, blocks] = panels(host);
    expect(stored!.innerHTML).toContain('<p>Stored <strong>panel</strong></p>');
    expect(stored!.innerHTML).not.toContain('script');
    expect(blocks!.textContent).toContain('Block panel');
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T132 (R5) — the tab bar's look:
 * the bar's background and border, the active and inactive tabs' colours
 * (a brand token or a hex) and a size. Nothing set: today's markup.
 */
describe('cms.Tabs — the tab bar\'s look (T132)', () => {
  const fields = config.components['cms.Tabs']!.fields as Record<string, { type: string; objectFields?: Record<string, { type: string; options?: Array<{ value: unknown }> }> }>;

  it('offers the bar\'s background and border, the active and inactive colours and a size', () => {
    const style = fields['tabStyle']!;
    expect(style.type).toBe('object');
    // T163: the size moved to `tabSize`, a value per breakpoint on the Responsive tab, with the same options.
    expect(Object.keys(style.objectFields ?? {})).toEqual([
      'barBackground',
      'barBorderColor',
      'activeBackground',
      'activeColor',
      'inactiveBackground',
      'inactiveColor',
      // T174: the hover colours of a tab that is not selected.
      'hoverBackground',
      'hoverColor',
    ]);
    expect((fields['tabSize'] as unknown as { options?: Array<{ value: unknown }> }).options?.map((option) => option.value)).toEqual(['s', 'm', 'l']);
    for (const key of ['barBackground', 'barBorderColor', 'activeBackground', 'activeColor', 'inactiveBackground', 'inactiveColor']) {
      expect(style.objectFields?.[key]?.type, key).toBe('custom');
    }
  });

  it('nothing set: today\'s classes and no custom properties', () => {
    const root0 = serverDom(tabsNode('t1', { variant: 'pills' })).querySelector<HTMLElement>('.cmsc-pb-tabs')!;
    expect(root0.className).toBe('cmsc-pb-tabs cmsc-pb-tabs--pills cmsc-pb-tabs--align-start');
    expect(root0.getAttribute('style')).toBeNull();
    const medium = serverDom(tabsNode('t2', { variant: 'pills', tabStyle: { size: 'm' } })).querySelector<HTMLElement>('.cmsc-pb-tabs')!;
    expect(medium.className).toBe('cmsc-pb-tabs cmsc-pb-tabs--pills cmsc-pb-tabs--align-start');
  });

  it('writes the colours as custom properties (token or hex), the size and a bar class', () => {
    const host = serverDom(
      tabsNode('t1', {
        variant: 'pills',
        tabStyle: {
          size: 'l',
          barBackground: '#ffffff',
          barBorderColor: 'token:primary',
          activeBackground: '#ffffff',
          activeColor: '#0f172a',
          inactiveBackground: 'transparent',
          inactiveColor: '#64748b',
        },
      }),
    );
    const element = host.querySelector<HTMLElement>('.cmsc-pb-tabs')!;
    expect(element.className).toContain('cmsc-pb-tabs--size-l');
    expect(element.className).toContain('cmsc-pb-tabs--bar');
    const style = element.getAttribute('style') ?? '';
    expect(style).toContain('--cmsc-tabs-bar-bg:#ffffff');
    expect(style).toContain('--cmsc-tabs-bar-border:var(--cmsb-color-primary');
    expect(style).toContain('--cmsc-tabs-active-bg:#ffffff');
    expect(style).toContain('--cmsc-tabs-active-fg:#0f172a');
    expect(style).toContain('--cmsc-tabs-fg:#64748b');
    // Not a hex or a known token: the stylesheet's own colour stays.
    expect(style).not.toContain('--cmsc-tabs-bg');
    // The markup, roles and keyboard model are unchanged.
    expect(tabs(host)).toHaveLength(3);
    expect(host.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it('a bar border alone also draws the bar', () => {
    const element = serverDom(tabsNode('t1', { tabStyle: { barBorderColor: '#d9e0e7' } })).querySelector<HTMLElement>('.cmsc-pb-tabs')!;
    expect(element.className).toContain('cmsc-pb-tabs--bar');
    expect(element.className).not.toContain('--size-');
  });
});

describe('cms.Tabs — space between the tab bar and the panel (T146)', () => {
  const css = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

  it('nothing set: no class and no custom property, today\'s 12 px', () => {
    const element = serverDom(tabsNode('t1')).querySelector<HTMLElement>('.cmsc-pb-tabs')!;
    expect(element.className).not.toContain('cmsc-pb-tabs--panel-gap');
    expect(element.getAttribute('style') ?? '').not.toContain('--cmsc-tabs-panel-gap');
  });

  it('a token per breakpoint or Custom px: a class and one custom property per breakpoint', () => {
    const element = serverDom(
      tabsNode('t1', { panelGap: { base: 'm', desktop: 'custom' }, panelGapPx: { base: 0, desktop: 48 } }),
    ).querySelector<HTMLElement>('.cmsc-pb-tabs')!;
    expect(element.className).toContain('cmsc-pb-tabs--panel-gap');
    expect(element.style.getPropertyValue('--cmsc-tabs-panel-gap')).toBe('var(--cmsb-space-m, 24px)');
    expect(element.style.getPropertyValue('--cmsc-tabs-panel-gap-md')).toBe('var(--cmsb-space-m, 24px)');
    expect(element.style.getPropertyValue('--cmsc-tabs-panel-gap-lg')).toBe('48px');
  });

  it('offers the gap on the Responsive tab, its px only with Custom', async () => {
    const block = config.components['cms.Tabs']!;
    const resolve = async (props: Record<string, unknown>) =>
      Object.keys(
        await block.resolveFields!(
          { props: { ...defaults, id: 't1', ...props } } as never,
          { parent: null, fields: block.fields, lastFields: block.fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
        ),
      );
    expect(await resolve({})).toContain('panelGap');
    expect(await resolve({})).not.toContain('panelGapPx');
    expect(await resolve({ panelGap: { base: 's', tablet: 'custom' } })).toContain('panelGapPx');
    expect(defaults).not.toHaveProperty('panelGap');
  });

  it('the stylesheet reads the gap below the bar per breakpoint, with today\'s 12 px as the fallback', () => {
    const sheet = css();
    expect(sheet).toContain('.cmsc-pb-tabs--panel-gap > .cmsc-pb-tabs__list { margin-bottom: var(--cmsc-tabs-panel-gap, 12px); }');
    expect(sheet).toMatch(
      /@media \(min-width: 768px\) \{ \.cmsc-pb-tabs--panel-gap > \.cmsc-pb-tabs__list \{ margin-bottom: var\(--cmsc-tabs-panel-gap-md, var\(--cmsc-tabs-panel-gap, 12px\)\); \} \}/,
    );
    expect(sheet).toMatch(
      /@media \(min-width: 1024px\) \{ \.cmsc-pb-tabs--panel-gap > \.cmsc-pb-tabs__list \{ margin-bottom: var\(--cmsc-tabs-panel-gap-lg, var\(--cmsc-tabs-panel-gap-md, var\(--cmsc-tabs-panel-gap, 12px\)\)\); \} \}/,
    );
  });
});

describe('cms.Tabs — a three-column panel from cms.Row and cms.Column (T146)', () => {
  const rowDefaults = (config.components['cms.Row']?.defaultProps ?? {}) as Record<string, unknown>;
  const columnDefaults = (config.components['cms.Column']?.defaultProps ?? {}) as Record<string, unknown>;
  const column = (id: string, span: unknown, content: unknown[]) => ({ type: 'cms.Column', props: { ...columnDefaults, id, span, content } });

  function threeColumns(prefix: string) {
    return {
      type: 'cms.Row',
      props: {
        ...rowDefaults,
        id: `${prefix}-row`,
        content: [
          column(`${prefix}-c1`, { base: 12, desktop: 3 }, [rich(`${prefix}-r1`, `${prefix} side text`)]),
          column(`${prefix}-c2`, { base: 12, desktop: 5 }, [rich(`${prefix}-r2`, `${prefix} media`)]),
          column(`${prefix}-c3`, { base: 12, desktop: 4 }, [rich(`${prefix}-r3`, `${prefix} closing text`)]),
        ],
      },
    };
  }

  it('a panel may hold a cms.Row (only columns, tabs and accordions are refused), and a row holds columns', () => {
    const block = config.components['cms.Tabs']!;
    const panel = ((block.fields as Record<string, { arrayFields?: Record<string, { disallow?: string[] }> }>)['items']!.arrayFields!['panel']!);
    expect(panel.disallow).not.toContain('cms.Row');
    expect(panel.disallow).toContain('cms.Column');
    const row = (config.components['cms.Row']!.fields as Record<string, { allow?: string[] }>)['content']!;
    expect(row.allow).toEqual(['cms.Column']);
  });

  it('renders every panel\'s three columns in the server HTML, in order, the inactive panel hidden', () => {
    const host = serverDom(
      tabsNode('t1', {
        items: [
          { label: 'Buyers', panel: [threeColumns('buyers')] },
          { label: 'Sellers', panel: [threeColumns('sellers')] },
        ],
      }),
    );
    const [first, second] = panels(host);
    for (const [panel, prefix] of [[first!, 'buyers'], [second!, 'sellers']] as const) {
      expect(panel.querySelector('.cmsc-pb-row-inner')).not.toBeNull();
      const texts = [`${prefix} side text`, `${prefix} media`, `${prefix} closing text`];
      const html = panel.innerHTML;
      expect(texts.map((text) => html.indexOf(text)).every((index, i, all) => index >= 0 && (i === 0 || index > all[i - 1]!))).toBe(true);
    }
    expect(first!.hidden).toBe(false);
    expect(second!.hidden).toBe(true);
  });
});

/**
 * T155 (R8, owner gap list (a)3): on a narrow screen the tab bar either wraps
 * onto more lines (today, T123) or stays one line that scrolls sideways, with
 * scroll snapping. The roles and the keyboard model are the same in both; the
 * page itself never scrolls sideways.
 */
describe('cms.Tabs — tabs that do not fit: wrap or one scrolling line (T155)', () => {
  const css = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');
  const field = () => config.components['cms.Tabs']!.fields!['barOverflow' as never] as { type?: string; options?: Array<{ value: unknown }>; metadata?: unknown } | undefined;

  it('offers wrap (first, today) or scroll on the General tab, unset by default', () => {
    expect(field()?.type).toBe('radio');
    expect(field()?.options?.map((option) => option.value)).toEqual(['wrap', 'scroll']);
    expect(field()?.metadata).toBeUndefined();
    expect(defaults).not.toHaveProperty('barOverflow');
  });

  it('unset or wrap: today\'s classes; scroll: one class more, the same roles and ids', () => {
    for (const props of [{}, { barOverflow: 'wrap' }]) {
      const element = serverDom(tabsNode('t1', { variant: 'pills', ...props })).querySelector<HTMLElement>('.cmsc-pb-tabs')!;
      expect(element.className).toBe('cmsc-pb-tabs cmsc-pb-tabs--pills cmsc-pb-tabs--align-start');
    }
    const host = serverDom(tabsNode('t1', { variant: 'pills', barOverflow: 'scroll' }));
    expect(host.querySelector<HTMLElement>('.cmsc-pb-tabs')!.className).toBe(
      'cmsc-pb-tabs cmsc-pb-tabs--pills cmsc-pb-tabs--align-start cmsc-pb-tabs--scroll',
    );
    expect(host.querySelector('[role="tablist"]')?.getAttribute('aria-orientation')).toBe('horizontal');
    expect(tabs(host).map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
    expect(panels(host).map((panel) => panel.textContent)).toEqual(['Panel for buyers', 'Panel for sellers', 'Panel for partners']);
  });

  it('scroll: the arrow keys, Home and End still move focus and the panel', () => {
    const host = clientDom(tabsNode('t-keys', { barOverflow: 'scroll' }));
    const focused = () => tabs(host).indexOf(document.activeElement as HTMLElement);
    act(() => tabs(host)[0]!.focus());
    press(tabs(host)[0]!, 'End');
    expect(focused()).toBe(2);
    expect(panels(host)[2]!.hidden).toBe(false);
    press(tabs(host)[2]!, 'ArrowRight');
    expect(focused()).toBe(0);
  });

  it('scroll: a chosen tab is brought into the bar\'s view (nearest, never the page block axis); wrap does not', () => {
    const calls: Array<{ id: string; options: unknown }> = [];
    const original = (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = function (this: HTMLElement, options: unknown) {
      calls.push({ id: this.id, options });
    };
    try {
      const host = clientDom(tabsNode('t-scroll', { barOverflow: 'scroll' }), tabsNode('t-wrap'));
      const [, , third, , fifth] = tabs(host);
      act(() => third!.click());
      expect(calls).toEqual([{ id: third!.id, options: { block: 'nearest', inline: 'nearest' } }]);
      act(() => fifth!.click());
      expect(calls).toHaveLength(1);
    } finally {
      (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = original;
    }
  });

  it('the stylesheet keeps the bar one line that scrolls inside the block, snapping, with a visible focus ring', () => {
    const sheet = css();
    expect(sheet).toContain(
      '.cmsc-pb-tabs--scroll > .cmsc-pb-tabs__list { flex-wrap: nowrap; max-width: 100%; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scroll-snap-type: x proximity;',
    );
    expect(sheet).toContain('.cmsc-pb-tabs--scroll .cmsc-pb-tabs__tab { flex-shrink: 0; white-space: nowrap; overflow-wrap: normal; scroll-snap-align: start;');
    // Today's focus ring on a tab and a panel (R-13), and one drawn inside the clipped bar.
    expect(sheet).toContain('.cmsc-pb-tabs__tab:focus-visible, .cmsc-pb-tabs__panel:focus-visible { outline: 2px solid var(--cmsb-color-primary, #1261a6); outline-offset: 2px; }');
    expect(sheet).toContain('.cmsc-pb-tabs--scroll .cmsc-pb-tabs__tab:focus-visible { outline-offset: -2px; }');
  });
});

/**
 * T163 (R9, owner request 2026-10-26): the tab size per breakpoint — smaller
 * pills on a phone. `tabSize` is a top-level value per breakpoint on the
 * Responsive tab (the size T132 put in `tabStyle`, which a nested field cannot
 * be). One size for every breakpoint renders exactly T132's classes; a size
 * stored in `tabStyle` still applies and is moved when the editor opens it.
 */
describe('cms.Tabs — the tab size per breakpoint (T163)', () => {
  const css = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');
  const root0 = (props: Record<string, unknown>): HTMLElement =>
    serverDom(tabsNode('t1', { variant: 'pills', ...props })).querySelector<HTMLElement>('.cmsc-pb-tabs')!;

  it('offers small, medium or large on the Responsive tab, unset by default', () => {
    const field = config.components['cms.Tabs']!.fields!['tabSize' as never] as { type?: string; options?: Array<{ value: unknown }>; metadata?: unknown } | undefined;
    expect(field?.type).toBe('select');
    expect(field?.options?.map((option) => option.value)).toEqual(['s', 'm', 'l']);
    expect(field?.metadata).toEqual({ pageBuilder: { responsive: true } });
    expect(defaults).not.toHaveProperty('tabSize');
  });

  it('one size for every breakpoint: exactly the classes a size in the bar\'s look writes', () => {
    expect(root0({ tabSize: 'l' }).className).toBe('cmsc-pb-tabs cmsc-pb-tabs--pills cmsc-pb-tabs--align-start cmsc-pb-tabs--size-l');
    expect(root0({ tabSize: { base: 's' } }).className).toBe('cmsc-pb-tabs cmsc-pb-tabs--pills cmsc-pb-tabs--align-start cmsc-pb-tabs--size-s');
    expect(root0({ tabSize: 'm' }).className).toBe('cmsc-pb-tabs cmsc-pb-tabs--pills cmsc-pb-tabs--align-start');
    expect(root0({ tabSize: { base: 'm', tablet: 'm', desktop: 'm' } }).getAttribute('style')).toBeNull();
    // Stored by T132 inside the bar's look: still applied.
    expect(root0({ tabStyle: { size: 'l' } }).className).toBe('cmsc-pb-tabs cmsc-pb-tabs--pills cmsc-pb-tabs--align-start cmsc-pb-tabs--size-l');
  });

  it('a size per breakpoint: the phone\'s size, then a class for each larger breakpoint that differs', () => {
    expect(root0({ tabSize: { base: 's', desktop: 'm' } }).className).toBe(
      'cmsc-pb-tabs cmsc-pb-tabs--pills cmsc-pb-tabs--align-start cmsc-pb-tabs--size-s cmsc-pb-tabs--size-lg-m',
    );
    expect(root0({ tabSize: { base: 's', tablet: 'm', desktop: 'l' } }).className).toBe(
      'cmsc-pb-tabs cmsc-pb-tabs--pills cmsc-pb-tabs--align-start cmsc-pb-tabs--size-s cmsc-pb-tabs--size-md-m cmsc-pb-tabs--size-lg-l',
    );
    // The tablet value is inherited by the desktop.
    expect(root0({ tabSize: { base: 'm', tablet: 'l' } }).className).toBe(
      'cmsc-pb-tabs cmsc-pb-tabs--pills cmsc-pb-tabs--align-start cmsc-pb-tabs--size-md-l',
    );
    // `tabSize` wins over a size left in the bar's look.
    expect(root0({ tabSize: { base: 's' }, tabStyle: { size: 'l' } }).className).toContain('cmsc-pb-tabs--size-s');
  });

  it('moves a size stored in the bar\'s look to tabSize when the editor resolves the block', async () => {
    const block = config.components['cms.Tabs']!;
    const resolved = (await block.resolveData!(
      { props: { ...defaults, id: 't1', tabStyle: { size: 's', barBackground: '#ffffff' } } } as never,
      { changed: {}, lastData: null, metadata: {}, trigger: 'load' } as never,
    )) as { props: Record<string, unknown> };
    expect(resolved.props['tabSize']).toBe('s');
    expect(resolved.props['tabStyle']).toEqual({ barBackground: '#ffffff' });
    const kept = (await block.resolveData!(
      { props: { ...defaults, id: 't2', tabSize: { base: 'l' }, tabStyle: { size: 's' } } } as never,
      { changed: {}, lastData: null, metadata: {}, trigger: 'load' } as never,
    )) as { props: Record<string, unknown> };
    expect(kept.props['tabSize']).toEqual({ base: 'l' });
  });

  it('the stylesheet sizes the tabs and the pill capsule per breakpoint, with T132\'s sizes', () => {
    const sheet = css();
    for (const [tier, min] of [['md', 768], ['lg', 1024]] as const) {
      const block = sheet.match(new RegExp(`@media \\(min-width: ${min}px\\) \\{ \\.cmsc-pb-tabs--size-${tier}-s [^@]*`))?.[0] ?? '';
      expect(block, tier).toContain(`.cmsc-pb-tabs--size-${tier}-s .cmsc-pb-tabs__tab { padding: 6px 12px; font-size: 13px; }`);
      expect(block, tier).toContain(`.cmsc-pb-tabs--size-${tier}-m .cmsc-pb-tabs__tab { padding: 10px 14px; font-size: 14px; }`);
      expect(block, tier).toContain(`.cmsc-pb-tabs--size-${tier}-l .cmsc-pb-tabs__tab { padding: 12px 20px; font-size: 16px; }`);
      expect(block, tier).toContain(`.cmsc-pb-tabs--pills.cmsc-pb-tabs--bar.cmsc-pb-tabs--size-${tier}-l .cmsc-pb-tabs__list { border-radius: 28px; }`);
    }
  });
});

/**
 * T174 (R11, owner request 2026-10-26): the tabs' hover look and a panel change
 * that visibly animates.
 *
 * - `tabStyle.hoverBackground` / `hoverColor` (a brand token or a hex) colour a
 *   tab that is not selected under the pointer, with a short transition; none
 *   set → today's classes and no transition.
 * - `effect: 'fade'` crossfades (the outgoing panel fades out over the incoming
 *   one, the panels' height follows) and `slide` adds a short sideways shift in
 *   the direction of travel. Every panel stays in the server HTML; while the
 *   outgoing panel is still shown it is `inert` and `aria-hidden`, and `hidden`
 *   again once the change ends. Reduced motion: the change is instant.
 * - `effect: 'none'` (the default) keeps today's markup, panels directly in the
 *   block.
 */
describe('cms.Tabs — hover look and an animated panel change (T174)', () => {
  const css = (): string =>
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');
  const fields = () =>
    config.components['cms.Tabs']!.fields as Record<string, { type: string; options?: Array<{ value: unknown }>; objectFields?: Record<string, { type: string }> }>;
  const wrapper = (host: HTMLElement) => host.querySelector<HTMLElement>('.cmsc-pb-tabs__panels');

  afterEach(() => {
    vi.useRealTimers();
    delete (window as { matchMedia?: unknown }).matchMedia;
  });

  function reducedMotion(reduce: boolean): void {
    (window as { matchMedia?: unknown }).matchMedia = (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion: reduce'),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    });
  }

  it('offers hover colours in the bar\'s look and a slide after instant and fade', () => {
    expect(fields()['tabStyle']!.objectFields?.['hoverBackground']?.type).toBe('custom');
    expect(fields()['tabStyle']!.objectFields?.['hoverColor']?.type).toBe('custom');
    expect(fields()['effect']!.options?.map((option) => option.value)).toEqual(['none', 'fade', 'slide']);
  });

  it('writes the hover colours as custom properties and a class; nothing set adds neither', () => {
    const plain = serverDom(tabsNode('t1', { variant: 'pills' })).querySelector<HTMLElement>('.cmsc-pb-tabs')!;
    expect(plain.className).not.toContain('cmsc-pb-tabs--hover');
    const element = serverDom(
      tabsNode('t1', { variant: 'pills', tabStyle: { hoverBackground: 'token:primary', hoverColor: '#ffffff' } }),
    ).querySelector<HTMLElement>('.cmsc-pb-tabs')!;
    expect(element.className).toContain('cmsc-pb-tabs--hover');
    expect(element.style.getPropertyValue('--cmsc-tabs-hover-bg')).toContain('var(--cmsb-color-primary');
    expect(element.style.getPropertyValue('--cmsc-tabs-hover-fg')).toBe('#ffffff');
    // Not a hex or a known token: nothing written, no class.
    const bad = serverDom(tabsNode('t1', { tabStyle: { hoverColor: 'red; x' } })).querySelector<HTMLElement>('.cmsc-pb-tabs')!;
    expect(bad.className).not.toContain('cmsc-pb-tabs--hover');
  });

  it('the stylesheet colours a tab that is not selected on hover, with a short transition off under reduced motion', () => {
    const sheet = css();
    expect(sheet).toMatch(
      /@media \(hover: hover\) \{ \.cmsc-pb-tabs--hover \.cmsc-pb-tabs__tab:not\(\.cmsc-pb-tabs__tab--active\):hover \{ background: var\(--cmsc-tabs-hover-bg, var\(--cmsc-tabs-bg, transparent\)\); color: var\(--cmsc-tabs-hover-fg, var\(--cmsc-tabs-fg, var\(--cmsb-fg-muted, #64748b\)\)\); \} \}/,
    );
    expect(sheet).toMatch(/\.cmsc-pb-tabs--hover \.cmsc-pb-tabs__tab \{ transition: background-color 200ms ease, color 200ms ease; \}/);
    expect(sheet).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.cmsc-pb-tabs--hover \.cmsc-pb-tabs__tab[^}]*transition: none/);
  });

  it('instant (the default): today\'s markup, the panels directly in the block', () => {
    const host = serverDom(tabsNode('t1'));
    expect(wrapper(host)).toBeNull();
    for (const panel of panels(host)) expect(panel.parentElement?.classList.contains('cmsc-pb-tabs')).toBe(true);
  });

  it.each(['fade', 'slide'] as const)('%s: every panel in the server HTML inside one panels box, the inactive ones hidden', (effect) => {
    const host = serverDom(tabsNode('t1', { effect, defaultTab: 1 }));
    const root0 = host.querySelector<HTMLElement>('.cmsc-pb-tabs')!;
    expect(root0.classList.contains(`cmsc-pb-tabs--${effect}`)).toBe(true);
    const box = wrapper(host)!;
    expect(box.parentElement).toBe(root0);
    expect(panels(host).every((panel) => panel.parentElement === box)).toBe(true);
    expect(panels(host).map((panel) => panel.textContent)).toEqual(['Panel for buyers', 'Panel for sellers', 'Panel for partners']);
    expect(panels(host).map((panel) => panel.hidden)).toEqual([true, false, true]);
    expect(host.querySelector('[inert], [aria-hidden]')).toBeNull();
  });

  it('fade: the outgoing panel stays shown, inert and hidden from assistive technology, until the change ends', () => {
    vi.useFakeTimers();
    reducedMotion(false);
    const host = clientDom(tabsNode('t-fade', { effect: 'fade' }));
    act(() => tabs(host)[2]!.click());
    const [first, , third] = panels(host);
    // The tabs model changes at once.
    expect(tabs(host).map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect(first!.hidden).toBe(false);
    expect(first!.hasAttribute('inert')).toBe(true);
    expect(first!.getAttribute('aria-hidden')).toBe('true');
    expect(first!.classList.contains('cmsc-pb-tabs__panel--leaving')).toBe(true);
    expect(third!.hidden).toBe(false);
    expect(third!.hasAttribute('aria-hidden')).toBe(false);
    expect(third!.hasAttribute('inert')).toBe(false);
    expect(third!.classList.contains('cmsc-pb-tabs__panel--entering')).toBe(true);
    expect(wrapper(host)!.classList.contains('cmsc-pb-tabs__panels--switching')).toBe(true);
    expect(panels(host)[1]!.hidden).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(panels(host).map((panel) => panel.hidden)).toEqual([true, true, false]);
    expect(host.querySelector('[inert], [aria-hidden], .cmsc-pb-tabs__panel--leaving, .cmsc-pb-tabs__panel--entering')).toBeNull();
    expect(wrapper(host)!.className).toBe('cmsc-pb-tabs__panels');
    expect(wrapper(host)!.style.height).toBe('');
  });

  it('a second change before the first ends hides the first outgoing panel at once', () => {
    vi.useFakeTimers();
    reducedMotion(false);
    const host = clientDom(tabsNode('t-fast', { effect: 'fade' }));
    act(() => tabs(host)[1]!.click());
    act(() => tabs(host)[2]!.click());
    expect(panels(host).map((panel) => panel.hidden)).toEqual([true, false, false]);
    expect(panels(host)[1]!.hasAttribute('inert')).toBe(true);
    expect(host.querySelectorAll('.cmsc-pb-tabs__panel--leaving')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(panels(host).map((panel) => panel.hidden)).toEqual([true, true, false]);
  });

  it('slide: the panels box knows the direction of travel; the keyboard model is unchanged', () => {
    vi.useFakeTimers();
    reducedMotion(false);
    const host = clientDom(tabsNode('t-slide', { effect: 'slide', defaultTab: 1 }));
    act(() => tabs(host)[1]!.focus());
    press(tabs(host)[1]!, 'ArrowRight');
    expect(document.activeElement).toBe(tabs(host)[2]);
    expect(wrapper(host)!.classList.contains('cmsc-pb-tabs__panels--back')).toBe(false);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    press(tabs(host)[2]!, 'Home');
    expect(document.activeElement).toBe(tabs(host)[0]);
    expect(wrapper(host)!.classList.contains('cmsc-pb-tabs__panels--back')).toBe(true);
    expect(tabs(host).map((tab) => tab.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);
  });

  it('reduced motion: the change is instant, the outgoing panel hidden at once', () => {
    reducedMotion(true);
    const host = clientDom(tabsNode('t-reduced', { effect: 'slide' }));
    act(() => tabs(host)[1]!.click());
    expect(panels(host).map((panel) => panel.hidden)).toEqual([true, false, true]);
    expect(host.querySelector('[inert], [aria-hidden], .cmsc-pb-tabs__panel--leaving')).toBeNull();
    expect(wrapper(host)!.classList.contains('cmsc-pb-tabs__panels--switching')).toBe(false);
  });

  it('the stylesheet stacks the panels while they change, animates the height, and is instant under reduced motion', () => {
    const sheet = css();
    expect(sheet).toContain('.cmsc-pb-tabs__panels { display: grid; grid-template-columns: minmax(0, 1fr); }');
    expect(sheet).toContain('.cmsc-pb-tabs__panels > .cmsc-pb-tabs__panel { grid-area: 1 / 1; align-self: start; min-width: 0; display: flow-root; }');
    expect(sheet).toMatch(/\.cmsc-pb-tabs__panels--switching \{ overflow: hidden; transition: height 300ms ease; \}/);
    expect(sheet).toMatch(/\.cmsc-pb-tabs__panel--entering \{ animation: cmsc-pb-tabs-in 300ms ease both; \}/);
    expect(sheet).toMatch(/\.cmsc-pb-tabs__panel--leaving \{ animation: cmsc-pb-tabs-out 300ms ease both; pointer-events: none; \}/);
    expect(sheet).toMatch(/\.cmsc-pb-tabs--slide \.cmsc-pb-tabs__panel--entering \{ animation-name: cmsc-pb-tabs-slide-in; \}/);
    expect(sheet).toMatch(/\.cmsc-pb-tabs--slide \.cmsc-pb-tabs__panel--leaving \{ animation-name: cmsc-pb-tabs-slide-out; \}/);
    expect(sheet).toMatch(/@keyframes cmsc-pb-tabs-slide-in \{ from \{ opacity: 0; transform: translateX\(var\(--cmsc-tabs-shift, 24px\)\); \}/);
    expect(sheet).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{[^@]*\.cmsc-pb-tabs__panel--entering, \.cmsc-pb-tabs__panel--leaving \{ animation: none; \}[^@]*\.cmsc-pb-tabs__panels--switching \{ transition: none; \}/,
    );
    // The old load-time fade is gone: the change is driven by the classes above.
    expect(sheet).not.toContain('.cmsc-pb-tabs--fade .cmsc-pb-tabs__panel:not([hidden])');
  });
});
