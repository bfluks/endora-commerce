import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';

/**
 * `specs/163-page-builder-marketing-pages/` T172 (R11) — a hover look for
 * carousel items and tiles: the caption of a `cms.CarouselImage`, and the
 * title and the text-link label of a `cms.LinkTile`, may take another colour
 * (a brand colour token or a hex) while the pointer is over the item or the
 * item holds keyboard focus, with a short colour transition that reduced
 * motion turns off. Unset, the item renders exactly as before: no class, no
 * custom property, no transition.
 */

const config = defaultPageBuilderConfig as Config;
const defaultsOf = (type: string) => (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function render(type: string, props: Record<string, unknown>): string {
  const content = [{ type, props: { ...defaultsOf(type), id: `${type}-1`, ...props } }] as Data['content'];
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
}

const IMAGE = { image: { imageSource: 'url', src: 'https://example.com/a.jpg', alt: 'A' }, caption: doc('Machines') };
const TILE = { title: doc('Machines'), linkLabel: 'See more', link: { kind: 'page', slug: 'machines' } };

const sheet = (): string =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8').replace(/\s+/g, ' ');

const fieldsOf = (type: string): Fields => (config.components[type] as ComponentConfig).fields as Fields;

describe('cms.CarouselImage — caption colour on hover (T172)', () => {
  it('unset renders exactly what it rendered before: no class and no custom property', () => {
    const html = render('cms.CarouselImage', IMAGE);
    expect(html).not.toContain('hover-caption');
    expect(html).not.toContain('--pb-caption-hover');
    expect(render('cms.CarouselImage', { ...IMAGE, captionHoverColor: '' })).toBe(html);
  });

  it('a hex or a brand token sets the colour on the item, read by the caption on hover and focus', () => {
    const hex = render('cms.CarouselImage', { ...IMAGE, captionHoverColor: '#1d4ed8' });
    expect(hex).toMatch(/<figure class="[^"]*cmsc-pb-carousel-image--hover-caption[^"]*" style="[^"]*--pb-caption-hover:#1d4ed8/);
    const token = render('cms.CarouselImage', { ...IMAGE, captionHoverColor: 'token:secondary' });
    expect(token).toMatch(/--pb-caption-hover:var\(--cmsb-color-secondary, #[0-9a-f]{6}\)/);
  });

  it('anything but a hex or a known token is ignored', () => {
    const html = render('cms.CarouselImage', IMAGE);
    expect(render('cms.CarouselImage', { ...IMAGE, captionHoverColor: 'red;background:url(x)' })).toBe(html);
  });

  it('offers the field as a colour, after the caption style', () => {
    const keys = Object.keys(fieldsOf('cms.CarouselImage'));
    expect(keys).toContain('captionHoverColor');
    expect(keys.indexOf('captionHoverColor')).toBe(keys.indexOf('captionStyle') + 1);
    expect(fieldsOf('cms.CarouselImage')['captionHoverColor']?.label).toBe('Caption hover color');
  });
});

describe('cms.LinkTile — title and label colour on hover (T172)', () => {
  it('unset renders exactly what it rendered before', () => {
    const html = render('cms.LinkTile', TILE);
    expect(html).not.toContain('--hover-');
    expect(html).not.toContain('-hover:');
    expect(render('cms.LinkTile', { ...TILE, titleHoverColor: '', labelHoverColor: 'nope' })).toBe(html);
  });

  it('the title\'s and the label\'s hover colours are their own', () => {
    const html = render('cms.LinkTile', { ...TILE, titleHoverColor: '#1d4ed8', labelHoverColor: 'token:primary' });
    expect(html).toMatch(/<a class="[^"]*cmsc-pb-link-tile--hover-title cmsc-pb-link-tile--hover-label[^"]*"/);
    expect(html).toContain('--pb-title-hover:#1d4ed8');
    expect(html).toMatch(/--pb-label-hover:var\(--cmsb-color-primary, #[0-9a-f]{6}\)/);
    const titleOnly = render('cms.LinkTile', { ...TILE, titleHoverColor: '#1d4ed8' });
    expect(titleOnly).not.toContain('hover-label');
  });

  it('offers both fields as colours, each after its font (the resting colours, T178, are on the Responsive tab since T181, the weights since T188)', () => {
    const keys = Object.keys(fieldsOf('cms.LinkTile'));
    expect(keys.indexOf('titleHoverColor')).toBe(keys.indexOf('titleFont') + 1);
    expect(keys.indexOf('labelHoverColor')).toBe(keys.indexOf('labelFont') + 1);
    expect(fieldsOf('cms.LinkTile')['titleHoverColor']?.label).toBe('Title hover color');
    expect(fieldsOf('cms.LinkTile')['labelHoverColor']?.label).toBe('Label hover color');
  });
});

describe('the stylesheet (T172)', () => {
  it('colours on hover and on keyboard focus, with a short transition only when a hover colour is set', () => {
    const css = sheet();
    expect(css).toContain(
      '.cmsc-pb-carousel-image--hover-caption:is(:hover, :focus-within) .cmsc-pb-carousel-image__caption { color: var(--pb-caption-hover) !important; }',
    );
    expect(css).toContain('.cmsc-pb-link-tile--hover-title:is(:hover, :focus-visible) .cmsc-pb-link-tile__title { color: var(--pb-title-hover); }');
    expect(css).toContain('.cmsc-pb-link-tile--hover-label:is(:hover, :focus-visible) .cmsc-pb-link-tile__label { color: var(--pb-label-hover); }');
    expect(css).toMatch(
      /\.cmsc-pb-carousel-image--hover-caption \.cmsc-pb-carousel-image__caption, \.cmsc-pb-link-tile--hover-title \.cmsc-pb-link-tile__title, \.cmsc-pb-link-tile--hover-label \.cmsc-pb-link-tile__label \{ transition: color 0\.2s ease; \}/,
    );
  });

  it('reduced motion: the colour changes at once', () => {
    expect(sheet()).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{ \.cmsc-pb-carousel-image--hover-caption \.cmsc-pb-carousel-image__caption, \.cmsc-pb-link-tile--hover-title \.cmsc-pb-link-tile__title, \.cmsc-pb-link-tile--hover-label \.cmsc-pb-link-tile__label \{ transition: none; \} \}/,
    );
  });
});
