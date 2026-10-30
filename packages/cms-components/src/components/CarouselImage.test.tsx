// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { CORNER_RADIUS_PX } from '@endora-commerce/page-builder-core';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` T053, US4, FR-020,
 * contracts/blocks.md `cms.CarouselImage` — a wide image or a gallery photo in
 * a carousel: an art-directed image, an optional caption placed anywhere
 * the image slider's title could be (or below the image) and styled with its
 * five title style fields plus a colour, an optional link, and a hover zoom.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.CarouselImage']?.defaultProps ?? {}) as Record<string, unknown>;
const ASSET = '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c';
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function dom(props: Record<string, unknown> = {}): HTMLElement {
  const content = [{ type: 'cms.CarouselImage', props: { ...defaults, id: 'image-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider
      embeds={{ blocks: {}, templates: {} }}
      assets={{ [ASSET]: { url: '/assets/file/photo.jpg' } }}
      mediaBaseUrl="https://api.example.com"
    >
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

const withImage = { image: { imageSource: 'library', assetId: ASSET, alt: 'A quiet lake' } };

describe('cms.CarouselImage (T053)', () => {
  it('is registered and its default renders a figure with a frame that reserves the image\'s space', () => {
    expect(config.components['cms.CarouselImage']).toBeDefined();
    const figure = dom().querySelector('figure.cmsc-pb-carousel-image');
    expect(figure).not.toBeNull();
    expect(figure!.querySelector('.cmsc-pb-carousel-image__placeholder, .cmsc-picture--ratio')).not.toBeNull();
  });

  it('renders the art-directed image, lazy, with its alternative text', () => {
    const img = dom(withImage).querySelector('picture img')!;
    expect(img.getAttribute('src')).toBe('https://api.example.com/assets/file/photo.jpg');
    expect(img.getAttribute('alt')).toBe('A quiet lake');
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('honours every caption placement ImageSlider offered, plus "below"; "none" renders no caption', () => {
    for (const placement of ['top-left', 'top-center', 'top-right', 'center', 'bottom-left', 'bottom-center', 'bottom-right']) {
      const caption = dom({ ...withImage, caption: doc('Lake'), captionPlacement: placement }).querySelector('figcaption');
      expect(caption?.textContent, placement).toBe('Lake');
      expect(caption!.className, placement).toContain(`cmsc-pb-carousel-image__caption--${placement}`);
    }
    const below = dom({ ...withImage, caption: doc('Lake'), captionPlacement: 'below' });
    const figure = below.querySelector('figure')!;
    expect(figure.className).toContain('cmsc-pb-carousel-image--caption-below');
    // Below the image, in the flow: the caption follows the media.
    expect(figure.lastElementChild?.tagName).toBe('FIGCAPTION');
    expect(dom({ ...withImage, caption: doc('Lake'), captionPlacement: 'none' }).querySelector('figcaption')).toBeNull();
    // A stored plain string reads as text.
    expect(dom({ ...withImage, caption: 'Plain', captionPlacement: 'bottom-left' }).querySelector('figcaption')?.textContent).toBe('Plain');
  });

  it('applies the caption style: background, colour, border colour and width, corner radius and padding', () => {
    const caption = dom({
      ...withImage,
      caption: doc('Lake'),
      captionPlacement: 'bottom-center',
      captionStyle: {
        background: '#112233',
        color: '#ffffff',
        borderColor: '#abcdef',
        borderWidth: 2,
        borderRadius: 'medium',
        paddingPx: 12,
      },
    }).querySelector<HTMLElement>('figcaption')!;
    expect(caption.style.background).toContain('rgb(17, 34, 51)');
    expect(caption.style.color).toBe('rgb(255, 255, 255)');
    expect(caption.style.borderStyle).toBe('solid');
    expect(caption.style.borderWidth).toBe('2px');
    expect(caption.style.borderColor).toBe('rgb(171, 205, 239)');
    expect(caption.style.borderRadius).toBe(`${CORNER_RADIUS_PX.medium}px`);
    expect(caption.style.padding).toBe('12px');
    // A brand colour token resolves to its variable with today's literal.
    const token = dom({ ...withImage, caption: doc('Lake'), captionStyle: { color: 'token:primary' } }).querySelector<HTMLElement>('figcaption')!;
    expect(token.getAttribute('style')).toContain('var(--cmsb-color-primary, #1261a6)');
  });

  it('links the whole image when a link is set, and not otherwise', () => {
    const linked = dom({ ...withImage, link: { kind: 'page', slug: 'about' } });
    const anchor = linked.querySelector('figure a');
    expect(anchor?.getAttribute('href')).toBe('/about');
    expect(anchor?.querySelector('img')).not.toBeNull();
    expect(dom(withImage).querySelector('a')).toBeNull();
  });

  it('hoverZoom sets a class', () => {
    expect(dom({ ...withImage, hoverZoom: true }).querySelector('figure')!.className).toContain('cmsc-pb-carousel-image--zoom');
    expect(dom({ ...withImage, hoverZoom: false }).querySelector('figure')!.className).not.toContain('--zoom');
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T129, T131 (R5) — a scrim behind
 * an overlay caption, and the item's filter tags.
 */
describe('cms.CarouselImage — caption scrim and tags (T129, T131)', () => {
  const fields = config.components['cms.CarouselImage']!.fields as Record<string, { type: string; objectFields?: Record<string, { type: string; options?: Array<{ value: unknown }>; min?: number; max?: number }> }>;

  it('offers a scrim (none, gradient, solid) with a strength, off by default', () => {
    const scrim = fields['captionScrim']!;
    expect(scrim.type).toBe('object');
    expect(scrim.objectFields?.['kind']?.options?.map((option) => option.value)).toEqual(['none', 'gradient', 'solid']);
    expect(scrim.objectFields?.['strength']).toMatchObject({ type: 'number', min: 0, max: 90 });
    expect(defaults['captionScrim']).toEqual({ kind: 'none', strength: 60 });
    expect(fields['tags']?.type).toBe('text');
  });

  it('no scrim by default: today\'s markup, the caption keeps its own box', () => {
    const host = dom({ ...withImage, caption: doc('Lake'), captionPlacement: 'bottom-left' });
    expect(host.querySelector('.cmsc-pb-carousel-image__scrim')).toBeNull();
    expect(host.querySelector('.cmsc-pb-carousel-image__caption')!.className).not.toContain('on-scrim');
  });

  it('a gradient runs from the caption\'s edge; a solid scrim tints the whole image; the strength is a custom property', () => {
    const bottom = dom({ ...withImage, caption: doc('Lake'), captionPlacement: 'bottom-left', captionScrim: { kind: 'gradient', strength: 70 } });
    const scrim = bottom.querySelector<HTMLElement>('.cmsc-pb-carousel-image__scrim')!;
    expect(scrim.getAttribute('aria-hidden')).toBe('true');
    expect(scrim.className).toContain('cmsc-pb-carousel-image__scrim--gradient-bottom');
    expect(scrim.getAttribute('style')).toContain('--pb-scrim:0.7');
    // A scrim replaces the caption's own box unless the editor gave it a background.
    expect(bottom.querySelector('.cmsc-pb-carousel-image__caption')!.className).toContain('cmsc-pb-carousel-image__caption--on-scrim');

    const top = dom({ ...withImage, caption: doc('Lake'), captionPlacement: 'top-right', captionScrim: { kind: 'gradient' } });
    expect(top.querySelector('.cmsc-pb-carousel-image__scrim')!.className).toContain('--gradient-top');
    expect(top.querySelector('.cmsc-pb-carousel-image__scrim')!.getAttribute('style')).toContain('--pb-scrim:0.6');

    const solid = dom({ ...withImage, caption: doc('Lake'), captionPlacement: 'center', captionScrim: { kind: 'solid', strength: 40 } });
    expect(solid.querySelector('.cmsc-pb-carousel-image__scrim')!.className).toContain('--solid');

    const styled = dom({ ...withImage, caption: doc('Lake'), captionScrim: { kind: 'gradient' }, captionStyle: { background: '#1d4ed8' } });
    expect(styled.querySelector('.cmsc-pb-carousel-image__caption')!.className).not.toContain('on-scrim');
  });

  it('no scrim without an overlay caption: below the image, hidden or empty', () => {
    for (const props of [
      { caption: doc('Lake'), captionPlacement: 'below' },
      { caption: doc('Lake'), captionPlacement: 'none' },
      { caption: undefined, captionPlacement: 'bottom-left' },
    ]) {
      expect(dom({ ...withImage, ...props, captionScrim: { kind: 'gradient' } }).querySelector('.cmsc-pb-carousel-image__scrim')).toBeNull();
    }
  });

  it('writes its tags for the Carousel\'s filter, and none when it has none', () => {
    expect(dom({ ...withImage, tags: 'Offices, retail' }).querySelector('figure')!.getAttribute('data-pb-tags')).toBe('offices,retail');
    expect(dom(withImage).querySelector('[data-pb-tags]')).toBeNull();
  });
});

/** `specs/163-page-builder-marketing-pages/` T144 (R7) — the caption's size and font role. */
describe('cms.CarouselImage — caption size and font (T144)', () => {
  const block = config.components['cms.CarouselImage'] as {
    fields: Record<string, { type: string; metadata?: unknown; options?: Array<{ value: unknown }> }>;
    responsiveFields?: string[];
    resolveFields?: (data: unknown, params: unknown) => Promise<Record<string, unknown>> | Record<string, unknown>;
  };
  const values = (key: string) => block.fields[key]?.options?.map((option) => option.value) ?? [];
  const captionOf = (props: Record<string, unknown>) =>
    dom({ ...withImage, caption: doc('Lake'), captionPlacement: 'bottom-left', ...props }).querySelector('figcaption')!;

  it('offers a size per breakpoint (Default first, the type tokens, Custom px) and a font role; none stored by default', async () => {
    expect(values('captionSize')).toEqual(['default', 'display', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'lead', 'body', 'small', 'custom']);
    expect(block.fields['captionSize']?.metadata).toEqual(expect.objectContaining({ pageBuilder: expect.objectContaining({ responsive: true }) }));
    expect(block.fields['captionSizePx']).toMatchObject({ type: 'number' });
    expect(values('captionFont')).toEqual(['default', 'heading', 'body']);
    expect(block.responsiveFields ?? []).toEqual(expect.arrayContaining(['captionSize', 'captionSizePx']));
    for (const key of ['captionSize', 'captionSizePx', 'captionFont']) expect(defaults).not.toHaveProperty(key);
    // The Custom px is offered once a breakpoint is on Custom.
    // R17 (T219): the caption's look is offered with a caption.
    const caption = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lake' }] }] };
    const plain = await block.resolveFields!({ props: { ...defaults, id: 'i', caption } }, { fields: block.fields });
    expect(Object.keys(plain)).not.toContain('captionSizePx');
    const custom = await block.resolveFields!({ props: { ...defaults, id: 'i', caption, captionSize: { base: 'small', desktop: 'custom' } } }, { fields: block.fields });
    expect(Object.keys(custom)).toContain('captionSizePx');
  });

  it('nothing chosen is today\'s caption: its text straight inside the figcaption', () => {
    const caption = captionOf({});
    expect(caption.querySelector('.cmsc-pb-carousel-image__caption-text')).toBeNull();
    expect(captionOf({ captionSize: 'default', captionFont: 'default' }).querySelector('.cmsc-pb-carousel-image__caption-text')).toBeNull();
  });

  it('a type token sizes the caption\'s text; a size per breakpoint or a Custom px is written as custom properties', () => {
    const token = captionOf({ captionSize: 'lead' }).querySelector('.cmsc-pb-carousel-image__caption-text')!;
    expect(token.className).toContain('cmsc-t--lead');
    expect(token.getAttribute('style')).toBeNull();
    expect(token.textContent).toBe('Lake');
    const tiers = captionOf({ captionSize: { base: 'small', desktop: 'custom' }, captionSizePx: { base: 14, desktop: 18 } }).querySelector(
      '.cmsc-pb-carousel-image__caption-text',
    )!;
    expect(tiers.className).toContain('cmsc-pb-text-size');
    expect(tiers.getAttribute('style')).toContain('--pb-text-size:var(--cmsb-t-small-size, 14px)');
    expect(tiers.getAttribute('style')).toContain('--pb-text-size-lg:18px');
    // Below the image, the same.
    const below = captionOf({ captionPlacement: 'below', captionSize: 'h5' }).querySelector('.cmsc-pb-carousel-image__caption-text')!;
    expect(below.className).toContain('cmsc-t--h5');
  });

  it('a font role reads the brand\'s heading or body font, with today\'s stack as the fallback', () => {
    const heading = captionOf({ captionFont: 'heading' }).querySelector<HTMLElement>('.cmsc-pb-carousel-image__caption-text')!;
    expect(heading.getAttribute('style')).toContain('font-family:var(--cmsb-font-heading, Inter, system-ui, -apple-system, sans-serif)');
    expect(heading.className).not.toContain('cmsc-t--');
    const body = captionOf({ captionFont: 'body', captionSize: 'body' }).querySelector<HTMLElement>('.cmsc-pb-carousel-image__caption-text')!;
    expect(body.getAttribute('style')).toContain('font-family:var(--cmsb-font-body, Inter, system-ui, -apple-system, sans-serif)');
    expect(body.className).toContain('cmsc-t--body');
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T188 (R14) — the caption's weight
 * per breakpoint (Responsive tab), through the item text `cms.LinkTile` shares:
 * a single weight is T151's inline one, weights that differ are
 * `--pb-item-weight(-md|-lg)` on the caption's span, today's weight (`initial`:
 * the caption box's own, its caption style included) where a tier has none.
 */
describe('cms.CarouselImage — caption weight per breakpoint (T188)', () => {
  const block = config.components['cms.CarouselImage'] as {
    fields: Record<string, { label?: string; metadata?: unknown; options?: Array<{ value: unknown }> }>;
    responsiveFields?: string[];
  };
  const captionOf = (props: Record<string, unknown>) =>
    dom({ ...withImage, caption: doc('Lake'), captionPlacement: 'bottom-left', ...props }).querySelector('figcaption')!;

  it('is a value per breakpoint on the Responsive tab with today\'s options; none stored by default', () => {
    expect(block.fields['captionWeight']?.metadata).toEqual(expect.objectContaining({ pageBuilder: expect.objectContaining({ responsive: true }) }));
    expect(block.responsiveFields ?? []).toContain('captionWeight');
    expect(block.fields['captionWeight']?.options?.map((option) => option.value)).toEqual(['default', 300, 400, 500, 600, 700, 800]);
    expect(block.fields['captionWeight']?.label).toBe('Caption weight');
    expect(defaults).not.toHaveProperty('captionWeight');
  });

  it('a single weight renders as T151\'s; weights that differ are written per tier on the caption\'s span', () => {
    const single = captionOf({ captionWeight: 400 }).outerHTML;
    expect(captionOf({ captionWeight: { base: 400, desktop: 400 } }).outerHTML).toBe(single);
    const text = captionOf({ captionWeight: { tablet: 700 } }).querySelector<HTMLElement>('.cmsc-pb-carousel-image__caption-text')!;
    expect(text.className).toBe('cmsc-pb-carousel-image__caption-text cmsc-pb-item-weight');
    expect(text.getAttribute('style')).toBe('--pb-item-weight:initial;--pb-item-weight-md:700;--pb-item-weight-lg:700');
  });
});
