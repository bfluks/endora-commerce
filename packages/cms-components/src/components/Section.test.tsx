import { readFileSync } from 'node:fs';
import { Render, type ComponentConfig, type Config } from '@puckeditor/core';
import type { ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SECTION_SPACE_FALLBACKS, withHideOn, type HideOnProps, type SectionSettingsValue } from '@endora-commerce/page-builder-core';
import { DEFAULT_BRAND_TOKENS } from '@endora-commerce/page-builder-core/brand-tokens';
import { CmsRenderProvider } from './render-context.js';
import { SectionFrame } from './Section.js';

/**
 * `specs/163-page-builder-marketing-pages/` FR-000–FR-005, FR-010, FR-012,
 * research R-8, R-8a, R-9 and contracts/blocks.md "`cms.Section`" —
 * `SectionFrame`, the frame `cms.Section` renders through (a probe block
 * stands in for it here; `SectionBlock.test.tsx` tests the block): at the top
 * level of a page it renders one `<section class="cmsc-section">` carrying its
 * anchor, colour scheme, width, background and token spacing; nested it
 * renders its content only and ignores the settings.
 *
 * Rendered through Puck's `<Render>`, the storefront's path, so the top level is
 * the one `withHideOn` reports and not a stand-in.
 */

const IMAGE = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const MOBILE_IMAGE = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const VIDEO = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const MOBILE_VIDEO = '2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e';
const POSTER = '3d4e5f60-7182-4c9d-8e1f-2a3b4c5d6e7f';

type ProbeProps = HideOnProps & { section?: SectionSettingsValue; label?: string; content?: unknown };

const probe = withHideOn<ProbeProps>({
  fields: { label: { type: 'text' } },
  render: (props: ProbeProps) => (
    <SectionFrame settings={props.section}>
      <p data-probe={props.label}>{props.label}</p>
    </SectionFrame>
  ),
} as unknown as ComponentConfig<{ props: ProbeProps }>) as unknown as ComponentConfig;

const container = withHideOn<ProbeProps>({
  fields: { content: { type: 'slot' } },
  render: (props: ProbeProps) => {
    const Content = props.content as ComponentType | undefined;
    return <div className="container">{Content ? <Content /> : null}</div>;
  },
} as unknown as ComponentConfig<{ props: ProbeProps }>) as unknown as ComponentConfig;

const config: Config = { components: { Probe: probe, Container: container } };

function renderTop(section: SectionSettingsValue | undefined): string {
  return renderData([{ type: 'Probe', props: { id: 'probe-1', label: 'Body', ...(section ? { section } : {}) } }]);
}

function renderData(content: unknown[]): string {
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content: content as never }} />
    </CmsRenderProvider>,
  );
}

/** The opening tag of the first element carrying `className`. */
function openingTag(html: string, className: string): string {
  const match = new RegExp(`<[a-z]+[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`).exec(html);
  if (!match) throw new Error(`no .${className} in\n${html}`);
  return match[0];
}

