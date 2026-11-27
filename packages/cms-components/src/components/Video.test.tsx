// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data, type Fields } from '@puckeditor/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isResponsiveField } from '@endora-commerce/page-builder-core';
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
 * `specs/163-page-builder-marketing-pages/` T126, US2, research R-9 —
 * `cms.Video` plays a self-hosted file as well as an embed.
 *
 * Extend, don't narrow: a video stored on `origin/master` (no `source`) is an
 * embed and renders today's markup; the aspect ratio keeps its three values
 * and gains every aspect token and a value per breakpoint. A file video is a
 * pair per breakpoint (`data-bp`), muted, inline, `preload="none"` with a
 * poster, never the `autoplay` attribute: an autoplaying one is started on
 * screen by `useBreakpointVideo`, and never under reduced motion.
 *
 * Rendered through Puck's `<Render>`, the storefront's path.
 */

const config = defaultPageBuilderConfig as Config;
const block = config.components['cms.Video'] as unknown as ComponentConfig;
const defaults = (block.defaultProps ?? {}) as Record<string, unknown>;

const STYLESHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/cms-components.css');

const VIDEO = '1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d';
const MOBILE_VIDEO = '2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e';
const POSTER = '3d4e5f60-7182-4c9d-8e1f-2a3b4c5d6e7f';
const asset = (id: string): string => `https://api.example.com/assets/file/${id}`;

function video(props: Record<string, unknown> = {}): Data['content'][number] {
  return { type: 'cms.Video', props: { ...defaults, id: 'video-1', ...props } } as Data['content'][number];
}

function dom(content: Data['content']): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={{ root: { props: {} }, content }} />
    </CmsRenderProvider>,
  );
  return host;
}

