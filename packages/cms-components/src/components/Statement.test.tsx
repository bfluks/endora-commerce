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
 * `specs/163-page-builder-marketing-pages/` T046, US3, FR-016,
 * contracts/blocks.md `cms.Statement` — a large heading with an optional muted
 * continuation and supporting text, optionally over a full-bleed image with the
 * text anchored at the bottom.
 */

const config = defaultPageBuilderConfig as Config;
const defaults = (config.components['cms.Statement']?.defaultProps ?? {}) as Record<string, unknown>;

function dom(props: Record<string, unknown> = {}): HTMLElement {
  const content = [{ type: 'cms.Statement', props: { ...defaults, id: 'statement-1', ...props } }] as Data['content'];
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

describe('cms.Statement (T046)', () => {
  it('default props render a start-aligned h2 at the h3 size, with no image', () => {
    expect(defaults['headingLevel']).toBe('h2');
    expect(defaults['headingSize']).toBe('h3');
    expect(defaults['align']).toBe('start');
    const host = dom();
    const heading = host.querySelector('h2');
    expect(heading?.textContent).toBeTruthy();
    expect(heading!.classList).toContain('cmsc-t--h3');
    const root = host.querySelector('.cmsc-pb-statement')!;
    expect(root.getAttribute('data-align')).toBe('start');
    expect(root.classList).not.toContain('cmsc-pb-statement--bleed');
    expect(host.querySelector('picture')).toBeNull();
  });

  it('a muted continuation renders as the muted emphasis, and the body renders muted', () => {
    const host = dom({
      heading: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'We build pages. ' },
              { type: 'text', text: 'Then we keep them fast.', marks: [{ type: 'emphasis', attrs: { variant: 'muted' } }] },
            ],
          },
        ],
      },
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Supporting text.' }] }] },
    });
    expect(host.querySelector('h2 span.cmsc-em--muted')?.textContent).toBe('Then we keep them fast.');
    const body = host.querySelector('.cmsc-pb-statement__body');
    expect(body?.textContent).toBe('Supporting text.');
  });

  it('with a background image it is full bleed, with the text anchored at the bottom', () => {
    const host = dom({
      align: 'center',
      background: { image: { imageSource: 'url', src: '/media/wide.jpg', alt: '' }, textPosition: 'bottom' },
    });
    const root = host.querySelector('.cmsc-pb-statement')!;
    expect(root.classList).toContain('cmsc-pb-statement--bleed');
    expect(root.getAttribute('data-text-position')).toBe('bottom');
    expect(root.getAttribute('data-align')).toBe('center');
    const img = root.querySelector('.cmsc-pb-statement__media img');
    expect(img?.getAttribute('loading')).toBe('lazy');
    // The text sits above the image in the stacking order.
    expect(root.querySelector('.cmsc-pb-statement__content h2')).not.toBeNull();
    expect(dom({ background: { image: { imageSource: 'url', src: '/media/wide.jpg', alt: '' }, textPosition: 'center' } })
      .querySelector('.cmsc-pb-statement')!.getAttribute('data-text-position')).toBe('center');
  });

  it('a background with no image is not full bleed', () => {
    const root = dom({ background: { textPosition: 'bottom' } }).querySelector('.cmsc-pb-statement')!;
    expect(root.classList).not.toContain('cmsc-pb-statement--bleed');
  });
});
