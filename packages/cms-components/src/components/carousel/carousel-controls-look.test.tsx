// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../../index.js';
import { CmsRenderProvider } from '../render-context.js';
import { CarouselShell, type CarouselShellProps } from './CarouselShell.js';
import { carouselShellOptions, withoutUnusedCarouselFields, CAROUSEL_TRACK_FIELDS } from './carousel-parts.js';

// Puck's drag-and-drop layer observes element sizes when it is imported; jsdom has no ResizeObserver.
vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R19B (T240–T244) — the carousel
 * controls' look, extended (plan § *Extend, don't narrow*):
 *
 * - **Dots** follow a dark colour scheme (the active dot stays visibly active)
 *   (T240). R23 (T448): their own inactive and active colours were removed —
 *   the scheme decides; a stored one is ignored.
 * - A **solid arrow's glyph** takes a colour of its own; unset it is today's
 *   white (T241).
 * - **Arrows and dots hidden per breakpoint**, a "Hide on" choice each; a row
 *   of controls left with nothing to show is removed there too (T242).
 * - **Controls in the header with no heading** stand at the header's end, where
 *   they stand beside a heading (T243).
 *
 * Every option unset renders exactly today's markup.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.ContentSlider']?.defaultProps ?? {}) as Record<string, unknown>;

function sliderHtml(props: Record<string, unknown> = {}): string {
  const content = [{ type: 'cms.ContentSlider', props: { ...defaults, id: 'carousel-1', ...props } }] as Data['content'];
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
}

function shellDom(props: Partial<CarouselShellProps>): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CarouselShell {...props}>
      {[1, 2, 3].map((n) => (
        <p key={n}>Slide {n}</p>
      ))}
    </CarouselShell>,
  );
  return host;
}

const root = (host: HTMLElement): HTMLElement => host.querySelector<HTMLElement>('.cmsc-pb-carousel')!;

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

