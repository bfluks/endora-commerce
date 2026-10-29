// @vitest-environment jsdom
import { act, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBreakpointVideo } from './use-breakpoint-video.js';

/**
 * `specs/163-page-builder-marketing-pages/` FR-012, research R-9 — a section's
 * background videos are a pair, one per breakpoint, loaded with
 * `preload="none"`. Only the one for the current breakpoint plays, only while
 * the section is on screen, and none plays under `prefers-reduced-motion`.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Listener = () => void;

/** A controllable `matchMedia`: the mobile and reduced-motion answers are set per test. */
const media = { mobile: false, reduced: false };
const mediaListeners = new Set<Listener>();
/** The last IntersectionObserver callback, so a test can report the section visible. */
let intersect: ((visible: boolean) => void) | null = null;
let observerAvailable = true;

function setMedia(next: Partial<typeof media>): void {
  Object.assign(media, next);
  for (const listener of mediaListeners) listener();
}

beforeEach(() => {
  media.mobile = false;
  media.reduced = false;
  mediaListeners.clear();
  intersect = null;
  observerAvailable = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('reduced-motion') ? media.reduced : media.mobile;
    },
    media: query,
    addEventListener: (_: string, listener: Listener) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => mediaListeners.delete(listener),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
        if (!observerAvailable) throw new Error('unavailable');
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function Harness({ single = false }: { single?: boolean }): ReactElement {
  const ref = useRef<HTMLElement>(null);
  useBreakpointVideo(ref);
  return (
    <section ref={ref}>
      {single ? (
        <video data-bp="all" preload="none" />
      ) : (
        <>
          <video data-bp="mobile" preload="none" />
          <video data-bp="desktop" preload="none" />
        </>
      )}
    </section>
  );
}

function mount(element: ReactElement): Root {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(element));
  return root;
}

function playing(): string[] {
  return Array.from(document.querySelectorAll('video'))
    .filter((video) => !video.paused)
    .map((video) => video.dataset['bp'] ?? '');
}

describe('useBreakpointVideo', () => {
  it('plays nothing until the section is visible', () => {
    mount(<Harness />);
    expect(playing()).toEqual([]);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it('plays only the desktop video when visible on a desktop viewport', () => {
    mount(<Harness />);
    act(() => intersect?.(true));
    expect(playing()).toEqual(['desktop']);
  });

  it('plays only the mobile video on a mobile viewport, and switches with the breakpoint', () => {
    media.mobile = true;
    mount(<Harness />);
    act(() => intersect?.(true));
    expect(playing()).toEqual(['mobile']);
    act(() => setMedia({ mobile: false }));
    expect(playing()).toEqual(['desktop']);
  });

  it('pauses when the section leaves the screen', () => {
    mount(<Harness />);
    act(() => intersect?.(true));
    act(() => intersect?.(false));
    expect(playing()).toEqual([]);
  });

  it('never plays under prefers-reduced-motion, and stops when it is turned on', () => {
    media.reduced = true;
    mount(<Harness />);
    act(() => intersect?.(true));
    expect(playing()).toEqual([]);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    act(() => setMedia({ reduced: false }));
    expect(playing()).toEqual(['desktop']);
    act(() => setMedia({ reduced: true }));
    expect(playing()).toEqual([]);
  });

  it('plays a single video at every breakpoint', () => {
    media.mobile = true;
    mount(<Harness single />);
    act(() => intersect?.(true));
    expect(playing()).toEqual(['all']);
  });

  it('mutes each video before playing it', () => {
    mount(<Harness />);
    act(() => intersect?.(true));
    expect(document.querySelector<HTMLVideoElement>('video[data-bp="desktop"]')?.muted).toBe(true);
  });

  it('plays nothing without IntersectionObserver, since visibility cannot be known', () => {
    observerAvailable = false;
    vi.stubGlobal('IntersectionObserver', undefined);
    mount(<Harness />);
    expect(playing()).toEqual([]);
  });
});
