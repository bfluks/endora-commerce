// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, resolveAllData, type Config, type Data } from '@puckeditor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
 * `specs/163-page-builder-marketing-pages/` T042, US2, FR-011, FR-012,
 * contracts/blocks.md `cms.Hero`, research R-9 to R-11 and R-23 — the hero:
 * media with a mobile alternative, an eyebrow, a title, a subheading and a
 * statement with their own level and size, rich text, any number of buttons
 * and a social-proof line; neutral defaults; a stored hero renders as before.
 *
 * Rendered through Puck's `<Render>`, the storefront's path.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config = defaultPageBuilderConfig as Config;
const heroDefaults = (config.components['cms.Hero']?.defaultProps ?? {}) as Record<string, unknown>;

const IMAGE = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const VIDEO = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const MOBILE_VIDEO = '2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e';
const POSTER = '3d4e5f60-7182-4c9d-8e1f-2a3b4c5d6e7f';

const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function hero(props: Record<string, unknown> = {}, id = 'hero-1'): Data['content'][number] {
  return { type: 'cms.Hero', props: { ...heroDefaults, id, ...props } } as Data['content'][number];
}

function data(content: Data['content']): Data {
  return { root: { props: {} }, content };
}

function html(content: Data['content']): string {
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={data(content)} />
    </CmsRenderProvider>,
  );
}

function dom(content: Data['content']): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html(content);
  return host;
}

