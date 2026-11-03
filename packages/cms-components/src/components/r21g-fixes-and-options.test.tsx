// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';
import { listingLeadOptions } from './listing-lead.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R21G — a fix and block options
 * found while rebuilding the reference pages. Every option is optional: unset,
 * the block renders today's markup (each `describe` starts with that guard).
 *
 * - T330: a hero social-proof caption placed below the image goes to a line of
 *   its own whatever its maximum width (the measure capped the flex basis that
 *   was meant to break the line, so a narrow caption stayed beside the image);
 * - T331–T338: the options, block by block.
 *
 * R23 (T435–T447) simplified a part of them; the cases below say which (the
 * social-proof caption's line height, a per-breakpoint weight, a list size of
 * its own, the sign-up button's px options and the slide's px spaces).
 */

const config = defaultPageBuilderConfig as Config;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const listDoc = {
  type: 'doc',
  content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] }] }],
};

function render(type: string, props: Record<string, unknown>): string {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  const content = [{ type, props: { ...defaults, id: 'block-1', ...props } }] as Data['content'];
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
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

// ── T330, T331: the hero's social-proof caption ──────────────────────────────

describe('a social-proof caption below the image breaks the line whatever its measure (T330)', () => {
  const PROOF = { socialProof: { image: { imageSource: 'url', src: 'https://example.com/faces.png', alt: '' }, caption: 'Trusted by many teams' } };

  it('unset: today’s row, no placement attribute', () => {
    const proof = dom('cms.Hero', PROOF).querySelector('.cmsc-pb-hero__proof')!;
    expect(proof.hasAttribute('data-caption')).toBe(false);
  });

  it('the line break does not depend on the caption’s width: a full-width break before the caption', () => {
    const proof = dom('cms.Hero', { ...PROOF, proofCaptionPlacement: { base: 'below', tablet: 'beside' }, proofCaptionMaxWidthPx: 144 }).querySelector(
      '.cmsc-pb-hero__proof',
    )!;
    expect(proof.getAttribute('data-caption')).toBe('below');
    expect(proof.getAttribute('data-caption-md')).toBe('beside');
    const css = sheet();
    // A break element of the row's full width between the image (order 0) and the caption (order 2).
    expect(css).toContain(
      ".cmsc-pb-hero__proof:is([data-caption='below'], [data-caption-md='below'], [data-caption-lg='below'])::before { content: ''; display: none; flex-basis: 100%; order: 1; }",
    );
    expect(css).toContain(".cmsc-pb-hero__proof[data-caption='below']::before { display: block; }");
    expect(css).toContain(".cmsc-pb-hero__proof[data-caption='below'] > .cmsc-pb-hero__proof-caption { flex-basis: 100%; order: 2; }");
    // The two row gaps around the zero-height break count once: today's 12 px between image and caption.
    expect(css).toContain(".cmsc-pb-hero__proof[data-caption='below'] { row-gap: 0; }");
    expect(css).toContain(".cmsc-pb-hero__proof[data-caption='below'] > .cmsc-pb-hero__proof-image + .cmsc-pb-hero__proof-caption { margin-top: 12px; }");
    // Beside at a wider tier undoes all three.
    expect(css).toContain(".cmsc-pb-hero__proof[data-caption-md='beside']::before { display: none; }");
    expect(css).toContain(".cmsc-pb-hero__proof[data-caption-md='beside'] { row-gap: 12px; }");
    expect(css).toContain(
      ".cmsc-pb-hero__proof[data-caption-md='beside'] > .cmsc-pb-hero__proof-image + .cmsc-pb-hero__proof-caption { margin-top: 0; }",
    );
    expect(css).toContain(".cmsc-pb-hero__proof[data-caption-lg='below']::before { display: block; }");
    // The measure is still applied.
    const caption = proof.querySelector('.cmsc-pb-hero__proof-caption')!;
    expect(caption.className).toContain('cmsc-pb-hero__proof-caption--measure');
    expect(caption.getAttribute('style')).toContain('--pb-hero-proof-max:144px');
  });
});

describe('the social-proof caption’s line height (T331) — removed by R23 (T436)', () => {
  const PROOF = { socialProof: { caption: 'Trusted by many teams' } };

  it('unset: no style on the caption', () => {
    expect(dom('cms.Hero', PROOF).querySelector('.cmsc-pb-hero__proof-caption')!.hasAttribute('style')).toBe(false);
  });

  it('a stored line height is ignored data: the caption keeps today’s; no field offers it', async () => {
    expect(dom('cms.Hero', { ...PROOF, proofCaptionLineHeight: { base: 1.2, desktop: 1.4 } }).querySelector('.cmsc-pb-hero__proof-caption')!.hasAttribute('style')).toBe(
      false,
    );
    expect(await fieldKeys('cms.Hero', PROOF)).not.toContain('proofCaptionLineHeight');
    expect(responsiveFields('cms.Hero')).not.toContain('proofCaptionLineHeight');
  });
});

// ── T332, T333: media and text ───────────────────────────────────────────────

describe('cms.MediaText columns of 12 (T332)', () => {
  const BASE = { heading: 'Heading', body: doc('Text'), media: { kind: 'image', image: IMAGE } };

  it('unset: today’s root, no column variables', () => {
    const root = dom('cms.MediaText', BASE).querySelector('.cmsc-pb-media-text')!;
    expect(root.className).toBe('cmsc-pb-media-text');
    expect(root.hasAttribute('style')).toBe(false);
  });

  it('media 5, one column between, text 5: both sides written, the rest of the grid in the stylesheet', () => {
    const root = dom('cms.MediaText', { ...BASE, mediaSpan: 5, textOffset: 1, textSpan: 5 }).querySelector('.cmsc-pb-media-text')!;
    expect(root.className).toContain('cmsc-pb-media-text--columns');
    const style = root.getAttribute('style') ?? '';
    expect(style).toContain('--cmsc-mt-media-col:1 / span 5');
    expect(style).toContain('--cmsc-mt-text-col:7 / span 5');
    expect(style).toContain('--cmsc-mt-media-col-end:8 / span 5');
    expect(style).toContain('--cmsc-mt-text-col-end:2 / span 5');
    const css = sheet();
    // R22I (T370), deliberately changed: the column gap is the block's own, then the brand's grid gap, then the gutter.
    expect(css).toContain(
      '.cmsc-pb-media-text--columns .cmsc-pb-media-text__row { grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: var(--cmsc-grid-gap-md, var(--cmsb-gutter, 24px)); }',
    );
    expect(css).toContain(
      ".cmsc-pb-media-text--columns .cmsc-pb-media-text__row[data-media-side='end'] > .cmsc-pb-media-text__media { grid-column: var(--cmsc-mt-media-col-end); }",
    );
    // Stacked on a tablet when side by side from the desktop only.
    expect(css).toContain(
      ".cmsc-pb-media-text--columns .cmsc-pb-media-text__row[data-side-by-side='desktop'] > :is(.cmsc-pb-media-text__media, .cmsc-pb-media-text__text) { grid-column: auto; grid-row: auto; }",
    );
  });

  it('the layout fields sit with the side-by-side breakpoint, behind the Advanced switch (R23 T438)', async () => {
    expect(await fieldKeys('cms.MediaText', BASE)).not.toContain('mediaSpan');
    const keys = await fieldKeys('cms.MediaText', { ...BASE, layoutAdvanced: true });
    const at = (key: string) => keys.indexOf(key);
    expect(at('layoutAdvanced')).toBeGreaterThan(at('sideBySide'));
    expect(at('mediaSpan')).toBe(at('layoutAdvanced') + 1);
    expect(at('textSpan')).toBe(at('mediaSpan') + 1);
    expect(at('textOffset')).toBe(at('textSpan') + 1);
  });
});

describe('cms.MediaText list markers, text weight and heading line height (T333)', () => {
  const BASE = { heading: 'Heading', body: listDoc };

  it('unset: today’s body and heading', () => {
    const host = dom('cms.MediaText', BASE);
    expect(host.querySelector('.cmsc-pb-media-text__body')!.hasAttribute('style')).toBe(false);
    expect(host.querySelector('.cmsc-pb-media-text__heading')!.hasAttribute('style')).toBe(false);
  });

  it('the marker colour on the root, one weight on the text, the line height on a Custom px heading (R23 T435)', async () => {
    const host = dom('cms.MediaText', {
      ...BASE,
      listMarkerColor: '#ffffff',
      bodyWeight: { base: 300, desktop: 500 },
      headingSize: 'custom',
      headingSizePx: 30,
      headingLineHeight: 1.2,
    });
    expect(host.querySelector('.cmsc-pb-media-text')!.getAttribute('style')).toContain('--cmsc-list-marker:#ffffff');
    const body = host.querySelector('.cmsc-pb-media-text__body')!;
    expect(body.className).not.toContain('cmsc-pb-ts-weight');
    expect(body.getAttribute('style')).toContain('font-weight:500');
    expect(host.querySelector('.cmsc-pb-media-text__heading')!.getAttribute('style')).toContain('line-height:1.2');
    // A token heading brings its own line height: a stored one is not applied.
    expect(dom('cms.MediaText', { ...BASE, headingLineHeight: 1.2 }).querySelector('.cmsc-pb-media-text__heading')!.hasAttribute('style')).toBe(false);
    expect(await fieldKeys('cms.MediaText', BASE)).toEqual(expect.arrayContaining(['listMarkerColor', 'bodyWeight']));
    expect(await fieldKeys('cms.MediaText', BASE)).not.toContain('headingLineHeight');
    expect(await fieldKeys('cms.MediaText', { ...BASE, headingSize: 'custom' })).toContain('headingLineHeight');
    expect(responsiveFields('cms.MediaText')).toContain('headingLineHeight');
    expect(responsiveFields('cms.MediaText')).not.toContain('bodyWeight');
  });
});

// ── T334: the call-to-action card ────────────────────────────────────────────

describe('cms.CtaCard stacking, image inset per breakpoint and text sizes (T334)', () => {
  const WITH_IMAGE = { image: IMAGE, list: [{ icon: 'check', text: 'One' }] };

  it('unset: today’s card', () => {
    const card = dom('cms.CtaCard', WITH_IMAGE).querySelector('.cmsc-pb-cta-card')!;
    expect(card.hasAttribute('data-mobile-image')).toBe(false);
    expect(card.hasAttribute('data-side-by-side')).toBe(false);
    expect(card.hasAttribute('style')).toBe(false);
    expect(card.querySelector('.cmsc-pb-cta-card__list')!.hasAttribute('style')).toBe(false);
  });

  it('a Custom inset stored as one number writes today’s one variable', () => {
    const card = dom('cms.CtaCard', { ...WITH_IMAGE, imageInset: 'custom', imageInsetPx: 16 }).querySelector('.cmsc-pb-cta-card')!;
    expect(card.getAttribute('style')).toBe('--cmsc-cta-image-inset:16px');
  });

  it('the image below the text while stacked, stacked up to the desktop; R23 (T440): one inset, a stored per-breakpoint one read as its desktop value', () => {
    const card = dom('cms.CtaCard', {
      ...WITH_IMAGE,
      mobileImagePosition: 'below',
      sideBySide: 'desktop',
      imageInset: 'custom',
      imageInsetPx: { base: 8, desktop: 16 },
    }).querySelector('.cmsc-pb-cta-card')!;
    expect(card.getAttribute('data-mobile-image')).toBe('below');
    expect(card.getAttribute('data-side-by-side')).toBe('desktop');
    const style = card.getAttribute('style') ?? '';
    expect(style).toBe('--cmsc-cta-image-inset:16px');
    const css = sheet();
    expect(css).toContain(".cmsc-pb-cta-card[data-mobile-image='below'] > .cmsc-pb-cta-card__media { order: 0; }");
    expect(css).toContain(
      ".cmsc-pb-cta-card--image-inset[data-mobile-image='below'] > .cmsc-pb-cta-card__media { margin: 0 calc(var(--cmsc-cta-image-inset) - 24px) calc(var(--cmsc-cta-image-inset) - 32px); }",
    );
    expect(css).toContain(".cmsc-pb-cta-card[data-image-side][data-side-by-side='desktop'] { grid-template-columns: minmax(0, 1fr); }");
    expect(css).toContain('margin: calc(var(--cmsc-cta-image-inset-lg, var(--cmsc-cta-image-inset-md, var(--cmsc-cta-image-inset))) - 48px);');
  });

  it('the text’s size per breakpoint; R23 (T440): the list follows it (its own size was removed)', () => {
    const card = dom('cms.CtaCard', {
      ...WITH_IMAGE,
      body: doc('Text'),
      bodySize: 'custom',
      bodySizePx: { base: 18, desktop: 16 },
      listSize: 'custom',
      listSizePx: 30,
    });
    const body = card.querySelector('.cmsc-pb-cta-card__body')!;
    expect(body.getAttribute('style')).toContain('--pb-ts-size:18px');
    const list = card.querySelector('.cmsc-pb-cta-card__list')!;
    expect(list.className).toContain('cmsc-pb-ts-size');
    expect(list.getAttribute('style')).toContain('--pb-ts-size:18px');
    expect(list.getAttribute('style')).toContain('--pb-ts-size-lg:16px');
    expect(list.getAttribute('style')).not.toContain('30px');
  });

  it('fields: the image’s stacking with an image, the Custom px on Custom, all per breakpoint where they vary', async () => {
    const keys = await fieldKeys('cms.CtaCard', { ...WITH_IMAGE, bodySize: 'custom' });
    expect(keys).toEqual(expect.arrayContaining(['mobileImagePosition', 'sideBySide', 'bodySize', 'bodySizePx']));
    expect(keys).not.toContain('listSize');
    expect(keys).not.toContain('listSizePx');
    const noImage = await fieldKeys('cms.CtaCard', {});
    expect(noImage).not.toContain('mobileImagePosition');
    expect(noImage).not.toContain('sideBySide');
    expect(responsiveFields('cms.CtaCard')).toEqual(expect.arrayContaining(['bodySize', 'bodySizePx']));
    expect(responsiveFields('cms.CtaCard')).not.toContain('imageInsetPx');
  });
});

// ── T335: stats ──────────────────────────────────────────────────────────────

describe('cms.Stats side by side from the desktop (T335)', () => {
  it('unset: no attribute; set: stacked on a tablet', async () => {
    expect(dom('cms.Stats', { image: IMAGE }).querySelector('.cmsc-pb-stats-block')!.hasAttribute('data-side-by-side')).toBe(false);
    const block = dom('cms.Stats', { image: IMAGE, sideBySide: 'desktop', imageSpan: 6 }).querySelector('.cmsc-pb-stats-block')!;
    expect(block.getAttribute('data-side-by-side')).toBe('desktop');
    const css = sheet();
    expect(css).toContain(
      "@media (min-width: 768px) and (max-width: 1023.98px) { .cmsc-pb-stats-block[data-side-by-side='desktop'] { grid-template-columns: minmax(0, 1fr); gap: 32px; }",
    );
    expect(await fieldKeys('cms.Stats', { image: IMAGE })).toContain('sideBySide');
    expect(await fieldKeys('cms.Stats', {})).not.toContain('sideBySide');
  });
});

// ── T336: the carousel split slide ───────────────────────────────────────────

describe('cms.CarouselSplit body indent and stacked spacing (T336)', () => {
  const ICON_TITLE = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'inlineIcon', attrs: { name: 'check' } }, { type: 'text', text: ' Precise work' }] }],
  };
  const BASE = { title: ICON_TITLE, body: doc('Text'), titleHangingIcon: true };

  it('unset: today’s slide', () => {
    const root = dom('cms.CarouselSplit', BASE).querySelector('.cmsc-pb-carousel-split')!;
    expect(root.className).toBe('cmsc-pb-carousel-split');
    expect(root.hasAttribute('style')).toBe(false);
  });

  it('the text indented to the hanging title’s text; R23 (T439): the gap is the indent’s own (a stored px gap ignored)', () => {
    const root = dom('cms.CarouselSplit', { ...BASE, bodyIndent: 'title', titleHangingIconGapPx: 13 }).querySelector('.cmsc-pb-carousel-split')!;
    expect(root.className).toContain('cmsc-pb-carousel-split--body-indent');
    expect(root.querySelector('.cmsc-pb-carousel-split__text')!.hasAttribute('style')).toBe(false);
    const css = sheet();
    expect(css).toContain(
      '.cmsc-pb-carousel-split--body-indent > .cmsc-pb-carousel-split__text { display: grid; grid-template-columns: auto minmax(0, 1fr); align-content: start; column-gap: var(--cmsc-hang-gap, 0.35em); }',
    );
    expect(css).toContain('.cmsc-pb-carousel-split--body-indent .cmsc-pb-carousel-split__title { display: grid; grid-template-columns: subgrid; align-items: baseline; }');
    expect(css).toContain('.cmsc-pb-carousel-split--body-indent .cmsc-pb-carousel-split__title .cmsc-hang { display: contents; }');
    expect(css).toContain('.cmsc-pb-carousel-split--body-indent > .cmsc-pb-carousel-split__text > .cmsc-pb-carousel-split__body { grid-column: 2; }');
  });

  it('no indent without a hanging title led by an icon', () => {
    expect(dom('cms.CarouselSplit', { ...BASE, titleHangingIcon: false, bodyIndent: 'title' }).querySelector('.cmsc-pb-carousel-split')!.className).not.toContain(
      'body-indent',
    );
    expect(dom('cms.CarouselSplit', { ...BASE, title: doc('Plain'), bodyIndent: 'title' }).querySelector('.cmsc-pb-carousel-split')!.className).not.toContain(
      'body-indent',
    );
  });

  it('R23 (T437): one spacing step for the stacked gap, one below the title and above the controls', async () => {
    const root = dom('cms.CarouselSplit', { ...BASE, stackedGap: 'xl', innerSpace: 's' }).querySelector('.cmsc-pb-carousel-split')!;
    expect(root.className).toContain('cmsc-pb-carousel-split--stacked-gap');
    expect(root.className).toContain('cmsc-pb-carousel-split--title-space');
    expect(root.className).toContain('cmsc-pb-carousel-split--controls-space');
    const style = root.getAttribute('style') ?? '';
    expect(style).toContain('--cmsc-split-stacked-gap:var(--cmsb-space-xl, 56px)');
    expect(style).toContain('--cmsc-split-title-space-md:var(--cmsb-space-s, 16px)');
    expect(style).toContain('--cmsc-split-controls-space-lg:var(--cmsb-space-s, 24px)');
    // The px values R21G stored are ignored data.
    expect(dom('cms.CarouselSplit', { ...BASE, stackedGapPx: 58, titleSpacePx: 24 }).querySelector('.cmsc-pb-carousel-split')!.className).toBe(
      'cmsc-pb-carousel-split',
    );
    const css = sheet();
    expect(css).toContain('.cmsc-pb-carousel-split.cmsc-pb-carousel-split--stacked-gap { row-gap: var(--cmsc-split-stacked-gap, 24px); }');
    expect(css).toContain('.cmsc-pb-carousel-split--title-space .cmsc-pb-carousel-split__title { margin-bottom: var(--cmsc-split-title-space, 12px); }');
    expect(css).toContain(
      '.cmsc-pb-carousel-split--controls-space .cmsc-pb-carousel__controls--slide { margin-top: var(--cmsc-split-controls-space, 24px); }',
    );
    const keys = await fieldKeys('cms.CarouselSplit', BASE);
    expect(keys).toEqual(expect.arrayContaining(['bodyIndent', 'stackedGap', 'innerSpace']));
    expect(keys).not.toContain('stackedGapPx');
    expect(await fieldKeys('cms.CarouselSplit', { ...BASE, titleHangingIcon: false })).not.toContain('bodyIndent');
  });
});

