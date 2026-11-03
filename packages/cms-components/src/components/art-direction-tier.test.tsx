import { readFileSync } from 'node:fs';
import { Render, type ComponentConfig, type Config } from '@puckeditor/core';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { withHideOn, type HideOnProps, type SectionSettingsValue } from '@endora-commerce/page-builder-core';
import { Picture, pictureMobileMedia } from './Picture.js';
import { CmsRenderProvider } from './render-context.js';
import { SectionFrame } from './Section.js';

/**
 * `specs/163-page-builder-marketing-pages/` R19C (T263) — where an art-directed
 * image's mobile variant gives way to the desktop one. Unset (or `tablet`) it is
 * the tablet tier, 768 px, as before; `desktopFrom: 'desktop'` keeps the mobile
 * art up to the desktop tier, 1024 px — for a `<picture>` (every
 * `ResponsiveImage`), and for a section background's image, tiled image and
 * video pair.
 */

const DESKTOP = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const MOBILE = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const VIDEO = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const MOBILE_VIDEO = '2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e';

function render(element: ReactElement): string {
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      {element}
    </CmsRenderProvider>,
  );
}

type ProbeProps = HideOnProps & { section?: SectionSettingsValue };
const probe = withHideOn<ProbeProps>({
  fields: {},
  render: (props: ProbeProps) => (
    <SectionFrame settings={props.section}>
      <p>Body</p>
    </SectionFrame>
  ),
} as unknown as ComponentConfig<{ props: ProbeProps }>) as unknown as ComponentConfig;
const config: Config = { components: { Probe: probe } };

function renderSection(section: SectionSettingsValue): string {
  return render(<Render config={config} data={{ root: { props: {} }, content: [{ type: 'Probe', props: { id: 'p-1', section } }] as never }} />);
}

const image = { imageSource: 'library' as const, assetId: DESKTOP, mobileAssetId: MOBILE, alt: '' };

describe('Picture — the tier the desktop image starts at (R19C, T263)', () => {
  it('unset or `tablet`: the mobile source below 768 px, as before', () => {
    expect(pictureMobileMedia(undefined)).toBe('(max-width: 767.98px)');
    expect(pictureMobileMedia('tablet')).toBe('(max-width: 767.98px)');
    expect(render(<Picture image={image} />)).toContain('<source media="(max-width: 767.98px)"');
    expect(render(<Picture image={{ ...image, desktopFrom: 'tablet' }} />)).toContain('<source media="(max-width: 767.98px)"');
  });

  it('`desktop`: the mobile source below 1024 px', () => {
    expect(pictureMobileMedia('desktop')).toBe('(max-width: 1023.98px)');
    expect(render(<Picture image={{ ...image, desktopFrom: 'desktop' }} />)).toContain('<source media="(max-width: 1023.98px)"');
  });
});

describe('Section background — the tier the desktop art starts at (R19C, T263)', () => {
  const background = { kind: 'image' as const, imageSource: 'library' as const, imageAssetId: DESKTOP, mobileImageAssetId: MOBILE };

  it('unset: today\'s markup, the picture switching at 768 px and no attribute', () => {
    const html = renderSection({ background });
    expect(html).toContain('<source media="(max-width: 767.98px)"');
    expect(html).not.toContain('data-desktop-from');
  });

  it('an image background\'s picture keeps the mobile art below 1024 px', () => {
    const html = renderSection({ background: { ...background, desktopFrom: 'desktop' } });
    expect(html).toContain('<source media="(max-width: 1023.98px)"');
  });

  it('a tiled image and a video pair carry `data-desktop-from` on the media layer', () => {
    const tiled = renderSection({ background: { ...background, size: { px: 200 }, repeat: 'repeat', desktopFrom: 'desktop' } });
    expect(tiled).toMatch(/<div class="cmsc-section__media" aria-hidden="true" data-desktop-from="desktop">/);
    const video = renderSection({
      background: { kind: 'video', videoSource: 'library', videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, desktopFrom: 'desktop' },
    });
    expect(video).toMatch(/<div class="cmsc-section__media" aria-hidden="true" data-desktop-from="desktop">/);
    expect(renderSection({ background: { ...background, desktopFrom: 'tablet' } })).not.toContain('data-desktop-from');
  });

  it('the stylesheet keeps the mobile tile and video up to 1024 px under `data-desktop-from="desktop"`', () => {
    const css = readFileSync(new URL('../../styles/cms-components.css', import.meta.url), 'utf8');
    expect(css).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1023\.98px\) \{\s*\.cmsc-section__media\[data-desktop-from='desktop'\] > \.cmsc-section__tile \{\s*background-image: var\(--cmsc-tile-image-mobile, var\(--cmsc-tile-image, none\)\);/,
    );
    expect(css).toMatch(
      /\.cmsc-section__media\[data-desktop-from='desktop'\] > \.cmsc-section__video\[data-bp='mobile'\] \{\s*display: block;/,
    );
    expect(css).toMatch(
      /\.cmsc-section__media\[data-desktop-from='desktop'\] > \.cmsc-section__video\[data-bp='desktop'\] \{\s*display: none;/,
    );
  });
});