function spec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { label: 'Start', link: { kind: 'url', href: '/start' }, style: 'primary', fill: 'solid', size: 'medium', ...overrides };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('cms.Hero (T042)', () => {
  it('default props render a non-empty hero', () => {
    const host = dom([hero()]);
    const root = host.querySelector('.cmsc-pb-hero');
    expect(root).not.toBeNull();
    expect(root!.textContent!.trim().length).toBeGreaterThan(0);
    expect(host.querySelector('h1')?.textContent).toBeTruthy();
  });

  // Coordinator ruling 2026-10-23 (deliberately changed, standing rule 13): the
  // default is start-aligned, as today's hero, not centred; and it sets no
  // `gaps`, so today's spacing between the texts applies.
  it('the default is neutral: no overlay, start-aligned, an h1-sized title, one primary button and no literal colours', () => {
    expect(heroDefaults['media']).toEqual({ kind: 'none' });
    expect(heroDefaults['titleLevel']).toBe('h1');
    expect(heroDefaults['titleSize']).toBe('h1');
    expect(heroDefaults['align']).toBe('start');
    expect(heroDefaults).not.toHaveProperty('gaps');
    expect(heroDefaults).not.toHaveProperty('textColor');
    expect(heroDefaults).not.toHaveProperty('overlay');
    expect(heroDefaults['buttons']).toEqual([expect.objectContaining({ style: 'primary', fill: 'solid', size: 'medium' })]);

    const host = dom([hero()]);
    expect(host.querySelector('.cmsc-pb-hero__overlay')).toBeNull();
    const title = host.querySelector('h1')!;
    expect(title.classList).toContain('cmsc-t--h1');
    expect(host.querySelector('.cmsc-pb-hero__content')?.getAttribute('data-align')).toBe('left');
    expect(host.querySelector('.cmsc-pb-hero__stack')).toBeNull();
    // No inline colour: the text takes the scheme's (today's heading colour with no tokens).
    expect((host.querySelector('.cmsc-pb-hero') as HTMLElement).style.color).toBe('');
    const buttons = host.querySelectorAll('.cmsc-btn');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.classList).toContain('cmsc-btn--primary-solid');
  });

  it('three buttons keep their own styles', () => {
    const host = dom([
      hero({
        buttons: [
          spec({ label: 'One' }),
          spec({ label: 'Two', style: 'secondary', fill: 'outline' }),
          spec({ label: 'Three', style: 'light', fill: 'text', size: 'large' }),
        ],
      }),
    ]);
    const buttons = Array.from(host.querySelectorAll('.cmsc-pb-hero__actions .cmsc-btn'));
    expect(buttons.map((button) => button.textContent)).toEqual(['One', 'Two', 'Three']);
    expect(buttons[0]!.classList).toContain('cmsc-btn--primary-solid');
    expect(buttons[1]!.classList).toContain('cmsc-btn--secondary-outline');
    expect(buttons[2]!.classList).toContain('cmsc-btn--light-text');
    expect(buttons[2]!.classList).toContain('cmsc-btn--large');
  });

  it('an icon-only scroll button pointing at an anchor carries its label as aria-label', () => {
    const host = dom([
      hero({ buttons: [spec({ label: 'Scroll to the next section', icon: 'arrowDown', iconPosition: 'only', link: { kind: 'anchor', anchor: 'next' } })] }),
    ]);
    const button = host.querySelector('.cmsc-pb-hero__actions a')!;
    expect(button.getAttribute('href')).toBe('#next');
    expect(button.getAttribute('aria-label')).toBe('Scroll to the next section');
  });

  it('an image hero first at the top level loads with high priority; a later one lazily', () => {
    const media = { kind: 'image', image: { imageSource: 'library', assetId: IMAGE, alt: 'Team at work' } };
    const host = dom([hero({ media }, 'hero-1'), hero({ media }, 'hero-2')]);
    const images = Array.from(host.querySelectorAll('.cmsc-pb-hero img'));
    expect(images).toHaveLength(2);
    expect(images[0]!.getAttribute('fetchpriority')).toBe('high');
    expect(images[0]!.getAttribute('loading')).toBe('eager');
    expect(images[1]!.getAttribute('fetchpriority')).toBeNull();
    expect(images[1]!.getAttribute('loading')).toBe('lazy');
  });

  it('a hero after another block, or nested, is lazy', () => {
    const media = { kind: 'image', image: { imageSource: 'library', assetId: IMAGE, alt: '' } };
    const afterHeading = dom([
      { type: 'cms.Heading', props: { ...(config.components['cms.Heading']?.defaultProps ?? {}), id: 'heading-1' } } as Data['content'][number],
      hero({ media }),
    ]);
    expect(afterHeading.querySelector('.cmsc-pb-hero img')?.getAttribute('loading')).toBe('lazy');

    const column = config.components['cms.Column']!.defaultProps as Record<string, unknown>;
    const row = config.components['cms.Row']!.defaultProps as Record<string, unknown>;
    const nested = dom([
      {
        type: 'cms.Row',
        props: {
          ...row,
          id: 'row-1',
          content: [{ type: 'cms.Column', props: { ...column, id: 'col-1', content: [hero({ media }, 'hero-nested')] } }],
        },
      } as Data['content'][number],
    ]);
    expect(nested.querySelector('.cmsc-pb-hero img')?.getAttribute('loading')).toBe('lazy');
  });

  it('a hero first inside the page’s first cms.Section leads the page; any other placement is lazy (T113)', () => {
    const media = { kind: 'image', image: { imageSource: 'library', assetId: IMAGE, alt: '' } };
    const sectionDefaults = (config.components['cms.Section']?.defaultProps ?? {}) as Record<string, unknown>;
    const section = (id: string, content: Data['content']): Data['content'][number] =>
      ({ type: 'cms.Section', props: { ...sectionDefaults, id, content } }) as Data['content'][number];
    const loading = (host: HTMLElement): Array<string | null> =>
      Array.from(host.querySelectorAll('.cmsc-pb-hero img')).map((img) => img.getAttribute('fetchpriority') ?? img.getAttribute('loading'));

    expect(loading(dom([section('s-1', [hero({ media }, 'hero-1'), hero({ media }, 'hero-2')])]))).toEqual(['high', 'lazy']);
    expect(loading(dom([section('s-1', []), section('s-2', [hero({ media }, 'hero-1')])]))).toEqual(['lazy']);

    const column = config.components['cms.Column']!.defaultProps as Record<string, unknown>;
    const row = config.components['cms.Row']!.defaultProps as Record<string, unknown>;
    const inRow = dom([
      section('s-1', [
        {
          type: 'cms.Row',
          props: { ...row, id: 'row-1', content: [{ type: 'cms.Column', props: { ...column, id: 'col-1', content: [hero({ media }, 'hero-deep')] } }] },
        } as Data['content'][number],
      ]),
    ]);
    expect(loading(inRow)).toEqual(['lazy']);
  });

  it('the lookup sees through a first top-level cms.SectionGroup to its first Section (T158)', () => {
    const media = { kind: 'image', image: { imageSource: 'library', assetId: IMAGE, alt: '' } };
    const sectionDefaults = (config.components['cms.Section']?.defaultProps ?? {}) as Record<string, unknown>;
    const groupDefaults = (config.components['cms.SectionGroup']?.defaultProps ?? {}) as Record<string, unknown>;
    const section = (id: string, content: Data['content']): Data['content'][number] =>
      ({ type: 'cms.Section', props: { ...sectionDefaults, id, content } }) as Data['content'][number];
    const group = (id: string, content: Data['content']): Data['content'][number] =>
      ({ type: 'cms.SectionGroup', props: { ...groupDefaults, id, content } }) as Data['content'][number];
    const loading = (host: HTMLElement): Array<string | null> =>
      Array.from(host.querySelectorAll('.cmsc-pb-hero img')).map((img) => img.getAttribute('fetchpriority') ?? img.getAttribute('loading'));

    expect(loading(dom([group('g-1', [section('s-1', [hero({ media }, 'hero-1'), hero({ media }, 'hero-2')])])]))).toEqual(['high', 'lazy']);
    expect(loading(dom([group('g-1', [section('s-1', []), section('s-2', [hero({ media }, 'hero-1')])])]))).toEqual(['lazy']);
    expect(loading(dom([section('s-0', []), group('g-1', [section('s-1', [hero({ media }, 'hero-1')])])]))).toEqual(['lazy']);
  });

  it('a video hero renders a breakpoint pair with a poster, loaded on demand and never autoplaying', () => {
    const host = dom([
      hero({ media: { kind: 'video', videoSource: 'library', videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, posterAssetId: POSTER } }),
    ]);
    const videos = Array.from(host.querySelectorAll('.cmsc-pb-hero video'));
    expect(videos.map((video) => video.getAttribute('data-bp'))).toEqual(['mobile', 'desktop']);
    for (const video of videos) {
      expect(video.getAttribute('preload')).toBe('none');
      expect(video.getAttribute('poster')).toBe(`https://api.example.com/assets/file/${POSTER}`);
      expect(video.hasAttribute('autoplay')).toBe(false);
      expect(video.hasAttribute('playsinline')).toBe(true);
      expect(video.hasAttribute('loop')).toBe(true);
    }
    expect(videos[0]!.getAttribute('src')).toBe(`https://api.example.com/assets/file/${MOBILE_VIDEO}`);
    expect(videos[1]!.getAttribute('src')).toBe(`https://api.example.com/assets/file/${VIDEO}`);
  });

  describe('motion', () => {
    let root: Root | null = null;
    let intersect: ((visible: boolean) => void) | null = null;
    const media = { reduced: false };

    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        get matches() {
          return query.includes('reduced-motion') ? media.reduced : false;
        },
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }));
      vi.stubGlobal(
        'IntersectionObserver',
        class {
          constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
            intersect = (visible) => callback([{ isIntersecting: visible }]);
          }
          observe(): void {}
          disconnect(): void {}
        },
      );
      vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { configurable: true, value: false });
        return Promise.resolve();
      });
      vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { configurable: true, value: true });
      });
    });

    afterEach(() => {
      act(() => root?.unmount());
      root = null;
      intersect = null;
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    function mount(): void {
      const host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
      act(() => {
        root!.render(
          <Render
            config={config}
            data={data([hero({ media: { kind: 'video', videoSource: 'library', videoAssetId: VIDEO, posterAssetId: POSTER } })])}
          />,
        );
      });
    }

    it('plays the video once on screen', () => {
      media.reduced = false;
      mount();
      act(() => intersect?.(true));
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });

    it('never plays it for a visitor who prefers reduced motion', () => {
      media.reduced = true;
      mount();
      act(() => intersect?.(true));
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });
  });

  it('separates the level from the size: a paragraph styled as display', () => {
    const host = dom([hero({ title: doc('Big statement'), titleLevel: 'p', titleSize: 'display' })]);
    const title = host.querySelector('.cmsc-pb-hero__title')!;
    expect(title.tagName).toBe('P');
    expect(title.classList).toContain('cmsc-t--display');
    expect(host.querySelector('h1')).toBeNull();
  });

  it('renders the eyebrow, subheading, statement, body and social proof', () => {
    const host = dom([
      hero({
        eyebrow: 'New',
        subheading: doc('A short subheading'),
        statement: doc('A bold statement'),
        statementLevel: 'h2',
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body copy' }] }] },
        socialProof: { image: { imageSource: 'url', src: '/media/avatars.png', alt: '' }, caption: 'Trusted by 2,000 teams' },
      }),
    ]);
    expect(host.querySelector('.cmsc-pb-hero__eyebrow')?.textContent).toBe('New');
    expect(host.querySelector('.cmsc-pb-hero__subheading')?.textContent).toBe('A short subheading');
    expect(host.querySelector('h2.cmsc-pb-hero__statement')?.textContent).toBe('A bold statement');
    expect(host.querySelector('.cmsc-pb-hero__body')?.textContent).toContain('Body copy');
    expect(host.querySelector('.cmsc-pb-hero__proof')?.textContent).toContain('Trusted by 2,000 teams');
    expect(host.querySelector('.cmsc-pb-hero__proof img')?.getAttribute('src')).toBe('https://api.example.com/media/avatars.png');
  });

  it('renders solid and gradient media as today\'s backgrounds', () => {
    const solid = dom([hero({ media: { kind: 'solid', color: '#1d4ed8' } })]).querySelector('.cmsc-pb-hero') as HTMLElement;
    expect(solid.style.backgroundColor).toBe('rgb(29, 78, 216)');
    const gradient = dom([hero({ media: { kind: 'gradient', from: '#0f766e', to: '#134e4a', angle: 135 } })]).querySelector(
      '.cmsc-pb-hero',
    ) as HTMLElement;
    expect(gradient.getAttribute('style')).toContain('linear-gradient(135deg, #0f766e, #134e4a)');
  });

  it('proposes a 40 % solid overlay when image or video media is first chosen, and not after', async () => {
    const resolveData = config.components['cms.Hero']!.resolveData!;
    const image = { kind: 'image', image: { imageSource: 'library', assetId: IMAGE, alt: '' } };
    const chosen = await resolveData(
      { props: { ...heroDefaults, id: 'hero-1', media: image } } as never,
      { changed: { media: true }, lastData: null, metadata: {}, trigger: 'replace', parent: null } as never,
    );
    expect((chosen.props as Record<string, unknown>)['overlay']).toEqual({ kind: 'solid', strength: 40 });

    const kept = await resolveData(
      { props: { ...heroDefaults, id: 'hero-1', media: image, overlay: { kind: 'none', strength: 0 } } } as never,
      { changed: { media: true }, lastData: null, metadata: {}, trigger: 'replace', parent: null } as never,
    );
    expect((kept.props as Record<string, unknown>)['overlay']).toEqual({ kind: 'none', strength: 0 });
  });

  it('a hero stored on origin/master renders as it did: its texts, its button and its look', () => {
    const host = dom([
      {
        type: 'cms.Hero',
        props: {
          id: 'hero-stored',
          heading: 'Grow your B2B sales',
          subtitle: 'Publish landing pages.',
          buttonLabel: 'Get started',
          buttonLinkType: 'url',
          buttonHref: '/start',
          buttonTarget: '_self',
          buttonVariant: 'secondary',
          minHeightPx: 360,
          contentAlign: 'left',
          overlayOpacity: 45,
          textColor: '#ffffff',
          background: { kind: 'gradient', gradientFrom: '#0f766e', gradientTo: '#134e4a', gradientAngle: 135 },
        },
      } as Data['content'][number],
    ]);
    const root = host.querySelector('.cmsc-pb-hero') as HTMLElement;
    expect(root.style.color).toBe('rgb(255, 255, 255)');
    expect(root.getAttribute('style')).toContain('linear-gradient(135deg, #0f766e, #134e4a)');
    const title = host.querySelector('h2.cmsc-pb-hero__heading');
    expect(title?.textContent).toBe('Grow your B2B sales');
    expect(host.querySelector('p.cmsc-pb-hero__subtitle')?.textContent).toBe('Publish landing pages.');
    const overlay = host.querySelector('.cmsc-pb-hero__overlay') as HTMLElement;
    expect(overlay.getAttribute('style')).toContain('0.45');
    expect(host.querySelector('.cmsc-pb-hero__content')?.getAttribute('data-align')).toBe('left');
    const button = host.querySelector('.cmsc-pb-hero__actions a')!;
    expect(button.getAttribute('href')).toBe('/start');
    expect(button.classList).toContain('cmsc-btn--primary-outline');
  });
});

