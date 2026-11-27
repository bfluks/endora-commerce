// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';
import { CAROUSEL_CONTROLS_ALIGN_OPTIONS, carouselShellOptions } from './carousel/carousel-parts.js';
import { CarouselShell } from './carousel/CarouselShell.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R20F (T310–T321) — layout and
 * spacing options found while rebuilding reference pages: the split slide's
 * columns, breakpoint, corners and text; the carousel controls' alignment;
 * media-and-text spacing and per-row alignment; the background panel on
 * phones; feature-list gaps; the call-to-action card's padding and image
 * width; a stats label's line height; a link list's last rule.
 *
 * Every option is optional: unset, the block's markup is today's (each block's
 * "unset" case below), set, it renders what the option says.
 *
 * R23 (T435–T449) simplified a part of them: weights are one value, a line
 * height applies with a Custom px size only, the inner px spaces are one
 * spacing step, the 12-column numbers sit behind an Advanced switch, and the
 * feature-list tracking, the panel's box spacing, the hanging-icon px gap and
 * the accordion's chevron circle were removed. The cases below say which.
 */

const config = defaultPageBuilderConfig as Config;
const STYLESHEET = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8');
const SHEET = STYLESHEET.replace(/\s+/g, ' ');

function defaultsOf(type: string): Record<string, unknown> {
  return ((config.components[type] as ComponentConfig | undefined)?.defaultProps ?? {}) as Record<string, unknown>;
}

function html(type: string, props: Record<string, unknown> = {}): string {
  const content = [{ type, props: { ...defaultsOf(type), id: `${type}-1`, ...props } }] as Data['content'];
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} assets={{}} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
}

function dom(type: string, props: Record<string, unknown> = {}): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html(type, props);
  return host;
}

const styleOf = (element: Element | null | undefined): string => element?.getAttribute('style') ?? '';
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const IMAGE = { imageSource: 'url', src: 'https://cdn.example.com/a.jpg', alt: 'A' };

async function shownFields(type: string, props: Record<string, unknown>): Promise<Record<string, unknown>> {
  const block = config.components[type] as ComponentConfig;
  return (await block.resolveFields!(
    { props: { id: 'x', ...defaultsOf(type), ...props } } as never,
    {
      changed: {},
      fields: block.fields ?? {},
      lastFields: block.fields ?? {},
      lastData: null,
      metadata: {},
      appState: {} as never,
      parent: { type: 'root', props: { id: 'root' } } as never,
    },
  )) as Record<string, unknown>;
}

const responsiveOf = (field: unknown): boolean =>
  (field as { metadata?: { pageBuilder?: { responsive?: boolean } } } | undefined)?.metadata?.pageBuilder?.responsive === true;

const responsiveFieldsOf = (type: string): string[] =>
  ((config.components[type] as { responsiveFields?: string[] } | undefined)?.responsiveFields ?? []) as string[];

// ── CarouselSplit (T310–T312) ────────────────────────────────────────