// ── T337: image art direction tier, heading measure ─────────────────────────

describe('cms.Image keeps its mobile art up to a chosen tier (T337)', () => {
  const ART = { imageSource: 'url', src: 'https://example.com/wide.jpg', mobileSrc: 'https://example.com/tall.jpg' };

  it('unset: the mobile source below 768 px, as before', () => {
    expect(render('cms.Image', ART)).toContain('<source media="(max-width: 767.98px)"');
  });

  it('`desktop`: below 1024 px; the field offered with a mobile image only', async () => {
    expect(render('cms.Image', { ...ART, desktopFrom: 'desktop' })).toContain('<source media="(max-width: 1023.98px)"');
    expect(await fieldKeys('cms.Image', ART)).toContain('desktopFrom');
    expect(await fieldKeys('cms.Image', { imageSource: 'url', src: 'https://example.com/wide.jpg' })).not.toContain('desktopFrom');
  });
});

describe('cms.Heading max width (T337)', () => {
  const TEXT = { level: 'h3', text: doc('Panel title') };

  it('unset: no measure', () => {
    expect(dom('cms.Heading', TEXT).querySelector('h3')!.className).not.toContain('cmsc-text-max');
  });

  it('a Custom px per breakpoint, as the other texts’ measures', async () => {
    const heading = dom('cms.Heading', { ...TEXT, textMaxWidth: 'custom', textMaxWidthPx: { base: 280, desktop: 400 } }).querySelector('h3')!;
    expect(heading.className).toContain('cmsc-text-max');
    expect(heading.getAttribute('style')).toContain('--cmsc-text-max:280px');
    expect(heading.getAttribute('style')).toContain('--cmsc-text-max-lg:400px');
    expect(await fieldKeys('cms.Heading', { ...TEXT, textMaxWidth: 'custom' })).toEqual(expect.arrayContaining(['textMaxWidth', 'textMaxWidthPx']));
    expect(await fieldKeys('cms.Heading', TEXT)).not.toContain('textMaxWidthPx');
    expect(responsiveFields('cms.Heading')).toEqual(expect.arrayContaining(['textMaxWidth', 'textMaxWidthPx']));
  });
});