describe('Section — top level', () => {
  it('renders <section class="cmsc-section"> with the anchor, scheme and width', () => {
    const html = renderTop({ anchor: 'contact', scheme: 'dark', width: 'full' });
    const tag = openingTag(html, 'cmsc-section');
    expect(tag).toMatch(/^<section /);
    expect(tag).toContain('id="contact"');
    expect(tag).toContain('data-cmsb-scheme="dark"');
    expect(tag).toContain('data-width="full"');
    expect(html).toContain('<p data-probe="Body">Body</p>');
  });

  it('sets no scheme attribute for `inherit`, and the contained width by default', () => {
    const tag = openingTag(renderTop({ scheme: 'inherit' }), 'cmsc-section');
    expect(tag).not.toContain('data-cmsb-scheme');
    expect(tag).toContain('data-width="contained"');
    expect(tag).not.toContain(' id=');
  });

  it('renders no id for an anchor outside the grammar', () => {
    const tag = openingTag(renderTop({ anchor: 'Not An Anchor' }), 'cmsc-section');
    expect(tag).not.toContain(' id=');
  });

  it('writes the spacing as padding custom properties per breakpoint, tokens reading --cmsb-space-*', () => {
    const tag = openingTag(
      renderTop({ spaceTop: { base: 'm', desktop: 'xl' }, spaceBottom: { base: { px: 12 }, tablet: 'none' } }),
      'cmsc-section',
    );
    // A token reads the brand variable, with the built-in mobile size below the
    // desktop tier and the desktop size from it (DEFAULT_BRAND_TOKENS.spacing).
    expect(tag).toContain('--cmsc-section-pt:var(--cmsb-space-m, 24px)');
    expect(tag).toContain('--cmsc-section-pt-md:var(--cmsb-space-m, 24px)');
    expect(tag).toContain('--cmsc-section-pt-lg:var(--cmsb-space-xl, 96px)');
    expect(tag).toContain('--cmsc-section-pb:12px');
    expect(tag).toContain('--cmsc-section-pb-md:var(--cmsb-space-none, 0px)');
    expect(tag).toContain('--cmsc-section-pb-lg:var(--cmsb-space-none, 0px)');
  });

  it('falls back to the built-in spacing scale of DEFAULT_BRAND_TOKENS', () => {
    const scale = Object.fromEntries(
      Object.entries(DEFAULT_BRAND_TOKENS.spacing).map(([token, size]) => [token, [size.mobilePx, size.desktopPx]]),
    );
    expect(SECTION_SPACE_FALLBACKS).toEqual(scale);
  });

  it('applies the default spacing (`l`) when the section sets none, and a caller default when given', () => {
    const tag = openingTag(renderTop({}), 'cmsc-section');
    expect(tag).toContain('--cmsc-section-pt:var(--cmsb-space-l, 40px)');
    expect(tag).toContain('--cmsc-section-pb-lg:var(--cmsb-space-l, 64px)');

    const custom = renderToString(
      <SectionFrame settings={undefined} defaults={{ spaceTop: { px: 16 }, spaceBottom: 'none' }}>
        <i />
      </SectionFrame>,
    );
    expect(openingTag(custom, 'cmsc-section')).toContain('--cmsc-section-pt:16px');
    expect(openingTag(custom, 'cmsc-section')).toContain('--cmsc-section-pb:var(--cmsb-space-none, 0px)');
  });

  // T117: the custom max width is one px value (a main-tab field), applied at every breakpoint.
  it('writes the custom width as --cmsc-section-max at every breakpoint', () => {
    const tag = openingTag(renderTop({ width: 'custom', customMaxWidthPx: 880 }), 'cmsc-section');
    expect(tag).toContain('data-width="custom"');
    expect(tag).toContain('--cmsc-section-max:880px');
    expect(tag).toContain('--cmsc-section-max-md:880px');
    expect(tag).toContain('--cmsc-section-max-lg:880px');
  });

  it('wraps the content in one frame after the background layer', () => {
    const html = renderTop({});
    expect(html).toMatch(/<div class="cmsc-section__frame">\s*<p data-probe="Body">/);
  });
});

describe('Section — nested', () => {
  it('renders its children only, ignoring the section settings', () => {
    const html = renderData([
      {
        type: 'Container',
        props: {
          id: 'container-1',
          content: [
            {
              type: 'Probe',
              props: { id: 'probe-2', label: 'Nested', section: { anchor: 'nested', scheme: 'dark', width: 'bleed' } },
            },
          ],
        },
      },
    ]);
    expect(html).toContain('<p data-probe="Nested">Nested</p>');
    expect(html).not.toContain('cmsc-section');
    expect(html).not.toContain('id="nested"');
    expect(html).not.toContain('data-cmsb-scheme');
  });
});