describe('cms.CarouselSplit: columns, breakpoint and corners (T310)', () => {
  it('unset: today\'s two halves from the tablet, 8 px corners, no attribute and no style', () => {
    const root = dom('cms.CarouselSplit').querySelector('.cmsc-pb-carousel-split')!;
    expect(root.getAttribute('class')).toBe('cmsc-pb-carousel-split');
    expect(root.hasAttribute('style')).toBe(false);
    expect(root.hasAttribute('data-side-by-side')).toBe(false);
    expect(root.querySelector('.cmsc-pb-carousel-split__media')?.hasAttribute('style')).toBe(false);
  });

  it('side by side from the desktop: the slide says so and the stylesheet stacks it on a tablet', () => {
    const root = dom('cms.CarouselSplit', { sideBySide: 'desktop' }).querySelector('.cmsc-pb-carousel-split')!;
    expect(root.getAttribute('data-side-by-side')).toBe('desktop');
    expect(SHEET).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1023\.98px\) \{ \.cmsc-pb-carousel-split\[data-side-by-side='desktop'\] \{ grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(dom('cms.CarouselSplit', { sideBySide: 'tablet' }).querySelector('.cmsc-pb-carousel-split')?.hasAttribute('data-side-by-side')).toBe(false);
  });

  it('the media and the text take columns of a 12-column grid with columns between them, mirrored on the end side', () => {
    const start = dom('cms.CarouselSplit', { mediaSpan: 5, textSpan: 5, textOffset: 2 }).querySelector('.cmsc-pb-carousel-split')!;
    expect(start.classList.contains('cmsc-pb-carousel-split--columns')).toBe(true);
    expect(styleOf(start)).toContain('--cmsc-split-media-col:1 / span 5');
    expect(styleOf(start)).toContain('--cmsc-split-text-col:8 / span 5');
    const end = dom('cms.CarouselSplit', { mediaSide: 'end', mediaSpan: 5, textSpan: 5, textOffset: 2 }).querySelector('.cmsc-pb-carousel-split')!;
    expect(styleOf(end)).toContain('--cmsc-split-media-col:8 / span 5');
    expect(styleOf(end)).toContain('--cmsc-split-text-col:1 / span 5');
    // Only the media width: the text takes the rest.
    const media = dom('cms.CarouselSplit', { mediaSpan: 7 }).querySelector('.cmsc-pb-carousel-split')!;
    expect(styleOf(media)).toContain('--cmsc-split-text-col:8 / span 5');
    expect(SHEET).toContain('.cmsc-pb-carousel-split--columns { grid-template-columns: repeat(12, minmax(0, 1fr));');
  });

  it('the media corners: a radius token, square included', () => {
    expect(styleOf(dom('cms.CarouselSplit', { mediaCornerRadius: 'none' }).querySelector('.cmsc-pb-carousel-split__media'))).toContain('border-radius:0px');
    expect(styleOf(dom('cms.CarouselSplit', { mediaCornerRadius: 'large' }).querySelector('.cmsc-pb-carousel-split__media'))).toContain('border-radius:16px');
  });
});

describe('cms.CarouselSplit: the title and the text (T311, T312)', () => {
  const withIcon = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'inlineIcon', attrs: { name: 'check' } }, { type: 'text', text: ' A title that wraps' }] }],
  };

  it('unset: the title keeps the h4 token and the text today\'s class, neither with a style', () => {
    const host = dom('cms.CarouselSplit');
    const title = host.querySelector('.cmsc-pb-carousel-split__title')!;
    expect(title.getAttribute('class')).toBe('cmsc-pb-carousel-split__title cmsc-pb-block-heading cmsc-t--h4');
    expect(title.hasAttribute('style')).toBe(false);
    expect(host.querySelector('.cmsc-pb-carousel-split__body')?.hasAttribute('style')).toBe(false);
  });

  it('the title takes a size per breakpoint, a weight and a line height', () => {
    const title = dom('cms.CarouselSplit', {
      titleSize: 'custom',
      titleSizePx: { base: 24, desktop: 32 },
      titleWeight: 500,
      titleLineHeight: 1.2,
    }).querySelector('.cmsc-pb-carousel-split__title')!;
    expect(title.classList.contains('cmsc-pb-ts-size')).toBe(true);
    expect(styleOf(title)).toContain('--pb-ts-size:24px');
    expect(styleOf(title)).toContain('--pb-ts-size-lg:32px');
    expect(styleOf(title)).toContain('font-weight:500');
    expect(styleOf(title)).toContain('line-height:1.2');
  });

  it('the text takes a size, a weight and a line height — R23 (T435): one weight, a stored per-breakpoint one read as its desktop value', () => {
    const body = dom('cms.CarouselSplit', {
      bodySize: 'custom',
      bodySizePx: 16,
      bodyWeight: { base: 400, desktop: 500 },
      bodyLineHeight: 1.6,
    }).querySelector('.cmsc-pb-carousel-split__body')!;
    expect(styleOf(body)).toContain('font-size:16px');
    expect(styleOf(body)).toContain('line-height:1.6');
    expect(body.classList.contains('cmsc-pb-ts-weight')).toBe(false);
    expect(styleOf(body)).toContain('font-weight:500');
  });

  it('a title led by an inline icon hangs beside it; R23 (T439): the space after the icon is the indent\'s own', () => {
    const plain = dom('cms.CarouselSplit', { title: withIcon }).querySelector('.cmsc-pb-carousel-split__title')!;
    expect(plain.querySelector('.cmsc-hang')).toBeNull();
    const hung = dom('cms.CarouselSplit', { title: withIcon, titleHangingIcon: true, titleHangingIconGapPx: { base: 12, desktop: 14 } }).querySelector(
      '.cmsc-pb-carousel-split__title',
    )!;
    expect(hung.querySelector(':scope > .cmsc-hang > .cmsc-hang__icon')).not.toBeNull();
    expect(hung.querySelector('.cmsc-hang__text')?.textContent).toBe('A title that wraps');
    // A stored px gap (R20F) is ignored data.
    expect(styleOf(hung)).not.toContain('--cmsc-hang-gap');
  });

  it('the fields: a Custom px and a line height only on Custom, one weight, the raw columns behind Advanced', async () => {
    const shown = await shownFields('cms.CarouselSplit', {});
    expect(shown).not.toHaveProperty('titleSizePx');
    expect(shown).not.toHaveProperty('bodySizePx');
    expect(shown).not.toHaveProperty('titleLineHeight');
    expect(shown).not.toHaveProperty('bodyLineHeight');
    expect(shown).not.toHaveProperty('titleHangingIconGapPx');
    expect(shown).toHaveProperty('layout');
    expect(shown).toHaveProperty('layoutAdvanced');
    expect(shown).not.toHaveProperty('mediaSpan');
    expect(shown).toHaveProperty('mediaCornerRadius');
    expect(await shownFields('cms.CarouselSplit', { layoutAdvanced: true })).toHaveProperty('mediaSpan');
    const custom = await shownFields('cms.CarouselSplit', { titleSize: 'custom', bodySize: 'custom', titleHangingIcon: true });
    expect(custom).toHaveProperty('titleSizePx');
    expect(custom).toHaveProperty('bodySizePx');
    expect(custom).not.toHaveProperty('titleHangingIconGapPx');
    for (const key of ['titleSize', 'titleSizePx', 'titleLineHeight', 'bodySize', 'bodySizePx', 'bodyLineHeight']) {
      expect(responsiveOf(custom[key]), key).toBe(true);
      expect(responsiveFieldsOf('cms.CarouselSplit'), key).toContain(key);
    }
    for (const key of ['titleWeight', 'bodyWeight']) {
      expect(responsiveOf(custom[key]), key).toBe(false);
      expect(responsiveFieldsOf('cms.CarouselSplit'), key).not.toContain(key);
    }
  });
});

