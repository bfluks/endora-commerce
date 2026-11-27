import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToString } from 'react-dom/server';
import { Render, type Data } from '@puckeditor/core';
import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
import { CmsRenderProvider } from '@endora-commerce/cms-components/components/render-context';
import { cmsCarouselLabels } from '../../lib/page-builder/carousel-labels';

/**
 * Feature 163, T095 — a carousel's words for assistive technology ("Previous
 * slide", "Next slide", "n of m") are in the page's language
 * (`specs/163-page-builder-marketing-pages/` FR-039, research R-12).
 *
 * `cms-components` has no translation layer. `CmsPageRenderer` passes the
 * page language's words, from the storefront's message catalogue, through the
 * render context every block reads; `CarouselShell` falls back to English.
 */

function carouselPage(): Data {
  return {
    root: { props: {} },
    content: [
      {
        type: 'cms.ContentSlider',
        props: {
          ...(defaultPageBuilderConfig.components['cms.ContentSlider']?.defaultProps ?? {}),
          id: 'pb163-carousel',
          controls: { arrows: true, dots: false, placement: 'below' },
        },
      },
    ],
  } as unknown as Data;
}

function render(language: string): string {
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} carouselLabels={cmsCarouselLabels(language)}>
      <Render config={defaultPageBuilderConfig} data={carouselPage()} />
    </CmsRenderProvider>,
  );
}

describe('carousel labels in the page language (T095)', () => {
  it('a Polish page names the arrows and the slides in Polish', () => {
    const html = render('pl-PL');
    expect(html).toContain('aria-label="Poprzedni slajd"');
    expect(html).toContain('aria-label="Następny slajd"');
    expect(html).toContain('aria-label="1 z 3"');
    expect(html).not.toContain('aria-label="Next slide"');
  });

  it('an English page, and a language the catalogue does not carry, read English', () => {
    for (const language of ['en-US', 'de-DE']) {
      const html = render(language);
      expect(html).toContain('aria-label="Previous slide"');
      expect(html).toContain('aria-label="2 of 3"');
    }
  });

  it('T131: the filter bar\'s name, its "All" button and the count are in the page language', () => {
    const page = {
      root: { props: {} },
      content: [
        {
          type: 'cms.ContentSlider',
          props: {
            ...(defaultPageBuilderConfig.components['cms.ContentSlider']?.defaultProps ?? {}),
            id: 'pb163-filter',
            filter: { show: true, allLabel: '', tags: [{ tag: 'a', label: 'Alpha' }] },
          },
        },
      ],
    } as unknown as Data;
    const html = (language: string) =>
      renderToString(
        <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} carouselLabels={cmsCarouselLabels(language)}>
          <Render config={defaultPageBuilderConfig} data={page} />
        </CmsRenderProvider>,
      );
    expect(html('pl-PL')).toContain('aria-label="Filtruj"');
    expect(html('pl-PL')).toContain('>Wszystkie</button>');
    expect(html('en-US')).toContain('>All</button>');
    expect(cmsCarouselLabels('pl-PL').filterCount).toBe('Pokazano {n} z {m}');
    expect(cmsCarouselLabels('en-US').filterCount).toBe('{n} of {m} shown');
  });

  it('CmsPageRenderer hands the page language\'s words to the render context', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/CmsPageRenderer.tsx'), 'utf8');
    expect(source).toMatch(/carouselLabels=\{cmsCarouselLabels\(page\.language\)\}/);
  });
});
