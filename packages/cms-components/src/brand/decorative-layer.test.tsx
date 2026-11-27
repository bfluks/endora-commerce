// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Render } from '@puckeditor/core';
import { DEFAULT_BRAND_TOKENS, type CmsBrandTokens } from '@endora-commerce/page-builder-core/brand-tokens';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { brandTokensToCss } from './brand-css.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` T136 (R5, owner gap list (a)6),
 * FR-005 as amended, research R-8a and R-21 — **an animated SVG asset can be
 * the dark scheme's decorative layer.**
 *
 * The layer is the asset the brand screen picks for the dark scheme
 * (`schemes.dark.decorativeAssetId`, any `image/*` asset, SVG included); the
 * library serves an SVG as `image/svg+xml`. A dark Section with `decorative`
 * paints it as a CSS background image, so:
 *
 * - each Section paints its own copy — there is no group background (FR-005
 *   ruling): two adjacent dark Sections show the layer twice, each covering
 *   its own box from its top centre;
 * - an SVG drawn as an image runs no script and loads nothing external; its
 *   own CSS animation does run, and the SVG can stop it under
 *   `prefers-reduced-motion: reduce` with a media query of its own, where the
 *   browser evaluates that query inside an SVG image. The page cannot stop an
 *   animation inside an image, so the stylesheet keeps the layer as it is and
 *   leaves the reduced-motion choice to the asset — tested here on the example
 *   the documentation gives.
 */

const BUILT_STYLESHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cms-components.css');
const SOURCE_STYLESHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css');
const SVG_ASSET = '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b';
const FILE_URL = `https://api.example.com/assets/file/${SVG_ASSET}`;

/**
 * The example of `packages/modules/cms/docs/cms/brand.md` ("The decorative
 * backdrop"): the animation runs only under
 * `prefers-reduced-motion: no-preference`, so a visitor who asks for reduced
 * motion sees the static drawing.
 */
const DOCUMENTED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
  <style>
    .glow { transform-origin: 800px 450px; }
    @media (prefers-reduced-motion: no-preference) {
      .glow { animation: drift 24s ease-in-out infinite alternate; }
    }
    @keyframes drift { to { transform: translateX(120px) scale(1.15); } }
  </style>
  <defs>
    <radialGradient id="g" cx="50%" cy="40%" r="50%">
      <stop offset="0" stop-color="#1d4ed8" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#1d4ed8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect class="glow" x="0" y="0" width="1600" height="900" fill="url(#g)"/>
</svg>`;

/** `value` with each `var()` replaced by the nearest ancestor's custom property, or its fallback. */
function resolveVars(element: Element, value: string): string {
  let out = value;
  for (let guard = 0; guard < 20 && out.includes('var('); guard += 1) {
    const start = out.indexOf('var(');
    let depth = 1;
    let end = start + 4;
    for (; end < out.length && depth > 0; end += 1) {
      if (out[end] === '(') depth += 1;
      if (out[end] === ')') depth -= 1;
    }
    const inner = out.slice(start + 4, end - 1);
    const comma = inner.indexOf(',');
    const name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
    const fallback = comma === -1 ? '' : inner.slice(comma + 1).trim();
    let set = '';
    for (let node: Element | null = element; node && set === ''; node = node.parentElement) {
      set = getComputedStyle(node).getPropertyValue(name).trim();
    }
    out = out.slice(0, start) + (set !== '' ? set : fallback) + out.slice(end);
  }
  return out;
}

function style(element: Element, property: string): string {
  return resolveVars(element, getComputedStyle(element).getPropertyValue(property)).trim();
}

const darkSection = (id: string, text: string): unknown => ({
  type: 'cms.Section',
  props: {
    id,
    scheme: 'dark',
    background: { kind: 'none', decorative: true },
    content: [{ type: 'cms.Text', props: { id: `${id}-text`, text } }],
  },
});

let host: HTMLElement;

beforeAll(() => {
  // jsdom ignores `@layer` blocks; the decorative rules are unlayered, so the built sheet is used as it is.
  const sheet = document.createElement('style');
  sheet.textContent = readFileSync(BUILT_STYLESHEET, 'utf8');
  document.head.appendChild(sheet);
  const tokens: CmsBrandTokens = {
    ...DEFAULT_BRAND_TOKENS,
    schemes: { ...DEFAULT_BRAND_TOKENS.schemes, dark: { ...DEFAULT_BRAND_TOKENS.schemes.dark, decorativeAssetId: SVG_ASSET } },
  };
  const brand = document.createElement('style');
  brand.id = 'cmsb';
  brand.textContent = brandTokensToCss(tokens, { assetUrl: (id) => `https://api.example.com/assets/file/${id}` }).css;
  document.head.appendChild(brand);

  host = document.createElement('div');
  host.innerHTML = renderToString(
    createElement(Render as never, {
      config: defaultPageBuilderConfig as never,
      data: { root: { props: {} }, content: [darkSection('s-1', 'First'), darkSection('s-2', 'Second')], zones: {} } as never,
    }),
  );
  document.body.appendChild(host);
});