// ── Carousel controls (T313, T314) ───────────────────────────────────

function sliderDom(props: Record<string, unknown>): HTMLElement {
  return dom('cms.ContentSlider', { slidesPerView: 1, ...props });
}

const splitSlide = (id: string) => ({
  type: 'cms.CarouselSplit',
  props: { id, title: doc('Title'), body: doc('Text'), media: { kind: 'image', image: IMAGE }, buttons: [] },
});

describe('carousel controls: dots at the start, arrows at the end; the row inside a slide aligned too (T313)', () => {
  it('every carousel offers "Dots at the start, arrows at the end"', () => {
    expect(CAROUSEL_CONTROLS_ALIGN_OPTIONS.map((option) => option.value)).toContain('dots-start');
    for (const type of ['cms.ContentSlider', 'catalog.ProductSlider', 'blog.LatestPosts']) {
      const field = ((config.components[type] as ComponentConfig).fields as Fields)['controlsAlign'] as { options: Array<{ value: string }> };
      expect(field.options.map((option) => option.value), type).toContain('dots-start');
    }
  });

  it('a root class per breakpoint, as the other alignments; the stylesheet moves the dots first and the arrows to the end', () => {
    const root = sliderDom({ controlsPlacement: 'below', controls: { arrows: true, dots: true }, controlsAlign: { base: 'start', tablet: 'dots-start' } }).querySelector(
      '.cmsc-pb-carousel',
    )!;
    expect(root.className).toContain('cmsc-pb-carousel--ctl-start');
    expect(root.className).toContain('cmsc-pb-carousel--ctl-md-dots-start');
    expect(SHEET).toContain('.cmsc-pb-carousel--ctl-dots-start > .cmsc-pb-carousel__controls--below > .cmsc-pb-carousel__dots { order: -1; margin-inline-end: auto; }');
    expect(SHEET).toContain('.cmsc-pb-carousel--ctl-md-dots-start > .cmsc-pb-carousel__controls--below > .cmsc-pb-carousel__dots { order: -1; margin-inline-end: auto; }');
    expect(SHEET).toContain('.cmsc-pb-carousel--ctl-lg-dots-start > .cmsc-pb-carousel__controls--below > .cmsc-pb-carousel__dots { order: -1; margin-inline-end: auto; }');
  });

  it('unset: the row inside a split slide keeps today\'s markup (no alignment class)', () => {
    const row = sliderDom({ controlsPlacement: 'slide', controls: { arrows: true, dots: true }, slides: [splitSlide('a'), splitSlide('b')] }).querySelector(
      '.cmsc-pb-carousel__controls--slide',
    )!;
    expect(row.className).not.toMatch(/--al-/);
  });

  it('set: the row inside a split slide carries the alignment, every breakpoint written', () => {
    const row = sliderDom({
      controlsPlacement: 'slide',
      controls: { arrows: true, dots: true },
      controlsAlign: { base: 'dots-start', desktop: 'end' },
      slides: [splitSlide('a'), splitSlide('b')],
    }).querySelector('.cmsc-pb-carousel__controls--slide')!;
    const classes = row.className.split(' ');
    expect(classes).toEqual(
      expect.arrayContaining(['cmsc-pb-carousel__controls--al-dots-start', 'cmsc-pb-carousel__controls--al-md-dots-start', 'cmsc-pb-carousel__controls--al-lg-end']),
    );
    expect(SHEET).toContain('.cmsc-pb-carousel__controls--al-end { justify-content: flex-end; }');
    expect(SHEET).toContain('.cmsc-pb-carousel__controls--al-center { justify-content: center; }');
    expect(SHEET).toContain('.cmsc-pb-carousel__controls--al-dots-start > .cmsc-pb-carousel__dots { order: -1; margin-inline-end: auto; }');
  });
});