// ── T338: small options ──────────────────────────────────────────────────────

describe('cms.RichContent list line height (T338)', () => {
  it('unset: no class; set with a Custom px text size (R23 T435): the lists’ line height per breakpoint', async () => {
    const plain = dom('cms.RichContent', { content: listDoc }).querySelector('.cmsc-pb-rich-content')!;
    expect(plain.className).not.toContain('list-leading');
    expect(
      dom('cms.RichContent', { content: listDoc, listLineHeight: 1.2 }).querySelector('.cmsc-pb-rich-content')!.className,
    ).not.toContain('list-leading');
    const set = dom('cms.RichContent', { content: listDoc, textSize: 'custom', textSizePx: 17, listLineHeight: { base: 1.2, desktop: 1.4 } }).querySelector(
      '.cmsc-pb-rich-content',
    )!;
    expect(set.className).toContain('cmsc-pb-rich-content--list-leading');
    expect(set.getAttribute('style')).toContain('--cmsc-rc-list-lh:1.2');
    expect(set.getAttribute('style')).toContain('--cmsc-rc-list-lh-lg:1.4');
    expect(sheet()).toContain('.cmsc-pb-rich-content--list-leading ul, .cmsc-pb-rich-content--list-leading ol { line-height: var(--cmsc-rc-list-lh, inherit); }');
    expect(await fieldKeys('cms.RichContent', {})).not.toContain('listLineHeight');
    expect(await fieldKeys('cms.RichContent', { textSize: 'custom' })).toContain('listLineHeight');
    expect(responsiveFields('cms.RichContent')).toContain('listLineHeight');
  });
});

