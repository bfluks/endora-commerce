// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';
import { twelveColumns } from './twelve-columns.js';
import { rowVerticalAlign } from './Row.js';
import { tierLeading } from './tier-leading.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R22I — grid, alignment and block
 * option fixes found while rebuilding the reference pages. Every option is
 * optional: unset, the block renders today's markup (each `describe` starts
 * with that guard).
 *
 * - T370: the 12-column layouts' column gap is their own (`columnGapPx`), not
 *   the page's side gutter;
 * - T371: a media-at-the-end pair anchored at column 1 (`columnsAnchor`);
 * - T372: a call-to-action card's two-column list follows its side-by-side tier;
 * - T373: a Row's vertical alignment reaches its columns (and `'center'` reads
 *   as `'middle'`);
 * - T374–T382: the options, block by block.
 *
 * R23 (T435–T443) simplified a part of the options: one weight, a line height
 * with a Custom px size only, the card's heading space as a spacing step, and
 * the rich text's list weight, the feature text's colour and the sign-up's
 * topic label size removed. The cases below say which.
 */

const config = defaultPageBuilderConfig as Config;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function render(type: string, props: Record<string, unknown>): string {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  const content = [{ type, props: { ...defaults, id: 'block-1', ...props } }] as Data['content'];
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
}

function renderContent(content: unknown[]): string {
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content: content as Data['content'] }} />
    </CmsRenderProvider>,
  );
}

function dom(type: string, props: Record<string, unknown>): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = render(type, props);
  return host;
}

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

