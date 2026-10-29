// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Render, type Config } from '@puckeditor/core';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig, withCmsPageRoot } from '../index.js';
import { CatalogPreviewProvider } from '../components/catalog-preview-context.js';
import { blockDataKey, blogPostsDataRequest } from '../utils/block-data.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no
// ResizeObserver, and nothing here is resized.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` standing rule 9, research R-3,
 * SC-004 — **with no `<style id="cmsb">` on the page, every block looks
 * exactly as it does on `origin/master`.**
 *
 * The page builder's stylesheet now reads `--cmsb-*` brand variables, each
 * with today's literal as its fallback. A deployment that never opens the
 * brand screen, a storefront whose `cms` module is off, and the e-mail editor
 * (which shares `cms-components.css` and never receives brand tokens) all
 * render through those fallbacks, so a fallback that drifts from today's
 * literal is a visible change nobody asked for.
 *
 * The harness renders each block with its own `defaultProps` through Puck's
 * `<Render>` (the storefront's path), into a jsdom document carrying the
 * **built** stylesheet and nothing else, and reads computed styles. Two
 * things jsdom does not do are done here, and only those:
 *
 * - it ignores rules inside `@layer` blocks, so the layers are unwrapped and
 *   placed before the unlayered rules — the precedence `@layer` gives them;
 * - it does not substitute `var()`, so {@link resolveVars} does, looking the
 *   custom property up the ancestor chain and taking the fallback when it is
 *   not set — which, with no brand tokens, is every `--cmsb-*`.
 *
 * The expected values are **literals recorded from `origin/master`**
 * (2026-10-22, before Phase 3b), never read from the code under test.
 *
 * Every later phase that reshapes a block adds that block's default render
 * here (plan § *Extend, don't narrow*): with no tokens, its default colours,
 * alignment and sizes equal today's.
 */

// A string, not a `URL`: under jsdom the global `URL` is jsdom's, which `fileURLToPath` refuses.
const BUILT_STYLESHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/cms-components.css');

/** Today's literals (`origin/master`). */
const ORIGIN = {
  primary: 'rgb(18, 97, 166)', // #1261a6
  white: 'rgb(255, 255, 255)',
  headingText: 'rgb(21, 32, 43)', // #15202b
  bodyText: 'rgb(36, 52, 71)', // #243447, cms.Text's default colour prop
  inlineSans: 'Inter, system-ui, -apple-system, sans-serif', // FONT_FAMILY_CSS.sans
  themeSans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', // `cmsc:font-sans`
  headingSizes: { h1: '48px', h2: '40px', h3: '32px', h4: '26px', h5: '22px', h6: '18px' },
  pageMaxWidth: '1360px',
  pagePadding: '24px',
  gap: '24px',
  rowPadding: '16px', // DEFAULT_LAYOUT_BOX_PROPS.padding, cms.Row's default
  /** `cms.Hero`'s `defaultProps` on origin/master, as a page stored then holds them. */
  heroDefaults: {
    heading: 'Grow your B2B sales',
    subtitle: 'Publish landing pages with catalog, content, and CTAs in one place.',
    buttonLabel: 'Get started',
    buttonLinkType: 'url',
    buttonLinkSlug: '',
    buttonHref: '/',
    buttonTarget: '_self',
    buttonVariant: 'primary',
    minHeightPx: 360,
    contentAlign: 'left',
    overlayOpacity: 45,
    textColor: '#ffffff',
    background: { kind: 'gradient', gradientFrom: '#0f766e', gradientTo: '#134e4a', gradientAngle: 135 },
    padding: { mode: 'uniform', value: 48 },
  },
} as const;

// ── Harness ──────────────────────────────────────────────────────────

/** The built stylesheet with its `@layer` blocks unwrapped ahead of the unlayered rules. */
function flattenLayers(css: string): string {
  const probe = document.createElement('style');
  probe.textContent = css;
  document.head.appendChild(probe);
  const layered: string[] = [];
  const unlayered: string[] = [];
  for (const rule of Array.from(probe.sheet!.cssRules)) {
    const kind = rule.constructor.name;
    if (kind === 'CSSLayerStatementRule') continue;
    if (kind === 'CSSLayerBlockRule') {
      for (const inner of Array.from((rule as CSSGroupingRule).cssRules)) layered.push(inner.cssText);
      continue;
    }
    unlayered.push(rule.cssText);
  }
  probe.remove();
  return [...layered, ...unlayered].join('\n');
}

/** The index of the parenthesis closing the one opened just before `from`. */
function closingParen(value: string, from: number): number {
  let depth = 1;
  for (let i = from; i < value.length; i += 1) {
    if (value[i] === '(') depth += 1;
    else if (value[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `name, fallback` split at the first top-level comma. */
function splitVarArgs(args: string): [string, string | null] {
  let depth = 0;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '(') depth += 1;
    else if (args[i] === ')') depth -= 1;
    else if (args[i] === ',' && depth === 0) return [args.slice(0, i).trim(), args.slice(i + 1).trim()];
  }
  return [args.trim(), null];
}

/** A custom property's specified value on the element or its nearest ancestor that sets it. */
function customProperty(element: Element, name: string): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = getComputedStyle(node).getPropertyValue(name).trim();
    if (value !== '') return value;
  }
  return '';
}

/** `value` with every `var()` substituted as a browser would, relative to `element`. */
function resolveVars(element: Element, value: string, depth = 0): string {
  if (depth > 20) throw new Error(`var() cycle in ${value}`);
  const start = value.indexOf('var(');
  if (start === -1) return value;
  const end = closingParen(value, start + 4);
  const [name, fallback] = splitVarArgs(value.slice(start + 4, end));
  const set = customProperty(element, name);
  const substituted = set !== '' ? set : (fallback ?? '');
  return resolveVars(element, value.slice(0, start) + substituted + value.slice(end + 1), depth + 1);
}

/** A `cmsc-btn` button's border colour: the `--cmsc-btn-border` its style and fill classes set. */
function buttonBorder(element: Element): string {
  return rgb(resolveVars(element, 'var(--cmsc-btn-border)'));
}

function style(element: Element, property: string): string {
  return resolveVars(element, getComputedStyle(element).getPropertyValue(property)).trim();
}

/** A colour as `rgb(r, g, b)`, through the CSSOM's own normaliser. */
function rgb(value: string): string {
  const probe = document.createElement('i');
  probe.style.color = value;
  return probe.style.color || value;
}

function fontStack(value: string): string {
  return value.replace(/'/g, '"').replace(/\s*,\s*/g, ', ').trim();
}

function render(
  type: string,
  props: Record<string, unknown> = {},
  config: Config = defaultPageBuilderConfig as Config,
): HTMLElement {
  const block = (config.components as Record<string, { defaultProps?: Record<string, unknown> }>)[type];
  const data = {
    root: { props: {} },
    content: [{ type, props: { id: `${type}-1`, ...(block?.defaultProps ?? {}), ...props } }],
    zones: {},
  };
  const host = document.createElement('div');
  host.innerHTML = renderToString(createElement(Render as never, { config: config as never, data: data as never }));
  document.body.appendChild(host);
  return host;
}

function query(host: HTMLElement, selector: string): HTMLElement {
  const found = host.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`${selector} not rendered:\n${host.innerHTML}`);
  return found;
}

// ── Tests ────────────────────────────────────────────────────────────

let builtCss = '';

beforeAll(() => {
  builtCss = readFileSync(BUILT_STYLESHEET, 'utf8');
  const sheet = document.createElement('style');
  sheet.textContent = flattenLayers(builtCss);
  document.head.appendChild(sheet);
  expect(document.getElementById('cmsb')).toBeNull();
});

describe('fallback parity with no brand tokens (standing rule 9)', () => {
  it('the built stylesheet reads the brand variables with today\'s literals as fallback', () => {
    const minified = builtCss.replace(/\s+/g, '');
    expect(minified).toContain('var(--cmsb-color-primary,#1261a6)');
    expect(minified).toMatch(/var\(--cmsb-font-body,Inter,/);
    expect(minified).toContain('var(--cmsb-t-h1-size,48px)');
  });

  it('cms.Button: each variant keeps today\'s colours, font and size', () => {
    // T039 (deliberately changed, standing rule 13): the button renders through
    // the shared `ButtonView`, so the class and the border are read from
    // `cmsc-btn--primary-<fill>` and its `--cmsc-btn-border` rather than from
    // `cmsc-pb-btn-<variant>`. The values are today's. Each variant is checked
    // both as a block stored on origin/master and as the reshaped `ButtonSpec`.
    const stored = (variant: string): Record<string, unknown> => ({
      button: undefined,
      label: 'Call to action',
      linkType: 'url',
      href: '/',
      target: '_self',
      variant,
    });
    const spec = (fill: string): Record<string, unknown> => ({
      button: { label: 'Call to action', link: { kind: 'url', href: '/' }, style: 'primary', fill, size: 'medium' },
    });

    for (const props of [{}, stored('primary'), spec('solid')]) {
      const primary = query(render('cms.Button', props), 'a');
      expect(rgb(style(primary, 'background-color'))).toBe(ORIGIN.primary);
      expect(primary.classList).toContain('cmsc-btn--primary-solid');
      expect(buttonBorder(primary)).toBe(ORIGIN.primary);
      expect(rgb(style(primary, 'color'))).toBe(ORIGIN.white);
      expect(fontStack(style(primary, 'font-family'))).toBe(ORIGIN.themeSans);
      expect(style(primary, 'font-size')).toBe('14px');
      expect(style(primary, 'font-weight')).toBe('700');
      expect(style(primary, 'min-height')).toBe('40px');
      expect(style(primary, 'border-radius')).toBe('8px');
    }

    // The white-filled `secondary` variant stays white-filled.
    for (const props of [stored('secondary'), spec('outline')]) {
      const secondary = query(render('cms.Button', props), 'a');
      expect(rgb(style(secondary, 'background-color'))).toBe(ORIGIN.white);
      expect(secondary.classList).toContain('cmsc-btn--primary-outline');
      expect(buttonBorder(secondary)).toBe(ORIGIN.primary);
      expect(rgb(style(secondary, 'color'))).toBe(ORIGIN.primary);
    }

    for (const props of [stored('ghost'), spec('text')]) {
      const ghost = query(render('cms.Button', props), 'a');
      expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(style(ghost, 'background-color'));
      expect(rgb(style(ghost, 'color'))).toBe(ORIGIN.primary);
    }
  });

  it('cms.Heading: every level keeps today\'s size, colour and font', () => {
    // T039 (deliberately changed, standing rule 13): the reshaped heading
    // separates the level from the size, and its default `size` is `h2`. Each
    // level is checked as a heading stored on origin/master (no `size`, today's
    // stored typography) and as a reshaped one whose size is its level. The
    // values are today's.
    for (const [level, size] of Object.entries(ORIGIN.headingSizes)) {
      const storedProps = {
        level,
        size: undefined,
        font: undefined,
        text: 'Section heading',
        fontFamily: 'sans',
        fontStyle: 'normal',
        color: '#15202b',
        fontWeight: 700,
        textAlign: 'left',
        lineHeight: 1.12,
      };
      for (const [shape, props] of [
        ['stored', storedProps],
        ['reshaped', { level, size: level }],
      ] as const) {
        const heading = query(render('cms.Heading', props), level);
        expect(style(heading, 'font-size'), `${shape} ${level}`).toBe(size);
        expect(rgb(style(heading, 'color')), `${shape} ${level}`).toBe(ORIGIN.headingText);
        expect(fontStack(style(heading, 'font-family')), `${shape} ${level}`).toBe(ORIGIN.inlineSans);
        expect(style(heading, 'font-weight'), `${shape} ${level}`).toBe('700');
        expect(style(heading, 'line-height'), `${shape} ${level}`).toBe('1.12');
      }
    }
  });

  it('cms.Heading default render (T039): h2 at today\'s size, weight, line height, colour and font, start-aligned', () => {
    const heading = query(render('cms.Heading'), 'h2');
    expect(heading.classList).toContain('cmsc-t--h2');
    expect(style(heading, 'font-size')).toBe(ORIGIN.headingSizes.h2);
    expect(style(heading, 'font-weight')).toBe('700');
    expect(style(heading, 'line-height')).toBe('1.12');
    expect(style(heading, 'letter-spacing')).toBe('0em');
    expect(rgb(style(heading, 'color'))).toBe(ORIGIN.headingText);
    expect(fontStack(style(heading, 'font-family'))).toBe(ORIGIN.inlineSans);
    expect(style(heading, 'margin-top')).toBe('0px');
    expect(heading.getAttribute('data-align')).toBe('left');
  });

  it('cms.Text keeps today\'s size, colour and font', () => {
    // R17 (T216, deliberately changed, standing rule 13): a *new* text has no colour of its own and
    // follows its section's; a text stored with today's default colour keeps it.
    const text = query(render('cms.Text', { color: '#243447' }), 'p');
    expect(style(text, 'font-size')).toBe('16px');
    expect(rgb(style(text, 'color'))).toBe(ORIGIN.bodyText);
    expect(fontStack(style(text, 'font-family'))).toBe(ORIGIN.inlineSans);
    expect(query(render('cms.Text'), 'p').style.color).toBe('');
  });

  it('cms.Hero stored on origin/master keeps today\'s text colour, heading size, overlay, layout and button colours', () => {
    // T043 (deliberately changed, standing rule 13): the default hero is no
    // longer today's teal-gradient banner (contracts/blocks.md: no media, so no
    // overlay, and the scheme's colours), so today's look is checked on a hero
    // stored with origin/master's `defaultProps` rather than on the default. The
    // values are today's; the button is read from the shared `ButtonView`.
    const host = render('cms.Hero', {
      media: undefined,
      title: undefined,
      buttons: undefined,
      titleSize: undefined,
      subheadingSize: undefined,
      statementSize: undefined,
      gaps: undefined,
      align: undefined,
      minHeight: undefined,
      ...ORIGIN.heroDefaults,
    });
    const root = query(host, '.cmsc-pb-hero');
    expect(rgb(style(root, 'color'))).toBe(ORIGIN.white);
    expect(style(root, 'min-height')).toBe('360px');
    expect(root.getAttribute('style')).toContain('linear-gradient(135deg, #0f766e, #134e4a)');
    // jsdom's CSSOM drops a `clamp()` value, so the heading's size is read from the rule itself.
    expect(builtCss.replace(/\s+/g, '')).toMatch(
      /\.cmsc-pb-hero__heading\{[^}]*font-size:clamp\(1\.75rem,3vw,2\.5rem\)/,
    );
    const heading = query(host, 'h2.cmsc-pb-hero__heading');
    expect(style(heading, 'font-weight')).toBe('700');
    expect(style(heading, 'margin-bottom')).toBe('12px');
    const subtitle = query(host, 'p.cmsc-pb-hero__subtitle');
    expect(style(subtitle, 'margin-bottom')).toBe('20px');
    const overlay = query(host, '.cmsc-pb-hero__overlay');
    // The minified rule reads `rgb(15 23 42/var(--cmsc-hero-overlay,.4))`: today's slate at 45 %.
    expect(style(overlay, 'background-color').replace(/\s*\/\s*/, ' / ')).toBe('rgb(15 23 42 / 0.45)');
    const content = query(host, '.cmsc-pb-hero__content');
    expect(style(content, 'text-align')).toBe('left');
    const cta = query(host, 'a');
    expect(rgb(style(cta, 'background-color'))).toBe(ORIGIN.primary);
    expect(rgb(style(cta, 'color'))).toBe(ORIGIN.white);
  });

  it('cms.Hero default render (T043): an h1-sized title in today\'s heading colour and font, start-aligned with today\'s spacing, one primary button, no overlay', () => {
    // Coordinator ruling 2026-10-23 (deliberately changed, standing rule 13):
    // the default is start-aligned (today's `contentAlign: 'left'`), not
    // centred, and keeps today's 12 px / 20 px spacing under the title and the
    // subheading.
    const host = render('cms.Hero', {
      subheading: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Subheading' }] }] },
    });
    expect(style(query(host, 'h1'), 'margin-bottom')).toBe('12px');
    expect(style(query(host, '.cmsc-pb-hero__subheading'), 'margin-bottom')).toBe('20px');
    const root = query(host, '.cmsc-pb-hero');
    expect(rgb(style(root, 'color'))).toBe(ORIGIN.headingText);
    expect(['transparent', 'rgba(0, 0, 0, 0)', '']).toContain(style(root, 'background-color'));
    expect(host.querySelector('.cmsc-pb-hero__overlay')).toBeNull();
    const title = query(host, 'h1');
    expect(style(title, 'font-size')).toBe(ORIGIN.headingSizes.h1);
    expect(style(title, 'font-weight')).toBe('700');
    expect(style(title, 'line-height')).toBe('1.12');
    expect(fontStack(style(title, 'font-family'))).toBe(ORIGIN.inlineSans);
    expect(rgb(style(title, 'color'))).toBe(ORIGIN.headingText);
    expect(style(query(host, '.cmsc-pb-hero__content'), 'text-align')).toBe('left');
    const cta = query(host, 'a');
    expect(cta.classList).toContain('cmsc-btn--primary-solid');
    expect(rgb(style(cta, 'background-color'))).toBe(ORIGIN.primary);
    expect(rgb(style(cta, 'color'))).toBe(ORIGIN.white);
  });

  it('cms.FeatureList default render (T048): today\'s three columns 24 px apart, 28 px teal icons, today\'s title and description look, left-aligned', () => {
    // Recorded from origin/master (b816c1d55): `FeatureListBody` wrote the
    // columns and the gap inline (3, 24 px), `.cmsc-pb-feature-list__title`
    // 1.05rem / 600 / #15202b, `__desc` 0.9rem / 1.45 / #475569, icons 28 px in #0f766e.
    for (const [shape, props] of [
      ['default', {}],
      [
        'stored',
        {
          items: [{ icon: 'truck', title: 'Fast delivery', description: 'Reliable logistics.' }],
          columns: 3,
          gap: 24,
          gapPx: undefined,
          iconColor: '#0f766e',
          iconSize: 28,
          align: 'left',
        },
      ],
    ] as const) {
      const host = render('cms.FeatureList', props);
      const grid = query(host, 'ul.cmsc-pb-feature-list');
      expect(style(grid, 'display'), shape).toBe('grid');
      expect(style(grid, 'grid-template-columns'), shape).toBe('repeat(3, minmax(0, 1fr))');
      expect(style(grid, 'gap'), shape).toBe(ORIGIN.gap);
      expect(style(grid, 'text-align'), shape).toBe('left');
      const title = query(host, 'h3.cmsc-pb-feature-list__title');
      expect(style(title, 'font-size'), shape).toBe('1.05rem');
      expect(style(title, 'font-weight'), shape).toBe('600');
      expect(rgb(style(title, 'color')), shape).toBe(ORIGIN.headingText);
      const desc = query(host, '.cmsc-pb-feature-list__desc');
      expect(style(desc, 'font-size'), shape).toBe('0.9rem');
      expect(style(desc, 'line-height'), shape).toBe('1.45');
      expect(rgb(style(desc, 'color')), shape).toBe('rgb(71, 85, 105)');
      const icon = query(host, '.cmsc-pb-feature-list__icon');
      expect(rgb(style(icon, 'color') || resolveVars(icon, icon.style.color)), shape).toBe('rgb(15, 118, 110)');
      expect(query(host, '.cmsc-pb-feature-list__icon svg').getAttribute('width'), shape).toBe('28');
    }
  });

  it('cms.Stats default render (T048): today\'s four centred columns 24 px apart, teal values, muted labels', () => {
    // Recorded from origin/master (b816c1d55): columns 4 and gap 24 px inline,
    // centred; `.cmsc-pb-stats__value` clamp(1.5rem, 2.5vw, 2rem) / 700 / 1.1 in
    // #0f766e; `__label` 0.9rem in #64748b.
    for (const [shape, props] of [
      ['default', {}],
      ['stored', { columns: 4, gap: 24, gapPx: undefined, align: 'center', valueColor: '#0f766e' }],
    ] as const) {
      const host = render('cms.Stats', props);
      const grid = query(host, 'ul.cmsc-pb-stats');
      expect(style(grid, 'grid-template-columns'), shape).toBe('repeat(4, minmax(0, 1fr))');
      expect(style(grid, 'gap'), shape).toBe(ORIGIN.gap);
      expect(style(grid, 'text-align'), shape).toBe('center');
      const value = query(host, '.cmsc-pb-stats__value');
      expect(style(value, 'font-weight'), shape).toBe('700');
      expect(style(value, 'line-height'), shape).toBe('1.1');
      expect(rgb(resolveVars(value, value.style.color)), shape).toBe('rgb(15, 118, 110)');
      const label = query(host, '.cmsc-pb-stats__label');
      expect(style(label, 'font-size'), shape).toBe('0.9rem');
      expect(rgb(style(label, 'color')), shape).toBe('rgb(100, 116, 139)');
    }
    // jsdom's CSSOM drops a `clamp()` value, so the value's size is read from the rule itself.
    expect(builtCss.replace(/\s+/g, '')).toMatch(/\.cmsc-pb-stats__value:not\(\.cmsc-pb-stats__value--token\)\{font-size:clamp\(1\.5rem,2\.5vw,2rem\)/);
  });

  it('cms.Testimonial default render (T048): today\'s card — light fill, 24 px padding, quote, author and role colours', () => {
    // Recorded from origin/master (b816c1d55): `defaultProps` background #f8fafc,
    // padding 24 px, corners `medium`; `.cmsc-pb-testimonial__quote` 1.15rem /
    // 1.55 / #15202b, `__author` 600 / #15202b, `__role` 0.875rem / #64748b.
    for (const [shape, props] of [
      ['default', {}],
      ['stored', { quote: '“Simple and fast.”', layout: undefined, avatarSource: 'url', avatarUrl: '', avatarAssetId: '' }],
    ] as const) {
      const host = render('cms.Testimonial', props);
      expect(query(host, '.cmsc-pb-testimonial').outerHTML, shape).toContain('#f8fafc');
      const quote = query(host, 'blockquote.cmsc-pb-testimonial__quote');
      expect(style(quote, 'font-size'), shape).toBe('1.15rem');
      expect(style(quote, 'line-height'), shape).toBe('1.55');
      expect(rgb(style(quote, 'color')), shape).toBe(ORIGIN.headingText);
      expect(style(quote, 'margin-bottom'), shape).toBe('16px');
      const author = query(host, '.cmsc-pb-testimonial__author');
      expect(style(author, 'font-weight'), shape).toBe('600');
      const role = query(host, '.cmsc-pb-testimonial__role');
      expect(style(role, 'font-size'), shape).toBe('0.875rem');
      expect(rgb(style(role, 'color')), shape).toBe('rgb(100, 116, 139)');
      // A rich quote's paragraph sits flush, as today's bare text did.
      const paragraph = quote.querySelector('p');
      if (paragraph) expect(style(paragraph, 'margin-top'), shape).toBe('0px');
    }
  });

  it('cms.Row keeps today\'s page container width, side padding and gaps', () => {
    // T112: the row is back to its origin/master shape, so its container frame
    // is again the row's own `.cmsc-pb-row-inner` (T034 had read the section's
    // `.cmsc-section__frame`). The values are today's.
    const host = render('cms.Row', { sectionLayout: 'full_width' });
    const inner = query(host, '.cmsc-pb-row-full-width .cmsc-pb-row-inner');
    expect(style(inner, 'max-width')).toBe(ORIGIN.pageMaxWidth);
    expect(style(inner, 'padding-left')).toBe(ORIGIN.pagePadding);
    expect(style(inner, 'padding-right')).toBe(ORIGIN.pagePadding);
    const columns = query(host, '.cmsc-pb-row-cols');
    // jsdom keeps the `gap` shorthand as written; it does not expand it.
    expect(style(columns, 'gap')).toBe(ORIGIN.gap);
    expect(style(columns, 'row-gap')).toBe(ORIGIN.gap);

    // Where no block sets a gap, the stylesheet's default gap applies.
    const bare = document.createElement('div');
    bare.className = 'cmsc-pb-gap cmsc-pb-row-gap';
    document.body.appendChild(bare);
    expect(style(bare, 'gap')).toBe(ORIGIN.gap);
    expect(style(bare, 'row-gap')).toBe(ORIGIN.gap);

    const page = query(
      render('cms.Row', {}, withCmsPageRoot(defaultPageBuilderConfig as Config)),
      '.cmsc-pb-page',
    );
    expect(style(page, 'max-width')).toBe(ORIGIN.pageMaxWidth);
    expect(style(page, 'padding-left')).toBe(ORIGIN.pagePadding);
    expect(style(page, 'padding-right')).toBe(ORIGIN.pagePadding);
  });

  it('cms.Row default render (T112, origin/master shape): today\'s 16 px padding, no colour, in the page container, no section', () => {
    const host = render('cms.Row');
    expect(host.querySelector('.cmsc-section')).toBeNull();
    // The box `BoxStyled` writes for a row, as on origin/master.
    const box = query(host, '[data-row-section="in_flow"]');
    const padding = ORIGIN.rowPadding;
    expect(box.getAttribute('style')).toContain(`--pb-padding:${padding} ${padding} ${padding} ${padding}`);
    expect(box.getAttribute('style')).toContain('--pb-margin:0px 0px 0px 0px');
    expect(style(box, 'background-color')).toBe('rgba(0, 0, 0, 0)');
  });

  /**
   * This case's budget, declared rather than defaulted. The inner row sits 20
   * elements deep, and with no brand tokens each `var()` misses on every one of
   * them, so {@link customProperty} asks jsdom for a computed value 20 times per
   * variable — about 40 ms a call against the built stylesheet, because jsdom
   * re-runs the cascade per property read (a cache of the declaration saves
   * nothing). Measured on a quiet host: 2.4 s for this case, against under
   * 0.4 s for any other in the file; on a loaded CI runner it passed the default
   * 10 s and failed `master` after #478 with nothing wrong in the render.
   */
  const NESTED_ROW_BUDGET_MS = 30_000;

  it('cms.Row nested keeps today\'s render, container frame included', () => {
    const row = (defaultPageBuilderConfig as Config).components['cms.Row']!.defaultProps as Record<string, unknown>;
    const column = (defaultPageBuilderConfig as Config).components['cms.Column']!.defaultProps as Record<string, unknown>;
    const host = render('cms.Row', {
      content: [
        {
          type: 'cms.Column',
          props: {
            ...column,
            id: 'column-1',
            content: [{ type: 'cms.Row', props: { ...row, id: 'row-nested', sectionLayout: 'full_width' } }],
          },
        },
      ],
    });
    const nested = query(host, '.cmsc-pb-row-full-width');
    expect(nested.getAttribute('data-row-section')).toBe('full_width');
    const inner = query(nested, '.cmsc-pb-row-inner');
    expect(style(inner, 'max-width')).toBe(ORIGIN.pageMaxWidth);
    expect(style(inner, 'padding-left')).toBe(ORIGIN.pagePadding);
  }, NESTED_ROW_BUDGET_MS);

  it('cms.ContentSlider stored on origin/master (T054): one per view 16 px apart, today\'s round white arrows over the edges, its 16 px padding', () => {
    // Recorded from origin/master (b816c1d55): `defaultProps` slidesPerView 1,
    // gap 16, arrows and dots shown, padding DEFAULT_LAYOUT_PADDING (16 px);
    // `.cmsc-pb-carousel__arrow` 36 px round, #fff on a #e2e8f0 border, 20 px
    // glyph, absolutely placed 8 px in from each edge at mid-height.
    const host = render('cms.ContentSlider', {
      slides: [
        { type: 'cms.Slide', props: { id: 'slide-1', content: [] } },
        { type: 'cms.Slide', props: { id: 'slide-2', content: [] } },
      ],
      slidesPerView: 1,
      gap: 16,
      showArrows: true,
      showDots: true,
      controls: undefined,
      header: undefined,
    });
    // The box around the track, as `BoxStyled` wrote it for today's slider.
    const box = query(host, '.cmsc-pb-padding');
    expect(box.contains(query(host, '.cmsc-pb-carousel'))).toBe(true);
    expect(box.getAttribute('style')).toContain('--pb-padding:16px 16px 16px 16px');
    const carousel = query(host, '.cmsc-pb-carousel');
    expect(resolveVars(carousel, 'var(--pb-spv)')).toBe('1');
    expect(resolveVars(carousel, 'var(--pb-gap)')).toBe('16px');
    for (const side of ['prev', 'next'] as const) {
      const arrow = query(host, `.cmsc-pb-carousel__arrow--${side}`);
      expect(style(arrow, 'position'), side).toBe('absolute');
      expect(style(arrow, 'top'), side).toBe('50%');
      expect(style(arrow, side === 'prev' ? 'left' : 'right'), side).toBe('8px');
      expect(style(arrow, 'width'), side).toBe('36px');
      expect(style(arrow, 'height'), side).toBe('36px');
      expect(style(arrow, 'border-radius'), side).toBe('50%');
      expect(rgb(style(arrow, 'background-color')), side).toBe(ORIGIN.white);
      expect(rgb(resolveVars(arrow, 'var(--cmsb-n-200, #e2e8f0)')), side).toBe('rgb(226, 232, 240)');
      expect(style(arrow, 'font-size'), side).toBe('20px');
    }
    // A slide is (100% - (spv - 1) × gap) / spv wide: the full track at one per view.
    expect(builtCss.replace(/\s+/g, '')).toContain('--cmsc-slide-w:calc((100%-(var(--cmsc-spv)-1)*var(--cmsc-gap))/var(--cmsc-spv))');
    // Today's dot colours, drawn 8 px inside a 24 px target.
    // (The minifier reorders declarations, so each is read on its own.)
    const dot = /\.cmsc-pb-carousel__dot:?:before\{([^}]*)\}/.exec(builtCss)?.[1] ?? '';
    for (const declaration of ['background:var(--cmsb-n-300,#cbd5e1)', 'border-radius:50%', 'width:8px', 'height:8px']) {
      expect(dot.replace(/\s+/g, ''), declaration).toContain(declaration);
    }
    expect(builtCss.replace(/\s+/g, '')).toMatch(/\.cmsc-pb-carousel__dot--active:?:before\{background:var\(--cmsb-n-700,#334155\)/);
  });

  it('cms.ContentSlider default render (T054): the same arrows below the track, today\'s 16 px gap on mobile, no autoplay', () => {
    const host = render('cms.ContentSlider');
    const carousel = query(host, '.cmsc-pb-carousel');
    expect(resolveVars(carousel, 'var(--pb-gap)')).toBe('16px');
    const arrow = query(host, '.cmsc-pb-carousel__controls--below .cmsc-pb-carousel__arrow--next');
    expect(style(arrow, 'position')).not.toBe('absolute');
    expect(style(arrow, 'width')).toBe('36px');
    expect(rgb(style(arrow, 'background-color'))).toBe(ORIGIN.white);
    expect(host.querySelector('.cmsc-pb-carousel__pause')).toBeNull();
  });
});

/**
 * Defects of the local rebuild (T120–T123): the new blocks read the section's
 * colour scheme and the brand fonts, and their rich bodies fit a narrow column.
 * The no-token look stays today's (the first case of each).
 */
describe('scheme, fonts and overflow of the new blocks (T120–T123)', () => {
  const doc = (...content: unknown[]): unknown => ({ type: 'doc', content });
  const para = (text: string): unknown => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const RICH_HTML = '<h2>Heading</h2><p>Body <a href="/a">link</a></p><blockquote><p>Quote</p></blockquote>';

  function renderTree(content: unknown[], hostStyle: Record<string, string> = {}): HTMLElement {
    const host = document.createElement('div');
    for (const [name, value] of Object.entries(hostStyle)) host.style.setProperty(name, value);
    host.innerHTML = renderToString(
      createElement(Render as never, { config: defaultPageBuilderConfig as never, data: { root: { props: {} }, content, zones: {} } as never }),
    );
    document.body.appendChild(host);
    return host;
  }

  const richContent = (id: string): unknown => ({ type: 'cms.RichContent', props: { id, content: null, html: RICH_HTML } });
  const darkSection = (id: string, content: unknown[]): unknown => ({ type: 'cms.Section', props: { id, scheme: 'dark', content } });

  it('T120 cms.RichContent with no tokens keeps today\'s text, heading and link colours, 16 px and 1.65', () => {
    const host = renderTree([richContent('rc-1')]);
    const p = query(host, 'p');
    expect(rgb(style(p, 'color'))).toBe(ORIGIN.bodyText);
    expect(style(p, 'font-size')).toBe('16px');
    expect(style(p, 'line-height')).toBe('1.65');
    expect(rgb(style(query(host, 'h2'), 'color'))).toBe(ORIGIN.headingText);
    expect(rgb(style(query(host, 'a'), 'color'))).toBe('rgb(37, 99, 235)'); // #2563eb
    expect(rgb(style(query(host, 'blockquote'), 'color'))).toBe('rgb(71, 85, 105)'); // #475569
  });

  it('T120 cms.RichContent in a dark Section reads the scheme\'s text, heading, link and muted colours', () => {
    const host = renderTree([darkSection('s-1', [richContent('rc-1')])]);
    expect(rgb(style(query(host, '.cmsc-section p'), 'color'))).toBe('rgb(248, 250, 252)'); // #f8fafc
    expect(rgb(style(query(host, '.cmsc-section h2'), 'color'))).toBe('rgb(248, 250, 252)');
    expect(rgb(style(query(host, '.cmsc-section a'), 'color'))).toBe('rgb(147, 197, 253)'); // #93c5fd
    expect(rgb(style(query(host, '.cmsc-section blockquote'), 'color'))).toBe('rgb(203, 213, 225)'); // #cbd5e1
  });

  it('T120 cms.RichContent reads the body size and the heading font from the brand', () => {
    const host = renderTree([richContent('rc-1')], {
      '--cmsb-t-body-size': '18px',
      '--cmsb-font-heading': '"Brand Heading", serif',
    });
    expect(style(query(host, 'p'), 'font-size')).toBe('18px');
    expect(fontStack(style(query(host, 'h2'), 'font-family'))).toBe('"Brand Heading", serif');
  });

  const BODY_BLOCKS: ReadonlyArray<[string, Record<string, unknown>, string]> = [
    ['cms.MediaText', { heading: 'Heading', body: doc(para('Media body')) }, '.cmsc-pb-media-text__body'],
    ['cms.FeatureList', { items: [{ title: 'Fast', body: doc(para('Feature body')) }] }, '.cmsc-pb-feature-list__body'],
    ['cms.Statement', { heading: 'Heading', body: doc(para('Statement body')) }, '.cmsc-pb-statement__body'],
    ['cms.CtaCard', { heading: 'Heading', body: doc(para('Card body')) }, '.cmsc-pb-cta-card__body'],
    ['cms.BackgroundPanel', { heading: 'Heading', body: doc(para('Panel body')) }, '.cmsc-pb-panel__body'],
    ['cms.Hero', { title: 'Title', body: doc(para('Hero body')) }, '.cmsc-pb-hero__body'],
    ['cms.Testimonial', { quote: doc(para('Quote body')), author: 'A. Author' }, '.cmsc-pb-testimonial__quote'],
    ['cms.CarouselSplit', { title: 'Title', body: doc(para('Split body')) }, '.cmsc-pb-carousel-split__body'],
  ];

  it.each(BODY_BLOCKS)('T122 %s: with no tokens the body keeps the page\'s font, as today', (type, props, selector) => {
    const body = query(render(type, props), selector);
    expect(['', 'inherit']).toContain(style(body, 'font-family'));
  });

  it.each(BODY_BLOCKS)('T122 %s: the body takes the brand body font, a heading in it the brand heading font', (type, props, selector) => {
    const withHeading = { ...props };
    for (const key of ['body', 'quote']) {
      if (key in withHeading) {
        withHeading[key] = doc({ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Sub' }] }, para('Text'));
      }
    }
    if ('items' in withHeading) {
      withHeading['items'] = [{ title: 'Fast', body: doc({ type: 'heading', attrs: { level: 4 }, content: [{ type: 'text', text: 'Sub' }] }, para('Text')) }];
    }
    const host = renderTree([{ type, props: { id: `${type}-b`, ...((defaultPageBuilderConfig as Config).components[type]?.defaultProps ?? {}), ...withHeading } }], {
      '--cmsb-font-body': '"Brand Body", sans-serif',
      '--cmsb-font-heading': '"Brand Heading", serif',
    });
    const body = query(host, selector);
    expect(fontStack(style(body, 'font-family'))).toBe('"Brand Body", sans-serif');
    expect(fontStack(style(query(body, 'h4'), 'font-family'))).toBe('"Brand Heading", serif');
  });

  it('T122 cms.FeatureList title takes the brand heading font, and keeps the page\'s font with no tokens', () => {
    const props = { items: [{ title: 'Fast', body: doc(para('Feature body')) }] };
    expect(['', 'inherit']).toContain(style(query(render('cms.FeatureList', props), '.cmsc-pb-feature-list__title'), 'font-family'));
    const host = renderTree(
      [{ type: 'cms.FeatureList', props: { id: 'fl-h', ...((defaultPageBuilderConfig as Config).components['cms.FeatureList']?.defaultProps ?? {}), ...props } }],
      { '--cmsb-font-heading': '"Brand Heading", serif' },
    );
    expect(fontStack(style(query(host, '.cmsc-pb-feature-list__title'), 'font-family'))).toBe('"Brand Heading", serif');
  });

  it.each(BODY_BLOCKS)('T121 %s: an image in the body never overflows its column', (type, props, selector) => {
    const withImage = { ...props };
    const image = { type: 'image', attrs: { src: 'https://cdn.example.com/wide.png', alt: '' } };
    for (const key of ['body', 'quote']) if (key in withImage) withImage[key] = doc(para('Text'), image);
    if ('items' in withImage) withImage['items'] = [{ title: 'Fast', body: doc(para('Text'), image) }];
    const img = query(query(render(type, withImage), selector), 'img');
    expect(style(img, 'max-width')).toBe('100%');
    expect(style(img, 'height')).toBe('auto');
  });

  it('T123 cms.Tabs: the tab list wraps inside its block, and a long label wraps inside its tab', () => {
    const host = render('cms.Tabs', { variant: 'pills' });
    expect(style(query(host, '.cmsc-pb-tabs__list'), 'flex-wrap')).toBe('wrap');
    const tab = query(host, '.cmsc-pb-tabs__tab');
    expect(style(tab, 'min-width')).toBe('0px');
    expect(style(tab, 'overflow-wrap')).toBe('anywhere');
  });
});

/**
 * T126, T127: `cms.Video` and `cms.Image` gain options, all off by default;
 * with none chosen they look as they do on origin/master.
 */
describe('cms.Video and cms.Image keep today\'s look with no new option chosen (T126, T127)', () => {
  it('cms.Video: an embed in today\'s rounded 16:9 frame', () => {
    const host = render('cms.Video', { url: 'https://www.youtube.com/watch?v=abc123' });
    const frame = query(host, '.cmsc-pb-video iframe').parentElement as HTMLElement;
    expect(frame.style.paddingTop).toBe('56.25%');
    expect(style(frame, 'position')).toBe('relative');
    expect(style(frame, 'overflow')).toBe('hidden');
    expect(host.querySelector('.cmsc-pb-video__frame, video')).toBeNull();
  });

  it('cms.Image: one inline-block <img>, its natural width up to the column, no frame, figure or overlay', () => {
    const host = render('cms.Image', { src: 'https://cdn.example.com/a.jpg' });
    const img = query(host, 'img');
    expect(img.style.display).toBe('inline-block');
    expect(img.style.width).toBe('auto');
    expect(img.style.maxWidth).toBe('100%');
    expect(img.style.objectFit).toBe('cover');
    expect(img.style.opacity).toBe('1');
    expect(host.querySelector('picture, figure, .cmsc-pb-image__frame, .cmsc-pb-image__overlay')).toBeNull();
  });
});

/**
 * T133–T135 (R5): with none of the new options chosen, the extended blocks
 * look as before — the hero's elements in today's order with today's spacing,
 * the accordion's bare 15 px semibold triggers, text at full width, and the
 * card's own line.
 */
describe('the R5 extensions keep today\'s look with no new option chosen (T133–T135)', () => {
  it('T134 cms.Accordion: bare triggers with today\'s 15 px semibold title', () => {
    const host = render('cms.Accordion');
    expect(host.querySelector('.cmsc-pb-accordion__heading, h2, h3, h4, h5, h6')).toBeNull();
    const trigger = query(host, '.cmsc-pb-accordion__trigger');
    expect(style(trigger, 'font-size')).toBe('15px');
    expect(style(trigger, 'font-weight')).toBe('600');
    const title = query(host, '.cmsc-pb-accordion__title');
    expect(title.getAttribute('style')).toBeNull();
  });

  it('T134 cms.Accordion: a heading level adds no margin or size of its own; a sized title reads the type scale', () => {
    const heading = query(render('cms.Accordion', { titleLevel: 'h3' }), 'h3.cmsc-pb-accordion__heading');
    expect(style(heading, 'margin-top')).toBe('0px');
    expect(style(heading, 'margin-bottom')).toBe('0px');
    expect(style(query(heading, '.cmsc-pb-accordion__trigger'), 'font-size')).toBe('15px');
    const sized = query(render('cms.Accordion', { titleSize: 'h4' }), '.cmsc-pb-accordion__title');
    expect(style(sized, 'font-size')).toBe(ORIGIN.headingSizes.h4);
  });

  it.each(['cms.Text', 'cms.Statement', 'cms.RichContent'])('T134 %s: no measure, so the text spans its column', (type) => {
    const host = render(type, type === 'cms.RichContent' ? { content: null, html: '<p>Body</p>' } : {});
    expect(host.querySelector('.cmsc-text-max')).toBeNull();
    for (const element of Array.from(host.querySelectorAll('p, h2'))) {
      expect(style(element, 'max-width'), element.outerHTML.slice(0, 60)).toMatch(/^(none)?$/);
    }
  });

  it('T134 cms.Text with a measure, centred: held to it and centred in its column', () => {
    const text = query(render('cms.Text', { textMaxWidth: 'medium', textAlign: 'center' }), 'p');
    expect(style(text, 'max-width')).toBe('48rem');
    expect(style(text, 'margin-left')).toBe('auto');
    expect(style(text, 'margin-right')).toBe('auto');
  });

  it('T133 cms.Hero: today\'s spacing between the texts, nothing under the last button row', () => {
    const host = render('cms.Hero', { subheading: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sub' }] }] } });
    expect(style(query(host, '.cmsc-pb-hero__title'), 'margin-bottom')).toBe('12px');
    expect(style(query(host, '.cmsc-pb-hero__subheading'), 'margin-bottom')).toBe('20px');
    expect(style(query(host, '.cmsc-pb-hero__actions'), 'margin-bottom')).toMatch(/^(0(px)?)?$/);
    expect(query(host, '.cmsc-pb-hero').classList.contains('cmsc-pb-hero--media-viewport')).toBe(false);
  });

  it('T133 cms.Hero: buttons placed before the title keep 20 px above it', () => {
    const host = render('cms.Hero', { order: [{ element: 'buttons' }] });
    const actions = query(host, '.cmsc-pb-hero__actions');
    expect(actions.nextElementSibling?.classList.contains('cmsc-pb-hero__title')).toBe(true);
    expect(style(actions, 'margin-bottom')).toBe('20px');
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` R5 (T129–T132): the carousel's
 * arrow look, grid, filter and scrim, and the tab bar's look. With nothing set,
 * the arrows and tabs keep today's computed look (the first case of each);
 * each option then changes only what it names. jsdom does not evaluate
 * `@media`, so the per-breakpoint rules are read from the built stylesheet.
 */
describe('carousel controls, grid, filter and scrim; the tab bar (T129–T132)', () => {
  const carousel = (props: Record<string, unknown>): HTMLElement => render('cms.ContentSlider', props);
  const arrow = (host: HTMLElement): HTMLElement => query(host, '.cmsc-pb-carousel__arrow--next');
  /**
   * A paint set through a `var()` in the `background` shorthand: jsdom keeps
   * the shorthand's text and leaves `background-color` unset, so it is read
   * from the shorthand, its variables resolved up the ancestor chain. jsdom
   * does not expand a `border` shorthand holding a `var()` either; those
   * colours are read from the stylesheet's rule and the custom property.
   */
  const paint = (element: HTMLElement): string => rgb(style(element, 'background'));
  const TRANSPARENT = 'rgba(0, 0, 0, 0)';

  it('T129 the default arrows keep today\'s 36 px white circle with a light border and slate icon', () => {
    const next = arrow(carousel({}));
    expect(style(next, 'width')).toBe('36px');
    expect(style(next, 'height')).toBe('36px');
    expect(rgb(style(next, 'background-color'))).toBe(ORIGIN.white);
    expect(builtCss.replace(/\s+/g, '')).toContain('border:1pxsolidvar(--cmsb-n-200,#e2e8f0)');
    expect(rgb(style(next, 'color'))).toBe('rgb(51, 65, 85)'); // #334155
    expect(style(next, 'border-radius')).toBe('50%');
  });

  it('T129 an outline, large, square arrow; a solid arrow in the chosen colour', () => {
    const outline = arrow(carousel({ controls: { arrows: true, dots: false, arrowVariant: 'outline', arrowSize: 'l', arrowShape: 'square' } }));
    expect(style(outline, 'width')).toBe('44px');
    // The minifier writes `transparent` as `#0000`, which jsdom does not parse: read the rule.
    expect(builtCss).toMatch(/\.cmsc-pb-carousel--arrows-outline \.cmsc-pb-carousel__arrow\{[^}]*background-color:(#0000|transparent)/);
    expect(style(outline, 'border-radius')).toBe('6px');
    const solid = arrow(carousel({ controls: { arrows: true, dots: false, arrowVariant: 'solid', arrowColor: '#1d4ed8' } }));
    expect(paint(solid)).toBe('rgb(29, 78, 216)');
    expect(rgb(style(solid, 'color'))).toBe(ORIGIN.white);
    const colored = arrow(carousel({ controls: { arrows: true, dots: false, arrowColor: '#1d4ed8' } }));
    expect(rgb(style(colored, 'color'))).toBe('rgb(29, 78, 216)');
    expect(rgb(style(colored, 'background-color'))).toBe(ORIGIN.white);
  });

  it('T129 the stylesheet removes a control group where its placement does not apply', () => {
    const minified = builtCss.replace(/\s+/g, '');
    expect(minified).toMatch(/@media\(max-width:767\.98px\)\{\.cmsc-pb-carousel__controls--off-sm\{display:none!important\}\}/);
    expect(minified).toMatch(/\.cmsc-pb-carousel__controls--off-md\{display:none!important\}/);
    expect(minified).toMatch(/@media\(min-width:1024px\)\{\.cmsc-pb-carousel__controls--off-lg\{display:none!important\}\}/);
  });

  it('T130 the grid lays the items out in columns, and a filtered-out item takes no place', () => {
    const host = carousel({ layout: 'grid', columns: { base: 1, tablet: 2, desktop: 4 } });
    const list = query(host, '.cmsc-pb-carousel--grid .cmsc-pb-carousel__slides');
    expect(style(list, 'display')).toBe('grid');
    expect(style(list, 'grid-template-columns')).toBe('repeat(1, minmax(0, 1fr))');
    const item = query(host, '.cmsc-pb-carousel__slide');
    expect(style(item, 'max-width')).toBe('none');
    item.hidden = true;
    expect(style(item, 'display')).toBe('none');
    // Equal heights make a slide a flex column; a hidden one still takes no place.
    const slide = query(carousel({ equalHeight: true }), '.cmsc-pb-carousel__slide');
    expect(style(slide, 'display')).toBe('flex');
    slide.hidden = true;
    expect(style(slide, 'display')).toBe('none');
  });

  it('T131 the filter bar wraps and its buttons are 36 px targets; the pressed one is filled', () => {
    const host = carousel({ filter: { show: true, allLabel: 'All', tags: [{ tag: 'a', label: 'Alpha' }] } });
    expect(style(query(host, '.cmsc-pb-carousel__filter'), 'flex-wrap')).toBe('wrap');
    const pressed = query(host, '.cmsc-pb-carousel__filter-button--active');
    expect(style(pressed, 'min-height')).toBe('36px');
    expect(paint(pressed)).toBe(ORIGIN.headingText);
    expect(rgb(style(pressed, 'color'))).toBe(ORIGIN.white);
  });

  it('T129 a scrim lies behind an overlay caption, whose own box gives way to it', () => {
    const image = { imageSource: 'url', src: 'https://cdn.example.com/a.jpg', alt: '' };
    const caption = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lake' }] }] };
    const plain = render('cms.CarouselImage', { image, caption, captionPlacement: 'bottom-left' });
    expect(style(query(plain, '.cmsc-pb-carousel-image__caption'), 'background-color')).not.toBe(TRANSPARENT);
    const host = render('cms.CarouselImage', { image, caption, captionPlacement: 'bottom-left', captionScrim: { kind: 'gradient', strength: 70 } });
    const scrim = query(host, '.cmsc-pb-carousel-image__scrim');
    expect(style(scrim, 'position')).toBe('absolute');
    expect(style(scrim, 'background')).toContain('linear-gradient(to top');
    const onScrim = query(host, '.cmsc-pb-carousel-image__caption');
    expect(style(onScrim, 'background-color')).toBe(TRANSPARENT);
    expect(rgb(style(onScrim, 'color'))).toBe(ORIGIN.white);
  });

  it('T132 the tabs keep today\'s colours with nothing set', () => {
    const pills = render('cms.Tabs', { variant: 'pills' });
    const active = query(pills, '.cmsc-pb-tabs__tab--active');
    expect(paint(active)).toBe('rgb(15, 23, 42)'); // #0f172a
    expect(rgb(style(active, 'color'))).toBe(ORIGIN.white);
    expect(rgb(style(query(pills, '.cmsc-pb-tabs__tab:not(.cmsc-pb-tabs__tab--active)'), 'color'))).toBe('rgb(100, 116, 139)'); // #64748b
    expect(style(query(pills, '.cmsc-pb-tabs__tab'), 'font-size')).toBe('14px');
    const underline = render('cms.Tabs', {});
    expect(builtCss.replace(/\s+/g, '')).toContain('border-bottom:1pxsolidvar(--cmsc-tabs-bar-border,var(--cmsb-n-200,#e2e8f0))');
    expect(['transparent', TRANSPARENT]).toContain(paint(query(underline, '.cmsc-pb-tabs__list')));
    expect(rgb(style(query(underline, '.cmsc-pb-tabs__tab--active'), 'color'))).toBe('rgb(15, 23, 42)');
  });

  it('T132 the tab bar\'s look: a capsule bar, the chosen colours and size, still wrapping', () => {
    const host = render('cms.Tabs', {
      variant: 'pills',
      tabStyle: { size: 'l', barBackground: '#ffffff', barBorderColor: '#0f172a', activeBackground: '#1d4ed8', activeColor: '#ffffff', inactiveColor: '#334155' },
    });
    const list = query(host, '.cmsc-pb-tabs__list');
    expect(paint(list)).toBe(ORIGIN.white);
    expect(rgb(resolveVars(list, 'var(--cmsc-tabs-bar-border)'))).toBe('rgb(15, 23, 42)');
    expect(builtCss.replace(/\s+/g, '')).toContain('border:1pxsolidvar(--cmsc-tabs-bar-border,transparent)');
    expect(style(list, 'border-radius')).toBe('28px');
    expect(style(list, 'flex-wrap')).toBe('wrap');
    expect(style(list, 'max-width')).toBe('100%');
    const active = query(host, '.cmsc-pb-tabs__tab--active');
    expect(paint(active)).toBe('rgb(29, 78, 216)');
    expect(style(active, 'font-size')).toBe('16px');
    expect(rgb(style(query(host, '.cmsc-pb-tabs__tab:not(.cmsc-pb-tabs__tab--active)'), 'color'))).toBe('rgb(51, 65, 85)');
  });
});

/**
 * R6 (T138–T140), defects found by the second local rebuild. Each case
 * pairs the defect (a Section with a content frame, a dark scheme, a media
 * frame's corners) with today's look where none of that is chosen.
 */
describe('R6: rows in a content frame, body text in a scheme, media frames (T138–T140)', () => {
  const blockDefaults = (type: string): Record<string, unknown> =>
    ((defaultPageBuilderConfig as Config).components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  const block = (type: string, id: string, props: Record<string, unknown> = {}): unknown => ({
    type,
    props: { ...blockDefaults(type), id, ...props },
  });
  const section = (id: string, props: Record<string, unknown>, content: unknown[]): unknown =>
    block('cms.Section', id, { ...props, content });
  function renderTree(content: unknown[]): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = renderToString(
      createElement(Render as never, { config: defaultPageBuilderConfig as never, data: { root: { props: {} }, content, zones: {} } as never }),
    );
    document.body.appendChild(host);
    return host;
  }
  /** Markup built by hand inside a scheme, for blocks whose render needs catalogue data. */
  function inScheme(scheme: string | null, html: string): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = scheme ? `<section class="cmsc-section" data-cmsb-scheme="${scheme}">${html}</section>` : html;
    document.body.appendChild(host);
    return host;
  }
  /** WCAG 2.x contrast ratio of two `rgb(…)` colours. */
  function contrast(a: string, b: string): number {
    const lum = (value: string): number => {
      const [r, g, bl] = (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map((n) => {
        const c = Number(n) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
    return (hi + 0.05) / (lo + 0.05);
  }
  const DARK_BG = 'rgb(15, 23, 42)'; // the dark scheme's built-in background, #0f172a
  const doc = (text: string): unknown => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  /** A background set through a `var()` in the `background` shorthand (see the T129 cases). */
  const paint = (element: HTMLElement): string => {
    const value = style(element, 'background');
    return value === '#0000' ? 'transparent' : rgb(value);
  };
  /** The dark scheme's translucent light tint, as the built stylesheet writes it. */
  const DARK_TINT = /^(rgb\(255 255 255 \/ 10%\)|rgba\(255, 255, 255, 0\.1\)|#ffffff1a|#fff1a)$/;

  it('T138 a Row in an edge-to-edge Section with a content width adds no inset of its own', () => {
    for (const contentWidth of ['contained', 'wide', 'custom']) {
      const host = renderTree([section(`s-${contentWidth}`, { width: 'bleed', contentWidth }, [block('cms.Row', 'r-1')])]);
      const inner = query(host, '[data-row-section="in_flow"] .cmsc-pb-row-inner');
      expect(style(inner, 'padding-left'), contentWidth).not.toBe(ORIGIN.pagePadding);
      expect(style(inner, 'padding-right'), contentWidth).not.toBe(ORIGIN.pagePadding);
      expect(style(inner, 'max-width'), contentWidth).not.toBe(ORIGIN.pageMaxWidth);
    }
  });

  it('T138 a Row in an edge-to-edge Section with no content width keeps today\'s container frame', () => {
    const host = renderTree([section('s-1', { width: 'bleed' }, [block('cms.Row', 'r-1')])]);
    const inner = query(host, '[data-row-section="in_flow"] .cmsc-pb-row-inner');
    expect(style(inner, 'max-width')).toBe(ORIGIN.pageMaxWidth);
    expect(style(inner, 'padding-left')).toBe(ORIGIN.pagePadding);
    expect(style(inner, 'padding-right')).toBe(ORIGIN.pagePadding);
  });

  it('T139 cms.FeatureList: the body follows a dark scheme at AA contrast, and keeps today\'s #475569 with none', () => {
    const items = [{ title: 'Fast', description: 'Plain body.', body: doc('Rich body') }];
    const plain = renderTree([block('cms.FeatureList', 'fl-1', { items })]);
    expect(rgb(style(query(plain, '.cmsc-pb-feature-list__desc'), 'color'))).toBe('rgb(71, 85, 105)');
    const dark = renderTree([section('s-1', { scheme: 'dark' }, [block('cms.FeatureList', 'fl-2', { items })])]);
    const desc = rgb(style(query(dark, '.cmsc-pb-feature-list__desc'), 'color'));
    expect(desc).toBe('rgb(203, 213, 225)'); // #cbd5e1, the dark scheme's muted text
    expect(contrast(desc, DARK_BG)).toBeGreaterThanOrEqual(4.5);
  });

  it('T139 the other block texts on the scheme\'s background follow it, today\'s colours with none', () => {
    const cases: ReadonlyArray<[string, string, string, string]> = [
      // [what, markup, selector, today's colour]
      ['product card SKU', '<div class="cmsc-pb-product-card cmsc-pb-product-card--showcase"><span class="cmsc-pb-product-card__sku">SKU-1</span></div>', '.cmsc-pb-product-card__sku', 'rgb(100, 116, 139)'],
      ['product card stock', '<div class="cmsc-pb-product-card"><span class="cmsc-pb-product-card__stock">3</span></div>', '.cmsc-pb-product-card__stock', 'rgb(100, 116, 139)'],
      ['category count', '<ul class="cmsc-pb-category-list"><li><span class="cmsc-pb-category-list__count">(3)</span></li></ul>', '.cmsc-pb-category-list__count', 'rgb(100, 116, 139)'],
      ['carousel image placeholder', '<figure class="cmsc-pb-carousel-image"><div class="cmsc-pb-carousel-image__placeholder">Add an image</div></figure>', '.cmsc-pb-carousel-image__placeholder', 'rgb(100, 116, 139)'],
      ['underline tab, active', '<div class="cmsc-pb-tabs cmsc-pb-tabs--underline"><button class="cmsc-pb-tabs__tab cmsc-pb-tabs__tab--active">A</button></div>', '.cmsc-pb-tabs__tab--active', 'rgb(15, 23, 42)'],
    ];
    for (const [what, markup, selector, today] of cases) {
      expect(rgb(style(query(inScheme(null, markup), selector), 'color')), what).toBe(today);
      const dark = rgb(style(query(inScheme('dark', markup), selector), 'color'));
      expect(contrast(dark, DARK_BG), `${what}: ${dark}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('T139 surfaces drawn under scheme text follow the scheme: a default product card, chips, the boxed and pill tabs', () => {
    const card = '<div class="cmsc-pb-product-card"><a class="cmsc-pb-product-card__name">Name</a></div>';
    expect(rgb(style(query(inScheme(null, card), '.cmsc-pb-product-card'), 'background-color'))).toBe(ORIGIN.white);
    expect(paint(query(inScheme('dark', card), '.cmsc-pb-product-card'))).toBe(DARK_BG);
    const chips = '<ul class="cmsc-pb-category-list cmsc-pb-category-list--chips"><li><a class="cmsc-pb-category-list__link">A</a></li></ul>';
    expect(paint(query(inScheme(null, chips), '.cmsc-pb-category-list__link'))).toBe('rgb(241, 245, 249)'); // #f1f5f9
    expect(style(query(inScheme('dark', chips), '.cmsc-pb-category-list__link'), 'background')).toMatch(DARK_TINT);
    const boxed = '<div class="cmsc-pb-tabs cmsc-pb-tabs--boxed"><button class="cmsc-pb-tabs__tab cmsc-pb-tabs__tab--active">A</button></div>';
    expect(paint(query(inScheme(null, boxed), '.cmsc-pb-tabs__tab--active'))).toBe('rgb(241, 245, 249)');
    expect(style(query(inScheme('dark', boxed), '.cmsc-pb-tabs__tab--active'), 'background')).toMatch(DARK_TINT);
    const pills = '<div class="cmsc-pb-tabs cmsc-pb-tabs--pills"><button class="cmsc-pb-tabs__tab cmsc-pb-tabs__tab--active">A</button></div>';
    const pill = query(inScheme('dark', pills), '.cmsc-pb-tabs__tab--active');
    expect(paint(pill)).toBe('rgb(248, 250, 252)'); // the scheme's text colour, inverted
    expect(rgb(style(pill, 'color'))).toBe(DARK_BG);
  });

  it('T140 cms.LinkTile: today\'s 8 px light frame by default; the image corners option and a scheme reach it', () => {
    const tile = query(renderTree([block('cms.LinkTile', 'lt-1')]), '.cmsc-pb-link-tile__media');
    expect(style(tile, 'border-radius')).toBe('8px');
    expect(paint(tile)).toBe('rgb(241, 245, 249)');
    expect(blockDefaults('cms.LinkTile')['mediaCornerRadius']).toBe('medium');
    const square = query(renderTree([block('cms.LinkTile', 'lt-2', { mediaCornerRadius: 'none' })]), '.cmsc-pb-link-tile__media');
    expect(style(square, 'border-radius')).toBe('0px');
    const large = query(renderTree([block('cms.LinkTile', 'lt-3', { mediaCornerRadius: 'large' })]), '.cmsc-pb-link-tile__media');
    expect(style(large, 'border-radius')).toBe('16px');
    const dark = renderTree([section('s-1', { scheme: 'dark' }, [block('cms.LinkTile', 'lt-4')])]);
    expect(paint(query(dark, '.cmsc-pb-link-tile__media'))).toBe('transparent');
    expect(style(query(dark, '.cmsc-pb-link-tile__placeholder'), 'background')).toMatch(DARK_TINT);
  });

  it('T140 cms.CarouselImage: today\'s 8 px light frame by default; the image corners option and a scheme reach it', () => {
    const figure = query(renderTree([block('cms.CarouselImage', 'ci-1')]), '.cmsc-pb-carousel-image');
    expect(style(figure, 'border-radius')).toBe('8px');
    expect(paint(figure)).toBe('rgb(241, 245, 249)');
    expect(blockDefaults('cms.CarouselImage')['mediaCornerRadius']).toBe('medium');
    const square = query(renderTree([block('cms.CarouselImage', 'ci-2', { mediaCornerRadius: 'none' })]), '.cmsc-pb-carousel-image');
    expect(style(square, 'border-radius')).toBe('0px');
    const dark = renderTree([section('s-1', { scheme: 'dark' }, [block('cms.CarouselImage', 'ci-3')])]);
    expect(paint(query(dark, '.cmsc-pb-carousel-image'))).toBe('transparent');
    expect(style(query(dark, '.cmsc-pb-carousel-image__placeholder'), 'background')).toMatch(DARK_TINT);
  });

  it('T140 cms.Video: today\'s 8 px frames by default; the frame corners option reaches the file frame, the embed and its iframe', () => {
    const file = { source: 'file', url: 'https://cdn.example.com/a.mp4' };
    expect(blockDefaults('cms.Video')['mediaCornerRadius']).toBe('medium');
    expect(style(query(renderTree([block('cms.Video', 'v-1', file)]), '.cmsc-pb-video__frame'), 'border-radius')).toBe('8px');
    expect(style(query(renderTree([block('cms.Video', 'v-2', { ...file, mediaCornerRadius: 'none' })]), '.cmsc-pb-video__frame'), 'border-radius')).toBe('0px');
    const embed = { url: 'https://www.youtube.com/watch?v=abc123' };
    const iframe = query(renderTree([block('cms.Video', 'v-3', embed)]), '.cmsc-pb-video iframe');
    expect(style(iframe, 'border-radius')).toBe('8px');
    const square = query(renderTree([block('cms.Video', 'v-4', { ...embed, mediaCornerRadius: 'none' })]), '.cmsc-pb-video iframe');
    expect(style(square, 'border-radius')).toBe('0px');
    expect(style(square.parentElement as HTMLElement, 'border-radius')).toBe('0px');
  });
});

/**
 * T148 (R7): a Section's overlap and its collapse when empty. With neither
 * chosen nor applicable, a Section keeps today's look — the default `l`
 * spacing as padding, its frame in place, no stacking order of its own.
 */
describe('cms.Section overlap and empty collapse keep today\'s look when unused (T148)', () => {
  const blockDefaults = (type: string): Record<string, unknown> =>
    ((defaultPageBuilderConfig as Config).components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  const block = (type: string, id: string, props: Record<string, unknown> = {}): unknown => ({
    type,
    props: { ...blockDefaults(type), id, ...props },
  });
  const section = (id: string, props: Record<string, unknown>, content: unknown[]): unknown =>
    block('cms.Section', id, { ...props, content });
  function renderTree(content: unknown[]): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = renderToString(
      createElement(Render as never, { config: defaultPageBuilderConfig as never, data: { root: { props: {} }, content, zones: {} } as never }),
    );
    document.body.appendChild(host);
    return host;
  }
  const sections = (host: HTMLElement): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('section.cmsc-section'));
  const frame = (element: HTMLElement): HTMLElement => element.querySelector<HTMLElement>(':scope > .cmsc-section__frame')!;
  const zero = (value: string): boolean => /^0(px)?$/.test(value);
  const text = (id: string): unknown => block('cms.Text', id, { text: 'Body' });
  const news = (id: string): unknown => block('blog.LatestPosts', id);

  it('an untouched Section after another: today\'s padding, its frame in place, no stacking order', () => {
    const [, second] = sections(renderTree([section('s-1', {}, [text('t-1')]), section('s-2', {}, [text('t-2')])])) as [HTMLElement, HTMLElement];
    expect(style(second, 'padding-top')).toBe('40px');
    expect(zero(style(frame(second), 'margin-top'))).toBe(true);
    expect(['', 'auto']).toContain(style(second, 'z-index'));
  });

  it('an overlapping Section pulls its frame up by the overlap and stacks above the previous section', () => {
    const [first, second] = sections(
      renderTree([section('s-1', { scheme: 'dark' }, [text('t-1')]), section('s-2', { overlap: 'l' }, [text('t-2')])]),
    ) as [HTMLElement, HTMLElement];
    expect(style(frame(second), 'margin-top').replace(/\s+/g, '')).toBe('calc(-1*40px)');
    expect(style(second, 'z-index')).toBe('1');
    expect(style(second, 'padding-top')).toBe('40px'); // its own spacing is unchanged
    expect(style(second, 'display')).toBe('flow-root');
    expect(zero(style(frame(first), 'margin-top'))).toBe(true);
  });

  it('the first block of the page has nothing to overlap: its frame stays in place', () => {
    const [first] = sections(renderTree([section('s-1', { overlap: { px: 80 } }, [text('t-1')])])) as [HTMLElement];
    expect(zero(style(frame(first), 'margin-top'))).toBe(true);
  });

  it('a Section whose blocks all render nothing paints no padding; one with content, or an image behind it, keeps it', () => {
    const [empty, full, imaged, blank] = sections(
      renderTree([
        section('s-1', { scheme: 'muted' }, [news('lp-1')]),
        section('s-2', {}, [news('lp-2'), text('t-1')]),
        section('s-3', { background: { kind: 'image', imageSource: 'url', imageUrl: 'https://cdn.example.com/a.jpg' } }, [news('lp-3')]),
        section('s-4', { width: 'viewport' }, []),
      ]),
    ) as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(zero(style(empty, 'padding-top')), 'empty: top').toBe(true);
    expect(zero(style(empty, 'padding-bottom')), 'empty: bottom').toBe(true);
    expect(style(full, 'padding-top')).toBe('40px');
    expect(style(full, 'padding-bottom')).toBe('40px');
    expect(style(imaged, 'padding-top')).toBe('40px');
    expect(zero(style(blank, 'padding-top'))).toBe(true);
    expect(zero(style(blank, 'min-height'))).toBe(true);
  });
});

/**
 * R7 (T143, T144, T147): the filter bar's style and alignment, the carousel
 * items' text sizes and fonts, the tile's label style, the controls'
 * alignment and the next arrow's own style. Each case pairs today's look
 * (nothing chosen) with the option's.
 */
describe('R7: filter style, item typography, controls alignment (T143, T144, T147)', () => {
  const minified = (): string => builtCss.replace(/\s+/g, '');
  const image = { imageSource: 'url', src: 'https://cdn.example.com/a.jpg', alt: '' };
  const caption = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lake' }] }] };
  const title = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Guide' }] }] };
  const filter = (extra: Record<string, unknown>) => ({ show: true, allLabel: 'All', tags: [{ tag: 'a', label: 'Alpha' }], ...extra });

  it('T143 pills at the start are today\'s; underline tabs drop the pill box and underline the pressed tab', () => {
    const pills = query(render('cms.ContentSlider', { filter: filter({}) }), '.cmsc-pb-carousel__filter');
    expect(style(pills, 'justify-content')).not.toMatch(/center|end/);
    const host = render('cms.ContentSlider', { filter: filter({ style: 'underline', align: 'center' }) });
    const bar = query(host, '.cmsc-pb-carousel__filter');
    expect(style(bar, 'justify-content')).toBe('center');
    expect(style(bar, 'flex-wrap')).toBe('wrap');
    expect(style(bar, 'border-bottom-style')).toBe('solid');
    expect(style(bar, 'border-bottom-width')).toBe('1px');
    const pressed = query(host, '.cmsc-pb-carousel__filter-button--active');
    expect(style(pressed, 'border-radius')).toBe('0px');
    expect(style(pressed, 'border-bottom-width')).toBe('2px');
    // The minifier writes `transparent` as `#0000`, which jsdom does not parse: read the rule.
    expect(minified()).toMatch(
      /\.cmsc-pb-carousel__filter--underline\.cmsc-pb-carousel__filter-button--active\{[^}]*background-color:(#0000|transparent);border-color:(#0000|transparent)(#0000|transparent)currentColor/,
    );
    expect(rgb(style(pressed, 'color'))).toBe(ORIGIN.headingText);
    expect(style(pressed, 'min-height')).toBe('36px');
    const other = query(host, '.cmsc-pb-carousel__filter-button:not(.cmsc-pb-carousel__filter-button--active)');
    expect(rgb(style(other, 'color'))).toBe('rgb(100, 116, 139)'); // #64748b, 4.76:1 on white
    expect(style(query(render('cms.ContentSlider', { filter: filter({ align: 'end' }) }), '.cmsc-pb-carousel__filter'), 'justify-content')).toBe('flex-end');
  });

  it('T147 the controls below the track stay centred; an alignment, the split arrows and a breakpoint value reach them', () => {
    const below = query(render('cms.ContentSlider', {}), '.cmsc-pb-carousel__controls--below');
    expect(style(below, 'justify-content')).toBe('center');
    const end = query(render('cms.ContentSlider', { controlsAlign: 'end' }), '.cmsc-pb-carousel__controls--below');
    expect(style(end, 'justify-content')).toBe('flex-end');
    const between = query(render('cms.ContentSlider', { controlsAlign: 'between' }), '.cmsc-pb-carousel__controls--below');
    expect(style(between, 'justify-content')).toBe('space-between');
    const css = minified();
    expect(css).toContain(
      '.cmsc-pb-carousel--ctl-split>.cmsc-pb-carousel__controls--below>.cmsc-pb-carousel__arrow--prev{margin-inline-end:auto}',
    );
    expect(css).toContain(
      '.cmsc-pb-carousel--ctl-split>.cmsc-pb-carousel__controls--below>.cmsc-pb-carousel__arrow--next{margin-inline-start:auto}',
    );
    expect(css).toMatch(/@media\(min-width:768px\)\{[^@]*\.cmsc-pb-carousel--ctl-md-end>:is\(\.cmsc-pb-carousel__controls--below,\.cmsc-pb-carousel__controls--dots\)\{justify-content:flex-end\}/);
    expect(css).toMatch(/@media\(min-width:1024px\)\{[^@]*\.cmsc-pb-carousel--ctl-lg-center>:is\(\.cmsc-pb-carousel__controls--below,\.cmsc-pb-carousel__controls--dots\)[^{]*\{justify-content:center\}/);
  });

  it('T147 the next arrow\'s own style: a solid next beside an outline previous', () => {
    const host = render('cms.ContentSlider', { controls: { arrows: true, dots: false, arrowVariant: 'outline', nextArrowVariant: 'solid', arrowColor: '#1d4ed8' } });
    const next = query(host, '.cmsc-pb-carousel__arrow--next');
    expect(rgb(style(next, 'background'))).toBe('rgb(29, 78, 216)');
    expect(rgb(style(next, 'color'))).toBe(ORIGIN.white);
    const prev = query(host, '.cmsc-pb-carousel__arrow--prev');
    expect(rgb(style(prev, 'color'))).toBe('rgb(29, 78, 216)');
    // Nothing chosen: both arrows today's white circle.
    const plain = render('cms.ContentSlider', {});
    expect(rgb(style(query(plain, '.cmsc-pb-carousel__arrow--next'), 'background-color'))).toBe(ORIGIN.white);
    expect(rgb(style(query(plain, '.cmsc-pb-carousel__arrow--next'), 'color'))).toBe('rgb(51, 65, 85)');
  });

  it('T144 a carousel caption keeps today\'s 14 px semibold; a type token or a font role sizes its text', () => {
    const plain = query(render('cms.CarouselImage', { image, caption, captionPlacement: 'bottom-left' }), '.cmsc-pb-carousel-image__caption');
    expect(style(plain, 'font-size')).toBe('0.875rem');
    expect(style(plain, 'font-weight')).toBe('600');
    const sized = query(
      render('cms.CarouselImage', { image, caption, captionPlacement: 'bottom-left', captionSize: 'lead', captionFont: 'heading' }),
      '.cmsc-pb-carousel-image__caption-text',
    );
    expect(style(sized, 'font-size')).toBe('18px');
    expect(style(sized, 'font-weight')).toBe('400');
    expect(style(sized, 'display')).toBe('block');
    expect(fontStack(style(sized, 'font-family'))).toBe(ORIGIN.inlineSans);
  });

  it('T144 a link tile keeps today\'s 18 px semibold title and a link-coloured label; a button label is a primary button', () => {
    const plain = render('cms.LinkTile', { title, linkLabel: 'More' });
    const heading = query(plain, '.cmsc-pb-link-tile__title');
    expect(style(heading, 'font-size')).toBe('1.125rem');
    expect(style(heading, 'font-weight')).toBe('600');
    expect(rgb(style(query(plain, '.cmsc-pb-link-tile__label'), 'color'))).toBe(ORIGIN.primary);
    const sized = query(render('cms.LinkTile', { title, linkLabel: 'More', titleSize: 'h4' }), '.cmsc-pb-link-tile__title-text');
    expect(style(sized, 'font-size')).toBe('26px');
    const button = query(render('cms.LinkTile', { title, linkLabel: 'More', labelStyle: 'button' }), '.cmsc-pb-link-tile__button');
    expect(rgb(style(button, 'background-color'))).toBe(ORIGIN.primary);
    expect(rgb(style(button, 'color'))).toBe(ORIGIN.white);
    expect(style(button, 'align-self')).toBe('flex-start');
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` R7 (T142, T145, T146): the space
 * after a hero element, the space below a tab bar and a media-and-text video
 * pair. Nothing set keeps today's computed spacing; each option changes only
 * what it names. jsdom does not evaluate `@media`, so the values read here are
 * the ones below the tablet tier.
 */
describe('R7: hero spacing per element, the tab panel gap, a video pair (T142, T145, T146)', () => {
  const sub = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Sub' }] }] };

  it('T145 cms.Hero: a Custom space after the title replaces today\'s 12 px; the next element adds none, the others keep today\'s', () => {
    const host = render('cms.Hero', { subheading: sub, spaceAfter: [{ element: 'title', space: 'custom', spacePx: 40 }] });
    expect(style(query(host, '.cmsc-pb-hero__title'), 'margin-bottom')).toBe('40px');
    const subheading = query(host, '.cmsc-pb-hero__subheading');
    expect(style(subheading, 'margin-top')).toMatch(/^0(px)?$/);
    expect(style(subheading, 'margin-bottom')).toBe('20px');
  });

  it('T145 cms.Hero: with `gaps`, a token after the subheading replaces the gap there only', () => {
    const host = render('cms.Hero', { subheading: sub, gaps: 'm', spaceAfter: [{ element: 'subheading', space: 'xl' }] });
    expect(style(query(host, '.cmsc-pb-hero__subheading'), 'margin-top')).toBe('24px');
    expect(style(query(host, '.cmsc-pb-hero__subheading'), 'margin-bottom')).toBe('56px');
    expect(style(query(host, '.cmsc-pb-hero__actions'), 'margin-top')).toMatch(/^0(px)?$/);
  });

  it('T146 cms.Tabs: today\'s 12 px below the bar; a gap replaces it, a token with its built-in px', () => {
    expect(style(query(render('cms.Tabs'), '.cmsc-pb-tabs__list'), 'margin-bottom')).toBe('12px');
    expect(style(query(render('cms.Tabs', { panelGap: 'custom', panelGapPx: 32 }), '.cmsc-pb-tabs__list'), 'margin-bottom')).toBe('32px');
    expect(style(query(render('cms.Tabs', { panelGap: 'l' }), '.cmsc-pb-tabs__list'), 'margin-bottom')).toBe('40px');
  });

  it('T142 cms.MediaText: a video pair shows the mobile video below the tablet tier; a single video is shown as today', () => {
    const pair = render('cms.MediaText', {
      media: { kind: 'video', videoSource: 'url', videoUrl: 'https://cdn.example.com/w.mp4', mobileVideoUrl: 'https://cdn.example.com/m.mp4' },
    });
    expect(style(query(pair, 'video[data-bp="mobile"]'), 'display')).toBe('block');
    expect(style(query(pair, 'video[data-bp="desktop"]'), 'display')).toBe('none');
    const single = render('cms.MediaText', { media: { kind: 'video', videoSource: 'url', videoUrl: 'https://cdn.example.com/w.mp4' } });
    expect(style(query(single, '.cmsc-pb-media-text__video video'), 'display')).toBe('block');
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` R8 (T150–T153): the carousel and
 * the product card take the brand body font (bug R7-1); a text weight, a
 * heading measure and controls lined up with the first slide. With no brand
 * tokens and nothing chosen each keeps today's look; each option changes only
 * what it names. jsdom does not evaluate `@media`, so the values read here
 * are the ones below the tablet tier.
 */
describe('R8: brand body font on carousels and cards, text weight, heading measure, controls to the first slide (T150–T153)', () => {
  const BRAND = { '--cmsb-font-body': '"Brand Body", sans-serif' };
  const tile = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Guide' }] }] };
  const product = { id: 'p1', slug: 'oak-shelf', name: 'Oak shelf', sku: 'OAK-1', primaryAssetUrl: null, summary: 'A shelf.' };

  function hosted(markup: string, hostStyle: Record<string, string> = {}): HTMLElement {
    const host = document.createElement('div');
    for (const [name, value] of Object.entries(hostStyle)) host.style.setProperty(name, value);
    host.innerHTML = markup;
    document.body.appendChild(host);
    return host;
  }

  function page(type: string, props: Record<string, unknown>, hostStyle: Record<string, string> = {}): HTMLElement {
    const block = (defaultPageBuilderConfig as Config).components[type];
    const data = { root: { props: {} }, content: [{ type, props: { id: `${type}-r8`, ...(block?.defaultProps ?? {}), ...props } }], zones: {} };
    return hosted(renderToString(createElement(Render as never, { config: defaultPageBuilderConfig as never, data: data as never })), hostStyle);
  }

  async function card(hostStyle: Record<string, string> = {}, props: Record<string, unknown> = {}): Promise<HTMLElement> {
    const { CmsProductCardView } = await import('../components/CmsProductCard.js');
    return hosted(renderToString(createElement(CmsProductCardView as never, { product, locale: 'en-US', ...props } as never)), hostStyle);
  }

  it('T150 the carousel (its filter bar and controls) keeps the page\'s font with no tokens and takes the brand body font', () => {
    const filter = { show: true, allLabel: 'All', tags: [{ tag: 'a', label: 'Alpha' }] };
    expect(['', 'inherit']).toContain(style(query(page('cms.ContentSlider', { filter }), '.cmsc-pb-carousel'), 'font-family'));
    const branded = query(page('cms.ContentSlider', { filter }, BRAND), '.cmsc-pb-carousel');
    expect(fontStack(style(branded, 'font-family'))).toBe('"Brand Body", sans-serif');
  });

  it('T150 the product card keeps the page\'s font with no tokens and takes the brand body font', async () => {
    expect(['', 'inherit']).toContain(style(query(await card(), '.cmsc-pb-product-card'), 'font-family'));
    expect(fontStack(style(query(await card(BRAND), '.cmsc-pb-product-card'), 'font-family'))).toBe('"Brand Body", sans-serif');
  });

  it('T151 a chosen weight overrides the text\'s own; nothing chosen keeps today\'s', async () => {
    expect(style(query(page('cms.LinkTile', { title: tile }), '.cmsc-pb-link-tile__title'), 'font-weight')).toBe('600');
    expect(style(query(page('cms.LinkTile', { title: tile, titleWeight: 400 }), '.cmsc-pb-link-tile__title-text'), 'font-weight')).toBe('400');
    expect(style(query(page('cms.CtaCard', { heading: 'Heading' }), '.cmsc-pb-block-heading'), 'font-weight')).toBe('700');
    expect(style(query(page('cms.CtaCard', { heading: 'Heading', headingWeight: 300 }), '.cmsc-pb-block-heading'), 'font-weight')).toBe('300');
    const plainName = style(query(await card(), '.cmsc-pb-product-card__name'), 'font-weight');
    expect(style(query(await card({}, { nameWeight: 800 }), '.cmsc-pb-product-card__name'), 'font-weight')).toBe('800');
    expect(plainName).not.toBe('800');
  });

  it('T152 the hero title has no measure unset; a Custom one holds it, centred in a centred hero', () => {
    expect(['', 'none']).toContain(style(query(page('cms.Hero', {}), '.cmsc-pb-hero__title'), 'max-width'));
    const title = query(page('cms.Hero', { titleMaxWidth: 'custom', titleMaxWidthPx: 900, align: 'center' }), '.cmsc-pb-hero__title');
    expect(style(title, 'max-width')).toBe('900px');
    expect(style(title, 'margin-left')).toBe('auto');
    expect(style(title, 'margin-right')).toBe('auto');
  });

  it('T153 the controls below the track span the container by default; aligned to the first slide they span one slide', () => {
    const plain = query(page('cms.ContentSlider', { bleed: 'end', slidesPerView: 1.25, controlsPlacement: 'below' }), '.cmsc-pb-carousel__controls--below');
    expect(['', 'auto']).toContain(style(plain, 'width'));
    const toSlide = query(
      page('cms.ContentSlider', { bleed: 'end', slidesPerView: 1.25, controlsPlacement: 'below', controlsAlignTo: 'slide' }),
      '.cmsc-pb-carousel__controls--below',
    );
    expect(style(toSlide, 'width').replace(/\s+/g, '')).toBe('calc((100%-(1.25-1)*16px)/1.25)');
    expect(style(toSlide, 'max-width')).toBe('100%');
  });
});

/**
 * R8 (T155, T156): the scrolling tab bar and the Column's distribution and
 * per-block order are off by default; unused, the look is today's.
 */
describe('R8: a scrolling tab bar, a Column\'s distribution and a block\'s order (T155, T156)', () => {
  it('T155 cms.Tabs: unset, the bar wraps as today (T123); scroll keeps one line inside the block', () => {
    const plain = render('cms.Tabs', { variant: 'pills' });
    expect(style(query(plain, '.cmsc-pb-tabs__list'), 'flex-wrap')).toBe('wrap');
    expect(['', 'visible']).toContain(style(query(plain, '.cmsc-pb-tabs__list'), 'overflow-x'));
    const host = render('cms.Tabs', { variant: 'pills', barOverflow: 'scroll' });
    const list = query(host, '.cmsc-pb-tabs__list');
    expect(style(list, 'flex-wrap')).toBe('nowrap');
    // The built sheet writes `overflow: auto hidden`, a shorthand jsdom does not expand.
    expect([style(list, 'overflow-x'), style(list, 'overflow')]).toContain('auto hidden');
    expect(style(list, 'max-width')).toBe('100%');
    const tab = query(host, '.cmsc-pb-tabs__tab');
    expect(style(tab, 'flex-shrink')).toBe('0');
    expect(style(tab, 'white-space')).toBe('nowrap');
  });

  it('T155 cms.Tabs underline: scrolling draws the bar line inside the box, so the active underline still meets it', () => {
    const plain = render('cms.Tabs');
    expect(style(query(plain, '.cmsc-pb-tabs__tab--active'), 'margin-bottom')).toBe('-1px');
    const host = render('cms.Tabs', { barOverflow: 'scroll' });
    const list = query(host, '.cmsc-pb-tabs__list');
    expect(style(list, 'border-bottom-style')).toBe('none');
    expect(style(list, 'box-shadow').replace(/\s+/g, ' ')).toBe('inset 0 -1px 0 #e2e8f0');
    expect(style(query(host, '.cmsc-pb-tabs__tab--active'), 'margin-bottom')).toMatch(/^0(px)?$/);
  });

  it('T156 cms.Column: unset, its stack is today\'s block flow; distributed, the column, its box and its stack are flex columns', () => {
    const column = (props: Record<string, unknown>) =>
      render('cms.Row', {
        content: [
          {
            type: 'cms.Column',
            props: { id: 'col-1', span: 12, content: [{ type: 'cms.Text', props: { id: 't-1', text: 'One' } }], ...props },
          },
        ],
      });
    const plain = column({});
    expect(style(query(plain, '.cmsc-pb-column-stack'), 'display')).toBe('block');
    expect(style(query(plain, '.cmsc-pb-row-col'), 'display')).toBe('block');
    const centred = column({ distribute: 'center' });
    expect(style(query(centred, '.cmsc-pb-row-col'), 'display')).toBe('flex');
    const stack = query(centred, '.cmsc-pb-column-stack');
    expect(style(stack, 'display')).toBe('flex');
    expect(style(stack, 'flex-direction')).toBe('column');
    expect(style(stack, 'justify-content')).toBe('center');
    // The box's content layer and the box itself grow with the column.
    expect(style(stack.parentElement!, 'display')).toBe('flex');
    expect(style(stack.parentElement!.parentElement!, 'display')).toBe('flex');
  });
});

/**
 * R9 (T159–T162): a Column's order in its Row, the MediaText item titles' size
 * and weight, the scrolling filter bar and the mobile poster are off by
 * default; unused, the look is today's.
 */
describe('R9: a Column\'s order, item titles, the scrolling filter bar, a mobile poster (T159–T162)', () => {
  const row = (columnProps: Record<string, unknown>) =>
    render('cms.Row', {
      content: [
        { type: 'cms.Column', props: { id: 'col-1', span: 6, content: [{ type: 'cms.Text', props: { id: 't-1', text: 'One' } }], ...columnProps } },
        { type: 'cms.Column', props: { id: 'col-2', span: 6, content: [{ type: 'cms.Text', props: { id: 't-2', text: 'Two' } }] } },
      ],
    });

  it('T159 cms.Column: unset, the columns keep the grid\'s stored order; an ordered column takes its order', () => {
    const plain = row({});
    for (const cell of Array.from(plain.querySelectorAll<HTMLElement>('.cmsc-pb-row-col'))) expect(['', '0']).toContain(style(cell, 'order'));
    const ordered = row({ stackOrder: { base: 'last', desktop: 'auto' } });
    const [first, second] = Array.from(ordered.querySelectorAll<HTMLElement>('.cmsc-pb-row-col'));
    expect(style(first!, 'order')).toBe('99');
    expect(['', '0']).toContain(style(second!, 'order'));
    expect(style(query(ordered, '.cmsc-pb-row-cols'), 'display')).toBe('grid');
  });

  it('T160 cms.MediaText: item titles stay 16 px / 600 unset; a weight or a Custom size reaches the title text', () => {
    const features = [{ icon: 'check', title: 'Fast', body: 'In a day.' }];
    const plain = query(render('cms.MediaText', { features }), '.cmsc-pb-media-text__feature-title');
    expect(style(plain, 'font-size')).toBe('16px');
    expect(style(plain, 'font-weight')).toBe('600');
    expect(plain.querySelector('.cmsc-pb-media-text__feature-title-text')).toBeNull();
    const text = query(
      render('cms.MediaText', { features, featureTitleSize: 'custom', featureTitleSizePx: 20, featureTitleWeight: 400 }),
      '.cmsc-pb-media-text__feature-title-text',
    );
    expect(style(text, 'font-size')).toBe('20px');
    expect(style(text, 'font-weight')).toBe('400');
    expect(style(text, 'display')).toBe('block');
  });

  it('T161 carousel filter: unset, the bar wraps as today; scroll keeps one line inside the block', () => {
    const filter = (extra: Record<string, unknown>) => ({ show: true, allLabel: 'All', tags: [{ tag: 'a', label: 'Alpha' }], ...extra });
    const plain = query(render('cms.ContentSlider', { filter: filter({}) }), '.cmsc-pb-carousel__filter');
    expect(style(plain, 'flex-wrap')).toBe('wrap');
    expect(['', 'visible']).toContain(style(plain, 'overflow-x'));
    const host = render('cms.ContentSlider', { filter: filter({ overflow: 'scroll', style: 'underline' }) });
    const bar = query(host, '.cmsc-pb-carousel__filter');
    expect(style(bar, 'flex-wrap')).toBe('nowrap');
    // The built sheet writes `overflow: auto hidden`, a shorthand jsdom does not expand.
    expect([style(bar, 'overflow-x'), style(bar, 'overflow')]).toContain('auto hidden');
    expect(style(bar, 'max-width')).toBe('100%');
    expect(style(bar, 'border-bottom-style')).toBe('none');
    expect(style(bar, 'box-shadow').replace(/\s+/g, ' ')).toBe('inset 0 -1px 0 #d9e0e7');
    const button = query(host, '.cmsc-pb-carousel__filter-button');
    expect(style(button, 'flex-shrink')).toBe('0');
    expect(style(button, 'white-space')).toBe('nowrap');
    expect(style(button, 'margin-bottom')).toMatch(/^0(px)?$/);
  });

  it('T162 cms.MediaText: one video with its own mobile poster shows the mobile one below the tablet tier', () => {
    const host = render('cms.MediaText', {
      media: { kind: 'video', videoSource: 'url', videoUrl: 'https://cdn.example.com/w.mp4', mobilePosterUrl: 'https://cdn.example.com/tall.jpg' },
    });
    expect(style(query(host, 'video[data-bp="mobile"]'), 'display')).toBe('block');
    expect(style(query(host, 'video[data-bp="desktop"]'), 'display')).toBe('none');
  });
});

describe('R9: the tab size per breakpoint, the arrow icon, an inline icon, rich-text headings (T163)', () => {
  it('T163 cms.Tabs: unset, today\'s 14 px tabs; one size for every breakpoint is T132\'s small tab', () => {
    const plain = query(render('cms.Tabs', { variant: 'pills' }), '.cmsc-pb-tabs__tab');
    expect(style(plain, 'font-size')).toBe('14px');
    expect(style(plain, 'padding')).toBe('10px 14px');
    // The phone's size is the class T132 writes; the larger breakpoints' rules sit in media blocks.
    const small = query(render('cms.Tabs', { variant: 'pills', tabSize: { base: 's', desktop: 'm' } }), '.cmsc-pb-tabs__tab');
    expect(style(small, 'font-size')).toBe('13px');
    expect(style(small, 'padding')).toBe('6px 12px');
  });

  it('T163 the carousel arrows: unset, today\'s 20 px chevron glyph; a drawn arrow is 0.8 em', () => {
    const items = [1, 2].map((n) => ({ type: 'cms.Slide', props: { id: `s-${n}`, content: [] } }));
    const plain = query(render('cms.ContentSlider', { slides: items, controlsPlacement: 'below' }), '.cmsc-pb-carousel__arrow');
    expect(plain.textContent).toBe('‹');
    expect(style(plain, 'font-size')).toBe('20px');
    const drawn = render('cms.ContentSlider', { slides: items, controlsPlacement: 'below', controls: { arrows: true, dots: false, arrowIcon: 'arrow' } });
    const icon = query(drawn, '.cmsc-pb-carousel__arrow svg.cmsc-pb-carousel__arrow-icon');
    expect(style(icon, 'width')).toBe('0.8em');
    expect(style(icon, 'height')).toBe('0.8em');
  });

  it('T163 an inline icon sits on the text line in the text\'s colour; nothing else changes', () => {
    const heading = (content: unknown[]) =>
      render('cms.Heading', { text: { type: 'doc', content: [{ type: 'paragraph', content }] } });
    const icon = query(heading([{ type: 'text', text: 'New ' }, { type: 'inlineIcon', attrs: { name: 'sparkles' } }]), 'svg.cmsc-inline-icon');
    expect(style(icon, 'display')).toBe('inline-block');
    expect(style(icon, 'vertical-align')).toBe('-0.125em');
    expect(icon.getAttribute('stroke')).toBe('currentColor');
    // In a gradient phrase (transparent text) it takes the accent colour, today's #1261a6 with no brand.
    const gradient = query(
      heading([{ type: 'inlineIcon', attrs: { name: 'sparkles' }, marks: [{ type: 'emphasis', attrs: { variant: 'gradient' } }] }]),
      'svg.cmsc-inline-icon',
    );
    expect(rgb(style(gradient, 'color'))).toBe(ORIGIN.primary);
  });

  it('T163 rich-text headings with no brand: cms.RichContent keeps its 32/26/22/18 px bold headings, and the stylesheet sets none in a rich body', () => {
    const host = render('cms.RichContent', { content: null, html: '<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4><p>E</p>' });
    const prose = query(host, '.cmsc-pb-rich-content');
    // jsdom does not match the utilities' nested selectors, so the built rules are read as text.
    for (const [level, size] of [['h1', '32px'], ['h2', '26px'], ['h3', '22px'], ['h4', '18px']] as const) {
      expect(prose.classList.contains(`cmsc:[&_${level}]:text-[${size}]`), level).toBe(true);
      expect(prose.classList.contains(`cmsc:[&_${level}]:font-bold`), level).toBe(true);
      expect(builtCss, level).toContain(`.cmsc\\:\\[\\&_${level}\\]\\:text-\\[${size}\\] ${level}{font-size:${size}}`);
    }
    // The type-scale rule is the brand's to write (brand-css.ts): the built sheet has none for rich bodies.
    expect(builtCss).not.toMatch(/\.cmsc-pb-rich h[1-6][^{]*\{[^}]*font-size/);
  });
});

describe('R10: the card image box and divider, a chevron read-more, full-width buttons (T168)', () => {
  const product = { id: 'p1', slug: 'oak-shelf', name: 'Oak shelf', sku: 'OAK-1', primaryAssetUrl: null, summary: 'A shelf.' };
  const BUTTON = { label: 'Start', link: { kind: 'url', href: '/start' }, style: 'primary', fill: 'solid', size: 'medium' };

  async function card(props: Record<string, unknown> = {}): Promise<HTMLElement> {
    const { CmsProductCardView } = await import('../components/CmsProductCard.js');
    const host = document.createElement('div');
    host.innerHTML = renderToString(createElement(CmsProductCardView as never, { product, locale: 'en-US', ...props } as never));
    document.body.appendChild(host);
    return host;
  }

  /** jsdom keeps a `var()` inside `background`/`border` shorthands unexpanded: the shorthand is read, resolved. */
  function paint(element: HTMLElement): string {
    const color = rgb(style(element, 'background-color'));
    return color !== 'rgba(0, 0, 0, 0)' && color !== '' ? color : rgb(style(element, 'background'));
  }

  it('T168 the card image box keeps today\'s neutral unset (#f8fafc, showcase #f1f5f9); a chosen colour replaces it', async () => {
    expect(paint(query(await card(), '.cmsc-pb-product-card__media'))).toBe('rgb(248, 250, 252)');
    expect(paint(query(await card({ variant: 'showcase' }), '.cmsc-pb-product-card__media'))).toBe('rgb(241, 245, 249)');
    expect(paint(query(await card({ variant: 'showcase', imageBackground: '#1d4ed8' }), '.cmsc-pb-product-card__media'))).toBe('rgb(29, 78, 216)');
  });

  it('T168 unset, the cards keep today\'s borders; a line divider draws one under the card, in the chosen colour or the neutral border', async () => {
    // Today's rules, untouched: the bordered card and the borderless showcase.
    expect(builtCss).toContain('.cmsc-pb-product-card{border:1px solid var(--cmsb-n-200,#e2e8f0);');
    expect(builtCss).toContain('.cmsc-pb-product-card--showcase{background:0 0;border:0}');
    expect(['0', '0px', '']).toContain(style(query(await card({ variant: 'showcase' }), '.cmsc-pb-product-card'), 'padding-bottom'));
    // The line: a rule of its own, read only with the class (no `var()` expansion in jsdom's border shorthand).
    expect(builtCss).toContain(
      '.cmsc-pb-product-card.cmsc-pb-product-card--divider,[data-cmsb-scheme] .cmsc-pb-product-card.cmsc-pb-product-card--divider{border-bottom:1px solid var(--pb-card-divider,var(--cmsb-border,var(--cmsb-n-200,#e2e8f0)))}',
    );
    const lined = query(await card({ variant: 'showcase', divider: 'line' }), '.cmsc-pb-product-card');
    expect(lined.classList.contains('cmsc-pb-product-card--divider')).toBe(true);
    expect(style(lined, 'padding-bottom')).toBe('16px');
    expect(rgb(resolveVars(lined, 'var(--pb-card-divider, var(--cmsb-border, var(--cmsb-n-200, #e2e8f0)))'))).toBe('rgb(226, 232, 240)');
    const coloured = query(await card({ variant: 'showcase', divider: 'line', dividerColor: '#1d4ed8' }), '.cmsc-pb-product-card');
    expect(rgb(resolveVars(coloured, 'var(--pb-card-divider, var(--cmsb-border, var(--cmsb-n-200, #e2e8f0)))'))).toBe('rgb(29, 78, 216)');
  });

  it('T168 a read-more summary keeps today\'s text look unset; a chevron one is a 44 px control whose text is clipped, not removed', () => {
    const passage = (attrs: Record<string, unknown>) => ({
      type: 'doc',
      content: [{ type: 'readMore', attrs, content: [{ type: 'readMoreSummary', content: [{ type: 'text', text: 'Read more' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }],
    });
    const plain = query(render('cms.RichContent', { content: passage({}), html: '' }), 'summary');
    expect(style(plain, 'display')).toBe('list-item');
    expect(rgb(style(plain, 'color'))).toBe(ORIGIN.primary);
    expect(style(plain, 'font-weight')).toBe('600');
    expect(style(plain, 'text-indent')).not.toBe('100%');
    const chevron = query(render('cms.RichContent', { content: passage({ summaryStyle: 'chevron' }), html: '' }), 'summary');
    expect(chevron.textContent).toBe('Read more');
    expect(style(chevron, 'display')).toBe('block');
    expect(style(chevron, 'width')).toBe('44px');
    expect(style(chevron, 'height')).toBe('44px');
    expect(style(chevron, 'overflow')).toBe('hidden');
    expect(style(chevron, 'text-indent')).toBe('100%');
    expect(style(chevron, 'list-style')).toBe('none');
  });

  it('T168 buttons keep today\'s width unset; full width spans the box, and a full-width list stacks and stretches', () => {
    const plain = query(render('cms.Button', { button: BUTTON }), '.cmsc-btn');
    expect(style(plain, 'display')).toBe('inline-flex');
    expect(['', 'auto']).toContain(style(plain, 'width'));
    const full = query(render('cms.Button', { button: BUTTON, fullWidth: { base: 'full' } }), '.cmsc-btn');
    expect(style(full, 'display')).toBe('flex');
    expect(style(full, 'width')).toBe('100%');
    const list = query(render('cms.CtaCard', { buttons: [BUTTON] }), '.cmsc-pb-cta-card__actions');
    expect(['', 'row']).toContain(style(list, 'flex-direction'));
    expect(style(list, 'align-items')).toBe('center');
    const stacked = query(render('cms.CtaCard', { buttons: [BUTTON], buttonsFullWidth: { base: 'full' } }), '.cmsc-pb-cta-card__actions');
    expect(style(stacked, 'flex-direction')).toBe('column');
    expect(style(stacked, 'align-items')).toBe('stretch');
    const hero = query(render('cms.Hero', { buttons: [BUTTON], buttonsFullWidth: { base: 'full' } }), '.cmsc-pb-hero__actions');
    expect(style(hero, 'flex-direction')).toBe('column');
    expect(style(hero, 'align-items')).toBe('stretch');
  });
});

describe('R10: an inline icon\'s size and offset, a background\'s size, repeat and position (T166, T167)', () => {
  const heading = (content: unknown[]) => render('cms.Heading', { text: { type: 'doc', content: [{ type: 'paragraph', content }] } });

  it('T166 an inline icon with no size or offset is today\'s 1 em on the line; a sized one takes its own', () => {
    const plain = query(heading([{ type: 'text', text: 'New ' }, { type: 'inlineIcon', attrs: { name: 'sparkles' } }]), 'svg.cmsc-inline-icon');
    expect(plain.getAttribute('width')).toBe('1em');
    expect(style(plain, 'vertical-align')).toBe('-0.125em');
    const sized = query(
      heading([{ type: 'text', text: 'New ' }, { type: 'inlineIcon', attrs: { name: 'sparkles', size: '0.5em', offset: 0.4 } }]),
      'svg.cmsc-inline-icon',
    );
    expect(sized.getAttribute('width')).toBe('0.5em');
    expect(sized.getAttribute('height')).toBe('0.5em');
    expect(style(sized, 'vertical-align')).toBe('0.4em');
    expect(style(sized, 'display')).toBe('inline-block');
  });

  it('T167 an untouched image background is today\'s cover picture; a decorative Section with no brand paints nothing', () => {
    const image = render('cms.Section', { background: { kind: 'image', imageSource: 'url', imageUrl: '/media/wide.jpg' }, content: [] });
    const img = query(image, '.cmsc-section__picture > img');
    expect(style(img, 'object-fit')).toBe('cover');
    expect(image.querySelector('.cmsc-section__tile')).toBeNull();
    const dark = query(render('cms.Section', { scheme: 'dark', background: { kind: 'none', decorative: true }, content: [] }), 'section.cmsc-section');
    expect(style(dark, 'background-image')).toBe('none');
    expect(style(dark, 'background-size')).toBe('cover');
    expect(style(dark, 'background-repeat')).toBe('no-repeat');
  });

  it('T167 a tiled image fills the media layer and draws the image at its own size and repeat', () => {
    const host = render('cms.Section', {
      background: { kind: 'image', imageSource: 'url', imageUrl: '/media/dots.svg', size: { px: 240 }, repeat: 'repeat' },
      content: [],
    });
    const tile = query(host, '.cmsc-section__media > .cmsc-section__tile');
    expect(style(tile, 'position')).toBe('absolute');
    expect(style(tile, 'background-image').replace(/["']/g, '')).toBe('url(/media/dots.svg)');
    expect(style(tile, 'background-size')).toBe('240px');
    expect(style(tile, 'background-repeat')).toBe('repeat');
  });
});

describe('R11: the tabs\' hover look and panel change keep today\'s look when unused (T174)', () => {
  it('T174 tabs with no hover colour: no transition and today\'s colours; a set hover colour adds only a short transition', () => {
    const plain = render('cms.Tabs', { variant: 'pills' });
    const other = query(plain, '.cmsc-pb-tabs__tab:not(.cmsc-pb-tabs__tab--active)');
    expect(['', 'all 0s ease 0s', 'none']).toContain(style(other, 'transition'));
    expect(rgb(style(other, 'color'))).toBe('rgb(100, 116, 139)'); // #64748b
    const hover = render('cms.Tabs', { variant: 'pills', tabStyle: { hoverBackground: '#1d4ed8', hoverColor: '#ffffff' } });
    const tab = query(hover, '.cmsc-pb-tabs__tab:not(.cmsc-pb-tabs__tab--active)');
    // The built sheet is minified: 200 ms is written `.2s`.
    expect(style(tab, 'transition')).toMatch(/background-color (\.2s|200ms)/);
    // At rest (no pointer over it) the tab keeps its own colour.
    expect(rgb(style(tab, 'color'))).toBe('rgb(100, 116, 139)');
  });

  it('T174 instant tabs keep the panel in the block\'s flow; an animated change shows only the selected panel at rest', () => {
    const plain = render('cms.Tabs');
    expect(query(plain, '.cmsc-pb-tabs__panel').parentElement?.classList.contains('cmsc-pb-tabs')).toBe(true);
    expect(style(query(plain, '.cmsc-pb-tabs__panel'), 'animation-name')).toMatch(/^(none|)$/);
    const fade = render('cms.Tabs', { effect: 'fade' });
    const box = query(fade, '.cmsc-pb-tabs__panels');
    expect(style(box, 'display')).toBe('grid');
    expect(style(box, 'overflow')).toMatch(/^(visible|)$/);
    const [shown, hidden] = [...fade.querySelectorAll<HTMLElement>('.cmsc-pb-tabs__panel')];
    expect(style(shown!, 'display')).toBe('flow-root');
    expect(style(hidden!, 'display')).toBe('none');
    expect(style(shown!, 'animation-name')).toMatch(/^(none|)$/);
  });
});

describe('R11: carousel ends and item hover colours keep today\'s look when unused (T171, T172)', () => {
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

  it('T171 a looping carousel (unset) never disables an arrow and keeps today\'s arrow look', () => {
    const host = render('cms.ContentSlider', { controlsPlacement: 'below' });
    const previous = query(host, '.cmsc-pb-carousel__arrow--prev');
    expect(previous.hasAttribute('disabled')).toBe(false);
    expect(['', '1']).toContain(style(previous, 'opacity'));
    expect(style(previous, 'cursor')).toBe('pointer');
    expect(rgb(style(previous, 'color'))).toBe('rgb(51, 65, 85)'); // #334155
  });

  it('T171 not looping, the arrow at an end is dimmed by default; a light outline or a colour replaces the dimming', () => {
    const dim = query(render('cms.ContentSlider', { controlsPlacement: 'below', loop: false }), '.cmsc-pb-carousel__arrow--prev');
    expect(dim.hasAttribute('disabled')).toBe(true);
    expect(style(dim, 'opacity')).toBe('0.4');
    expect(style(dim, 'cursor')).toBe('default');
    const light = query(
      render('cms.ContentSlider', { controlsPlacement: 'below', loop: false, controls: { arrows: true, dots: false, disabledArrowLook: 'outline-light' } }),
      '.cmsc-pb-carousel__arrow--prev',
    );
    expect(style(light, 'opacity')).toBe('1');
    expect(rgb(style(light, 'color'))).toBe('rgba(255, 255, 255, 0.4)');
    const colored = query(
      render('cms.ContentSlider', {
        controlsPlacement: 'below',
        loop: false,
        controls: { arrows: true, dots: false, disabledArrowLook: 'color', disabledArrowColor: '#1d4ed8' },
      }),
      '.cmsc-pb-carousel__arrow--prev',
    );
    expect(style(colored, 'opacity')).toBe('1');
    expect(rgb(style(colored, 'color'))).toBe('rgb(29, 78, 216)');
    // The next arrow, not at an end, keeps today's look.
    const next = query(render('cms.ContentSlider', { controlsPlacement: 'below', loop: false }), '.cmsc-pb-carousel__arrow--next');
    expect(['', '1']).toContain(style(next, 'opacity'));
  });

  it('T172 a caption and a tile with no hover colour: no transition, today\'s colours; a set one adds only a short transition', () => {
    const IMAGE = { image: { imageSource: 'url', src: 'https://example.com/a.jpg', alt: 'A' }, caption: doc('Machines') };
    const plain = query(render('cms.CarouselImage', IMAGE), '.cmsc-pb-carousel-image__caption');
    expect(['', 'all 0s ease 0s', 'none']).toContain(style(plain, 'transition'));
    expect(rgb(style(plain, 'color'))).toBe(ORIGIN.white);
    const hover = query(render('cms.CarouselImage', { ...IMAGE, captionHoverColor: '#1d4ed8' }), '.cmsc-pb-carousel-image__caption');
    expect(style(hover, 'transition')).toMatch(/color (\.2s|200ms|0\.2s)/);
    expect(rgb(style(hover, 'color'))).toBe(ORIGIN.white);

    const TILE = { title: doc('Machines'), linkLabel: 'See more', link: { kind: 'page', slug: 'machines' } };
    const title = query(render('cms.LinkTile', TILE), '.cmsc-pb-link-tile__title');
    expect(['', 'all 0s ease 0s', 'none']).toContain(style(title, 'transition'));
    expect(rgb(style(title, 'color'))).toBe(ORIGIN.headingText);
    const tile = render('cms.LinkTile', { ...TILE, titleHoverColor: '#1d4ed8', labelHoverColor: '#1d4ed8' });
    expect(style(query(tile, '.cmsc-pb-link-tile__title'), 'transition')).toMatch(/color (\.2s|200ms|0\.2s)/);
    expect(rgb(style(query(tile, '.cmsc-pb-link-tile__title'), 'color'))).toBe(ORIGIN.headingText);
    expect(rgb(style(query(tile, '.cmsc-pb-link-tile__label'), 'color'))).toBe(ORIGIN.primary);
  });
});

describe('R11: read-more position and reveal above, the accordion\'s look, an emphasis colour keep today\'s look when unused (T173, T175)', () => {
  const passage = (attrs: Record<string, unknown>) => ({
    type: 'doc',
    content: [{ type: 'readMore', attrs, content: [{ type: 'readMoreSummary', content: [{ type: 'text', text: 'Read more' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }],
  });
  const accordion = (props: Record<string, unknown> = {}) =>
    render('cms.Accordion', {
      items: [
        { title: 'One', panel: [] },
        { title: 'Two', panel: [] },
      ],
      ...props,
    });

  it('T173 a read-more passage keeps today\'s block and its summary at the start; centred, end and reveal above move the summary only', () => {
    const plain = query(render('cms.RichContent', { content: passage({}), html: '' }), 'details');
    expect(['', 'block']).toContain(style(plain, 'display'));
    expect(['', 'start', 'left']).toContain(style(query(plain, 'summary'), 'text-align'));
    const centred = query(render('cms.RichContent', { content: passage({ chevronPosition: 'center' }), html: '' }), 'summary');
    expect(style(centred, 'text-align')).toBe('center');
    const chevronEnd = query(render('cms.RichContent', { content: passage({ summaryStyle: 'chevron', chevronPosition: 'end' }), html: '' }), 'summary');
    expect(style(chevronEnd, 'margin-inline-start')).toBe('auto');
    const above = query(render('cms.RichContent', { content: passage({ revealAbove: true, open: true }), html: '' }), 'details');
    expect(style(above, 'display')).toBe('flex');
    expect(style(above, 'flex-direction')).toBe('column');
    const summary = query(above, 'summary');
    expect(above.firstElementChild).toBe(summary);
    expect(style(summary, 'order')).toBe('1');
    expect(style(summary, 'margin-top')).toBe('8px');
    // The animation lives behind reduced motion and feature queries: nothing in the default look.
    expect(builtCss.replace(/\s+/g, '')).toContain('@supports(interpolate-size:allow-keywords)andselector(::details-content)');
  });

  it('T175 an accordion keeps today\'s look unset: a 12 px title row, a line under each item, the plus glyph', () => {
    const host = accordion();
    const trigger = query(host, '.cmsc-pb-accordion__trigger');
    expect(style(trigger, 'padding-top')).toBe('12px');
    expect(style(trigger, 'padding-bottom')).toBe('12px');
    // jsdom drops a border shorthand holding a `var()`: today's rule is read from the built sheet, and the
    // root carries no class that a T175 rule selects.
    expect(builtCss).toContain('.cmsc-pb-accordion__item{border-bottom:1px solid var(--cmsb-n-200,#e2e8f0)}');
    expect(query(host, '.cmsc-pb-accordion').className).toBe('cmsc-pb-accordion cmsc-pb-accordion--default cmsc-pb-accordion--icon-end');
    expect(query(host, '.cmsc-pb-accordion__icon').textContent).toBe('+');
  });

  it('T175 dividers between, boxed items and a title padding change what they name', () => {
    expect(query(accordion({ dividers: 'between' }), '.cmsc-pb-accordion').classList).toContain('cmsc-pb-accordion--dividers-between');
    expect(builtCss).toContain(
      '.cmsc-pb-accordion--dividers-between>.cmsc-pb-accordion__item+.cmsc-pb-accordion__item{border-top:1px solid var(--cmsb-n-200,#e2e8f0)}',
    );
    const boxed = accordion({ itemStyle: 'boxed' });
    const box = query(boxed, '.cmsc-pb-accordion__item');
    expect(builtCss).toContain('.cmsc-pb-accordion--boxed>.cmsc-pb-accordion__item{border:1px solid var(--cmsb-n-200,#e2e8f0);');
    expect(style(box, 'border-radius')).toBe('8px');
    expect(style(query(boxed, '.cmsc-pb-accordion__trigger'), 'padding-left')).toBe('16px');
    const padded = query(accordion({ titlePadding: { base: 'custom' }, titlePaddingPx: 20 }), '.cmsc-pb-accordion__trigger');
    expect(resolveVars(padded, style(padded, 'padding-top'))).toBe('20px');
  });

  it('T175 an emphasis colour paints the phrase, a gradient one as solid text; without one the variant\'s look stays', () => {
    const heading = (attrs: Record<string, unknown>) =>
      query(render('cms.Heading', { text: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'phrase', marks: [{ type: 'emphasis', attrs }] }] }] } }), '.cmsc-em');
    expect(rgb(resolveVars(heading({ variant: 'accent' }), style(heading({ variant: 'accent' }), 'color')))).toBe(ORIGIN.primary);
    const coloured = heading({ variant: 'gradient', color: '#1d4ed8' });
    expect(rgb(style(coloured, 'color'))).toBe('rgb(29, 78, 216)');
    expect(style(coloured, 'background-image')).toBe('none');
    const token = heading({ variant: 'muted', color: 'token:secondary' });
    expect(rgb(resolveVars(token, style(token, 'color')))).toBe('rgb(15, 118, 110)');
  });
});

describe('R12: an animated reveal-above read-more, resting tile colours, the accordion\'s title colour, divider and icon keep today\'s look when unused (T177–T179)', () => {
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const accordion = (props: Record<string, unknown> = {}) =>
    render('cms.Accordion', {
      items: [
        { title: 'One', panel: [] },
        { title: 'Two', panel: [] },
      ],
      ...props,
    });

  it('T177 a read-more revealed above animates: inside the animation block its content may shrink below its content height', () => {
    const minified = builtCss.replace(/\s+/g, '');
    const opening = '@supports(interpolate-size:allow-keywords)andselector(::details-content){';
    const start = minified.indexOf(opening);
    expect(start).toBeGreaterThan(-1);
    // The block's own body, up to its matching brace.
    let depth = 1;
    let end = start + opening.length;
    while (depth > 0 && end < minified.length) {
      if (minified[end] === '{') depth += 1;
      if (minified[end] === '}') depth -= 1;
      end += 1;
    }
    const block = minified.slice(start, end);
    // A flex item's `min-block-size: auto` would hold `::details-content` at full height (B4).
    expect(block).toMatch(/details\.cmsc-read-more--reveal-above::details-content\{[^}]*min-block-size:0[;}]/);
    // Outside the block nothing changes: an unset passage is still a block with its summary first.
    const plain = query(
      render('cms.RichContent', {
        content: { type: 'doc', content: [{ type: 'readMore', attrs: {}, content: [{ type: 'readMoreSummary', content: [{ type: 'text', text: 'More' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] },
        html: '',
      }),
      'details',
    );
    expect(['', 'block']).toContain(style(plain, 'display'));
  });

  it('T178 a tile with no resting colour keeps today\'s title and label colours; a set one paints them', () => {
    const TILE = { title: doc('Machines'), linkLabel: 'See more', link: { kind: 'page', slug: 'machines' } };
    const plain = render('cms.LinkTile', TILE);
    expect(rgb(style(query(plain, '.cmsc-pb-link-tile__title'), 'color'))).toBe(ORIGIN.headingText);
    expect(rgb(style(query(plain, '.cmsc-pb-link-tile__label'), 'color'))).toBe(ORIGIN.primary);
    const set = render('cms.LinkTile', { ...TILE, titleColor: '#475569', labelColor: '#1d4ed8', titleHoverColor: '#ffffff' });
    expect(rgb(style(query(set, '.cmsc-pb-link-tile__title'), 'color'))).toBe('rgb(71, 85, 105)');
    expect(rgb(style(query(set, '.cmsc-pb-link-tile__label'), 'color'))).toBe('rgb(29, 78, 216)');
  });

  it('T179 an accordion keeps today\'s trigger colour and icon size unset; a title colour and an icon size change only those', () => {
    const plain = accordion();
    const trigger = query(plain, '.cmsc-pb-accordion__trigger');
    expect(query(plain, '.cmsc-pb-accordion').getAttribute('style')).toBeNull();
    const coloured = query(accordion({ titleColor: '#475569' }), '.cmsc-pb-accordion__trigger');
    expect(rgb(style(coloured, 'color'))).toBe('rgb(71, 85, 105)');
    expect(rgb(style(trigger, 'color'))).not.toBe('rgb(71, 85, 105)');
    expect(style(query(plain, '.cmsc-pb-accordion__icon'), 'font-size')).not.toBe('20px');
    const sized = query(accordion({ icon: 'chevron', iconSize: 'm' }), '.cmsc-pb-accordion__icon');
    expect(style(sized, 'font-size')).toBe('20px');
    // The line under the title: today's line under each item stays when the option is unset.
    expect(query(accordion(), '.cmsc-pb-accordion').className).not.toContain('divider-title');
    expect(query(accordion({ dividerPosition: 'title' }), '.cmsc-pb-accordion').className).toContain('cmsc-pb-accordion--divider-title');
  });
});

describe('R13: resting tile colours per breakpoint, the accordion\'s spacing and title weight keep today\'s look when unused (T181–T183)', () => {
  const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
  const accordion = (props: Record<string, unknown> = {}) =>
    render('cms.Accordion', {
      items: [
        { title: 'One', panel: [] },
        { title: 'Two', panel: [] },
      ],
      defaultOpen: 0,
      ...props,
    });

  // jsdom does not evaluate `@media`: what is read here is the base (narrowest) tier; the tiers above are
  // asserted on the built sheet in `LinkTile.test.tsx` and `Accordion.test.tsx`.
  it('T181 a tile keeps today\'s colours unset and below a breakpoint-only colour; a base colour paints the narrowest width', () => {
    const TILE = { title: doc('Machines'), linkLabel: 'See more', link: { kind: 'page', slug: 'machines' } };
    const desktopOnly = render('cms.LinkTile', { ...TILE, titleColor: { desktop: '#334155' }, labelColor: { desktop: '#334155' } });
    expect(rgb(style(query(desktopOnly, '.cmsc-pb-link-tile__title'), 'color'))).toBe(ORIGIN.headingText);
    expect(rgb(style(query(desktopOnly, '.cmsc-pb-link-tile__label'), 'color'))).toBe(ORIGIN.primary);
    const perTier = render('cms.LinkTile', { ...TILE, titleColor: { base: '#ffffff', desktop: '#334155' } });
    expect(rgb(style(query(perTier, '.cmsc-pb-link-tile__title'), 'color'))).toBe(ORIGIN.white);
  });

  it('T182 an accordion keeps no space above an open panel and none between plain items unset; a gap sets them', () => {
    const plain = accordion();
    const panel = query(plain, '.cmsc-pb-accordion__panel');
    // jsdom writes an unset length as `0`.
    expect(['0', '0px']).toContain(style(panel, 'padding-top'));
    expect(style(panel, 'padding-bottom')).toBe('12px');
    expect(['', '0', '0px']).toContain(style(query(plain, '.cmsc-pb-accordion__item'), 'margin-bottom'));
    const spaced = accordion({ panelGap: 'custom', panelGapPx: 24, itemGap: 'custom', itemGapPx: 20 });
    const open = query(spaced, '.cmsc-pb-accordion__panel');
    expect(resolveVars(open, style(open, 'padding-top'))).toBe('24px');
    const items = spaced.querySelectorAll<HTMLElement>('.cmsc-pb-accordion__item');
    expect(resolveVars(items[0]!, style(items[0]!, 'margin-bottom'))).toBe('20px');
    expect(['', '0', '0px']).toContain(style(items[1]!, 'margin-bottom'));
    // A breakpoint-only gap keeps today's at the narrowest width, 12 px under a title line included.
    const underTitle = query(accordion({ dividerPosition: 'title', panelGap: { desktop: 'l' } }), '.cmsc-pb-accordion__panel');
    expect(resolveVars(underTitle, style(underTitle, 'padding-top'))).toBe('12px');
  });

  it('T183 an accordion title keeps today\'s semibold trigger unset; a weight is the title\'s own', () => {
    const plain = accordion();
    expect(style(query(plain, '.cmsc-pb-accordion__trigger'), 'font-weight')).toBe('600');
    expect(query(plain, '.cmsc-pb-accordion__title').getAttribute('style')).toBeNull();
    expect(style(query(accordion({ titleWeight: 700 }), '.cmsc-pb-accordion__title'), 'font-weight')).toBe('700');
  });
});

describe('R14: the accordion\'s title weight per breakpoint and the space after an open panel keep today\'s look when unused (T185, T186)', () => {
  const accordion = (props: Record<string, unknown> = {}) =>
    render('cms.Accordion', {
      items: [
        { title: 'One', panel: [] },
        { title: 'Two', panel: [] },
      ],
      defaultOpen: 0,
      ...props,
    });

  // jsdom does not evaluate `@media`: what is read here is the base (narrowest) tier.
  it('T185 a title keeps today\'s weight below a breakpoint-only weight; a base weight is the narrowest width\'s', () => {
    const desktopOnly = query(accordion({ titleWeight: { desktop: 700 } }), '.cmsc-pb-accordion__title');
    expect(resolveVars(desktopOnly, style(desktopOnly, 'font-weight'))).toBe('600');
    const perTier = query(accordion({ titleWeight: { base: 500, desktop: 700 } }), '.cmsc-pb-accordion__title');
    expect(resolveVars(perTier, style(perTier, 'font-weight'))).toBe('500');
  });

  it('T186 an open panel keeps today\'s 12 px below it unset and below a breakpoint-only value; a value sets it', () => {
    expect(style(query(accordion(), '.cmsc-pb-accordion__panel'), 'padding-bottom')).toBe('12px');
    const desktopOnly = query(accordion({ panelPaddingBottom: { desktop: 'custom' }, panelPaddingBottomPx: { desktop: 4 } }), '.cmsc-pb-accordion__panel');
    expect(resolveVars(desktopOnly, style(desktopOnly, 'padding-bottom'))).toBe('12px');
    const set = query(accordion({ panelPaddingBottom: 'custom', panelPaddingBottomPx: 4 }), '.cmsc-pb-accordion__panel');
    expect(resolveVars(set, style(set, 'padding-bottom'))).toBe('4px');
  });
});

describe('R14: the tile\'s title and label weight per breakpoint keep today\'s look when unused (T188)', () => {
  const TILE = {
    title: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Guide' }] }] },
    linkLabel: 'Read more',
    link: { kind: 'page', slug: 'guide' },
  };
  /** The weight in effect: a variable left `initial` is invalid at computed-value time, so the span inherits. */
  const weightOf = (element: HTMLElement): string => {
    const value = style(element, 'font-weight');
    return value === '' || value === 'initial' ? weightOf(element.parentElement!) : value;
  };

  // jsdom does not evaluate `@media`: what is read here is the base (narrowest) tier.
  it('T188 a title and a label keep today\'s 600 below a breakpoint-only weight; a base weight is the narrowest width\'s', () => {
    const desktopOnly = render('cms.LinkTile', { ...TILE, titleWeight: { desktop: 500 }, labelWeight: { desktop: 400 } });
    expect(weightOf(query(desktopOnly, '.cmsc-pb-link-tile__title-text'))).toBe('600');
    expect(weightOf(query(desktopOnly, '.cmsc-pb-link-tile__label-text'))).toBe('600');
    const perTier = render('cms.LinkTile', { ...TILE, titleWeight: { base: 400, desktop: 500 } });
    expect(weightOf(query(perTier, '.cmsc-pb-link-tile__title-text'))).toBe('400');
    // A sized title below a breakpoint-only weight keeps its token's weight.
    const sized = render('cms.LinkTile', { ...TILE, titleSize: 'h6', titleWeight: { desktop: 500 } });
    expect(weightOf(query(sized, '.cmsc-pb-link-tile__title-text'))).toBe('700');
  });
});

describe('R15: the post card\'s look keeps today\'s card when unused (T189)', () => {
  const POST = {
    id: 'p-1', slug: 'first', name: 'First post', publishedAt: null, excerpt: null,
    mainImageUrl: 'https://cdn.example.com/first.jpg', primaryCategorySlug: 'news', primaryCategoryName: 'News', url: '/blog/first',
  };
  const DEFAULTS = (defaultPageBuilderConfig.components as Record<string, { defaultProps?: Record<string, unknown> }>)['blog.LatestPosts']!.defaultProps ?? {};
  function news(props: Record<string, unknown> = {}): HTMLElement {
    const merged: Record<string, unknown> = { ...DEFAULTS, id: 'news-1', layout: 'grid', header: { lead: 'Lead' }, ...props };
    const request = blogPostsDataRequest({ limit: merged['limit'] as number | undefined, categorySlug: merged['categorySlug'] as string | undefined });
    const host = document.createElement('div');
    host.innerHTML = renderToString(
      createElement(CatalogPreviewProvider as never, { data: { [blockDataKey(request)]: [POST] } } as never,
        createElement(Render as never, { config: defaultPageBuilderConfig as never, data: { root: { props: {} }, content: [{ type: 'blog.LatestPosts', props: merged }], zones: {} } as never })),
    );
    document.body.appendChild(host);
    return host;
  }
  const zero = (value: string): boolean => /^(0(px)?\s*)+$/.test(value);

  // jsdom does not evaluate `@media`: what is read here is the base (narrowest) tier.
  it('T189 a card keeps today\'s background, corners, padding, chip, read-more weight and lead colour unset', () => {
    const host = news();
    const card = query(host, '.cmsc-pb-post-card');
    expect(rgb(style(card, 'background-color'))).toBe(ORIGIN.white);
    expect(style(card, 'border-radius')).toBe('8px');
    expect(zero(style(card, 'padding-top'))).toBe(true);
    const body = query(host, '.cmsc-pb-post-card__body');
    expect(style(body, 'padding-top')).toBe('16px');
    expect(zero(style(body, 'padding-left'))).toBe(true);
    const chip = query(host, '.cmsc-pb-post-card__chip');
    expect(rgb(style(chip, 'background'))).toBe('rgb(241, 245, 249)');
    expect(style(chip, 'font-weight')).toBe('600');
    expect(style(query(host, '.cmsc-pb-post-card__more'), 'font-weight')).toBe('600');
    expect(rgb(style(query(host, '.cmsc-pb-carousel__lead'), 'color'))).toBe('rgb(100, 116, 139)');
  });

  it('T189 breakpoint-only values keep today\'s card at the narrowest width; base values set it', () => {
    const desktopOnly = news({ cardPadding: { desktop: 'custom' }, cardPaddingPx: { desktop: 20 }, cardTextPadding: { desktop: 'l' } });
    expect(zero(style(query(desktopOnly, '.cmsc-pb-post-card'), 'padding-top'))).toBe(true);
    const body = query(desktopOnly, '.cmsc-pb-post-card__body');
    expect(style(body, 'padding-top')).toBe('16px');
    expect(zero(style(body, 'padding-left'))).toBe(true);
    const set = news({ cardBackground: '#e2e8f0', cardRadius: 'none', cardPadding: 'custom', cardPaddingPx: 12, cardTextPadding: 'custom', cardTextPaddingPx: 24 });
    const card = query(set, '.cmsc-pb-post-card');
    expect(rgb(style(card, 'background-color'))).toBe('rgb(226, 232, 240)');
    expect(zero(style(card, 'border-radius'))).toBe(true);
    expect(style(card, 'padding-top')).toBe('12px');
    expect(style(query(set, '.cmsc-pb-post-card__body'), 'padding-left')).toBe('24px');
  });
});