describe('cms.Accordion title line height (T338)', () => {
  const ITEMS = { items: [{ title: 'Question', body: doc('Answer') }] };

  it('unset: no line height on the titles', () => {
    const title = dom('cms.Accordion', ITEMS).querySelector('.cmsc-pb-accordion__title')!;
    expect(title.getAttribute('style') ?? '').not.toContain('line-height');
  });

  it('with a Custom px title size (R23 T435): one value inline on each title; values per breakpoint on the root', async () => {
    const CUSTOM = { ...ITEMS, titleSize: 'custom', titleSizePx: 18 };
    expect(dom('cms.Accordion', { ...CUSTOM, titleLineHeight: 1.3 }).querySelector('.cmsc-pb-accordion__title')!.getAttribute('style')).toContain(
      'line-height:1.3',
    );
    const root = dom('cms.Accordion', { ...CUSTOM, titleLineHeight: { base: 1.3, desktop: 1.2 } }).querySelector('.cmsc-pb-accordion')!;
    expect(root.className).toContain('cmsc-pb-accordion--title-leading');
    expect(root.getAttribute('style')).toContain('--cmsc-acc-title-lh:1.3');
    expect(root.getAttribute('style')).toContain('--cmsc-acc-title-lh-lg:1.2');
    // Without a Custom size the stored line height is not applied, and not offered.
    expect(dom('cms.Accordion', { ...ITEMS, titleLineHeight: 1.3 }).querySelector('.cmsc-pb-accordion__title')!.getAttribute('style') ?? '').not.toContain(
      'line-height',
    );
    expect(await fieldKeys('cms.Accordion', ITEMS)).not.toContain('titleLineHeight');
    expect(await fieldKeys('cms.Accordion', CUSTOM)).toContain('titleLineHeight');
    expect(responsiveFields('cms.Accordion')).toContain('titleLineHeight');
  });
});