describe('carousel: arrows kept (disabled) when every slide fits (T314)', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  function fitting(keepArrowsWhenFit: boolean): { host: HTMLElement; unmount: () => void } {
    // jsdom lays nothing out: scrollWidth and clientWidth are 0, so every slide fits.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <CarouselShell showArrows showDots controlsPlacement="below" keepArrowsWhenFit={keepArrowsWhenFit}>
          {[1, 2].map((n) => (
            <p key={n}>Slide {n}</p>
          ))}
        </CarouselShell>,
      ),
    );
    return { host, unmount: () => act(() => root.unmount()) };
  }

  it('off (today): the controls hide once everything fits', () => {
    const { host, unmount } = fitting(false);
    expect(host.querySelector<HTMLElement>('.cmsc-pb-carousel__controls--below')?.hidden).toBe(true);
    unmount();
  });

  it('on: the row stays, both arrows disabled, the dots hidden', () => {
    const { host, unmount } = fitting(true);
    const row = host.querySelector<HTMLElement>('.cmsc-pb-carousel__controls--below')!;
    expect(row.hidden).toBe(false);
    const arrows = Array.from(row.querySelectorAll<HTMLButtonElement>('.cmsc-pb-carousel__arrow'));
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) expect(arrow.disabled).toBe(true);
    expect(row.querySelector<HTMLElement>('.cmsc-pb-carousel__dots')?.hidden).toBe(true);
    expect(SHEET).toContain('.cmsc-pb-carousel__dots[hidden] { visibility: hidden; }');
    unmount();
  });

  it('the shell options carry the choice only when on', () => {
    expect(carouselShellOptions({ controls: { arrows: true } })).not.toHaveProperty('keepArrowsWhenFit');
    expect(carouselShellOptions({ controls: { arrows: true, arrowsWhenFit: true } }).keepArrowsWhenFit).toBe(true);
  });

  it('the switch shows with the arrows only, on every carousel', async () => {
    for (const type of ['cms.ContentSlider', 'catalog.ProductSlider', 'blog.LatestPosts']) {
      const on = (await shownFields(type, { controls: { arrows: true } }))['controls'] as { objectFields: Record<string, unknown> };
      expect(Object.keys(on.objectFields), type).toContain('arrowsWhenFit');
      const off = (await shownFields(type, { controls: { arrows: false, dots: true } }))['controls'] as { objectFields: Record<string, unknown> };
      expect(Object.keys(off.objectFields), type).not.toContain('arrowsWhenFit');
    }
  });

  it('a disabled look is offered for kept arrows on a looping carousel too', async () => {
    const shown = (await shownFields('cms.ContentSlider', { loop: true, controls: { arrows: true, arrowsWhenFit: true } }))['controls'] as {
      objectFields: Record<string, unknown>;
    };
    expect(Object.keys(shown.objectFields)).toContain('disabledArrowLook');
    const options = carouselShellOptions({ loop: true, controls: { arrows: true, arrowsWhenFit: true, disabledArrowLook: 'color', disabledArrowColor: '#000000' } });
    expect(options.disabledArrowLook).toBe('color');
    expect(options.disabledArrowColor).toBe('#000000');
  });
});

// ── MediaText (T315) ─────────────────────────────────────────────────