/**
 * T133 (R5, owner gap list (a)9): the editor chooses the order of the hero's
 * elements, and the media can reach past the content frame to the window's
 * edges. Plan § *Extend, don't narrow*: unset, the order is today's and the
 * media stays in the hero, so a stored or a new hero renders as before.
 */
describe('cms.Hero element order and media width (T133)', () => {
  const STYLESHEET = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8');
  const ELEMENT_CLASS: Record<string, string> = {
    'cmsc-pb-hero__eyebrow': 'eyebrow',
    'cmsc-pb-hero__title': 'title',
    'cmsc-pb-hero__subheading': 'subheading',
    'cmsc-pb-hero__statement': 'statement',
    'cmsc-pb-hero__body': 'body',
    'cmsc-pb-hero__actions': 'buttons',
    'cmsc-pb-hero__proof': 'socialProof',
  };
  const everything = {
    eyebrow: 'New',
    subheading: doc('Subheading'),
    statement: doc('Statement'),
    body: doc('Body copy'),
    buttons: [spec()],
    socialProof: { caption: 'Trusted by many teams' },
  };

  function sequence(host: HTMLElement): string[] {
    const content = host.querySelector('.cmsc-pb-hero__content')!;
    return Array.from(content.children).map((child) => {
      const known = Array.from(child.classList).find((name) => name in ELEMENT_CLASS);
      return known ? ELEMENT_CLASS[known]! : child.className;
    });
  }

  it('unset, the elements keep today\'s order', () => {
    expect(sequence(dom([hero(everything)]))).toEqual(['eyebrow', 'title', 'subheading', 'statement', 'body', 'buttons', 'socialProof']);
  });

  it('renders the elements in the chosen order; unlisted ones follow in today\'s order, unknown and repeated entries are ignored', () => {
    const order = ['buttons', 'title', 'nonsense', 'title', 'body'].map((element) => ({ element }));
    expect(sequence(dom([hero({ ...everything, order })]))).toEqual([
      'buttons',
      'title',
      'body',
      'eyebrow',
      'subheading',
      'statement',
      'socialProof',
    ]);
  });

  it('an element left empty is not rendered wherever it is placed', () => {
    const order = [{ element: 'socialProof' }, { element: 'title' }];
    expect(sequence(dom([hero({ order })]))).toEqual(['title', 'buttons']);
  });

  it('offers the order as a list of the seven elements, and the media width beside the placement', () => {
    const fields = config.components['cms.Hero']!.fields as Record<string, { type?: string; arrayFields?: Record<string, { options?: Array<{ value: unknown }> }>; options?: Array<{ value: unknown }>; metadata?: unknown }>;
    const order = fields['order'];
    expect(order?.type).toBe('array');
    expect(order?.arrayFields?.['element']?.options?.map((option) => option.value)).toEqual([
      'eyebrow',
      'title',
      'subheading',
      'statement',
      'body',
      'buttons',
      'socialProof',
    ]);
    expect(fields['mediaWidth']?.options?.map((option) => option.value)).toEqual(['content', 'viewport']);
    expect(heroDefaults['order']).toBeUndefined();
    expect(heroDefaults['mediaWidth']).toBeUndefined();
  });

  it('media width: unset or `content` keeps the media in the hero; `viewport` marks the hero for the edge-to-edge rules', () => {
    const image = { kind: 'image', image: { imageSource: 'url', src: '/media/wide.jpg', alt: '' } };
    for (const mediaWidth of [undefined, 'content']) {
      const root = dom([hero({ media: image, mediaPlacement: 'above', ...(mediaWidth ? { mediaWidth } : {}) })]).querySelector('.cmsc-pb-hero')!;
      expect(root.classList.contains('cmsc-pb-hero--media-viewport')).toBe(false);
    }
    const root = dom([hero({ media: image, mediaPlacement: 'above', mediaWidth: 'viewport' })]).querySelector('.cmsc-pb-hero')!;
    expect(root.classList.contains('cmsc-pb-hero--media-viewport')).toBe(true);
    // Without image or video there is nothing to widen.
    expect(
      dom([hero({ media: { kind: 'solid', color: '#0f172a' }, mediaWidth: 'viewport' })])
        .querySelector('.cmsc-pb-hero')!
        .classList.contains('cmsc-pb-hero--media-viewport'),
    ).toBe(false);
  });

  it('the stylesheet widens the media to the window, above or behind the content, and not in the editor canvas', () => {
    const css = STYLESHEET.replace(/\s+/g, ' ');
    expect(css).toMatch(/\.cmsc-pb-hero--media-viewport \{[^}]*overflow: visible/);
    expect(css).toMatch(
      /\.cmsc-pb-hero--media-viewport \.cmsc-pb-hero__media--above \{[^}]*width: 100vw;[^}]*margin-left: calc\(50% - 50vw\)/,
    );
    expect(css).toMatch(
      /\.cmsc-pb-hero--media-viewport \.cmsc-pb-hero__media:not\(\.cmsc-pb-hero__media--above\),[^{]*\.cmsc-pb-hero__overlay \{[^}]*left: calc\(50% - 50vw\);[^}]*right: calc\(50% - 50vw\)/,
    );
    expect(css).toMatch(/\[data-puck-entry\] \.cmsc-pb-hero--media-viewport \.cmsc-pb-hero__media/);
  });

  it('buttons or the social proof placed before another element keep today\'s 20 px above what follows', () => {
    const css = STYLESHEET.replace(/\s+/g, ' ');
    expect(css).toMatch(
      /\.cmsc-pb-hero__content:not\(\.cmsc-pb-hero__stack\) > :is\(\.cmsc-pb-hero__actions, \.cmsc-pb-hero__proof\):not\(:last-child\) \{ margin-bottom: 20px; \}/,
    );
    expect(css).toMatch(/\.cmsc-pb-hero__content:not\(\.cmsc-pb-hero__stack\) > \.cmsc-pb-hero__proof:first-child \{ margin-top: 0; \}/);
  });
});

