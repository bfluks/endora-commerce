// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R23 (T438, T440) — a 12-column
 * layout is a preset (\`layout\`) on the split slide, the stats beside an image
 * and the call-to-action card; the raw numbers stay, shown and applied with
 * the Advanced switch (\`layoutAdvanced\`) on. Raw numbers stored before the
 * switch existed (R19A–R22I) keep rendering, and the editor shows them with
 * the switch on. \`cms.MediaText\` keeps its \`split\` as the preset and gains the
 * switch for its raw numbers.
 */

const config = defaultPageBuilderConfig as Config;
const IMAGE = { imageSource: 'url', src: 'https://example.com/a.jpg', alt: '' };

function dom(type: string, props: Record<string, unknown>): HTMLElement {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  const content = [{ type, props: { ...defaults, id: 'block-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

async function fieldKeys(type: string, props: Record<string, unknown>): Promise<string[]> {
  const block = config.components[type] as ComponentConfig;
  const fields = block.fields as Fields;
  const resolved = await block.resolveFields!(
    { props: { ...(block.defaultProps ?? {}), ...props } } as never,
    { fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
  );
  return Object.keys(resolved);
}

async function resolvedProps(type: string, props: Record<string, unknown>): Promise<Record<string, unknown>> {
  const block = config.components[type] as ComponentConfig;
  const out = await block.resolveData!({ props: { ...(block.defaultProps ?? {}), ...props } } as never, { changed: {} } as never);
  return (out as { props: Record<string, unknown> }).props;
}

const styleOf = (element: Element | null | undefined): string => element?.getAttribute('style') ?? '';

describe('cms.CarouselSplit layout preset (T438)', () => {
  const split = (props: Record<string, unknown>) => dom('cms.CarouselSplit', props).querySelector('.cmsc-pb-carousel-split')!;

  it('unset or Default: today’s two halves, no columns', () => {
    expect(split({}).className).toBe('cmsc-pb-carousel-split');
    expect(split({ layout: 'default' }).className).toBe('cmsc-pb-carousel-split');
  });

  it('a preset places media and text on the 12 columns, mirrored for media at the end', () => {
    const start = split({ layout: '7-5' });
    expect(start.className).toContain('cmsc-pb-carousel-split--columns');
    expect(styleOf(start)).toContain('--cmsc-split-media-col:1 / span 7');
    expect(styleOf(start)).toContain('--cmsc-split-text-col:8 / span 5');
    const end = split({ layout: '5-1-6', mediaSide: 'end' });
    expect(styleOf(end)).toContain('--cmsc-split-media-col:8 / span 5');
    expect(styleOf(end)).toContain('--cmsc-split-text-col:1 / span 6');
  });

  it('with Advanced on, the raw numbers win over the preset; off, stored raw numbers are not read', () => {
    const advanced = split({ layout: '7-5', layoutAdvanced: true, mediaSpan: 4, textSpan: 8 });
    expect(styleOf(advanced)).toContain('--cmsc-split-media-col:1 / span 4');
    const off = split({ layout: '7-5', layoutAdvanced: false, mediaSpan: 4, textSpan: 8 });
    expect(styleOf(off)).toContain('--cmsc-split-media-col:1 / span 7');
  });

  it('the fields: the preset and the switch; the raw numbers with the switch on', async () => {
    const keys = await fieldKeys('cms.CarouselSplit', {});
    expect(keys).toEqual(expect.arrayContaining(['layout', 'layoutAdvanced']));
    expect(keys).not.toContain('mediaSpan');
    expect(keys).not.toContain('columnGapPx');
    expect(await fieldKeys('cms.CarouselSplit', { layout: '6-6' })).toContain('columnGapPx');
    expect(await fieldKeys('cms.CarouselSplit', { layoutAdvanced: true })).toEqual(expect.arrayContaining(['mediaSpan', 'textSpan', 'textOffset']));
    // The anchor and the gap, as before (R22I), once there are columns of 12.
    expect(await fieldKeys('cms.CarouselSplit', { layoutAdvanced: true, mediaSpan: 5 })).toEqual(expect.arrayContaining(['columnsAnchor', 'columnGapPx']));
  });

  it('raw numbers stored before the switch existed open with the switch on', async () => {
    expect((await resolvedProps('cms.CarouselSplit', { mediaSpan: 5 }))['layoutAdvanced']).toBe(true);
    expect((await resolvedProps('cms.CarouselSplit', {}))['layoutAdvanced']).toBeUndefined();
    expect((await resolvedProps('cms.CarouselSplit', { layout: '6-6', mediaSpan: 5 }))['layoutAdvanced']).toBeUndefined();
  });
});

describe('cms.Stats layout preset (T438)', () => {
  const block = (props: Record<string, unknown>) => dom('cms.Stats', { image: IMAGE, ...props }).querySelector('.cmsc-pb-stats-block')!;

  it('unset: today’s two halves; a preset: image columns – between – figures columns', () => {
    expect(block({}).className).toBe('cmsc-pb-stats-block');
    const preset = block({ layout: '5-1-6' });
    expect(preset.className).toContain('cmsc-pb-stats-block--columns');
    expect(styleOf(preset)).toContain('--cmsc-stats-media-col:1 / span 5');
    expect(styleOf(preset)).toContain('--cmsc-stats-figures-col:7 / span 6');
  });

  it('Advanced: the raw spans and offset; stored raw numbers without a preset read as Advanced', async () => {
    expect(styleOf(block({ layout: '6-6', layoutAdvanced: true, imageSpan: 4 }))).toContain('--cmsc-stats-media-col:1 / span 4');
    expect(styleOf(block({ imageSpan: 4 }))).toContain('--cmsc-stats-media-col:1 / span 4');
    expect((await resolvedProps('cms.Stats', { image: IMAGE, imageSpan: 4 }))['layoutAdvanced']).toBe(true);
    const keys = await fieldKeys('cms.Stats', { image: IMAGE });
    expect(keys).toEqual(expect.arrayContaining(['layout', 'layoutAdvanced']));
    expect(keys).not.toContain('imageSpan');
    expect(await fieldKeys('cms.Stats', { image: IMAGE, layoutAdvanced: true })).toEqual(
      expect.arrayContaining(['imageSpan', 'figuresSpan', 'figuresOffset']),
    );
    expect(await fieldKeys('cms.Stats', {})).not.toContain('layout');
  });
});

describe('cms.CtaCard layout preset (T440)', () => {
  const card = (props: Record<string, unknown>) => dom('cms.CtaCard', { image: IMAGE, ...props }).querySelector('.cmsc-pb-cta-card')!;

  it('a preset sets the image width from the tablet up (two tracks, no column between)', () => {
    const preset = card({ layout: '4-8' });
    expect(preset.className).toContain('cmsc-pb-cta-card--image-cols');
    expect(styleOf(preset)).toContain('--cmsc-cta-cols-md:minmax(0, 8fr) minmax(0, 4fr)');
    expect(styleOf(preset)).toContain('--cmsc-cta-cols-lg:minmax(0, 8fr) minmax(0, 4fr)');
    expect(styleOf(card({ layout: '4-8', imageSide: 'start' }))).toContain('--cmsc-cta-cols-lg:minmax(0, 4fr) minmax(0, 8fr)');
  });

  it('Advanced: the raw columns per breakpoint win; stored ones without a preset read as Advanced', async () => {
    const advanced = card({ layout: '4-8', layoutAdvanced: true, imageColumns: { base: 6, desktop: 5 } });
    expect(styleOf(advanced)).toContain('--cmsc-cta-cols-lg:minmax(0, 7fr) minmax(0, 5fr)');
    expect((await resolvedProps('cms.CtaCard', { image: IMAGE, imageColumns: 5 }))['layoutAdvanced']).toBe(true);
    const layout = ((config.components['cms.CtaCard'] as ComponentConfig).fields as Record<string, { options?: Array<{ value: string }> }>)['layout'];
    expect(layout?.options?.map((option) => option.value)).toEqual(['default', '6-6', '7-5', '5-7', '8-4', '4-8']);
  });
});

describe('cms.MediaText keeps its split; the raw columns behind the switch (T438)', () => {
  it('the switch shows the raw numbers; stored ones open with it on and render as before', async () => {
    expect(await fieldKeys('cms.MediaText', {})).toContain('split');
    expect(await fieldKeys('cms.MediaText', {})).not.toContain('mediaSpan');
    expect(await fieldKeys('cms.MediaText', { layoutAdvanced: true })).toContain('mediaSpan');
    expect((await resolvedProps('cms.MediaText', { mediaSpan: 5 }))['layoutAdvanced']).toBe(true);
    const root = dom('cms.MediaText', { mediaSpan: 5 }).querySelector('.cmsc-pb-media-text')!;
    expect(root.className).toContain('cmsc-pb-media-text--columns');
    const off = dom('cms.MediaText', { mediaSpan: 5, layoutAdvanced: false }).querySelector('.cmsc-pb-media-text')!;
    expect(off.className).toBe('cmsc-pb-media-text');
  });
});