describe('cms.MediaText: spacing, per-row alignment and text size (T315)', () => {
  it('unset: today\'s markup — no style on the block or the text, every row on the block\'s alignment', () => {
    const host = dom('cms.MediaText', { rows: [{ heading: doc('Two'), body: doc('Text') }] });
    const root = host.querySelector('.cmsc-pb-media-text')!;
    expect(root.getAttribute('class')).toBe('cmsc-pb-media-text');
    expect(root.hasAttribute('style')).toBe(false);
    expect(host.querySelector('.cmsc-pb-media-text__body')?.hasAttribute('style')).toBe(false);
    const rows = Array.from(host.querySelectorAll('.cmsc-pb-media-text__row'));
    expect(rows.map((row) => row.getAttribute('data-valign'))).toEqual(['center', 'center']);
  });

  it('R23 (T437): one spacing step below the heading and between paragraphs, one between stacked media and text', () => {
    const root = dom('cms.MediaText', { innerSpace: 'm', stackedGap: 'l' }).querySelector('.cmsc-pb-media-text')!;
    expect(root.className).toBe('cmsc-pb-media-text cmsc-pb-media-text--heading-space cmsc-pb-media-text--body-space cmsc-pb-media-text--stacked-gap');
    const style = styleOf(root);
    expect(style).toContain('--cmsc-mt-heading-space:var(--cmsb-space-m, 24px)');
    expect(style).toContain('--cmsc-mt-heading-space-md:var(--cmsb-space-m, 24px)');
    expect(style).toContain('--cmsc-mt-heading-space-lg:var(--cmsb-space-m, 40px)');
    expect(style).toContain('--cmsc-mt-body-space:var(--cmsb-space-m, 24px)');
    expect(style).toContain('--cmsc-mt-stacked-gap-lg:var(--cmsb-space-l, 64px)');
    // The px values R20F stored are ignored data.
    expect(dom('cms.MediaText', { headingSpacePx: 16, bodySpacePx: 24, stackedGapPx: 32 }).querySelector('.cmsc-pb-media-text')?.hasAttribute('style')).toBe(false);
    expect(SHEET).toContain('.cmsc-pb-media-text--heading-space .cmsc-pb-media-text__heading { margin-bottom: var(--cmsc-mt-heading-space, 16px); }');
    expect(SHEET).toContain('.cmsc-pb-media-text--body-space .cmsc-pb-media-text__body > * + * { margin-top: var(--cmsc-mt-body-space, 0px); }');
    expect(SHEET).toContain('.cmsc-pb-media-text--stacked-gap .cmsc-pb-media-text__row { row-gap: var(--cmsc-mt-stacked-gap, 24px); }');
  });

  it('a row takes its own vertical alignment; a row without one follows the block\'s', () => {
    const rows = Array.from(
      dom('cms.MediaText', {
        verticalAlign: 'start',
        rows: [{ heading: doc('Two'), verticalAlign: 'center' }, { heading: doc('Three') }],
      }).querySelectorAll('.cmsc-pb-media-text__row'),
    );
    expect(rows.map((row) => row.getAttribute('data-valign'))).toEqual(['start', 'center', 'start']);
  });

  it('the text takes a size per breakpoint and a line height', () => {
    const body = dom('cms.MediaText', { bodySize: { base: 'custom', desktop: 'custom' }, bodySizePx: { base: 20, desktop: 24 }, bodyLineHeight: 1.5 }).querySelector(
      '.cmsc-pb-media-text__body',
    )!;
    expect(body.classList.contains('cmsc-pb-ts-size')).toBe(true);
    expect(styleOf(body)).toContain('--pb-ts-size:20px');
    expect(styleOf(body)).toContain('--pb-ts-size-lg:24px');
    expect(styleOf(body)).toContain('line-height:1.5');
  });

  it('the fields: the text size per breakpoint, a Custom px and a line height only on Custom, the spacing steps, a row\'s own alignment', async () => {
    const shown = await shownFields('cms.MediaText', {});
    expect(shown).not.toHaveProperty('bodySizePx');
    expect(shown).not.toHaveProperty('bodyLineHeight');
    expect(responsiveOf(shown['bodySize'])).toBe(true);
    for (const key of ['innerSpace', 'stackedGap']) {
      expect(shown, key).toHaveProperty(key);
      expect(responsiveOf(shown[key]), key).toBe(false);
    }
    const custom = await shownFields('cms.MediaText', { bodySize: 'custom' });
    expect(custom).toHaveProperty('bodySizePx');
    expect(responsiveOf(custom['bodyLineHeight'])).toBe(true);
    expect(responsiveFieldsOf('cms.MediaText')).toContain('bodyLineHeight');
    const rows = shown['rows'] as { arrayFields: Record<string, unknown> };
    expect(Object.keys(rows.arrayFields)).toContain('verticalAlign');
  });
});