describe('cms.Hero mobile video by URL (T142)', () => {
  it('a URL video takes a mobile URL: the breakpoint pair, loaded on demand, never autoplaying', () => {
    const host = dom([
      hero({
        media: {
          kind: 'video',
          videoSource: 'url',
          videoUrl: 'https://cdn.example.com/wide.mp4',
          mobileVideoUrl: 'https://cdn.example.com/square.mp4',
        },
      }),
    ]);
    const videos = Array.from(host.querySelectorAll('.cmsc-pb-hero video'));
    expect(videos.map((video) => video.getAttribute('data-bp'))).toEqual(['mobile', 'desktop']);
    expect(videos.map((video) => video.getAttribute('src'))).toEqual(['https://cdn.example.com/square.mp4', 'https://cdn.example.com/wide.mp4']);
    for (const video of videos) {
      expect(video.getAttribute('preload')).toBe('none');
      expect(video.hasAttribute('autoplay')).toBe(false);
    }
  });

  it('a library video keeps its mobile library video before a mobile URL, and takes the URL without one', () => {
    const both = dom([
      hero({
        media: { kind: 'video', videoSource: 'library', videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, mobileVideoUrl: '/m.mp4' },
      }),
    ]);
    expect(both.querySelector('video[data-bp="mobile"]')?.getAttribute('src')).toBe(`https://api.example.com/assets/file/${MOBILE_VIDEO}`);
    const urlOnly = dom([hero({ media: { kind: 'video', videoSource: 'library', videoAssetId: VIDEO, mobileVideoUrl: '/m.mp4' } })]);
    expect(urlOnly.querySelector('video[data-bp="mobile"]')?.getAttribute('src')).toBe('https://api.example.com/m.mp4');
  });
});