describe('newsletter.Signup button height, text size and weight (T338) — removed by R23 (T443)', () => {
  it('unset: today’s button and root', () => {
    const host = dom('newsletter.Signup', {});
    expect(host.querySelector('.cmsc-pb-signup')!.className).not.toContain('button-height');
    expect(host.querySelector('.cmsc-pb-signup__button')!.hasAttribute('style')).toBe(false);
  });

  it('stored values are ignored data: today’s button and root, no fields', async () => {
    const stale = dom('newsletter.Signup', { buttonHeightPx: { base: 46 }, buttonTextSizePx: 14, buttonWeight: 500 });
    expect(stale.innerHTML).toBe(dom('newsletter.Signup', {}).innerHTML);
    expect(sheet()).not.toContain('cmsc-pb-signup--button-height');
    const keys = await fieldKeys('newsletter.Signup', {});
    for (const key of ['buttonHeightPx', 'buttonTextSizePx', 'buttonWeight']) expect(keys).not.toContain(key);
    expect(responsiveFields('newsletter.Signup')).toEqual([]);
  });
});

describe('catalog product listings: the header lead’s size, weight and colour (T338)', () => {
  const HEADER = { header: { heading: 'Products', lead: 'Our range' } };

  for (const type of ['catalog.ProductSlider', 'catalog.ProductGrid']) {
    it(`${type}: the lead’s look`, async () => {
      const block = config.components[type] as ComponentConfig;
      const fields = await fieldKeys(type, HEADER);
      expect(fields).toEqual(expect.arrayContaining(['leadSize', 'leadWeight', 'leadColor']));
      expect(fields).not.toContain('leadSizePx');
      expect(await fieldKeys(type, { ...HEADER, leadSize: 'custom' })).toContain('leadSizePx');
      expect(responsiveFields(type)).toEqual(expect.arrayContaining(['leadSize', 'leadSizePx']));
      // R23 (T435): one weight.
      expect(responsiveFields(type)).not.toContain('leadWeight');
      expect(block.fields).toHaveProperty('leadColor');
    });
  }

  it('unset: no lead wrapper (today’s header); set: the lead’s text in a styled span (R23: one weight)', () => {
    expect(listingLeadOptions({}, null)).toBeUndefined();
    const options = listingLeadOptions({ leadSize: 'custom', leadSizePx: 16, leadWeight: { base: 400, desktop: 500 }, leadColor: '#000000' }, null)!;
    const html = renderToString(<>{options.lead!('Our range')}</>);
    expect(html).toContain('class="cmsc-pb-carousel__lead-text"');
    expect(html).toContain('font-size:16px');
    expect(html).toContain('font-weight:500');
    expect(html).toContain('color:#000000');
  });
});

describe('cms.DownloadTile title weight (T338)', () => {
  const LINK = { linkTo: 'link', link: { kind: 'url', href: 'https://example.com/terms' }, title: 'Terms' };

  it('unset: today’s title; set: its weight', async () => {
    expect(dom('cms.DownloadTile', LINK).querySelector('.cmsc-pb-download-tile__title')!.hasAttribute('style')).toBe(false);
    expect(dom('cms.DownloadTile', { ...LINK, titleWeight: 600 }).querySelector('.cmsc-pb-download-tile__title')!.getAttribute('style')).toBe(
      'font-weight:600',
    );
    expect(await fieldKeys('cms.DownloadTile', {})).toContain('titleWeight');
  });
});