describe('an animated SVG as the dark scheme\'s decorative layer (T136)', () => {
  it('each dark decorative Section paints the SVG file as its own cover layer, from its top centre', () => {
    const sections = Array.from(host.querySelectorAll<HTMLElement>('section.cmsc-section'));
    expect(sections).toHaveLength(2);
    for (const section of sections) {
      expect(section.getAttribute('data-decorative')).toBe('1');
      expect(style(section, 'background-image').replace(/["']/g, '')).toBe(`url(${FILE_URL})`);
      expect(style(section, 'background-size')).toBe('cover');
      expect(['top center', 'center top']).toContain(style(section, 'background-position'));
      expect(style(section, 'background-repeat')).toBe('no-repeat');
    }
  });

  it('draws no group background: nothing around the adjacent Sections carries the layer', () => {
    const sections = Array.from(host.querySelectorAll('section.cmsc-section'));
    expect(sections).toHaveLength(2);
    for (const section of sections) {
      for (let node = section.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        expect(style(node, 'background-image'), node.outerHTML.slice(0, 80)).toMatch(/^(none)?$/);
      }
    }
    expect(host.querySelectorAll('[data-decorative]')).toHaveLength(2);
  });

  it('a light Section asking for the layer paints nothing: the layer is the dark scheme\'s', () => {
    const light = document.createElement('div');
    light.innerHTML = renderToString(
      createElement(Render as never, {
        config: defaultPageBuilderConfig as never,
        data: {
          root: { props: {} },
          content: [{ type: 'cms.Section', props: { id: 'l-1', scheme: 'light', background: { kind: 'none', decorative: true }, content: [] } }],
          zones: {},
        } as never,
      }),
    );
    document.body.appendChild(light);
    expect(style(light.querySelector('section')!, 'background-image')).toBe('none');
  });

  it('the stylesheet keeps the layer under reduced motion: the asset decides how it moves', () => {
    const css = readFileSync(SOURCE_STYLESHEET, 'utf8');
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((match) => match[1]).join('\n');
    expect(reduced).not.toContain('data-decorative');
    expect(reduced).not.toContain('--cmsb-decorative');
  });

  it('the documented example is an SVG an image can draw, animated only when motion is allowed', () => {
    const svg = new DOMParser().parseFromString(DOCUMENTED_SVG, 'image/svg+xml');
    expect(svg.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(svg.documentElement.tagName).toBe('svg');
    // Nothing an SVG drawn as an image would refuse to run or fetch.
    expect(svg.getElementsByTagName('script')).toHaveLength(0);
    expect(DOCUMENTED_SVG).not.toMatch(/(?:href|src)="(?:https?:)?\/\//);
    // CSS animation (which a media query can stop), not SMIL (which it cannot).
    expect(svg.getElementsByTagName('animate')).toHaveLength(0);
    const rules = svg.getElementsByTagName('style')[0]!.textContent!;
    const gated = /@media \(prefers-reduced-motion: no-preference\) \{([^}]*\{[^}]*\})\s*\}/.exec(rules);
    expect(gated?.[1]).toContain('animation:');
    expect(rules.replace(gated![0], '')).not.toMatch(/animation\s*:/);
  });
});

/**
 * T154 (R8, owner gap list (a)1): the layer may be given as a URL instead of a
 * library asset, as T142 allowed for video — https: or a site-relative path,
 * which the storefront rebases on the API origin. A Section paints it exactly
 * as it paints the asset.
 */
describe('a decorative layer given as a URL (T154)', () => {
  it('a dark decorative Section paints the URL as its cover layer', () => {
    const brand = document.getElementById('cmsb')!;
    const before = brand.textContent;
    const tokens = {
      ...DEFAULT_BRAND_TOKENS,
      schemes: { ...DEFAULT_BRAND_TOKENS.schemes, dark: { ...DEFAULT_BRAND_TOKENS.schemes.dark, decorativeUrl: '/media/lights.svg' } },
    } as CmsBrandTokens;
    try {
      brand.textContent = brandTokensToCss(tokens, { mediaUrl: (url) => `https://api.example.com${url}` }).css;
      const section = host.querySelector<HTMLElement>('section.cmsc-section')!;
      expect(style(section, 'background-image').replace(/["']/g, '')).toBe('url(https://api.example.com/media/lights.svg)');
      expect(style(section, 'background-size')).toBe('cover');
    } finally {
      brand.textContent = before;
    }
  });
});

/**
 * T167 (R10, owner gap list (a)3): the layer's size, repeat and position,
 * chosen with the block's `decorative` toggle (the Section's or the group's
 * background value, not a brand token). Unset is today's `cover` from the top
 * centre, no repeat; a size in px keeps the layer that size at every width, so
 * a tall group shows the backdrop at its own scale down the column instead of
 * one image stretched to the group's height.
 */
describe('the decorative layer\'s size, repeat and position (T167)', () => {
  function renderContent(content: unknown[]): HTMLElement {
    const box = document.createElement('div');
    box.innerHTML = renderToString(
      createElement(Render as never, { config: defaultPageBuilderConfig as never, data: { root: { props: {} }, content, zones: {} } as never }),
    );
    document.body.appendChild(box);
    return box;
  }
  const LAYOUT = { decorativeSize: { px: 720 }, decorativeRepeat: 'repeat-y', decorativePosition: 'top' } as const;

  it('a dark decorative Section paints the layer at the chosen size, repeated down, from the top centre', () => {
    const box = renderContent([
      { type: 'cms.Section', props: { id: 'd-1', scheme: 'dark', background: { kind: 'none', decorative: true, ...LAYOUT }, content: [] } },
    ]);
    const section = box.querySelector<HTMLElement>('section.cmsc-section')!;
    expect(style(section, 'background-image').replace(/["']/g, '')).toBe(`url(${FILE_URL})`);
    expect(style(section, 'background-size')).toBe('720px');
    expect(style(section, 'background-repeat')).toBe('repeat-y');
    expect(['top center', 'center top']).toContain(style(section, 'background-position'));
  });

  it('a Section group paints it once on its paint layer, and the Sections inside take none of it', () => {
    const box = renderContent([
      {
        type: 'cms.SectionGroup',
        props: {
          id: 'g-1',
          scheme: 'dark',
          background: { kind: 'solid', color: '#000000', decorative: true, decorativeSize: { percent: 100 }, decorativeRepeat: 'repeat-y', decorativePosition: 'center' },
          content: [{ type: 'cms.Section', props: { id: 'g-1-s', content: [{ type: 'cms.Text', props: { id: 'g-1-t', text: 'Inside' } }] } }],
        },
      },
    ]);
    const paint = box.querySelector<HTMLElement>('.cmsc-section-group__paint')!;
    expect(style(paint, 'background-image').replace(/["']/g, '')).toBe(`url(${FILE_URL})`);
    expect(style(paint, 'background-size')).toBe('100%');
    expect(style(paint, 'background-repeat')).toBe('repeat-y');
    expect(['center', 'center center']).toContain(style(paint, 'background-position'));
    const inside = box.querySelector<HTMLElement>('section.cmsc-section')!;
    expect(inside.getAttribute('data-decorative')).toBeNull();
    expect(style(inside, 'background-image')).toMatch(/^(none)?$/);
  });

  it('unset on a group: today\'s cover from the top centre, no repeat', () => {
    const box = renderContent([
      { type: 'cms.SectionGroup', props: { id: 'g-2', scheme: 'dark', background: { kind: 'none', decorative: true }, content: [] } },
    ]);
    const paint = box.querySelector<HTMLElement>('.cmsc-section-group__paint')!;
    expect(style(paint, 'background-size')).toBe('cover');
    expect(['top center', 'center top']).toContain(style(paint, 'background-position'));
    expect(style(paint, 'background-repeat')).toBe('no-repeat');
  });
});