describe('Section — backgrounds (R-9)', () => {
  it('an image renders a positioned Picture with its mobile source, and an overlay element', () => {
    const html = renderTop({
      background: {
        kind: 'image',
        imageSource: 'library',
        imageAssetId: IMAGE,
        mobileImageAssetId: MOBILE_IMAGE,
        position: 'top',
        overlay: { kind: 'gradient', direction: 'to-top', strength: 60 },
      },
    });
    const media = openingTag(html, 'cmsc-section__media');
    expect(media).toContain('aria-hidden="true"');
    expect(html).toMatch(/class="cmsc-section__media"[^>]*><picture class="cmsc-picture cmsc-section__picture"/);
    expect(html).toContain(`<source media="(max-width: 767.98px)" srcSet="https://api.example.com/assets/file/${MOBILE_IMAGE}"/>`);
    expect(html).toContain(`src="https://api.example.com/assets/file/${IMAGE}"`);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('object-position:top');
    const overlay = openingTag(html, 'cmsc-section__overlay');
    expect(overlay).toContain('data-kind="gradient"');
    expect(overlay).toContain('linear-gradient(to top, rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0))');
    expect(openingTag(html, 'cmsc-section')).toContain('data-media="1"');
  });

  it('an image from a URL works too, and no overlay is drawn without one', () => {
    const html = renderTop({ background: { kind: 'image', imageSource: 'url', imageUrl: '/media/wide.jpg' } });
    expect(html).toContain('src="https://api.example.com/media/wide.jpg"');
    expect(html).not.toContain('cmsc-section__overlay');
  });

  it('a solid overlay paints its strength as an opacity of black', () => {
    const html = renderTop({
      background: { kind: 'image', imageUrl: '/a.jpg', overlay: { kind: 'solid', strength: 25 } },
    });
    expect(openingTag(html, 'cmsc-section__overlay')).toContain('background:rgba(0, 0, 0, 0.25)');
  });

  it('a video renders a muted, inline, looping, lazy pair with a poster, one per breakpoint', () => {
    const html = renderTop({
      background: {
        kind: 'video',
        videoSource: 'library',
        videoAssetId: VIDEO,
        mobileVideoAssetId: MOBILE_VIDEO,
        videoPosterAssetId: POSTER,
      },
    });
    const videos = html.match(/<video[^>]*>/g) ?? [];
    expect(videos).toHaveLength(2);
    const [mobile, desktop] = videos as [string, string];
    expect(mobile).toContain('data-bp="mobile"');
    expect(mobile).toContain(`src="https://api.example.com/assets/file/${MOBILE_VIDEO}"`);
    expect(desktop).toContain('data-bp="desktop"');
    expect(desktop).toContain(`src="https://api.example.com/assets/file/${VIDEO}"`);
    for (const video of videos) {
      expect(video).toMatch(/\smuted(=""|\s|>)/);
      expect(video).toContain('playsInline');
      expect(video).toContain('loop');
      expect(video).toContain('preload="none"');
      expect(video).toContain(`poster="https://api.example.com/assets/file/${POSTER}"`);
      // Played by an effect when visible, never by the browser on its own.
      expect(video).not.toContain('autoplay');
      expect(video).not.toContain('autoPlay');
    }
  });

  it('a single video is used at every width', () => {
    const html = renderTop({ background: { kind: 'video', videoSource: 'url', videoUrl: 'https://cdn.example.com/loop.mp4' } });
    const videos = html.match(/<video[^>]*>/g) ?? [];
    expect(videos).toHaveLength(1);
    expect(videos[0]).toContain('data-bp="all"');
  });

  it('a solid or gradient background is painted on the section itself', () => {
    expect(openingTag(renderTop({ background: { kind: 'solid', color: '#1d4ed8' } }), 'cmsc-section')).toContain(
      'background-color:#1d4ed8',
    );
    expect(
      openingTag(renderTop({ background: { kind: 'solid', color: 'token:primary' } }), 'cmsc-section'),
    ).toContain('background-color:var(--cmsb-color-primary, #1261a6)');
    expect(
      openingTag(
        renderTop({ background: { kind: 'gradient', gradientFrom: '#ffffff', gradientTo: '#0f172a', gradientAngle: 90 } }),
        'cmsc-section',
      ),
    ).toContain('background:linear-gradient(90deg, #ffffff, #0f172a)');
  });

  it('`decorative` marks the section, which paints --cmsb-decorative (R-8a)', () => {
    const tag = openingTag(renderTop({ scheme: 'dark', background: { kind: 'none', decorative: true } }), 'cmsc-section');
    expect(tag).toContain('data-decorative="1"');
    const css = readFileSync(new URL('../../styles/cms-components.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    expect(css).toMatch(/\.cmsc-section\[data-decorative='1'\] \{[^}]*background-image: var\(--cmsb-decorative, none\)/);
  });

  // T091 (R-8a, FR-005 as amended): the backdrop is a layer of its own — a
  // chosen solid colour stays under it, and a gradient is drawn beneath it
  // rather than replacing it.
  it('`decorative` keeps a solid colour under the backdrop', () => {
    const tag = openingTag(
      renderTop({ scheme: 'dark', background: { kind: 'solid', color: '#0f172a', decorative: true } }),
      'cmsc-section',
    );
    expect(tag).toContain('data-decorative="1"');
    expect(tag).toContain('background-color:#0f172a');
    expect(tag).not.toMatch(/[";]background:/);
  });

  it('`decorative` over a gradient layers the backdrop above the gradient', () => {
    const tag = openingTag(
      renderTop({
        scheme: 'dark',
        background: { kind: 'gradient', gradientFrom: '#0f172a', gradientTo: '#1d4ed8', gradientAngle: 180, decorative: true },
      }),
      'cmsc-section',
    );
    expect(tag).toContain('background-image:var(--cmsb-decorative, none), linear-gradient(180deg, #0f172a, #1d4ed8)');
    expect(tag).not.toMatch(/[";]background:/);
  });

  it('without `decorative` a gradient is painted as before', () => {
    const tag = openingTag(
      renderTop({ background: { kind: 'gradient', gradientFrom: '#ffffff', gradientTo: '#0f172a', gradientAngle: 90 } }),
      'cmsc-section',
    );
    expect(tag).not.toContain('data-decorative');
    expect(tag).not.toContain('--cmsb-decorative');
  });
});

describe('Section — stylesheet (FR-001, FR-005, standing rule 9)', () => {
  const css = readFileSync(new URL('../../styles/cms-components.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');

  it('offsets an anchored section below the sticky header', () => {
    expect(css).toMatch(/\.cmsc-section \{[^}]*scroll-margin-top: var\(--cmsb-header-offset, 0px\)/);
  });

  it('spaces with padding only, so adjacent sections touch', () => {
    const rule = /\.cmsc-section \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toContain('padding-top: var(--cmsc-section-pt');
    expect(rule).toContain('padding-bottom: var(--cmsc-section-pb');
    expect(rule).not.toMatch(/(^|[\s;])margin(-top|-bottom)?:/);
  });

  it('rebinds the scheme variables with the built-in colours as defaults, in a layer brand tokens override', () => {
    expect(css).toMatch(
      /@layer base \{[^@]*\[data-cmsb-scheme='dark'\] \{[^}]*--cmsb-bg: #0f172a;[^}]*--cmsb-fg: #f8fafc;/,
    );
    expect(css).toMatch(/\.cmsc-section\[data-cmsb-scheme\] \{[^}]*background-color: var\(--cmsb-bg, #ffffff\)/);
  });
});

/**
 * T167 (R10, owner gap list (a)3): an image background and the decorative
 * layer take a size (`cover`, `contain`, `auto`, a width in px or %), a repeat
 * and a focal position. Unset, both render byte for byte as before: the image
 * as a `cover` `<picture>`, the layer by the stylesheet's `cover` from the top
 * centre. `contain` stays a `<picture>`; a natural or fixed size, or a repeat,
 * paints the image as a CSS background of the media layer — the mobile image
 * below the tablet tier, as the `<picture>` does — with the size kept the same
 * at every breakpoint.
 */
describe('Section — background size, repeat and position (T167)', () => {
  const style = (tag: string): string => /style="([^"]*)"/.exec(tag)?.[1] ?? '';

  it('unset: the image is today\'s cover picture and the section carries no background layout', () => {
    const html = renderTop({ background: { kind: 'image', imageSource: 'library', imageAssetId: IMAGE, position: 'top' } });
    expect(html).toContain('<picture class="cmsc-picture cmsc-section__picture"');
    expect(html).toContain('object-fit:cover;object-position:top');
    expect(html).not.toContain('cmsc-section__tile');
    expect(style(openingTag(html, 'cmsc-section'))).not.toMatch(/background-(size|repeat|position)/);
  });

  it('contain keeps the picture, fitted whole', () => {
    const html = renderTop({ background: { kind: 'image', imageSource: 'url', imageUrl: '/media/wide.jpg', size: 'contain', repeat: 'no-repeat' } });
    expect(html).toContain('<picture class="cmsc-picture cmsc-section__picture"');
    expect(html).toContain('object-fit:contain');
    expect(html).not.toContain('cmsc-section__tile');
  });

  it('a fixed width with a repeat paints the image as the media layer\'s background, the mobile image as its own variable', () => {
    const html = renderTop({
      background: {
        kind: 'image',
        imageSource: 'library',
        imageAssetId: IMAGE,
        mobileImageAssetId: MOBILE_IMAGE,
        size: { px: 240 },
        repeat: 'repeat-y',
        position: 'top',
        overlay: { kind: 'solid', strength: 25 },
      },
    });
    expect(html).not.toContain('<picture');
    const tile = openingTag(html, 'cmsc-section__tile');
    expect(openingTag(html, 'cmsc-section__media')).toContain('aria-hidden="true"');
    const css = style(tile);
    expect(css).toContain(`--cmsc-tile-image:url(&quot;https://api.example.com/assets/file/${IMAGE}&quot;)`);
    expect(css).toContain(`--cmsc-tile-image-mobile:url(&quot;https://api.example.com/assets/file/${MOBILE_IMAGE}&quot;)`);
    expect(css).toContain('background-size:240px');
    expect(css).toContain('background-repeat:repeat-y');
    expect(css).toContain('background-position:top center');
    // The overlay still sits above it, in the same media layer.
    expect(html).toMatch(/class="cmsc-section__media"[^>]*><div class="cmsc-section__tile"[^>]*><\/div><div class="cmsc-section__overlay"/);
    expect(openingTag(html, 'cmsc-section')).toContain('data-media="1"');
  });

  it('a width in % or the natural size, from a URL; one image only writes no mobile variable', () => {
    const percent = openingTag(
      renderTop({ background: { kind: 'image', imageSource: 'url', imageUrl: '/media/dots.svg', size: { percent: 50 } } }),
      'cmsc-section__tile',
    );
    expect(style(percent)).toContain('--cmsc-tile-image:url(&quot;https://api.example.com/media/dots.svg&quot;)');
    expect(style(percent)).not.toContain('--cmsc-tile-image-mobile');
    expect(style(percent)).toContain('background-size:50%');
    expect(style(percent)).toContain('background-repeat:no-repeat');
    expect(style(percent)).toContain('background-position:center');
    const auto = openingTag(renderTop({ background: { kind: 'image', imageUrl: '/media/dots.svg', size: 'auto', repeat: 'repeat' } }), 'cmsc-section__tile');
    expect(style(auto)).toContain('background-size:auto');
    expect(style(auto)).toContain('background-repeat:repeat');
    // A cover image that repeats is painted as a background too.
    const coverRepeat = renderTop({ background: { kind: 'image', imageUrl: '/media/dots.svg', repeat: 'repeat-x' } });
    expect(style(openingTag(coverRepeat, 'cmsc-section__tile'))).toContain('background-size:cover');
  });

  it('a URL that could close the CSS string is escaped, not written raw', () => {
    const tile = openingTag(renderTop({ background: { kind: 'image', imageUrl: '/a").png', size: 'auto' } }), 'cmsc-section__tile');
    expect(style(tile)).not.toContain('a&quot;)');
    expect(style(tile)).toContain('/a\\&quot;).png');
  });

  it('the decorative layer\'s size, repeat and position are written on the section, beside the scheme\'s backdrop', () => {
    const tag = openingTag(
      renderTop({
        scheme: 'dark',
        background: { kind: 'solid', color: '#000000', decorative: true, decorativeSize: { px: 720 }, decorativeRepeat: 'repeat-y', decorativePosition: 'top' },
      }),
      'cmsc-section',
    );
    expect(tag).toContain('data-decorative="1"');
    expect(style(tag)).toContain('background-color:#000000');
    expect(style(tag)).toContain('background-size:720px');
    expect(style(tag)).toContain('background-repeat:repeat-y');
    expect(style(tag)).toContain('background-position:top center');
  });

  it('over a gradient, the layer\'s layout is the first of two layers and the gradient keeps today\'s', () => {
    const tag = openingTag(
      renderTop({
        scheme: 'dark',
        background: {
          kind: 'gradient',
          gradientFrom: '#0f172a',
          gradientTo: '#1d4ed8',
          gradientAngle: 180,
          decorative: true,
          decorativeSize: 'contain',
          decorativeRepeat: 'repeat',
        },
      }),
      'cmsc-section',
    );
    expect(style(tag)).toContain('background-image:var(--cmsb-decorative, none), linear-gradient(180deg, #0f172a, #1d4ed8)');
    expect(style(tag)).toContain('background-size:contain, cover');
    expect(style(tag)).toContain('background-repeat:repeat, no-repeat');
    expect(style(tag)).toContain('background-position:top center, top center');
  });

  it('the layer\'s options are ignored without `decorative`, and values outside the grammar are ignored', () => {
    const off = openingTag(renderTop({ scheme: 'dark', background: { kind: 'none', decorativeSize: { px: 720 }, decorativeRepeat: 'repeat' } }), 'cmsc-section');
    expect(style(off)).not.toMatch(/background-(size|repeat|position)/);
    const bad = openingTag(
      renderTop({
        scheme: 'dark',
        background: { kind: 'none', decorative: true, decorativeSize: { px: 99999 }, decorativeRepeat: 'round', decorativePosition: 'middle' } as never,
      }),
      'cmsc-section',
    );
    expect(style(bad)).not.toMatch(/background-(size|repeat|position)/);
    const badImage = renderTop({ background: { kind: 'image', imageUrl: '/a.jpg', size: 'fill', repeat: 'round' } as never });
    expect(badImage).toContain('<picture');
    expect(badImage).not.toContain('cmsc-section__tile');
  });
});