/**
 * T162 (R9, owner gap list (a)6): the hero's mobile video takes a poster of its
 * own, from the library or by URL (the library one wins); one video with its
 * own mobile poster is rendered once per breakpoint. Without one, today's.
 */
describe('cms.Hero mobile poster (T162)', () => {
  const MOBILE_POSTER = '4e5f6071-8293-4dae-9f20-3b4c5d6e7f80';
  const asset = (id: string): string => `https://api.example.com/assets/file/${id}`;
  const posters = (host: HTMLElement): Array<[string | null, string | null, string | null]> =>
    Array.from(host.querySelectorAll('.cmsc-pb-hero video')).map((v) => [v.getAttribute('data-bp'), v.getAttribute('src'), v.getAttribute('poster')]);
  const pair = { kind: 'video', videoSource: 'library', videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, posterAssetId: POSTER };

  it('no mobile poster: the poster on both videos, as before', () => {
    expect(posters(dom([hero({ media: pair })]))).toEqual([
      ['mobile', asset(MOBILE_VIDEO), asset(POSTER)],
      ['desktop', asset(VIDEO), asset(POSTER)],
    ]);
  });

  it('the mobile video takes the library mobile poster, or a URL one made absolute; the library one wins', () => {
    expect(posters(dom([hero({ media: { ...pair, mobilePosterAssetId: MOBILE_POSTER } })]))[0]).toEqual(['mobile', asset(MOBILE_VIDEO), asset(MOBILE_POSTER)]);
    expect(posters(dom([hero({ media: { ...pair, mobilePosterUrl: '/media/tall.jpg' } })]))[0]).toEqual([
      'mobile',
      asset(MOBILE_VIDEO),
      'https://api.example.com/media/tall.jpg',
    ]);
    expect(posters(dom([hero({ media: { ...pair, mobilePosterUrl: '/media/tall.jpg', mobilePosterAssetId: MOBILE_POSTER } })]))[0]![2]).toBe(asset(MOBILE_POSTER));
    expect(posters(dom([hero({ media: { ...pair, mobilePosterAssetId: MOBILE_POSTER } })]))[1]).toEqual(['desktop', asset(VIDEO), asset(POSTER)]);
  });

  it('one video with its own mobile poster: the same file once per breakpoint', () => {
    const host = dom([hero({ media: { kind: 'video', videoSource: 'url', videoUrl: 'https://cdn.example.com/wide.mp4', posterAssetId: POSTER, mobilePosterUrl: 'https://cdn.example.com/tall.jpg' } })]);
    expect(posters(host)).toEqual([
      ['mobile', 'https://cdn.example.com/wide.mp4', 'https://cdn.example.com/tall.jpg'],
      ['desktop', 'https://cdn.example.com/wide.mp4', asset(POSTER)],
    ]);
    for (const v of Array.from(host.querySelectorAll('video'))) expect(v.getAttribute('preload')).toBe('none');
  });
});