async function fieldsFor(props: Record<string, unknown>): Promise<Fields> {
  const fields = block.fields as Fields;
  if (!block.resolveFields) return fields;
  return block.resolveFields(
    { props: { id: 'video-1', ...defaults, ...props } } as never,
    { parent: null, fields, lastFields: fields, changed: {}, lastData: null, metadata: {}, appState: {} } as never,
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('cms.Video — an embed, as on origin/master', () => {
  it('a video stored on origin/master (no source) renders today\'s iframe in a 16:9 padded frame', () => {
    const host = dom([
      video({ source: undefined, url: 'https://www.youtube.com/watch?v=abc123', aspectRatio: '16:9', title: 'Product tour' }),
    ]);
    const iframe = host.querySelector('.cmsc-pb-video iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('src')).toContain('youtube');
    expect(iframe!.getAttribute('title')).toBe('Product tour');
    const frame = iframe!.parentElement as HTMLElement;
    expect(frame.style.paddingTop).toBe('56.25%');
    expect(host.querySelector('video')).toBeNull();
  });

  it('keeps today\'s defaults and starts as an embed', () => {
    expect(defaults).toMatchObject({
      source: 'embed',
      url: '',
      provider: 'auto',
      aspectRatio: '16:9',
      title: 'Video',
      autoplay: false,
      muted: false,
      loop: false,
      controls: true,
      maxWidth: 100,
      align: 'center',
    });
  });

  it('an embed takes any aspect token: a custom w:h as a padded frame', () => {
    const host = dom([video({ url: 'https://vimeo.com/123', aspectRatio: '67:20' })]);
    const frame = host.querySelector('.cmsc-pb-video iframe')!.parentElement as HTMLElement;
    expect(frame.style.paddingTop).toBe(`${(20 / 67) * 100}%`);
  });

  it('an embed with a ratio per breakpoint writes the ratio variables and no padding', () => {
    const host = dom([video({ url: 'https://vimeo.com/123', aspectRatio: { base: '1:1', desktop: '21:9' } })]);
    const frame = host.querySelector('.cmsc-pb-video iframe')!.parentElement as HTMLElement;
    expect(frame.classList).toContain('cmsc-pb-video__frame');
    expect(frame.style.paddingTop).toBe('');
    expect(frame.style.getPropertyValue('--pb-ratio')).toBe('1 / 1');
    expect(frame.style.getPropertyValue('--pb-ratio-md')).toBe('1 / 1');
    expect(frame.style.getPropertyValue('--pb-ratio-lg')).toBe('21 / 9');
  });
});

describe('cms.Video — a self-hosted file (T126)', () => {
  it('a library video with a mobile video and a poster renders a breakpoint pair, loaded on demand', () => {
    const host = dom([
      video({
        source: 'file',
        videoAssetId: VIDEO,
        mobileVideoAssetId: MOBILE_VIDEO,
        posterAssetId: POSTER,
        aspectRatio: { base: '1:1', desktop: '67:20' },
        title: 'Factory floor',
      }),
    ]);
    expect(host.querySelector('iframe')).toBeNull();
    const videos = Array.from(host.querySelectorAll<HTMLVideoElement>('.cmsc-pb-video video'));
    expect(videos.map((v) => v.getAttribute('data-bp'))).toEqual(['mobile', 'desktop']);
    expect(videos.map((v) => v.getAttribute('src'))).toEqual([asset(MOBILE_VIDEO), asset(VIDEO)]);
    for (const v of videos) {
      expect(v.getAttribute('preload')).toBe('none');
      expect(v.getAttribute('poster')).toBe(asset(POSTER));
      expect(v.hasAttribute('playsinline')).toBe(true);
      expect(v.hasAttribute('autoplay')).toBe(false);
      // Not autoplaying: the visitor starts it with today's default controls.
      expect(v.hasAttribute('controls')).toBe(true);
      expect(v.getAttribute('aria-label')).toBe('Factory floor');
    }
    // The frame reserves its ratio per breakpoint before anything loads.
    const frame = host.querySelector('.cmsc-pb-video__frame') as HTMLElement;
    expect(frame).not.toBeNull();
    expect(frame.style.getPropertyValue('--pb-ratio')).toBe('1 / 1');
    expect(frame.style.getPropertyValue('--pb-ratio-lg')).toBe('67 / 20');
  });

  it('an autoplaying file is muted, looped as asked, marked for the breakpoint effect, and never carries autoplay', () => {
    const host = dom([
      video({ source: 'file', videoAssetId: VIDEO, autoplay: true, muted: false, loop: true, controls: false }),
    ]);
    const v = host.querySelector<HTMLVideoElement>('.cmsc-pb-video video')!;
    expect(v.getAttribute('data-bp')).toBe('all');
    expect(v.hasAttribute('data-autoplay')).toBe(true);
    expect(v.hasAttribute('autoplay')).toBe(false);
    expect(v.hasAttribute('loop')).toBe(true);
    expect(v.hasAttribute('controls')).toBe(false);
    // React writes `muted` as a property; the server HTML carries it as an attribute.
    expect(v.outerHTML).toContain('muted');
    // The default ratio frame is today's 16:9.
    expect((host.querySelector('.cmsc-pb-video__frame') as HTMLElement).style.getPropertyValue('--pb-ratio')).toBe('16 / 9');
  });

  it('a file given by URL plays that file when no library video is chosen', () => {
    const host = dom([video({ source: 'file', url: 'https://cdn.example.com/clip.mp4' })]);
    const v = host.querySelector<HTMLVideoElement>('.cmsc-pb-video video')!;
    expect(v.getAttribute('src')).toBe('https://cdn.example.com/clip.mp4');
    expect(v.getAttribute('data-bp')).toBe('all');
  });

  it('a file source with nothing chosen renders no player on the page', () => {
    const host = dom([video({ source: 'file' })]);
    expect(host.querySelector('video')).toBeNull();
    expect(host.querySelector('iframe')).toBeNull();
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

    function mount(props: Record<string, unknown>): void {
      const host = document.createElement('div');
      document.body.appendChild(host);
      root = createRoot(host);
      act(() => {
        root!.render(<Render config={config} data={{ root: { props: {} }, content: [video(props)] }} />);
      });
    }

    it('starts an autoplaying file once it is on screen', () => {
      media.reduced = false;
      mount({ source: 'file', videoAssetId: VIDEO, autoplay: true });
      act(() => intersect?.(true));
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    });

    it('never starts it for a visitor who prefers reduced motion', () => {
      media.reduced = true;
      mount({ source: 'file', videoAssetId: VIDEO, autoplay: true });
      act(() => intersect?.(true));
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });

    it('never starts a file that is not set to autoplay', () => {
      media.reduced = false;
      mount({ source: 'file', videoAssetId: VIDEO, autoplay: false });
      act(() => intersect?.(true));
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });

    it('T142: a pair given by URL starts on screen, and never under reduced motion', () => {
      const pair = { source: 'file', url: 'https://cdn.example.com/wide.mp4', mobileUrl: 'https://cdn.example.com/square.mp4', autoplay: true };
      media.reduced = false;
      mount(pair);
      act(() => intersect?.(true));
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
      act(() => root?.unmount());
      root = null;
      vi.mocked(HTMLMediaElement.prototype.play).mockClear();
      media.reduced = true;
      mount(pair);
      act(() => intersect?.(true));
      expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    });
  });
});

describe('cms.Video — a mobile video by URL (T142)', () => {
  it('a desktop and a mobile URL render the breakpoint pair', () => {
    const host = dom([
      video({ source: 'file', url: 'https://cdn.example.com/wide.mp4', mobileUrl: 'https://cdn.example.com/square.mp4' }),
    ]);
    const videos = Array.from(host.querySelectorAll<HTMLVideoElement>('.cmsc-pb-video video'));
    expect(videos.map((v) => v.getAttribute('data-bp'))).toEqual(['mobile', 'desktop']);
    expect(videos.map((v) => v.getAttribute('src'))).toEqual(['https://cdn.example.com/square.mp4', 'https://cdn.example.com/wide.mp4']);
    for (const v of videos) expect(v.getAttribute('preload')).toBe('none');
  });

  it('a library video takes a mobile URL; a mobile library video wins over the URL', () => {
    const byUrl = dom([video({ source: 'file', videoAssetId: VIDEO, mobileUrl: 'https://cdn.example.com/square.mp4' })]);
    expect(Array.from(byUrl.querySelectorAll('.cmsc-pb-video video')).map((v) => v.getAttribute('src'))).toEqual([
      'https://cdn.example.com/square.mp4',
      asset(VIDEO),
    ]);
    const both = dom([
      video({ source: 'file', videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, mobileUrl: 'https://cdn.example.com/square.mp4' }),
    ]);
    expect(Array.from(both.querySelectorAll('.cmsc-pb-video video')).map((v) => v.getAttribute('src'))).toEqual([
      asset(MOBILE_VIDEO),
      asset(VIDEO),
    ]);
  });

  it('a relative mobile URL is made absolute against the media origin, as the desktop URL is', () => {
    const host = dom([video({ source: 'file', url: '/media/wide.mp4', mobileUrl: '/media/square.mp4' })]);
    expect(Array.from(host.querySelectorAll('.cmsc-pb-video video')).map((v) => v.getAttribute('src'))).toEqual([
      'https://api.example.com/media/square.mp4',
      'https://api.example.com/media/wide.mp4',
    ]);
  });

  it('offers the mobile URL for a file only (T194: from the URL file source)', async () => {
    expect(Object.keys(await fieldsFor({ source: 'file', fileSource: 'url' }))).toContain('mobileUrl');
    expect(Object.keys(await fieldsFor({ source: 'file', mobileUrl: '/media/tall.mp4' }))).toContain('mobileUrl');
    expect(Object.keys(await fieldsFor({ source: 'embed' }))).not.toContain('mobileUrl');
  });
});

/**
 * T162 (R9, owner gap list (a)6): a poster of its own for the video shown below
 * the tablet tier, a library image or a URL (the library one wins), so a mobile
 * video of another ratio does not show the desktop frame cropped before it
 * plays. One video with its own mobile poster renders the file twice, one per
 * breakpoint, each `preload="none"`; without one, today's markup.
 */
describe('cms.Video — a mobile poster (T162)', () => {
  const MOBILE_POSTER = '4e5f6071-8293-4dae-9f20-3b4c5d6e7f80';
  const posters = (host: HTMLElement): Array<[string | null, string | null, string | null]> =>
    Array.from(host.querySelectorAll('.cmsc-pb-video video')).map((v) => [v.getAttribute('data-bp'), v.getAttribute('src'), v.getAttribute('poster')]);

  it('no mobile poster: the poster on every video, as before', () => {
    expect(posters(dom([video({ source: 'file', videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, posterAssetId: POSTER })]))).toEqual([
      ['mobile', asset(MOBILE_VIDEO), asset(POSTER)],
      ['desktop', asset(VIDEO), asset(POSTER)],
    ]);
    expect(posters(dom([video({ source: 'file', videoAssetId: VIDEO, posterAssetId: POSTER })]))).toEqual([['all', asset(VIDEO), asset(POSTER)]]);
  });

  it('a pair: the mobile video takes the mobile poster; the library poster wins over a URL', () => {
    const pair = { source: 'file', videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, posterAssetId: POSTER };
    expect(posters(dom([video({ ...pair, mobilePosterUrl: '/media/tall.jpg' })]))).toEqual([
      ['mobile', asset(MOBILE_VIDEO), 'https://api.example.com/media/tall.jpg'],
      ['desktop', asset(VIDEO), asset(POSTER)],
    ]);
    expect(posters(dom([video({ ...pair, mobilePosterUrl: '/media/tall.jpg', mobilePosterAssetId: MOBILE_POSTER })]))[0]).toEqual([
      'mobile',
      asset(MOBILE_VIDEO),
      asset(MOBILE_POSTER),
    ]);
  });

  it('one video with its own mobile poster: the same file once per breakpoint, loading nothing before it plays', () => {
    const host = dom([video({ source: 'file', videoAssetId: VIDEO, posterAssetId: POSTER, mobilePosterAssetId: MOBILE_POSTER })]);
    expect(posters(host)).toEqual([
      ['mobile', asset(VIDEO), asset(MOBILE_POSTER)],
      ['desktop', asset(VIDEO), asset(POSTER)],
    ]);
    for (const v of Array.from(host.querySelectorAll('video'))) expect(v.getAttribute('preload')).toBe('none');
  });

  it('offers the mobile poster for a file only (T194: the picker from the library, the URL from the URL source)', async () => {
    expect(Object.keys(await fieldsFor({ source: 'file' }))).toContain('mobilePosterAssetId');
    expect(Object.keys(await fieldsFor({ source: 'file', posterSource: 'url' }))).toContain('mobilePosterUrl');
    const embed = Object.keys(await fieldsFor({ source: 'embed' }));
    expect(embed).not.toContain('mobilePosterAssetId');
    expect(embed).not.toContain('mobilePosterUrl');
  });
});

describe('cms.Video — fields', () => {
  it('offers the source, and the file fields only for a file (asset ids end in AssetId)', async () => {
    const source = (block.fields as Fields)['source'] as { type: string; options: { value: unknown }[] };
    expect(source.type).toBe('select');
    expect(source.options.map((o) => o.value)).toEqual(['embed', 'file']);

    const embed = Object.keys(await fieldsFor({ source: 'embed' }));
    expect(embed).toEqual(expect.arrayContaining(['url', 'provider', 'aspectRatio', 'title', 'autoplay', 'muted', 'loop', 'controls']));
    expect(embed).not.toContain('videoAssetId');
    expect(embed).not.toContain('posterAssetId');

    // T194: a file's own fields follow its file and poster sources (both the library for a new file).
    const file = Object.keys(await fieldsFor({ source: 'file' }));
    expect(file).toEqual(expect.arrayContaining(['fileSource', 'videoAssetId', 'mobileVideoAssetId', 'posterSource', 'posterAssetId', 'aspectRatio', 'autoplay', 'muted', 'loop', 'controls']));
    expect(file).not.toContain('provider');
    const byUrl = Object.keys(await fieldsFor({ source: 'file', fileSource: 'url', posterSource: 'url' }));
    expect(byUrl).toEqual(expect.arrayContaining(['url', 'mobileUrl', 'posterUrl', 'mobilePosterUrl']));
  });

  it('the aspect ratio is a responsive field, on the Responsive tab', () => {
    expect(isResponsiveField((block.fields as Fields)['aspectRatio'] as never)).toBe(true);
    expect((block as unknown as { responsiveFields?: string[] }).responsiveFields).toContain('aspectRatio');
  });
});

describe('cms.Video — stylesheet', () => {
  const css = readFileSync(STYLESHEET, 'utf8').replace(/\s+/g, ' ');

  it('the frame reserves the ratio per breakpoint, each inheriting the one below', () => {
    // T140: the corners read the block's frame-corners option, today's 8 px as the fallback.
    expect(css).toContain('.cmsc-pb-video__frame { position: relative; width: 100%; overflow: hidden; border-radius: var(--pb-media-radius, 8px); aspect-ratio: var(--pb-ratio, 16 / 9);');
    expect(css).toMatch(/@media \(min-width: 768px\) \{ \.cmsc-pb-video__frame \{ aspect-ratio: var\(--pb-ratio-md, var\(--pb-ratio, 16 \/ 9\)\); \} \}/);
    expect(css).toMatch(/@media \(min-width: 1024px\) \{ \.cmsc-pb-video__frame \{ aspect-ratio: var\(--pb-ratio-lg, var\(--pb-ratio-md, var\(--pb-ratio, 16 \/ 9\)\)\); \} \}/);
  });

  it('shows only the video of the current breakpoint', () => {
    expect(css).toContain(".cmsc-pb-video__file[data-bp='desktop'] { display: none; }");
    expect(css).toMatch(/@media \(min-width: 768px\) \{ \.cmsc-pb-video__file\[data-bp='mobile'\] \{ display: none; \} \.cmsc-pb-video__file\[data-bp='desktop'\] \{ display: block; \} \}/);
  });
});

/**
 * T194 (owner review 2026-10-27): an embed offers its URL and provider only; a
 * file offers a file source (the library or URLs) governing the video and the
 * mobile video, and a poster source governing the poster and the mobile poster
 * (`posterUrl` is new). A stored video renders as before; with no source
 * chosen the editor shows, and records, the one its values imply.
 */
describe('cms.Video — file and poster sources (T194)', () => {
  const FILE_FIELDS = ['videoAssetId', 'mobileVideoAssetId', 'url', 'mobileUrl'];
  const POSTER_FIELDS = ['posterAssetId', 'mobilePosterAssetId', 'posterUrl', 'mobilePosterUrl'];
  const MOBILE_POSTER = '4e5f6071-8293-4dae-9f20-3b4c5d6e7f80';
  const sources = (host: HTMLElement): Array<[string | null, string | null, string | null]> =>
    Array.from(host.querySelectorAll('.cmsc-pb-video video')).map((v) => [v.getAttribute('data-bp'), v.getAttribute('src'), v.getAttribute('poster')]);

  it('an embed offers the URL and the provider, and none of a file\'s sources or fields', async () => {
    const embed = Object.keys(await fieldsFor({ source: 'embed' }));
    expect(embed).toEqual(expect.arrayContaining(['url', 'provider']));
    for (const name of ['fileSource', 'posterSource', ...FILE_FIELDS.filter((n) => n !== 'url'), ...POSTER_FIELDS]) expect(embed, name).not.toContain(name);
  });

  it.each([
    [{ fileSource: 'library' }, ['videoAssetId', 'mobileVideoAssetId']],
    [{ fileSource: 'url' }, ['url', 'mobileUrl']],
  ])('a file from %j offers %j', async (props, shown) => {
    const offered = Object.keys(await fieldsFor({ source: 'file', ...props }));
    expect(offered).toContain('fileSource');
    for (const name of FILE_FIELDS) expect(offered.includes(name), name).toBe(shown.includes(name));
  });

  it.each([
    [{ posterSource: 'library' }, ['posterAssetId', 'mobilePosterAssetId']],
    [{ posterSource: 'url' }, ['posterUrl', 'mobilePosterUrl']],
  ])('a poster from %j offers %j', async (props, shown) => {
    const offered = Object.keys(await fieldsFor({ source: 'file', ...props }));
    expect(offered).toContain('posterSource');
    for (const name of POSTER_FIELDS) expect(offered.includes(name), name).toBe(shown.includes(name));
  });

  it.each([
    [{ url: '/media/wide.mp4' }, 'url', 'library'],
    [{ mobileUrl: '/media/tall.mp4', videoAssetId: VIDEO }, 'library', 'library'],
    [{ videoAssetId: VIDEO, mobilePosterUrl: '/media/tall.jpg' }, 'library', 'url'],
    [{ videoAssetId: VIDEO, posterAssetId: POSTER, mobilePosterUrl: '/media/tall.jpg' }, 'library', 'library'],
    [{}, 'library', 'library'],
  ])('a stored file with no sources (%j) shows the file source %s and the poster source %s, and records them', async (props, file, poster) => {
    const offered = Object.keys(await fieldsFor({ source: 'file', ...props }));
    expect(offered).toContain(file === 'url' ? 'url' : 'videoAssetId');
    expect(offered).toContain(poster === 'url' ? 'mobilePosterUrl' : 'posterAssetId');
    const resolved = (await block.resolveData!({ props: { ...defaults, id: 'v', source: 'file', ...props } } as never, { changed: {} } as never)) as {
      props: Record<string, unknown>;
    };
    expect(resolved.props['fileSource']).toBe(file);
    expect(resolved.props['posterSource']).toBe(poster);
    // Recording the implied sources changes nothing on the page.
    expect(dom([video(resolved.props)]).innerHTML).toBe(dom([video({ source: 'file', ...props })]).innerHTML);
  });

  it('an embed records no file or poster source', async () => {
    const resolved = (await block.resolveData!({ props: { ...defaults, id: 'v', source: 'embed', url: 'https://youtu.be/x' } } as never, { changed: {} } as never)) as {
      props: Record<string, unknown>;
    };
    expect(resolved.props).not.toHaveProperty('fileSource');
    expect(resolved.props).not.toHaveProperty('posterSource');
  });

  it('a poster URL, made absolute; unset or library source: the library poster wins; URL source: the URLs win', () => {
    expect(sources(dom([video({ source: 'file', videoAssetId: VIDEO, posterUrl: '/media/wide.jpg' })]))).toEqual([
      ['all', asset(VIDEO), 'https://api.example.com/media/wide.jpg'],
    ]);
    expect(sources(dom([video({ source: 'file', videoAssetId: VIDEO, posterAssetId: POSTER, posterUrl: '/media/wide.jpg' })]))[0]![2]).toBe(asset(POSTER));
    expect(
      sources(
        dom([
          video({
            source: 'file',
            videoAssetId: VIDEO,
            posterSource: 'url',
            posterAssetId: POSTER,
            posterUrl: '/media/wide.jpg',
            mobilePosterAssetId: MOBILE_POSTER,
            mobilePosterUrl: '/media/tall.jpg',
          }),
        ]),
      ),
    ).toEqual([
      ['mobile', asset(VIDEO), 'https://api.example.com/media/tall.jpg'],
      ['desktop', asset(VIDEO), 'https://api.example.com/media/wide.jpg'],
    ]);
  });

  it('URL file source: the URLs win over library videos, which remain the fallback', () => {
    const both = { source: 'file', videoAssetId: VIDEO, mobileVideoAssetId: MOBILE_VIDEO, url: '/media/wide.mp4', mobileUrl: '/media/tall.mp4' };
    expect(sources(dom([video(both)])).map(([bp, src]) => [bp, src])).toEqual([
      ['mobile', asset(MOBILE_VIDEO)],
      ['desktop', asset(VIDEO)],
    ]);
    expect(sources(dom([video({ ...both, fileSource: 'url' })])).map(([bp, src]) => [bp, src])).toEqual([
      ['mobile', 'https://api.example.com/media/tall.mp4'],
      ['desktop', 'https://api.example.com/media/wide.mp4'],
    ]);
    expect(sources(dom([video({ source: 'file', fileSource: 'url', videoAssetId: VIDEO })])).map(([bp, src]) => [bp, src])).toEqual([['all', asset(VIDEO)]]);
  });
});
