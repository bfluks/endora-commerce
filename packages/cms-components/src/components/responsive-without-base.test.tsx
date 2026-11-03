// @vitest-environment jsdom
import { Render, type Config, type Data } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { specAtTier } from './Button.js';
import { CarouselShell } from './carousel/CarouselShell.js';
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
 * `specs/163-page-builder-marketing-pages/` T170 — a responsive value stored
 * without `base` (an API write or an import; the editor always writes `base`)
 * is read as "no value below the first breakpoint that has one": the tiers
 * below that breakpoint render as if the value were unset, that breakpoint and
 * the ones above it take the stored value. Before T170 such a value was read as
 * unset at every breakpoint. Representative renderers: a Column's row span and
 * span, a Section's spacing, a carousel's slides per view (the shell and the
 * Carousel block), a block's order in a column, a Heading's alignment, and a
 * button's style in the editor's previewed tier.
 */

const config = defaultPageBuilderConfig as Config;
const defaultsOf = (type: string) => (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;

function render(content: unknown[]): string {
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content: content as Data['content'] }} />
    </CmsRenderProvider>,
  );
}

const text = (id: string, value: string, props: Record<string, unknown> = {}) => ({
  type: 'cms.Text',
  props: { ...defaultsOf('cms.Text'), id, text: value, ...props },
});

function row(columnProps: Record<string, unknown>, content: unknown[] = [text('t-1', 'Body')]): string {
  return render([
    {
      type: 'cms.Row',
      props: {
        ...defaultsOf('cms.Row'),
        id: 'row-1',
        content: [{ type: 'cms.Column', props: { ...defaultsOf('cms.Column'), id: 'col-1', content, ...columnProps } }],
      },
    },
  ]);
}

const openingTag = (html: string, className: string): string => {
  const match = new RegExp(`<[a-z]+[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`).exec(html);
  if (!match) throw new Error(`no .${className} in\n${html}`);
  return match[0];
};

describe('a responsive value stored without base (T170)', () => {
  it('cms.Column: a row span and a span set from the desktop up, unset below', () => {
    const cell = openingTag(row({ span: { desktop: 4 }, rowSpan: { desktop: 2 } }), 'cmsc-pb-row-col');
    expect(cell).toContain('data-pb-place="1"');
    expect(cell).toContain('--pb-col-span:12;--pb-col-span-md:12;--pb-col-span-lg:4');
    expect(cell).toContain('--pb-row-span:1;--pb-row-span-md:1;--pb-row-span-lg:2');
  });

  it('cms.Column: a value from the tablet up inherits upwards', () => {
    const cell = openingTag(row({ span: 12, rowSpan: { tablet: 3 } }), 'cmsc-pb-row-col');
    expect(cell).toContain('--pb-row-span:1;--pb-row-span-md:3;--pb-row-span-lg:3');
  });

  it('cms.Section: spacing set from the desktop up keeps the default spacing below', () => {
    const html = render([
      {
        type: 'cms.Section',
        props: { ...defaultsOf('cms.Section'), id: 'section-1', spaceTop: { desktop: 'xl' }, spaceBottom: { tablet: 'none' }, content: [text('t-1', 'Body')] },
      },
    ]);
    const tag = openingTag(html, 'cmsc-section');
    expect(tag).toContain('--cmsc-section-pt:var(--cmsb-space-l, 40px)');
    expect(tag).toContain('--cmsc-section-pt-md:var(--cmsb-space-l, 40px)');
    expect(tag).toContain('--cmsc-section-pt-lg:var(--cmsb-space-xl, 96px)');
    expect(tag).toContain('--cmsc-section-pb:var(--cmsb-space-l, 40px)');
    expect(tag).toContain('--cmsc-section-pb-md:var(--cmsb-space-none, 0px)');
    expect(tag).toContain('--cmsc-section-pb-lg:var(--cmsb-space-none, 0px)');
  });

  it('CarouselShell: slides per view from the desktop up, one per view below', () => {
    const host = document.createElement('div');
    host.innerHTML = renderToString(
      <CarouselShell slidesPerView={{ desktop: 3 } as never}>
        {[<p key="1">One</p>, <p key="2">Two</p>, <p key="3">Three</p>]}
      </CarouselShell>,
    );
    expect(host.querySelector('[role="region"]')?.getAttribute('style') ?? '').toContain('--pb-spv:1;--pb-spv-md:1;--pb-spv-lg:3');
  });

  it('cms.ContentSlider: slides per view stored from the tablet up', () => {
    const host = document.createElement('div');
    host.innerHTML = render([{ type: 'cms.ContentSlider', props: { ...defaultsOf('cms.ContentSlider'), id: 'carousel-1', slidesPerView: { tablet: 2, desktop: 4 } } }]);
    expect(host.querySelector('[role="region"]')?.getAttribute('style') ?? '').toContain('--pb-spv:1;--pb-spv-md:2;--pb-spv-lg:4');
  });

  it('a block placed first in its column from the desktop up keeps its place below', () => {
    const html = row({}, [text('t-1', 'Body'), text('t-2', 'Proof', { stackOrder: { desktop: 'first' } })]);
    expect(html).toContain('data-pb-order="1"');
    expect(html).toMatch(/--pb-order:0;--pb-order-md:0;--pb-order-lg:-1/);
  });

  it('cms.Heading: an alignment from the desktop up keeps the default alignment below', () => {
    const html = render([{ type: 'cms.Heading', props: { ...defaultsOf('cms.Heading'), id: 'h-1', text: 'Title', textAlign: { desktop: 'center' } } }]);
    expect(html).toMatch(/data-align="left" data-align-md="left" data-align-lg="center"/);
  });

  it('a button style from the desktop up is the default style in a smaller previewed tier', () => {
    const spec = { label: 'Go', style: { desktop: 'secondary' }, fill: { tablet: 'outline' } } as never;
    expect(specAtTier(spec, 'mobile')).toMatchObject({ style: undefined, fill: undefined });
    expect(specAtTier(spec, 'tablet')).toMatchObject({ style: undefined, fill: 'outline' });
    expect(specAtTier(spec, 'desktop')).toMatchObject({ style: 'secondary', fill: 'outline' });
  });
});