describe('cms.Hero space after each element (T145)', () => {
  const STYLESHEET = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css'), 'utf8');
  const texts = { subheading: doc('Sub'), statement: doc('Statement') };

  it('unset, the content carries nothing new: today\'s spacing', () => {
    const content = dom([hero(texts)]).querySelector<HTMLElement>('.cmsc-pb-hero__content')!;
    expect(content.hasAttribute('data-space-after')).toBe(false);
    expect(content.getAttribute('style') ?? '').not.toContain('--cmsc-hero-after');
  });

  it('names each spaced element and writes its space per breakpoint: a token with its built-in px, or Custom px', () => {
    const content = dom([
      hero({
        ...texts,
        spaceAfter: [
          { element: 'subheading', space: 'xl' },
          { element: 'title', space: 'custom', spacePx: 6 },
          { element: 'title', space: 'l' },
          { element: 'nonsense', space: 'l' },
        ],
      }),
    ]).querySelector<HTMLElement>('.cmsc-pb-hero__content')!;
    expect(content.getAttribute('data-space-after')).toBe('title subheading');
    expect(content.style.getPropertyValue('--cmsc-hero-after-title')).toBe('6px');
    expect(content.style.getPropertyValue('--cmsc-hero-after-title-lg')).toBe('6px');
    expect(content.style.getPropertyValue('--cmsc-hero-after-subheading')).toBe('var(--cmsb-space-xl, 56px)');
    expect(content.style.getPropertyValue('--cmsc-hero-after-subheading-lg')).toBe('var(--cmsb-space-xl, 96px)');
  });

  it('an item without a space, or with an unknown one, is ignored', () => {
    const content = dom([hero({ ...texts, spaceAfter: [{ element: 'title' }, { element: 'subheading', space: 'huge' }] })]).querySelector<HTMLElement>(
      '.cmsc-pb-hero__content',
    )!;
    expect(content.hasAttribute('data-space-after')).toBe(false);
  });

  it('T193: offers the space in the list of elements — Default, every token and Custom — with its Custom px; no list of its own', () => {
    const fields = (config.components['cms.Hero']!.fields ?? {}) as Record<string, { type: string; arrayFields?: Record<string, { options?: Array<{ value: unknown }> }> }>;
    expect(fields['spaceAfter']).toBeUndefined();
    const field = fields['order']!;
    expect(field.type).toBe('array');
    expect(field.arrayFields!['element']!.options!.map((option) => option.value)).toEqual([
      'eyebrow', 'title', 'subheading', 'statement', 'body', 'buttons', 'socialProof',
    ]);
    expect(field.arrayFields!['space']!.options!.map((option) => option.value)).toEqual(['default', 'none', 'xs', 's', 'm', 'l', 'xl', 'xxl', 'custom']);
    expect(Object.keys(field.arrayFields!)).toContain('spacePx');
  });

  it('the stylesheet puts the space below a named element and none above the next, per breakpoint, in either spacing mode', () => {
    const css = STYLESHEET.replace(/\s+/g, ' ');
    for (const [element, cls] of [
      ['eyebrow', 'eyebrow'], ['title', 'title'], ['subheading', 'subheading'], ['statement', 'statement'],
      ['body', 'body'], ['buttons', 'actions'], ['socialProof', 'proof'],
    ] as const) {
      expect(css, element).toContain(
        `.cmsc-pb-hero__content[data-space-after~='${element}'] > .cmsc-pb-hero__${cls}:not(:last-child) { margin-bottom: var(--cmsc-hero-after-${element}); }`,
      );
      expect(css, `${element} lg`).toMatch(
        new RegExp(`@media \\(min-width: 1024px\\) \\{[^@]*\\.cmsc-pb-hero__content\\[data-space-after~='${element}'\\] > \\.cmsc-pb-hero__${cls}:not\\(:last-child\\) \\{ margin-bottom: var\\(--cmsc-hero-after-${element}-lg, var\\(--cmsc-hero-after-${element}\\)\\); \\}`),
      );
      expect(css, `${element} next`).toMatch(new RegExp(`\\.cmsc-pb-hero__content\\[data-space-after~='${element}'\\] > \\.cmsc-pb-hero__${cls} \\+ \\*`));
    }
  });
});

