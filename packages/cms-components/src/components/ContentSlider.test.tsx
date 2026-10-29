// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { Render, type Config, type Data } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
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
 * `specs/163-page-builder-marketing-pages/` T054, US4, FR-019–FR-022,
 * contracts/blocks.md `cms.ContentSlider` ("Carousel") — rendered through
 * Puck's `<Render>`, the storefront's path: the slot's children become slide
 * groups, every item's content is in the server HTML, the header renders, and
 * a slider stored before the reshape renders with today's controls.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.ContentSlider']?.defaultProps ?? {}) as Record<string, unknown>;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function dom(props: Record<string, unknown> = {}): HTMLElement {
  const content = [{ type: 'cms.ContentSlider', props: { ...defaults, id: 'carousel-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

const slides = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>('[aria-roledescription="slide"]'));

describe('cms.ContentSlider, the Carousel (T054)', () => {
  it('is labelled "Carousel" and its default is three image slides at 1.15 / 2 / 3 per view, arrows below, no autoplay', () => {
    expect(config.components['cms.ContentSlider']?.label).toBe('Carousel');
    expect(defaults['slidesPerView']).toEqual({ base: 1.15, tablet: 2, desktop: 3 });
    // T129 (deliberately changed, standing rule 13): the placement moved out of
    // `controls` to `controlsPlacement`, a value per breakpoint; the value is today's.
    expect(defaults['controls']).toEqual({ arrows: true, dots: false });
    expect(defaults['controlsPlacement']).toBe('below');
    expect(defaults['autoplay']).toBe(false);
    expect(defaults['effect']).toBe('slide');
    expect(defaults['bleed']).toBe('none');
    const host = dom();
    expect(slides(host)).toHaveLength(3);
    expect(host.querySelectorAll('figure.cmsc-pb-carousel-image')).toHaveLength(3);
    const style = host.querySelector('[role="region"]')!.getAttribute('style') ?? '';
    expect(style).toContain('--pb-spv:1.15');
    expect(style).toContain('--pb-spv-lg:3');
    // The `s` spacing token, with today's 16 px on mobile as its fallback.
    expect(style).toContain('--pb-gap:var(--cmsb-space-s, 16px)');
    expect(host.querySelector('.cmsc-pb-carousel__controls--below button[aria-label="Next slide"]')).not.toBeNull();
  });

  it('wraps every kind of slot child as a slide "n of m", each item\'s content in the server HTML', () => {
    const host = dom({
      slides: [
        { type: 'cms.CarouselImage', props: { id: 'a', image: { imageSource: 'url', src: 'https://example.com/a.jpg', alt: 'A' }, caption: doc('First') } },
        { type: 'cms.LinkTile', props: { id: 'b', title: doc('Second'), linkLabel: 'More', link: { kind: 'page', slug: 'about' } } },
        { type: 'cms.CarouselSplit', props: { id: 'c', title: doc('Third'), media: { kind: 'image' } } },
        { type: 'acme.Unknown', props: { id: 'd' } },
      ],
    });
    expect(slides(host).map((slide) => slide.getAttribute('aria-label'))).toEqual(['1 of 3', '2 of 3', '3 of 3']);
    for (const text of ['First', 'Second', 'More', 'Third']) expect(host.textContent).toContain(text);
  });

  it('renders the header: a heading at its level and size, a lead and a button, and names the region after a plain heading', () => {
    const host = dom({
      header: { heading: doc('Downloads'), lead: 'Product sheets and manuals.', button: { label: 'All files', link: { kind: 'page', slug: 'files' }, style: 'primary', fill: 'outline', size: 'medium' } },
      headingLevel: 'h2',
      headingSize: 'h3',
      controls: { arrows: true, dots: false, placement: 'header' },
    });
    const header = host.querySelector('.cmsc-pb-carousel__header')!;
    expect(header.querySelector('h2.cmsc-t--h3')?.textContent).toBe('Downloads');
    expect(header.querySelector('.cmsc-pb-carousel__lead')?.textContent).toBe('Product sheets and manuals.');
    expect(header.querySelector('a.cmsc-btn')?.getAttribute('href')).toBe('/files');
    expect(header.querySelector('button[aria-label="Next slide"]')).not.toBeNull();
    expect(dom({ header: { heading: 'Plain' } }).querySelector('[role="region"]')!.getAttribute('aria-label')).toBe('Plain');
  });

  it('a slider stored before the reshape renders as today: one per view, its px gap, arrows over the slides, dots below', () => {
    const host = dom({
      header: undefined,
      controls: undefined,
      effect: undefined,
      bleed: undefined,
      slides: [
        { type: 'cms.Slide', props: { id: 's1', content: [] } },
        { type: 'cms.Slide', props: { id: 's2', content: [] } },
      ],
      slidesPerView: 1,
      gap: 16,
      showArrows: true,
      showDots: true,
    });
    const region = host.querySelector('[role="region"]')!;
    expect(region.className).toContain('cmsc-pb-carousel--controls-overlay');
    expect(region.getAttribute('style')).toContain('--pb-spv:1;--pb-spv-md:1;--pb-spv-lg:1;--pb-gap:16px;--pb-gap-md:16px;--pb-gap-lg:16px');
    expect(host.querySelector('.cmsc-pb-carousel__viewport .cmsc-pb-carousel__controls--overlay button[aria-label="Previous slide"]')).not.toBeNull();
    expect(host.querySelector('.cmsc-pb-carousel__controls--dots .cmsc-pb-carousel__dots')).not.toBeNull();
    expect(slides(host)).toHaveLength(2);
  });

  it('fade forces one per view; bleed sets its class', () => {
    const fade = dom({ effect: 'fade' }).querySelector('[role="region"]')!;
    expect(fade.className).toContain('cmsc-pb-carousel--fade');
    expect(fade.getAttribute('style')).toContain('--pb-spv:1;--pb-spv-md:1;--pb-spv-lg:1');
    expect(dom({ bleed: 'end' }).querySelector('[role="region"]')!.className).toContain('cmsc-pb-carousel--bleed-end');
  });

  it('carries no section settings: a stray `section` prop renders no section (T111)', () => {
    const host = dom({ section: { anchor: 'downloads', scheme: 'muted' } });
    expect(host.querySelector('section.cmsc-section')).toBeNull();
    expect(host.querySelector('#downloads')).toBeNull();
    expect(host.querySelector('[role="region"]')).not.toBeNull();
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T129–T131 (R5) — the Carousel's
 * controls per breakpoint and arrow look, its grid layout, and the optional
 * category filter, through Puck's `<Render>` (the storefront's path).
 */
describe('cms.ContentSlider — controls, grid and filter (T129–T131)', () => {
  const block = config.components['cms.ContentSlider']!;
  const fields = block.fields as Record<string, { type: string; metadata?: unknown; options?: Array<{ value: unknown }>; objectFields?: Record<string, { type: string; options?: Array<{ value: unknown }> }>; arrayFields?: Record<string, unknown> }>;
  const values = (field: { options?: Array<{ value: unknown }> } | undefined) => (field?.options ?? []).map((option) => option.value);

  async function resolvedFieldKeys(props: Record<string, unknown>): Promise<string[]> {
    const resolved = await block.resolveFields!({ props: { ...defaults, id: 'c', ...props } } as never, { fields: block.fields } as never);
    return Object.keys(resolved);
  }

  it('the arrow placement is a value per breakpoint on the Responsive tab, with every placement of T054', () => {
    expect(fields['controlsPlacement']?.type).toBe('select');
    expect(fields['controlsPlacement']?.metadata).toEqual(expect.objectContaining({ pageBuilder: expect.objectContaining({ responsive: true }) }));
    expect(values(fields['controlsPlacement']).sort()).toEqual(['below', 'header', 'overlay']);
    expect(Object.keys(fields['controls']?.objectFields ?? {})).not.toContain('placement');
    const registered = (config.components['cms.ContentSlider'] as { responsiveFields?: string[] }).responsiveFields;
    expect(registered ?? []).toEqual(expect.arrayContaining(['controlsPlacement', 'columns']));
  });

  it('offers the arrows\' variant, shape, size and colour in the controls', () => {
    const controls = fields['controls']!.objectFields!;
    expect(values(controls['arrowVariant'])).toEqual(['default', 'outline', 'solid']);
    expect(values(controls['arrowShape'])).toEqual(['round', 'square']);
    expect(values(controls['arrowSize'])).toEqual(['s', 'm', 'l']);
    expect(controls['arrowColor']?.type).toBe('custom');
  });

  it('renders a placement per breakpoint and the arrow look from the props', () => {
    const host = dom({
      header: { heading: doc('Projects') },
      controlsPlacement: { base: 'below', desktop: 'header' },
      controls: { arrows: true, dots: false, arrowVariant: 'outline', arrowShape: 'round', arrowSize: 'l', arrowColor: 'token:primary' },
    });
    const region = host.querySelector('[role="region"]')!;
    expect(region.className).toContain('cmsc-pb-carousel--arrows-outline');
    expect(region.className).toContain('cmsc-pb-carousel--arrows-l');
    expect(region.getAttribute('style')).toContain('--pb-arrow-color:var(--cmsb-color-primary');
    expect(host.querySelector('.cmsc-pb-carousel__controls--header')!.className).toContain('--off-sm');
    expect(host.querySelector('.cmsc-pb-carousel__controls--below')!.className).toContain('--off-lg');
  });

  it('a carousel stored with its placement inside `controls` keeps it, and is carried to `controlsPlacement`', async () => {
    const host = dom({ controlsPlacement: undefined, controls: { arrows: true, dots: false, placement: 'header' }, header: { heading: doc('Stored') } });
    expect(host.querySelector('.cmsc-pb-carousel__header button[aria-label="Next slide"]')).not.toBeNull();
    const { contentSliderFromLegacy } = await import('./ContentSlider.js');
    expect(contentSliderFromLegacy({ slides: [], controls: { arrows: true, placement: 'header' } })).toMatchObject({ controlsPlacement: 'header' });
    expect(contentSliderFromLegacy({ slides: [], showArrows: true })).toMatchObject({ controlsPlacement: 'overlay' });
    // A stored placement is the block's own: the editor canvas merges the defaults in before `resolveData` moves it.
    expect(contentSliderFromLegacy({ slides: [], controls: { arrows: true, placement: 'header' }, controlsPlacement: 'below' })).toMatchObject({
      controlsPlacement: 'header',
    });
    // The editor's `resolveData` moves it out of `controls`, so a later edit on the Responsive tab is not overridden.
    const resolved = await block.resolveData!({ props: { id: 'c', slides: [], controls: { arrows: true, dots: false, placement: 'header' } } } as never, {} as never);
    expect((resolved as { props: Record<string, unknown> }).props).toMatchObject({ controls: { arrows: true, dots: false }, controlsPlacement: 'header' });
    expect(((resolved as { props: { controls: object } }).props.controls)).not.toHaveProperty('placement');
  });

  it('lays the items out as a grid of columns per breakpoint, every item kind in the server HTML', async () => {
    expect(values(fields['layout'])).toEqual(['carousel', 'grid']);
    expect(defaults['layout']).toBe('carousel');
    expect(fields['columns']).toMatchObject({ type: 'number', min: 1, max: 6 });
    expect(fields['columns']?.metadata).toEqual(expect.objectContaining({ pageBuilder: expect.objectContaining({ responsive: true }) }));
    const host = dom({
      layout: 'grid',
      columns: { base: 1, tablet: 2, desktop: 4 },
      slides: [
        { type: 'cms.CarouselImage', props: { id: 'a', image: { imageSource: 'url', src: 'https://example.com/a.jpg', alt: 'A' }, caption: doc('First') } },
        { type: 'cms.LinkTile', props: { id: 'b', title: doc('Second'), linkLabel: 'More', link: { kind: 'page', slug: 'about' } } },
        { type: 'cms.CarouselSplit', props: { id: 'c', title: doc('Third'), media: { kind: 'image' } } },
        { type: 'cms.DownloadTile', props: { id: 'd', title: 'Fourth' } },
        { type: 'cms.Slide', props: { id: 'e', content: [] } },
      ],
    });
    const grid = host.querySelector('.cmsc-pb-carousel--grid')!;
    expect(grid.getAttribute('style')).toContain('--pb-cols:1;--pb-cols-md:2;--pb-cols-lg:4');
    expect(host.querySelectorAll('[role="list"] > [role="listitem"]')).toHaveLength(5);
    expect(host.querySelector('[role="region"]')).toBeNull();
    for (const text of ['First', 'Second', 'Third']) expect(host.textContent).toContain(text);

    const carouselKeys = await resolvedFieldKeys({ layout: 'carousel' });
    expect(carouselKeys).not.toContain('columns');
    const gridKeys = await resolvedFieldKeys({ layout: 'grid' });
    expect(gridKeys).toContain('columns');
    for (const key of ['slidesPerView', 'effect', 'controls', 'controlsPlacement', 'bleed', 'autoplay', 'intervalMs']) expect(gridKeys).not.toContain(key);
    for (const key of ['gap', 'filter', 'equalHeight', 'slides', 'header']) expect(gridKeys).toContain(key);
  });

  it('shows the filter bar from its tags, every item in the server HTML and none hidden', () => {
    const filter = fields['filter']!;
    expect(filter.type).toBe('object');
    // T143 (deliberately changed, standing rule 13): the filter gains the bar's style and
    // alignment after its three fields of T131, which keep their place; T161 (also deliberately
    // changed) the bar's overflow after them.
    expect(Object.keys(filter.objectFields ?? {})).toEqual(['show', 'allLabel', 'tags', 'style', 'align', 'overflow']);
    // The "All" label is empty by default: the page language's word is shown (render context).
    expect(defaults['filter']).toEqual({ show: false, allLabel: '', tags: [] });
    const props = {
      filter: { show: true, allLabel: 'All projects', tags: [{ tag: 'Offices', label: 'Offices' }, { tag: 'retail', label: '' }] },
      slides: [
        { type: 'cms.CarouselImage', props: { id: 'a', tags: 'offices', caption: doc('Office one') } },
        { type: 'cms.LinkTile', props: { id: 'b', tags: 'Retail, offices', title: doc('Shop') } },
        { type: 'cms.CarouselSplit', props: { id: 'c', tags: 'retail', title: doc('Split') } },
        { type: 'cms.DownloadTile', props: { id: 'd', tags: 'retail', title: 'Sheet' } },
        { type: 'cms.Slide', props: { id: 'e', tags: 'offices', content: [] } },
      ],
    };
    const host = dom(props);
    const bar = host.querySelector('[role="toolbar"]')!;
    // A tag with no label shows the tag itself.
    expect(Array.from(bar.querySelectorAll('button')).map((button) => button.textContent)).toEqual(['All projects', 'Offices', 'retail']);
    expect(host.querySelector('[data-pb-tags="offices"]')).not.toBeNull();
    expect(host.querySelector('[data-pb-tags="retail,offices"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-pb-tags]')).toHaveLength(4);
    expect(host.querySelectorAll('[aria-roledescription="slide"][hidden]')).toHaveLength(0);
    // The bar shows only when switched on.
    expect(dom({ ...props, filter: { ...props.filter, show: false } }).querySelector('[role="toolbar"]')).toBeNull();
    expect(dom({ ...props, layout: 'grid' }).querySelector('[role="toolbar"]')).not.toBeNull();
  });
});

describe('cms.ContentSlider — filter style, controls alignment and the next arrow (T143, T147)', () => {
  const block = config.components['cms.ContentSlider']!;
  type FieldLike = { type: string; metadata?: unknown; options?: Array<{ value: unknown }>; objectFields?: Record<string, FieldLike> };
  const fields = block.fields as Record<string, FieldLike>;
  const values = (field: FieldLike | undefined) => (field?.options ?? []).map((option) => option.value);

  it('the filter offers pills (first, today\'s) or underline tabs, and an alignment; none is stored by default', () => {
    const filter = fields['filter']!.objectFields!;
    expect(values(filter['style'])).toEqual(['pills', 'underline']);
    expect(values(filter['align'])).toEqual(['start', 'center', 'end']);
    expect(defaults['filter']).toEqual({ show: false, allLabel: '', tags: [] });
  });

  it('the controls\' alignment is a value per breakpoint on the Responsive tab, centred (today) first; hidden for a grid', async () => {
    expect(fields['controlsAlign']?.type).toBe('select');
    expect(fields['controlsAlign']?.metadata).toEqual(expect.objectContaining({ pageBuilder: expect.objectContaining({ responsive: true }) }));
    expect(values(fields['controlsAlign'])).toEqual(['center', 'start', 'end', 'between', 'split']);
    expect(defaults).not.toHaveProperty('controlsAlign');
    const registered = (config.components['cms.ContentSlider'] as { responsiveFields?: string[] }).responsiveFields;
    expect(registered ?? []).toContain('controlsAlign');
    const grid = await block.resolveFields!({ props: { ...defaults, id: 'c', layout: 'grid' } } as never, { fields: block.fields } as never);
    expect(Object.keys(grid)).not.toContain('controlsAlign');
    const carousel = await block.resolveFields!({ props: { ...defaults, id: 'c' } } as never, { fields: block.fields } as never);
    expect(Object.keys(carousel)).toContain('controlsAlign');
  });

  it('the next arrow may take its own style, "same as the arrows" first', () => {
    const controls = fields['controls']!.objectFields!;
    expect(values(controls['nextArrowVariant'])).toEqual(['same', 'default', 'outline', 'solid']);
    expect(defaults['controls']).toEqual({ arrows: true, dots: false });
  });

  it('renders the filter style, the controls alignment and the next arrow\'s style from the props', () => {
    const host = dom({
      filter: { show: true, allLabel: 'All', style: 'underline', align: 'end', tags: [{ tag: 'a', label: 'Alpha' }] },
      controlsAlign: { base: 'end', desktop: 'split' },
      controls: { arrows: true, dots: false, arrowVariant: 'outline', nextArrowVariant: 'solid' },
      slides: [{ type: 'cms.CarouselImage', props: { id: 'a', tags: 'a', caption: doc('One') } }],
    });
    const bar = host.querySelector('[role="toolbar"]')!;
    expect(bar.className).toContain('cmsc-pb-carousel__filter--underline');
    expect(bar.className).toContain('cmsc-pb-carousel__filter--align-end');
    const region = host.querySelector('[role="region"]')!;
    expect(region.className).toContain('cmsc-pb-carousel--ctl-end');
    expect(region.className).toContain('cmsc-pb-carousel--ctl-lg-split');
    expect(region.className).toContain('cmsc-pb-carousel--next-arrow-solid');
  });
});