async function fieldKeys(type: string, props: Record<string, unknown>): Promise<string[]> {
  const block = config.components[type] as ComponentConfig;
  const fields = block.fields as Fields;
  const resolved = block.resolveFields
    ? await block.resolveFields(
        { props: { ...(block.defaultProps ?? {}), ...props } } as never,
        { fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
      )
    : fields;
  return Object.keys(resolved);
}

function responsiveFields(type: string): string[] {
  return ((config.components[type] as unknown as { responsiveFields?: string[] }).responsiveFields ?? []) as string[];
}

const IMAGE = { imageSource: 'url', src: 'https://example.com/a.jpg', alt: '' };

// ── T370: the 12-column layouts' own column gap ──────────────────────────────

describe('12-column layouts take a column gap of their own, not the side gutter (T370)', () => {
  const MEDIA_TEXT = { heading: 'Heading', body: doc('Text'), media: { kind: 'image', image: IMAGE } };

  it('the stylesheet reads the block’s gap, then today’s gutter — per tier', () => {
    const css = sheet();
    const chain = (suffix: string) => `var(--cmsc-grid-gap${suffix}, var(--cmsb-gutter, 24px))`;
    expect(css).toContain(
      `.cmsc-pb-stats-block--columns { grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: ${chain('-md')}; }`,
    );
    expect(css).toContain(
      `.cmsc-pb-carousel-split--columns { grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: ${chain('-md')}; }`,
    );
    expect(css).toContain(
      `.cmsc-pb-media-text--columns .cmsc-pb-media-text__row { grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: ${chain('-md')}; }`,
    );
    expect(css).toContain(
      `@media (min-width: 1024px) { .cmsc-pb-stats-block--columns, .cmsc-pb-carousel-split--columns, .cmsc-pb-media-text--columns .cmsc-pb-media-text__row { column-gap: ${chain('-lg')}; } }`,
    );
    // Nothing of the inner grids reads the bare side gutter any more.
    expect(css).not.toMatch(/--columns[^{]*\{[^}]*column-gap: var\(--cmsb-gutter/);
    // The Row's own gap fallback (it always writes its gap) reads the same chain.
    expect(css).toContain('.cmsc-pb-gap { gap: var(--pb-gap, var(--cmsb-gutter, 24px));');
  });

  it('unset: no gap variable on any of the three', () => {
    const media = dom('cms.MediaText', { ...MEDIA_TEXT, mediaSpan: 5 }).querySelector('.cmsc-pb-media-text')!;
    expect(media.getAttribute('style')).not.toContain('--cmsc-grid-gap');
    const stats = dom('cms.Stats', { image: IMAGE, imageSpan: 5 }).querySelector('.cmsc-pb-stats-block')!;
    expect(stats.getAttribute('style')).not.toContain('--cmsc-grid-gap');
    const split = dom('cms.CarouselSplit', { mediaSpan: 5 }).querySelector('.cmsc-pb-carousel-split')!;
    expect(split.getAttribute('style')).not.toContain('--cmsc-grid-gap');
  });

  it('set: px per breakpoint on the grid’s element, only with the columns of 12', async () => {
    const media = dom('cms.MediaText', { ...MEDIA_TEXT, mediaSpan: 5, columnGapPx: { base: 16, desktop: 24 } }).querySelector('.cmsc-pb-media-text')!;
    const style = media.getAttribute('style') ?? '';
    expect(style).toContain('--cmsc-grid-gap:16px');
    expect(style).toContain('--cmsc-grid-gap-md:16px');
    expect(style).toContain('--cmsc-grid-gap-lg:24px');
    // No columns of 12: the value is not written (the split keeps its own gap).
    expect(dom('cms.MediaText', { ...MEDIA_TEXT, columnGapPx: 16 }).querySelector('.cmsc-pb-media-text')!.hasAttribute('style')).toBe(false);

    const stats = dom('cms.Stats', { image: IMAGE, imageSpan: 5, figuresOffset: 2, columnGapPx: 16 }).querySelector('.cmsc-pb-stats-block')!;
    expect(stats.getAttribute('style')).toContain('--cmsc-grid-gap-lg:16px');
    const split = dom('cms.CarouselSplit', { mediaSpan: 5, columnGapPx: 16 }).querySelector('.cmsc-pb-carousel-split')!;
    expect(split.getAttribute('style')).toContain('--cmsc-grid-gap-md:16px');

    for (const [type, columns] of [
      ['cms.MediaText', { ...MEDIA_TEXT, mediaSpan: 5 }],
      ['cms.Stats', { image: IMAGE, imageSpan: 5 }],
      ['cms.CarouselSplit', { mediaSpan: 5 }],
    ] as const) {
      expect(await fieldKeys(type, columns), type).toContain('columnGapPx');
      expect(responsiveFields(type), type).toContain('columnGapPx');
    }
    expect(await fieldKeys('cms.MediaText', MEDIA_TEXT)).not.toContain('columnGapPx');
    expect(await fieldKeys('cms.Stats', { image: IMAGE })).not.toContain('columnGapPx');
    expect(await fieldKeys('cms.CarouselSplit', {})).not.toContain('columnGapPx');
  });
});

// ── T371: the pair anchored at a chosen edge ─────────────────────────────────

describe('a media-at-the-end pair may start at column 1 (T371)', () => {
  const SPANS = { mediaSpan: 5, textSpan: 5, textOffset: 1 };

  it('unset (or `media`): today’s mirror from column 12', () => {
    expect(twelveColumns(SPANS, 'end')).toEqual({ media: '8 / span 5', text: '2 / span 5' });
    expect(twelveColumns({ ...SPANS, columnsAnchor: 'media' }, 'end')).toEqual({ media: '8 / span 5', text: '2 / span 5' });
    expect(twelveColumns(SPANS, 'start')).toEqual({ media: '1 / span 5', text: '7 / span 5' });
  });

  it('`start`: the pair from column 1 whatever the media side; `end`: the pair to column 12', () => {
    expect(twelveColumns({ ...SPANS, columnsAnchor: 'start' }, 'end')).toEqual({ media: '7 / span 5', text: '1 / span 5' });
    expect(twelveColumns({ ...SPANS, columnsAnchor: 'start' }, 'start')).toEqual({ media: '1 / span 5', text: '7 / span 5' });
    expect(twelveColumns({ ...SPANS, columnsAnchor: 'end' }, 'start')).toEqual({ media: '2 / span 5', text: '8 / span 5' });
    expect(twelveColumns({ ...SPANS, columnsAnchor: 'end' }, 'end')).toEqual({ media: '8 / span 5', text: '2 / span 5' });
  });

  it('cms.MediaText writes the anchored columns for alternating rows; cms.CarouselSplit for its side', async () => {
    const BASE = { heading: 'Heading', body: doc('Text'), media: { kind: 'image', image: IMAGE } };
    const style = dom('cms.MediaText', { ...BASE, ...SPANS, columnsAnchor: 'start' }).querySelector('.cmsc-pb-media-text')!.getAttribute('style') ?? '';
    expect(style).toContain('--cmsc-mt-media-col:1 / span 5');
    expect(style).toContain('--cmsc-mt-media-col-end:7 / span 5');
    expect(style).toContain('--cmsc-mt-text-col-end:1 / span 5');
    const split = dom('cms.CarouselSplit', { ...SPANS, mediaSide: 'end', columnsAnchor: 'start' }).querySelector('.cmsc-pb-carousel-split')!;
    expect(split.getAttribute('style')).toContain('--cmsc-split-media-col:7 / span 5');
    expect(split.getAttribute('style')).toContain('--cmsc-split-text-col:1 / span 5');
    expect(await fieldKeys('cms.MediaText', { ...BASE, mediaSpan: 5 })).toContain('columnsAnchor');
    expect(await fieldKeys('cms.MediaText', BASE)).not.toContain('columnsAnchor');
    expect(await fieldKeys('cms.CarouselSplit', { mediaSpan: 5 })).toContain('columnsAnchor');
    expect(await fieldKeys('cms.CarouselSplit', {})).not.toContain('columnsAnchor');
  });
});

// ── T372: the card's list columns ────────────────────────────────────────────

describe('a call-to-action card’s two-column list follows its side-by-side tier (T372)', () => {
  it('stacked to the desktop: one column on a tablet; side by side from the tablet: today’s two columns', () => {
    const css = sheet();
    expect(css).toContain(
      "@media (min-width: 768px) and (max-width: 1023.98px) { .cmsc-pb-cta-card[data-side-by-side='desktop'] > .cmsc-pb-cta-card__text > .cmsc-pb-cta-card__list[data-columns='2'] { grid-template-columns: minmax(0, 1fr); } }",
    );
    const card = dom('cms.CtaCard', { image: IMAGE, sideBySide: 'desktop', list: [{ text: 'One' }, { text: 'Two' }] }).querySelector('.cmsc-pb-cta-card')!;
    expect(card.getAttribute('data-side-by-side')).toBe('desktop');
    expect(card.querySelector('.cmsc-pb-cta-card__text > .cmsc-pb-cta-card__list')!.getAttribute('data-columns')).toBe('2');
  });
});

// ── T373: a Row's vertical alignment ─────────────────────────────────────────

describe('a Row’s vertical alignment reaches its columns (T373)', () => {
  const rowDefaults = (config.components['cms.Row']?.defaultProps ?? {}) as Record<string, unknown>;
  const columnDefaults = (config.components['cms.Column']?.defaultProps ?? {}) as Record<string, unknown>;
  const textDefaults = (config.components['cms.Text']?.defaultProps ?? {}) as Record<string, unknown>;
  const rowWith = (props: Record<string, unknown>) => {
    const host = document.createElement('div');
    host.innerHTML = renderContent([
      {
        type: 'cms.Row',
        props: {
          ...rowDefaults,
          id: 'row-1',
          ...props,
          content: [{ type: 'cms.Column', props: { ...columnDefaults, id: 'col-1', span: 6, content: [{ type: 'cms.Text', props: { ...textDefaults, id: 't', text: 'In' } }] } }],
        },
      },
    ]);
    return host;
  };

  it('a column stretches only when its row does: no `align-self` of its own', () => {
    const column = rowWith({}).querySelector('.cmsc-pb-row-col')!;
    expect(column.className).not.toContain('self-stretch');
    expect(sheet()).not.toMatch(/\.cmsc-pb-row-col[^{]*\{[^}]*align-self/);
  });

  it('unset: the row stretches its columns, as before', () => {
    const cols = rowWith({}).querySelector('.cmsc-pb-row-cols')!;
    expect(cols.getAttribute('data-align')).toBe('stretch');
    expect(sheet()).toContain(".cmsc-pb-cols-align[data-align='stretch'] { align-items: stretch; }");
  });

  it('`center` (the media-and-text wording) reads as `middle`, per breakpoint', () => {
    const cols = rowWith({ verticalAlign: { base: 'center', desktop: 'top' } }).querySelector('.cmsc-pb-row-cols')!;
    expect(cols.getAttribute('data-align')).toBe('middle');
    expect(cols.getAttribute('data-align-md')).toBe('middle');
    expect(cols.getAttribute('data-align-lg')).toBe('top');
    expect(rowWith({ verticalAlign: 'center' }).querySelector('.cmsc-pb-row-cols')!.getAttribute('data-align')).toBe('middle');
    expect(rowVerticalAlign('center')).toBe('middle');
    expect(rowVerticalAlign({ base: 'bottom', tablet: 'center' })).toEqual({ base: 'bottom', tablet: 'middle' });
    expect(rowVerticalAlign(undefined)).toBeUndefined();
  });
});

// ── T374: the call-to-action card's heading space, text weight and measure ────

describe('cms.CtaCard heading space, text weight and text max width (T374)', () => {
  it('unset: today’s card and text', () => {
    const host = dom('cms.CtaCard', {});
    expect(host.querySelector('.cmsc-pb-cta-card')!.className).toBe('cmsc-pb-cta-card');
    expect(host.querySelector('.cmsc-pb-cta-card__body')!.hasAttribute('style')).toBe(false);
  });

  it('set: the space below the heading (R23: a spacing step), one weight and the measure on the text', async () => {
    const host = dom('cms.CtaCard', {
      headingSpace: 's',
      bodyWeight: { base: 400, desktop: 500 },
      textMaxWidth: { base: 'none', desktop: 'custom' },
      textMaxWidthPx: 544,
    });
    const card = host.querySelector('.cmsc-pb-cta-card')!;
    expect(card.className).toContain('cmsc-pb-cta-card--heading-space');
    expect(card.getAttribute('style')).toContain('--cmsc-cta-heading-space:var(--cmsb-space-s, 16px)');
    expect(card.getAttribute('style')).toContain('--cmsc-cta-heading-space-lg:var(--cmsb-space-s, 24px)');
    const body = host.querySelector('.cmsc-pb-cta-card__body')!;
    expect(body.className).not.toContain('cmsc-pb-ts-weight');
    expect(body.className).toContain('cmsc-text-max');
    expect(body.getAttribute('style')).toContain('font-weight:500');
    expect(body.getAttribute('style')).toContain('--cmsc-text-max-lg:544px');
    // R22I's px space is ignored data.
    expect(dom('cms.CtaCard', { headingSpacePx: 24 }).querySelector('.cmsc-pb-cta-card')!.className).toBe('cmsc-pb-cta-card');
    const css = sheet();
    expect(css).toContain('.cmsc-pb-cta-card--heading-space .cmsc-pb-cta-card__heading { margin-bottom: var(--cmsc-cta-heading-space, 16px); }');
    expect(css).toContain('.cmsc-pb-cta-card--heading-space .cmsc-pb-cta-card__heading { margin-bottom: var(--cmsc-cta-heading-space-lg, 16px); }');
    const keys = await fieldKeys('cms.CtaCard', {});
    expect(keys).toEqual(expect.arrayContaining(['headingSpace', 'bodyWeight', 'textMaxWidth']));
    expect(keys).not.toContain('textMaxWidthPx');
    expect(await fieldKeys('cms.CtaCard', { textMaxWidth: 'custom' })).toContain('textMaxWidthPx');
    expect(responsiveFields('cms.CtaCard')).toEqual(expect.arrayContaining(['textMaxWidth', 'textMaxWidthPx']));
  });
});

// ── T375: the stats' value line height ───────────────────────────────────────

describe('cms.Stats value line height (T375)', () => {
  const STATS = { items: [{ value: '30+', label: 'Years' }], valueSize: { base: 'h3', desktop: 'h2' } };

  it('unset: no line height on the value', () => {
    expect(dom('cms.Stats', STATS).querySelector('.cmsc-pb-stats__value')!.getAttribute('style')).not.toMatch(/line-height|--pb-lh/);
  });

  it('R23 (T435): only where the size is Custom px — one value inline; from the first Custom breakpoint up, the others keep the token’s', async () => {
    // A token at every breakpoint brings its own line height: a stored one is not applied.
    expect(dom('cms.Stats', { ...STATS, valueLineHeight: 1.2 }).querySelector('.cmsc-pb-stats__value')!.getAttribute('style')).not.toMatch(
      /line-height|--pb-lh/,
    );
    expect(
      dom('cms.Stats', { ...STATS, valueSize: 'custom', valueSizePx: 64, valueLineHeight: 1.2 }).querySelector('.cmsc-pb-stats__value')!.getAttribute('style'),
    ).toContain('line-height:1.2');
    const value = dom('cms.Stats', { ...STATS, valueSize: { base: 'h3', desktop: 'custom' }, valueSizePx: 64, valueLineHeight: 1.2 }).querySelector(
      '.cmsc-pb-stats__value',
    )!;
    expect(value.className).toContain('cmsc-pb-lh-lg');
    expect(value.className).not.toMatch(/cmsc-pb-lh(\s|$)|cmsc-pb-lh-md/);
    expect(value.getAttribute('style')).toContain('--pb-lh-lg:1.2');
    expect(await fieldKeys('cms.Stats', {})).not.toContain('valueLineHeight');
    expect(await fieldKeys('cms.Stats', { valueSize: { base: 'h3', desktop: 'custom' } })).toContain('valueLineHeight');
    expect(responsiveFields('cms.Stats')).toContain('valueLineHeight');
  });

  it('the helper: per-tier classes win over a token’s line height, at the end of the stylesheet', () => {
    expect(tierLeading(undefined, null)).toEqual({ classes: [], style: {} });
    expect(tierLeading({ base: 1.2, tablet: 1.2, desktop: 1.2 }, null)).toEqual({ classes: [], style: { lineHeight: '1.2' } });
    expect(tierLeading({ base: 1.3, desktop: 1 }, null)).toEqual({
      classes: ['cmsc-pb-lh', 'cmsc-pb-lh-md', 'cmsc-pb-lh-lg'],
      style: { '--pb-lh': '1.3', '--pb-lh-md': '1.3', '--pb-lh-lg': '1' },
    });
    expect(tierLeading({ base: 1.3, desktop: 1 }, 'desktop')).toEqual({ classes: [], style: { lineHeight: '1' } });
    expect(tierLeading({ desktop: 1 }, 'mobile')).toEqual({ classes: [], style: {} });
    const css = sheet();
    expect(css).toContain('.cmsc-pb-lh.cmsc-pb-lh { line-height: var(--pb-lh); }');
    expect(css).toContain('@media (min-width: 1024px) { .cmsc-pb-lh-lg.cmsc-pb-lh-lg { line-height: var(--pb-lh-lg); } }');
    expect(css.indexOf('.cmsc-pb-lh.cmsc-pb-lh')).toBeGreaterThan(css.indexOf('.cmsc-pb-text-token {'));
  });
});

// ── T376: the media-and-text features' text ──────────────────────────────────

describe('cms.MediaText feature text size and weight (T376; R23: one weight, no colour of its own)', () => {
  const BASE = { heading: 'Heading', body: doc('Text'), features: [{ icon: 'check', title: 'Title', body: 'Feature text' }] };

  it('unset: today’s feature text', () => {
    expect(dom('cms.MediaText', BASE).querySelector('.cmsc-pb-media-text__feature-body')!.hasAttribute('style')).toBe(false);
  });

  it('set: the size per breakpoint (a token bringing its line height), one weight; a stored colour is ignored', async () => {
    const body = dom('cms.MediaText', {
      ...BASE,
      featureBodySize: 'body',
      featureBodyWeight: { base: 400, desktop: 500 },
      featureBodyColor: '#ffffff',
    }).querySelector('.cmsc-pb-media-text__feature-body')!;
    expect(body.getAttribute('style')).toContain('font-size:var(--cmsb-t-body-size, 16px)');
    expect(body.getAttribute('style')).toContain('line-height:var(--cmsb-t-body-lh, 1.65)');
    expect(body.className).not.toContain('cmsc-pb-ts-weight');
    expect(body.getAttribute('style')).toContain('font-weight:500');
    expect(body.getAttribute('style')).not.toContain('color:');
    const custom = dom('cms.MediaText', { ...BASE, featureBodySize: 'custom', featureBodySizePx: 18 }).querySelector('.cmsc-pb-media-text__feature-body')!;
    expect(custom.getAttribute('style')).toContain('font-size:18px');
    const keys = await fieldKeys('cms.MediaText', BASE);
    expect(keys).toEqual(expect.arrayContaining(['featureBodySize', 'featureBodyWeight']));
    expect(keys).not.toContain('featureBodyColor');
    expect(keys).not.toContain('featureBodySizePx');
    expect(await fieldKeys('cms.MediaText', { ...BASE, featureBodySize: 'custom' })).toContain('featureBodySizePx');
    expect(responsiveFields('cms.MediaText')).toEqual(expect.arrayContaining(['featureBodySize', 'featureBodySizePx']));
    expect(responsiveFields('cms.MediaText')).not.toContain('featureBodyWeight');
  });
});

// ── T377: rich content weights ───────────────────────────────────────────────

describe('cms.RichContent text weight (T377; R23: one value, the lists follow it)', () => {
  const RICH = { content: doc('Text'), html: '<p>Text</p><ul><li>One</li></ul>' };
  const prose = (host: HTMLElement) => host.querySelector('.cmsc-pb-rich-content')!;

  it('unset: today’s prose', () => {
    const element = prose(dom('cms.RichContent', RICH));
    expect(element.className).not.toMatch(/ts-weight|list-weight/);
    expect(element.hasAttribute('style')).toBe(false);
  });

  it('set: one text weight (a stored per-breakpoint one read as its desktop value); a stored list weight is ignored', async () => {
    const element = prose(dom('cms.RichContent', { ...RICH, textWeight: { base: 400, desktop: 500 }, listWeight: { desktop: 500 } }));
    expect(element.className).not.toMatch(/ts-weight|list-weight/);
    expect(element.getAttribute('style')).toBe('font-weight:500');
    expect(prose(dom('cms.RichContent', { ...RICH, textWeight: 500 })).getAttribute('style')).toContain('font-weight:500');
    expect(sheet()).not.toContain('cmsc-pb-rich-content--list-weight');
    const keys = await fieldKeys('cms.RichContent', RICH);
    expect(keys).toContain('textWeight');
    expect(keys).not.toContain('listWeight');
    expect(responsiveFields('cms.RichContent')).not.toContain('textWeight');
  });
});

// ── T378: the feature list's icon position per breakpoint and item widths ────

describe('cms.FeatureList icon position per breakpoint, item widths and title weight (T378)', () => {
  const list = (props: Record<string, unknown>) => dom('cms.FeatureList', props).querySelector('.cmsc-pb-feature-list')!;

  it('unset or one position: today’s attribute', () => {
    expect(list({}).hasAttribute('data-icon-position')).toBe(false);
    const beside = list({ iconPosition: 'beside' });
    expect(beside.getAttribute('data-icon-position')).toBe('beside');
    expect(beside.hasAttribute('data-icon-position-md')).toBe(false);
    expect(list({ iconPosition: { base: 'beside', tablet: 'beside', desktop: 'beside' } }).hasAttribute('data-icon-position-lg')).toBe(false);
  });

  it('a position per breakpoint: one attribute per tier, the stylesheet places or unplaces the icon', async () => {
    const tiered = list({ iconPosition: { base: 'above', tablet: 'beside', desktop: 'above' } });
    expect(tiered.getAttribute('data-icon-position')).toBe('above');
    expect(tiered.getAttribute('data-icon-position-md')).toBe('beside');
    expect(tiered.getAttribute('data-icon-position-lg')).toBe('above');
    const css = sheet();
    expect(css).toContain(
      "@media (min-width: 768px) { .cmsc-pb-feature-list[data-icon-position-md='beside'] > .cmsc-pb-feature-list__item { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: baseline; column-gap: var(--cmsc-fl-icon-space-md, var(--cmsc-fl-icon-space, 12px)); }",
    );
    expect(css).toContain(
      ".cmsc-pb-feature-list[data-icon-position-lg='above'] > .cmsc-pb-feature-list__item { display: list-item; }",
    );
    expect(responsiveFields('cms.FeatureList')).toContain('iconPosition');
    expect(await fieldKeys('cms.FeatureList', {})).toContain('iconPosition');
  });

  it('an item’s width in columns of 12 on desktops: the list moves to 12 columns there, the others keep theirs', async () => {
    expect(list({}).className).not.toContain('--spans');
    const items = [
      { title: 'A', body: doc('a'), span: 6 },
      { title: 'B', body: doc('b') },
    ];
    const element = list({ items, columns: { base: 1, desktop: 2 } });
    expect(element.className).toContain('cmsc-pb-feature-list--spans');
    expect(element.getAttribute('style')).toContain('--cmsc-fl-default-span:6');
    const [first, second] = Array.from(element.querySelectorAll('.cmsc-pb-feature-list__item'));
    expect(first!.getAttribute('style')).toBe('--cmsc-fl-span:6');
    expect(second!.hasAttribute('style')).toBe(false);
    const css = sheet();
    expect(css).toContain(
      '@media (min-width: 1024px) { .cmsc-pb-feature-list--spans { grid-template-columns: repeat(12, minmax(0, 1fr)); } .cmsc-pb-feature-list--spans > .cmsc-pb-feature-list__item { grid-column: span var(--cmsc-fl-span, var(--cmsc-fl-default-span, 4)); } }',
    );
    const block = config.components['cms.FeatureList'] as ComponentConfig;
    const itemFields = (block.fields as Record<string, { arrayFields?: Record<string, unknown> }>)['items']!.arrayFields!;
    expect(Object.keys(itemFields)).toContain('span');
  });

  it('the title weight is per breakpoint already (a guard)', () => {
    const title = dom('cms.FeatureList', { titleWeight: { base: 400, desktop: 500 } }).querySelector('.cmsc-pb-feature-list__title')!;
    expect(title.querySelector('.cmsc-pb-item-weight')!.getAttribute('style')).toContain('--pb-item-weight-lg:500');
    expect(responsiveFields('cms.FeatureList')).toContain('titleWeight');
  });
});

// ── T379: line heights and the posts' lead weight ────────────────────────────

describe('carousel header heading and link list title line heights (T379)', () => {
  const HEADER = { header: { heading: 'Heading', lead: 'Lead' } };

  it('unset: today’s header heading', () => {
    const heading = dom('cms.ContentSlider', HEADER).querySelector('.cmsc-pb-carousel__heading')!;
    expect(heading.getAttribute('style') ?? '').not.toMatch(/line-height|--pb-lh/);
  });

  it('set with a Custom px heading size (R23 T435): the line height from that breakpoint up, offered on every listing with the header', async () => {
    const CUSTOM = { ...HEADER, headingSize: { base: 'h3', desktop: 'custom' }, headingSizePx: 40 };
    const heading = dom('cms.ContentSlider', { ...CUSTOM, headingLineHeight: { base: 1.2, desktop: 1 } }).querySelector('.cmsc-pb-carousel__heading')!;
    expect(heading.className).toContain('cmsc-pb-lh-lg');
    expect(heading.className).not.toMatch(/cmsc-pb-lh(\s|$)/);
    expect(heading.getAttribute('style')).toContain('--pb-lh-lg:1');
    // A token heading brings its own line height: a stored one is not applied.
    expect(dom('cms.ContentSlider', { ...HEADER, headingLineHeight: 1.2 }).querySelector('.cmsc-pb-carousel__heading')!.getAttribute('style') ?? '').not.toMatch(
      /line-height|--pb-lh/,
    );
    for (const type of ['cms.ContentSlider', 'catalog.ProductSlider', 'catalog.ProductGrid', 'blog.LatestPosts']) {
      expect(await fieldKeys(type, HEADER), type).not.toContain('headingLineHeight');
      expect(await fieldKeys(type, CUSTOM), type).toContain('headingLineHeight');
      expect(responsiveFields(type), type).toContain('headingLineHeight');
    }
  });

  it('cms.LinkList row title line height, with a Custom px size (R23 T435)', async () => {
    const ITEMS = { items: [{ title: 'Row', description: '' }] };
    expect(dom('cms.LinkList', ITEMS).querySelector('.cmsc-pb-link-list__title')!.hasAttribute('style')).toBe(false);
    expect(
      dom('cms.LinkList', { ...ITEMS, titleSize: 'custom', titleSizePx: 18, titleLineHeight: 1.3 }).querySelector('.cmsc-pb-link-list__title')!.getAttribute('style'),
    ).toContain('line-height:1.3');
    expect(dom('cms.LinkList', { ...ITEMS, titleLineHeight: 1.3 }).querySelector('.cmsc-pb-link-list__title')!.hasAttribute('style')).toBe(false);
    expect(await fieldKeys('cms.LinkList', ITEMS)).not.toContain('titleLineHeight');
    expect(await fieldKeys('cms.LinkList', { ...ITEMS, titleSize: 'custom' })).toContain('titleLineHeight');
    expect(responsiveFields('cms.LinkList')).toContain('titleLineHeight');
  });

  it('blog.LatestPosts offers a lead weight — one value (R23 T435)', async () => {
    expect(await fieldKeys('blog.LatestPosts', HEADER)).toContain('leadWeight');
    expect(responsiveFields('blog.LatestPosts')).not.toContain('leadWeight');
  });
});

// ── T380: the sign-up's topic labels and button icon ─────────────────────────

describe('newsletter.Signup button icon (T380; R23 T443: no topic label size)', () => {
  const TOPICS = { topics: [{ label: 'News', tagCode: 'news' }] };

  it('unset: today’s topics and button', () => {
    const host = dom('newsletter.Signup', TOPICS);
    expect(host.querySelector('.cmsc-pb-signup__topics')!.className).toBe('cmsc-pb-signup__topics');
    const button = host.querySelector('.cmsc-pb-signup__button')!;
    expect(button.className).toBe('cmsc-pb-signup__button');
    expect(button.querySelector('svg')).toBeNull();
  });

  it('set: an icon after the button’s label; a stored topic label size is ignored', async () => {
    const host = dom('newsletter.Signup', { ...TOPICS, topicLabelSizePx: { base: 16, tablet: 18, desktop: 14 }, buttonIcon: 'chevronRight' });
    const topics = host.querySelector('.cmsc-pb-signup__topics')!;
    expect(topics.className).toBe('cmsc-pb-signup__topics');
    expect(topics.hasAttribute('style')).toBe(false);
    const button = host.querySelector('.cmsc-pb-signup__button')!;
    expect(button.className).toContain('cmsc-pb-signup__button--icon');
    const icon = button.querySelector('svg.cmsc-pb-signup__button-icon')!;
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(button.lastElementChild).toBe(icon);
    expect(sheet()).not.toContain('cmsc-pb-signup__topics--label-size');
    expect(await fieldKeys('newsletter.Signup', TOPICS)).toContain('buttonIcon');
    expect(await fieldKeys('newsletter.Signup', TOPICS)).not.toContain('topicLabelSizePx');
  });
});

// ── T381: the testimonial's quote size ───────────────────────────────────────

describe('cms.Testimonial quote size (T381)', () => {
  it('unset: today’s quote', () => {
    expect(dom('cms.Testimonial', {}).querySelector('.cmsc-pb-testimonial__quote')!.hasAttribute('style')).toBe(false);
  });

  it('set: a type token or Custom px per breakpoint', async () => {
    const quote = dom('cms.Testimonial', { quoteSize: { base: 'body', desktop: 'custom' }, quoteSizePx: { desktop: 14 } }).querySelector(
      '.cmsc-pb-testimonial__quote',
    )!;
    expect(quote.className).toContain('cmsc-pb-ts-size');
    expect(quote.getAttribute('style')).toContain('--pb-ts-size:var(--cmsb-t-body-size, 16px)');
    expect(quote.getAttribute('style')).toContain('--pb-ts-size-lg:14px');
    expect(await fieldKeys('cms.Testimonial', {})).toContain('quoteSize');
    expect(await fieldKeys('cms.Testimonial', {})).not.toContain('quoteSizePx');
    expect(await fieldKeys('cms.Testimonial', { quoteSize: 'custom' })).toContain('quoteSizePx');
    expect(responsiveFields('cms.Testimonial')).toEqual(expect.arrayContaining(['quoteSize', 'quoteSizePx']));
  });
});

// ── T382: the download tile's button icon ────────────────────────────────────

describe('cms.DownloadTile icon button glyph (T382)', () => {
  const TILE = { title: 'Catalogue', linkTo: 'link', link: { kind: 'url', href: 'https://example.com/terms' }, linkLook: 'icon', fileAssetId: '' };

  it('unset: today’s glyph (a page link’s arrow)', () => {
    const icon = dom('cms.DownloadTile', TILE).querySelector('.cmsc-pb-download-tile__icon')!;
    expect(icon.getAttribute('class')).toContain('lucide-arrow-right');
  });

  it('set: a glyph from the icon catalog, a cloud download among them; offered with the icon look only', async () => {
    const icon = dom('cms.DownloadTile', { ...TILE, iconButtonIcon: 'cloudDownload' }).querySelector('.cmsc-pb-download-tile__icon')!;
    expect(icon.getAttribute('class')).toContain('lucide-cloud-download');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    // An unknown name keeps today's glyph.
    expect(dom('cms.DownloadTile', { ...TILE, iconButtonIcon: 'nope' }).querySelector('.cmsc-pb-download-tile__icon')!.getAttribute('class')).toContain(
      'lucide-arrow-right',
    );
    expect(await fieldKeys('cms.DownloadTile', TILE)).toContain('iconButtonIcon');
    expect(await fieldKeys('cms.DownloadTile', { ...TILE, linkLook: 'text' })).not.toContain('iconButtonIcon');
  });
});