/**
 * T193 (owner review 2026-10-27): the order of the elements and the space after
 * each are one list, `order: [{element, space?, spacePx?}]`. A stored
 * `spaceAfter` is still read for an element whose item has no space, so a
 * stored page renders as it did; the editor carries it into the list once.
 */
describe('cms.Hero elements: order and spacing in one list (T193)', () => {
  const texts = { subheading: doc('Sub'), statement: doc('Statement'), buttons: [spec()] };
  const contentOf = (props: Record<string, unknown>): HTMLElement =>
    dom([hero({ ...texts, ...props })]).querySelector<HTMLElement>('.cmsc-pb-hero__content')!;

  it('an item\'s own space is written as a stored `spaceAfter` entry was, names in today\'s element order', () => {
    const merged = contentOf({
      order: [
        { element: 'buttons', space: 'xxl' },
        { element: 'title', space: 'custom', spacePx: 6 },
        { element: 'subheading', space: 'default' },
      ],
    });
    const legacy = contentOf({
      order: [{ element: 'buttons' }, { element: 'title' }, { element: 'subheading' }],
      spaceAfter: [
        { element: 'buttons', space: 'xxl' },
        { element: 'title', space: 'custom', spacePx: 6 },
      ],
    });
    expect(merged.getAttribute('data-space-after')).toBe('title buttons');
    expect(merged.getAttribute('style')).toBe(legacy.getAttribute('style'));
    expect(merged.getAttribute('data-space-after')).toBe(legacy.getAttribute('data-space-after'));
    expect(merged.style.getPropertyValue('--cmsc-hero-after-buttons-lg')).toBe('var(--cmsb-space-xxl, 128px)');
  });

  it('a stored `spaceAfter` still counts for an element whose item has no space; an item\'s own space wins', () => {
    const content = contentOf({
      order: [{ element: 'title', space: 's' }, { element: 'buttons' }],
      spaceAfter: [
        { element: 'title', space: 'xl' },
        { element: 'buttons', space: 'l' },
      ],
    });
    expect(content.getAttribute('data-space-after')).toBe('title buttons');
    expect(content.style.getPropertyValue('--cmsc-hero-after-title')).toBe('var(--cmsb-space-s, 16px)');
    expect(content.style.getPropertyValue('--cmsc-hero-after-buttons')).toMatch(/^var\(--cmsb-space-l, /);
  });

  it('the editor carries a stored `spaceAfter` into the full effective order once: same order, same spacing, same markup', async () => {
    const stored = {
      ...heroDefaults,
      ...texts,
      id: 'hero-carry',
      order: [{ element: 'title' }, { element: 'buttons' }, { element: 'statement' }],
      spaceAfter: [{ element: 'buttons', space: 'xxl' }, { element: 'eyebrow', space: 'l' }, { element: 'nonsense', space: 'l' }],
    };
    const resolved = (await config.components['cms.Hero']!.resolveData!({ props: stored } as never, { changed: {} } as never)) as {
      props: Record<string, unknown>;
    };
    expect(resolved.props['spaceAfter']).toBeUndefined();
    expect(resolved.props['order']).toEqual([
      { element: 'title' },
      { element: 'buttons', space: 'xxl' },
      { element: 'statement' },
      { element: 'eyebrow', space: 'l' },
      { element: 'subheading' },
      { element: 'body' },
      { element: 'socialProof' },
    ]);
    expect(html([{ type: 'cms.Hero', props: resolved.props } as Data['content'][number]])).toBe(
      html([{ type: 'cms.Hero', props: stored } as Data['content'][number]]),
    );
  });

  it('an empty `order` with a stored `spaceAfter` becomes today\'s full order with the spaces attached', async () => {
    const stored = { ...heroDefaults, ...texts, id: 'hero-empty', spaceAfter: [{ element: 'statement', space: 'custom', spacePx: 40 }] };
    const resolved = (await config.components['cms.Hero']!.resolveData!({ props: stored } as never, { changed: {} } as never)) as {
      props: Record<string, unknown>;
    };
    expect((resolved.props['order'] as Array<{ element: string }>).map((item) => item.element)).toEqual([
      'eyebrow', 'title', 'subheading', 'statement', 'body', 'buttons', 'socialProof',
    ]);
    expect((resolved.props['order'] as Array<Record<string, unknown>>)[3]).toEqual({ element: 'statement', space: 'custom', spacePx: 40 });
    expect(html([{ type: 'cms.Hero', props: resolved.props } as Data['content'][number]])).toBe(
      html([{ type: 'cms.Hero', props: stored } as Data['content'][number]]),
    );
  });

  it('through Puck\'s own resolution (which merges the resolved props over the stored ones) the list is gone', async () => {
    const stored = {
      ...heroDefaults,
      ...texts,
      id: 'hero-puck',
      order: [{ element: 'buttons' }],
      spaceAfter: [{ element: 'buttons', space: 'xxl' }],
    };
    const resolved = await resolveAllData(data([{ type: 'cms.Hero', props: stored } as Data['content'][number]]), config);
    const props = (resolved.content[0] as { props: Record<string, unknown> }).props;
    expect(props['spaceAfter']).toBeUndefined();
    expect(JSON.parse(JSON.stringify(props))).not.toHaveProperty('spaceAfter');
    expect((props['order'] as Array<Record<string, unknown>>)[0]).toEqual({ element: 'buttons', space: 'xxl' });
  });

  it('a hero with no `spaceAfter` is left as it is', async () => {
    const stored = { ...heroDefaults, id: 'hero-plain', order: [{ element: 'buttons' }] };
    const resolved = (await config.components['cms.Hero']!.resolveData!({ props: stored } as never, { changed: {} } as never)) as {
      props: Record<string, unknown>;
    };
    expect(resolved.props['order']).toEqual([{ element: 'buttons' }]);
    expect(resolved.props).not.toHaveProperty('spaceAfter');
  });
});

/**
 * T192 (owner review 2026-10-27): the overlay offers its direction for a
 * gradient only and its strength for a solid or gradient overlay; with None,
 * only its type. The field objects are stable, so Puck keeps the focus.
 */
describe('cms.Hero overlay fields follow its type (T192)', () => {
  const block = config.components['cms.Hero']!;
  const resolve = async (overlay: unknown): Promise<Record<string, { objectFields?: Record<string, unknown>; label?: string }>> =>
    (await block.resolveFields!(
      { props: { ...heroDefaults, id: 'hero-o', ...(overlay === undefined ? {} : { overlay }) } } as never,
      { fields: block.fields, lastFields: block.fields, changed: {}, lastData: null, metadata: {}, appState: {}, parent: null } as never,
    )) as never;

  it('None or unset: the type only; solid: type and strength; gradient: type, direction and strength', async () => {
    expect(Object.keys((await resolve(undefined))['overlay']!.objectFields!)).toEqual(['kind']);
    expect(Object.keys((await resolve({ kind: 'none', strength: 0 }))['overlay']!.objectFields!)).toEqual(['kind']);
    expect(Object.keys((await resolve({ kind: 'solid', strength: 40 }))['overlay']!.objectFields!)).toEqual(['kind', 'strength']);
    expect(Object.keys((await resolve({ kind: 'gradient' }))['overlay']!.objectFields!)).toEqual(['kind', 'direction', 'strength']);
  });

  it('hands Puck the same field object for the same type', async () => {
    expect((await resolve({ kind: 'solid' }))['overlay']).toBe((await resolve({ kind: 'solid', strength: 10 }))['overlay']);
    expect((await resolve({ kind: 'gradient' }))['overlay']).toBe((await resolve({ kind: 'gradient', direction: 'to-left' }))['overlay']);
  });

  it('labels the selects "Type" and says what the overlay does', () => {
    const fields = block.fields as Record<string, { label?: string; objectFields?: Record<string, { label?: string }> }>;
    expect(fields['overlay']!.label).toBe('Overlay (darkens the background media)');
    expect(fields['overlay']!.objectFields!['kind']!.label).toBe('Type');
    expect(fields['media']!.objectFields!['kind']!.label).toBe('Type');
  });
});

/**
 * T191 (owner review 2026-10-27): the poster has a source of its own, like the
 * video — a library image or a URL (`posterUrl`, made absolute). Unset, the
 * library image wins over a URL; with the URL source the URL does.
 */
describe('cms.Hero poster by URL (T191)', () => {
  const MOBILE_POSTER = '4e5f6071-8293-4dae-9f20-3b4c5d6e7f80';
  const asset = (id: string): string => `https://api.example.com/assets/file/${id}`;
  const posters = (media: Record<string, unknown>): Array<[string | null, string | null]> =>
    Array.from(dom([hero({ media: { kind: 'video', videoSource: 'library', videoAssetId: VIDEO, ...media } })]).querySelectorAll('.cmsc-pb-hero video')).map(
      (v) => [v.getAttribute('data-bp'), v.getAttribute('poster')],
    );

  it('a poster URL, made absolute, on the video', () => {
    expect(posters({ posterUrl: '/media/wide.jpg' })).toEqual([['all', 'https://api.example.com/media/wide.jpg']]);
  });

  it('unset or library source: the library poster wins over the URL', () => {
    expect(posters({ posterAssetId: POSTER, posterUrl: '/media/wide.jpg' })).toEqual([['all', asset(POSTER)]]);
    expect(posters({ posterSource: 'library', posterAssetId: POSTER, posterUrl: '/media/wide.jpg' })).toEqual([['all', asset(POSTER)]]);
  });

  it('URL source: the URLs win, the library images remain the fallback', () => {
    expect(
      posters({ posterSource: 'url', posterAssetId: POSTER, posterUrl: '/media/wide.jpg', mobilePosterAssetId: MOBILE_POSTER, mobilePosterUrl: '/media/tall.jpg' }),
    ).toEqual([
      ['mobile', 'https://api.example.com/media/tall.jpg'],
      ['desktop', 'https://api.example.com/media/wide.jpg'],
    ]);
    expect(posters({ posterSource: 'url', posterAssetId: POSTER })).toEqual([['all', asset(POSTER)]]);
  });

  it('the plain media field offers the poster source and its URL', () => {
    const media = (config.components['cms.Hero']!.fields as Record<string, { objectFields?: Record<string, { options?: Array<{ value: unknown }> }> }>)['media']!;
    expect(media.objectFields!['posterSource']!.options!.map((option) => option.value)).toEqual(['library', 'url']);
    expect(Object.keys(media.objectFields!)).toEqual(expect.arrayContaining(['posterAssetId', 'posterUrl', 'mobilePosterAssetId', 'mobilePosterUrl']));
  });
});