describe('carousel dots follow the scheme (T240; R23 T448: no colours of their own)', () => {
  it('unset writes nothing new: the markup is today’s; a stored dot colour is ignored', () => {
    const html = sliderHtml({ controls: { arrows: true, dots: true } });
    expect(html).not.toContain('--pb-dot');
    expect(sliderHtml({ controls: { arrows: true, dots: true, dotColor: '#ffffff', activeDotColor: 'token:primary' } })).toBe(html);
    expect(carouselShellOptions({ controls: { dots: true, dotColor: '#ffffff', activeDotColor: 'token:primary' } as never })).not.toHaveProperty('dotColor');
  });

  it('the stylesheet reads the scheme’s dot colours: in the dark scheme the active dot is the scheme’s text colour over a faint inactive dot', () => {
    const css = sheet();
    expect(css).toContain('.cmsc-pb-carousel__dot::before { content: \'\'; width: 8px; height: 8px; border-radius: 50%; background: var(--cmsc-dot, var(--cmsb-n-300, #cbd5e1)); }');
    expect(css).toContain('.cmsc-pb-carousel__dot--active::before { background: var(--cmsc-dot-active, var(--cmsb-n-700, #334155)); }');
    expect(css).not.toContain('--pb-dot');
    expect(css).toMatch(/\[data-cmsb-scheme='dark'\] \{[^}]*--cmsc-dot: rgb\(255 255 255 \/ 35%\); --cmsc-dot-active: var\(--cmsb-fg, #f8fafc\);/);
  });
});

describe('a solid arrow’s glyph colour (T241)', () => {
  it('is written as --pb-arrow-glyph, read by both solid looks with today’s white as the fallback', () => {
    expect(root(shellDom({ arrowVariant: 'solid', arrowColor: '#ffffff', arrowGlyphColor: '#000000' })).getAttribute('style')).toContain(
      '--pb-arrow-glyph:#000000',
    );
    expect(carouselShellOptions({ controls: { arrowVariant: 'solid', arrowGlyphColor: 'token:primary' } }).arrowGlyphColor).toMatch(/^var\(/);
    const css = sheet();
    expect(css).toContain('.cmsc-pb-carousel--arrows-solid .cmsc-pb-carousel__arrow { background: var(--pb-arrow-color, var(--cmsb-n-900, #0f172a)); border-color: transparent; color: var(--pb-arrow-glyph, #fff); }');
    expect(css).toContain('.cmsc-pb-carousel--next-arrow-solid .cmsc-pb-carousel__arrow--next { background: var(--pb-arrow-color, var(--cmsb-n-900, #0f172a)); border-color: transparent; color: var(--pb-arrow-glyph, #fff); }');
  });

  it('unset writes nothing', () => {
    const html = sliderHtml({ controls: { arrows: true, arrowVariant: 'solid' } });
    expect(html).not.toContain('--pb-arrow-glyph');
    expect(sliderHtml({ controls: { arrows: true, arrowVariant: 'solid', arrowGlyphColor: '' } })).toBe(html);
  });
});

describe('arrows and dots hidden per breakpoint (T242)', () => {
  it('unset or nothing ticked renders today’s markup', () => {
    const html = sliderHtml({ controls: { arrows: true, dots: true } });
    expect(html).not.toMatch(/--(arrows|dots)-off-/);
    expect(sliderHtml({ controls: { arrows: true, dots: true, hideArrowsOn: {}, hideDotsOn: { mobile: false } } })).toBe(html);
  });

  it('writes a root class per breakpoint the arrows or the dots are hidden on', () => {
    const host = shellDom({ showDots: true, controlsPlacement: 'below', hideArrowsOn: { mobile: true, tablet: true }, hideDotsOn: { desktop: true } });
    const classes = root(host).className.split(' ');
    expect(classes).toEqual(expect.arrayContaining(['cmsc-pb-carousel--arrows-off-sm', 'cmsc-pb-carousel--arrows-off-md', 'cmsc-pb-carousel--dots-off-lg']));
    expect(classes).not.toContain('cmsc-pb-carousel--arrows-off-lg');
  });

  it('a row of controls with nothing left to show at a breakpoint is removed there', () => {
    // Below, arrows only: hidden on phones and tablets, so the row goes there.
    const below = shellDom({ showDots: false, controlsPlacement: 'below', hideArrowsOn: { mobile: true, tablet: true } });
    const row = below.querySelector('.cmsc-pb-carousel__controls--below')!;
    expect(row.className).toContain('cmsc-pb-carousel__controls--off-sm');
    expect(row.className).toContain('cmsc-pb-carousel__controls--off-md');
    expect(row.className).not.toContain('--off-lg');
    // With dots still shown the row stays.
    const withDots = shellDom({ showDots: true, controlsPlacement: 'below', hideArrowsOn: { mobile: true } });
    expect(withDots.querySelector('.cmsc-pb-carousel__controls--below')!.className).not.toContain('--off-sm');
    // The header with only the arrows goes with them.
    const header = shellDom({ showDots: false, controlsPlacement: 'header', hideArrowsOn: { mobile: true } });
    expect(header.querySelector('.cmsc-pb-carousel__header')!.className).toContain('cmsc-pb-carousel__controls--off-sm');
    // The dots row of the header placement goes where the dots are hidden.
    const dotsRow = shellDom({ showDots: true, controlsPlacement: 'header', hideDotsOn: { tablet: true } });
    expect(dotsRow.querySelector('.cmsc-pb-carousel__controls--dots')!.className).toContain('cmsc-pb-carousel__controls--off-md');
  });

  it('the stylesheet hides the carousel’s own arrows and dots, never a nested carousel’s', () => {
    const css = sheet();
    expect(css).toMatch(
      /@media \(max-width: 767\.98px\) \{ \.cmsc-pb-carousel--arrows-off-sm > \.cmsc-pb-carousel__controls > \.cmsc-pb-carousel__arrow, \.cmsc-pb-carousel--arrows-off-sm > \.cmsc-pb-carousel__header > \.cmsc-pb-carousel__controls > \.cmsc-pb-carousel__arrow, \.cmsc-pb-carousel--arrows-off-sm > \.cmsc-pb-carousel__viewport > \.cmsc-pb-carousel__controls > \.cmsc-pb-carousel__arrow, \.cmsc-pb-carousel--dots-off-sm > \.cmsc-pb-carousel__controls > \.cmsc-pb-carousel__dots,/,
    );
    expect(css).toContain('.cmsc-pb-carousel--arrows-off-lg > .cmsc-pb-carousel__controls > .cmsc-pb-carousel__arrow');
    expect(css).toContain('.cmsc-pb-carousel--dots-off-md > .cmsc-pb-carousel__controls > .cmsc-pb-carousel__dots');
    // T253: controls drawn inside a slide follow the carousel's choice too.
    expect(css).toContain('.cmsc-pb-carousel--arrows-off-lg .cmsc-pb-carousel__controls--slide > .cmsc-pb-carousel__arrow');
  });

  it('the shell options carry the choices from `controls`', () => {
    const options = carouselShellOptions({ controls: { arrows: true, dots: true, hideArrowsOn: { mobile: true }, hideDotsOn: { tablet: true, desktop: false } } });
    expect(options.hideArrowsOn).toEqual({ mobile: true });
    expect(options.hideDotsOn).toEqual({ tablet: true });
    expect(carouselShellOptions({ controls: { hideArrowsOn: {} } })).not.toHaveProperty('hideArrowsOn');
  });
});

describe('controls in a header with no heading (T243)', () => {
  it('render the header with the arrows alone, which the stylesheet puts at the header’s end', () => {
    const html = sliderHtml({ controlsPlacement: 'header', header: { heading: '', lead: '' } });
    expect(html).toMatch(/<div class="cmsc-pb-carousel__header"><div class="cmsc-pb-carousel__controls cmsc-pb-carousel__controls--header">/);
    expect(sheet()).toContain('.cmsc-pb-carousel__header > .cmsc-pb-carousel__controls--header:first-child { margin-inline-start: auto; }');
  });
});

describe('the new settings are offered where they apply (T240–T242)', () => {
  const controlsFields = (props: Record<string, unknown>): string[] => {
    const fields = withoutUnusedCarouselFields(props, { ...CAROUSEL_TRACK_FIELDS } as Record<string, unknown>);
    return Object.keys((fields['controls'] as { objectFields: Record<string, unknown> }).objectFields);
  };

  it('"hide the dots on" with dots; "hide the arrows on" with arrows; the glyph colour with a solid arrow', () => {
    const none = controlsFields({ controls: { arrows: false, dots: false } });
    for (const key of ['hideDotsOn', 'hideArrowsOn', 'arrowGlyphColor']) expect(none).not.toContain(key);
    const dots = controlsFields({ controls: { arrows: true, dots: true } });
    expect(dots).toEqual(expect.arrayContaining(['hideDotsOn', 'hideArrowsOn']));
    expect(dots).not.toContain('dotColor');
    expect(dots).not.toContain('activeDotColor');
    expect(dots).not.toContain('arrowGlyphColor');
    expect(controlsFields({ controls: { arrows: true, arrowVariant: 'solid' } })).toContain('arrowGlyphColor');
    expect(controlsFields({ controls: { arrows: true, nextArrowVariant: 'solid' } })).toContain('arrowGlyphColor');
  });

  it('every block with the carousel’s controls offers them', () => {
    for (const type of ['cms.ContentSlider', 'catalog.ProductSlider', 'blog.LatestPosts']) {
      const block = config.components[type] as ComponentConfig;
      const controls = (block.fields as Fields)['controls'] as { objectFields: Record<string, unknown> };
      expect(Object.keys(controls.objectFields), type).toEqual(
        expect.arrayContaining(['arrowGlyphColor', 'hideArrowsOn', 'hideDotsOn']),
      );
    }
  });
});