// ── BackgroundPanel (T316) ───────────────────────────────────────────

describe('cms.BackgroundPanel: text over the image on phones (T316)', () => {
  it('unset: today\'s stacked panel, no class, no attribute', () => {
    const panel = dom('cms.BackgroundPanel').querySelector('.cmsc-pb-panel')!;
    expect(panel.getAttribute('class')).toBe('cmsc-pb-panel');
    expect(panel.hasAttribute('data-mobile-layout')).toBe(false);
  });

  it('text over the image on phones: the panel says so, the stylesheet lays both in one cell below 768 px', () => {
    const panel = dom('cms.BackgroundPanel', { mobileLayout: 'overlay' }).querySelector('.cmsc-pb-panel')!;
    expect(panel.getAttribute('data-mobile-layout')).toBe('overlay');
    expect(dom('cms.BackgroundPanel', { mobileLayout: 'stack' }).querySelector('.cmsc-pb-panel')?.hasAttribute('data-mobile-layout')).toBe(false);
    expect(SHEET).toMatch(/@media \(max-width: 767\.98px\) \{ \.cmsc-pb-panel\[data-mobile-layout='overlay'\] \{ display: grid;/);
    expect(SHEET).toContain(".cmsc-pb-panel[data-mobile-layout='overlay'] > .cmsc-pb-panel__media { grid-area: 1 / 1; aspect-ratio: auto; }");
  });

  it('R23 (T449): the text box keeps its own spacing — a stored px margin or padding (R20F) is ignored', () => {
    const panel = dom('cms.BackgroundPanel', { textBoxMarginPx: { base: 0, tablet: 0 }, textBoxPaddingPx: { base: 24, desktop: 0 } }).querySelector('.cmsc-pb-panel')!;
    expect(panel.className).toBe('cmsc-pb-panel');
    expect(styleOf(panel)).not.toContain('--cmsc-panel-box');
    expect(SHEET).not.toContain('cmsc-pb-panel--box-');
  });

  it('the fields: the layout on phones, and no box spacing', async () => {
    const shown = await shownFields('cms.BackgroundPanel', {});
    expect(shown).toHaveProperty('mobileLayout');
    expect(shown).not.toHaveProperty('textBoxMarginPx');
    expect(shown).not.toHaveProperty('textBoxPaddingPx');
  });
});

// ── FeatureList (T317) ───────────────────────────────────────────────

describe('cms.FeatureList: a row gap, list line height and the inner spacing (T317, R23)', () => {
  it('unset: today\'s list, no row gap and no tracking', () => {
    const host = dom('cms.FeatureList');
    const list = host.querySelector('ul.cmsc-pb-feature-list')!;
    expect(list.getAttribute('class')).toBe('cmsc-pb-feature-list');
    expect(styleOf(list)).not.toContain('row-gap');
    expect(host.querySelector('.cmsc-pb-feature-list__title')?.hasAttribute('style')).toBe(false);
  });

  it('a row gap per breakpoint apart from the column gap', () => {
    const list = dom('cms.FeatureList', { gap: 'custom', gapPx: 16, rowGapPx: { base: 32, desktop: 48 } }).querySelector('ul.cmsc-pb-feature-list')!;
    expect(list.classList.contains('cmsc-pb-feature-list--row-gap')).toBe(true);
    expect(styleOf(list)).toContain('--cmsc-fl-row-gap:32px');
    expect(styleOf(list)).toContain('--cmsc-fl-row-gap-lg:48px');
    expect(SHEET).toContain('.cmsc-pb-feature-list--row-gap { row-gap: var(--cmsc-fl-row-gap, var(--cmsc-fl-gap, 24px)); }');
  });

  it('R23 (T435): the titles\' letter spacing (R20F) is the token\'s — a stored one is ignored', () => {
    const title = dom('cms.FeatureList', { titleLetterSpacing: -0.02 }).querySelector('.cmsc-pb-feature-list__title')!;
    expect(styleOf(title)).not.toContain('letter-spacing');
  });

  it('the line height of lists (with a Custom px text size) and one spacing step between paragraphs', () => {
    const list = dom('cms.FeatureList', { bodySize: 'custom', bodySizePx: 15, listLineHeight: 1.2, innerSpace: 's' }).querySelector('ul.cmsc-pb-feature-list')!;
    expect(list.className).toContain('cmsc-pb-feature-list--list-leading');
    expect(list.className).toContain('cmsc-pb-feature-list--body-space');
    expect(styleOf(list)).toContain('--cmsc-fl-list-lh:1.2');
    expect(styleOf(list)).toContain('--cmsc-fl-body-space:var(--cmsb-space-s, 16px)');
    // A token size brings its own line height: the lists' is not applied.
    expect(dom('cms.FeatureList', { bodySize: 'body', listLineHeight: 1.2 }).querySelector('ul.cmsc-pb-feature-list')?.className).not.toContain('list-leading');
    expect(SHEET).toContain('.cmsc-pb-feature-list--list-leading .cmsc-pb-feature-list__body :is(ul, ol) { line-height: var(--cmsc-fl-list-lh, inherit); }');
    expect(SHEET).toContain('.cmsc-pb-feature-list--body-space .cmsc-pb-feature-list__body > * + * { margin-top: var(--cmsc-fl-body-space, 0.5em); }');
  });

  it('the fields are offered, per breakpoint where they vary', async () => {
    const shown = await shownFields('cms.FeatureList', {});
    expect(responsiveOf(shown['rowGapPx'])).toBe(true);
    expect(responsiveFieldsOf('cms.FeatureList')).toContain('rowGapPx');
    expect(shown).toHaveProperty('innerSpace');
    expect(shown).not.toHaveProperty('listLineHeight');
    expect(shown).not.toHaveProperty('titleLetterSpacing');
    expect(shown).not.toHaveProperty('bodySpacePx');
    const custom = await shownFields('cms.FeatureList', { bodySize: 'custom' });
    expect(responsiveOf(custom['listLineHeight'])).toBe(true);
    expect(responsiveFieldsOf('cms.FeatureList')).toContain('listLineHeight');
  });
});

// ── CtaCard (T318) ───────────────────────────────────────────────────

describe('cms.CtaCard: the card\'s padding and the image\'s width (T318)', () => {
  it('unset: today\'s card', () => {
    const card = dom('cms.CtaCard', { image: IMAGE }).querySelector('.cmsc-pb-cta-card')!;
    expect(card.getAttribute('class')).toBe('cmsc-pb-cta-card');
    expect(card.hasAttribute('style')).toBe(false);
  });

  it('R23 (T437): the padding is one spacing step; the image inset reads it instead of today\'s', () => {
    const card = dom('cms.CtaCard', { image: IMAGE, cardPadding: 'xl' }).querySelector('.cmsc-pb-cta-card')!;
    expect(card.classList.contains('cmsc-pb-cta-card--padding')).toBe(true);
    expect(styleOf(card)).toContain('--cmsc-cta-pad:var(--cmsb-space-xl, 56px)');
    expect(styleOf(card)).toContain('--cmsc-cta-pad-lg:var(--cmsb-space-xl, 96px)');
    // The px values R20F stored are ignored data.
    expect(dom('cms.CtaCard', { image: IMAGE, paddingPx: 24 }).querySelector('.cmsc-pb-cta-card')?.hasAttribute('style')).toBe(false);
    expect(SHEET).toContain('.cmsc-pb-cta-card--padding { padding: var(--cmsc-cta-pad, 32px 24px); }');
    // R21G (T334), deliberately changed (standing rule 13): the inset is read per breakpoint, each tier falling back to the one below.
    expect(SHEET).toContain(
      '.cmsc-pb-cta-card--padding.cmsc-pb-cta-card--image-inset > .cmsc-pb-cta-card__media { margin: calc(var(--cmsc-cta-image-inset-lg, var(--cmsc-cta-image-inset-md, var(--cmsc-cta-image-inset))) - var(--cmsc-cta-pad-lg, 48px)); }',
    );
  });

  it('the image\'s width in columns of 12 from the tablet up, mirrored for an image at the start', () => {
    const end = dom('cms.CtaCard', { image: IMAGE, imageColumns: { base: 6, desktop: 5 } }).querySelector('.cmsc-pb-cta-card')!;
    expect(end.classList.contains('cmsc-pb-cta-card--image-cols')).toBe(true);
    expect(styleOf(end)).toContain('--cmsc-cta-cols-md:minmax(0, 6fr) minmax(0, 6fr)');
    expect(styleOf(end)).toContain('--cmsc-cta-cols-lg:minmax(0, 7fr) minmax(0, 5fr)');
    const start = dom('cms.CtaCard', { image: IMAGE, imageSide: 'start', imageColumns: 5 }).querySelector('.cmsc-pb-cta-card')!;
    expect(styleOf(start)).toContain('--cmsc-cta-cols-lg:minmax(0, 5fr) minmax(0, 7fr)');
    // Without an image the option writes nothing.
    expect(dom('cms.CtaCard', { imageColumns: 5 }).querySelector('.cmsc-pb-cta-card')?.hasAttribute('style')).toBe(false);
  });

  it('the fields: the padding step always; with an image a layout preset, the raw columns per breakpoint behind Advanced', async () => {
    expect(await shownFields('cms.CtaCard', {})).not.toHaveProperty('imageColumns');
    expect(await shownFields('cms.CtaCard', {})).not.toHaveProperty('layout');
    const shown = await shownFields('cms.CtaCard', { image: IMAGE });
    expect(shown).toHaveProperty('cardPadding');
    expect(shown).toHaveProperty('layout');
    expect(shown).not.toHaveProperty('imageColumns');
    const advanced = await shownFields('cms.CtaCard', { image: IMAGE, layoutAdvanced: true });
    expect(responsiveOf(advanced['imageColumns'])).toBe(true);
    expect(responsiveFieldsOf('cms.CtaCard')).toContain('imageColumns');
  });
});

// ── Stats, LinkList, Accordion (T319–T321) ───────────────────────────

describe('cms.Stats: the label\'s line height (T319)', () => {
  it('unset writes nothing; set with a Custom px label size (R23 T435), the label carries it', () => {
    expect(dom('cms.Stats').querySelector('.cmsc-pb-stats__label')?.hasAttribute('style')).toBe(false);
    expect(styleOf(dom('cms.Stats', { labelSize: 'custom', labelSizePx: 15, labelLineHeight: 1.6 }).querySelector('.cmsc-pb-stats__label'))).toContain(
      'line-height:1.6',
    );
    expect(dom('cms.Stats', { labelLineHeight: 1.6 }).querySelector('.cmsc-pb-stats__label')?.hasAttribute('style')).toBe(false);
    expect(responsiveFieldsOf('cms.Stats')).toContain('labelLineHeight');
  });
});

describe('cms.LinkList: a rule after the last row (T320)', () => {
  it('unset: today\'s rules between rows only', () => {
    expect(dom('cms.LinkList').querySelector('.cmsc-pb-link-list')?.getAttribute('class')).toBe('cmsc-pb-link-list cmsc-pb-link-list--divided');
  });

  it('on: the list says so, the stylesheet draws the rule under the last row', () => {
    expect(dom('cms.LinkList', { dividerAfterLast: true }).querySelector('.cmsc-pb-link-list')?.className).toContain('cmsc-pb-link-list--divided-end');
    expect(dom('cms.LinkList', { divider: false, dividerAfterLast: true }).querySelector('.cmsc-pb-link-list')?.className).not.toContain('--divided-end');
    expect(SHEET).toContain('.cmsc-pb-link-list--divided-end .cmsc-pb-link-list__item:last-child { border-bottom: 1px solid var(--cmsb-border, var(--cmsb-n-200, #e2e8f0)); }');
  });

  it('the switch shows only with the rules between rows on', async () => {
    expect(await shownFields('cms.LinkList', { divider: true })).toHaveProperty('dividerAfterLast');
    expect(await shownFields('cms.LinkList', { divider: false })).not.toHaveProperty('dividerAfterLast');
  });
});

describe('cms.Accordion: R20F T321\'s chevron in a filled circle was removed (R23 T441)', () => {
  const items = [{ title: 'One', content: 'Text' }];

  it('a stored circle reads as the plain chevron, its colour ignored', () => {
    const chevron = dom('cms.Accordion', { items, icon: 'chevron' });
    const circle = dom('cms.Accordion', { items, icon: 'chevron-circle', iconCircleColor: '#000000' });
    expect(circle.innerHTML).toBe(chevron.innerHTML);
    expect(SHEET).not.toContain('chevron-circle');
  });

  it('the icon offers plus and chevron only; no circle colour field', async () => {
    const icon = (await shownFields('cms.Accordion', {}))['icon'] as { options: Array<{ value: string }> };
    expect(icon.options.map((option) => option.value)).toEqual(['plus', 'chevron']);
    expect(await shownFields('cms.Accordion', { icon: 'chevron' })).not.toHaveProperty('iconCircleColor');
  });
});
