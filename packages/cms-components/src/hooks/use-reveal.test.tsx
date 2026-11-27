// @vitest-environment jsdom
import { act, StrictMode, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useReveal, type RevealValue } from './use-reveal.js';

/**
 * `specs/163-page-builder-marketing-pages/` US10, FR-036, FR-037, research
 * R-21 — an entrance reveal is opt-in and safe without JavaScript:
 *
 * - the server HTML carries no `data-cmsc-reveal`, so the content is visible
 *   before any script runs;
 * - on mount, with motion allowed, the element turns `pending` (the only state
 *   the stylesheet hides), and `done` once it intersects — once;
 * - under `prefers-reduced-motion: reduce`, or below 1024 px with
 *   `desktopOnly`, it never turns `pending`;
 * - every revealing element shares one IntersectionObserver (INP).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const media = { reduced: false, desktop: true };
let observers: FakeObserver[] = [];
let observerAvailable = true;

class FakeObserver {
  readonly observed = new Set<Element>();
  readonly unobserved: Element[] = [];
  disconnected = false;
  constructor(readonly callback: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) {
    observers.push(this);
  }
  observe(target: Element): void {
    this.observed.add(target);
  }
  unobserve(target: Element): void {
    this.observed.delete(target);
    this.unobserved.push(target);
  }
  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }
}

/** Reports `target` as on screen (or off it) to every live observer watching it. */
function intersect(target: Element, isIntersecting = true): void {
  for (const observer of observers) {
    if (observer.observed.has(target)) observer.callback([{ target, isIntersecting }]);
  }
}

beforeEach(() => {
  media.reduced = false;
  media.desktop = true;
  observers = [];
  observerAvailable = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      if (query.includes('reduced-motion')) return media.reduced;
      if (query.includes('min-width: 1024px')) return media.desktop;
      return false;
    },
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class extends FakeObserver {
      constructor(callback: ConstructorParameters<typeof FakeObserver>[0]) {
        if (!observerAvailable) throw new Error('unavailable');
        super(callback);
      }
    },
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function Harness({ reveal, disabled, label = 'probe' }: { reveal: RevealValue | undefined; disabled?: boolean; label?: string }): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useReveal(ref, reveal, disabled === undefined ? {} : { disabled });
  return (
    <div ref={ref} data-probe={label}>
      Visible content
    </div>
  );
}

const roots: Root[] = [];

function mount(element: ReactElement): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<StrictMode>{element}</StrictMode>));
}

function probe(label = 'probe'): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-probe="${label}"]`)!;
}

const FADE: RevealValue = { effect: 'fade-up', desktopOnly: false };

describe('useReveal (T089)', () => {
  it('the server render carries no data-cmsc-reveal, so the content is visible without JavaScript', () => {
    const html = renderToString(<Harness reveal={{ effect: 'words', desktopOnly: true }} />);
    expect(html).not.toContain('data-cmsc-reveal');
    expect(html).toContain('Visible content');
  });

  it('on mount with motion allowed it turns pending, then done on intersection, once', () => {
    mount(<Harness reveal={FADE} />);
    const element = probe();
    expect(element.getAttribute('data-cmsc-reveal')).toBe('pending');

    act(() => intersect(element, false));
    expect(element.getAttribute('data-cmsc-reveal')).toBe('pending');

    act(() => intersect(element, true));
    expect(element.getAttribute('data-cmsc-reveal')).toBe('done');
    // Played once: no longer watched, and leaving and re-entering changes nothing.
    expect(observers.some((observer) => observer.observed.has(element))).toBe(false);
    act(() => intersect(element, false));
    act(() => intersect(element, true));
    expect(element.getAttribute('data-cmsc-reveal')).toBe('done');
  });

  it('never sets pending under prefers-reduced-motion: reduce', () => {
    media.reduced = true;
    mount(<Harness reveal={FADE} />);
    expect(probe().hasAttribute('data-cmsc-reveal')).toBe(false);
    expect(observers.every((observer) => observer.observed.size === 0)).toBe(true);
  });

  it('with desktopOnly below 1024 px it never sets pending', () => {
    media.desktop = false;
    mount(<Harness reveal={{ effect: 'words', desktopOnly: true }} />);
    expect(probe().hasAttribute('data-cmsc-reveal')).toBe(false);
  });

  it('with desktopOnly at 1024 px and up it reveals', () => {
    mount(<Harness reveal={{ effect: 'words', desktopOnly: true }} />);
    expect(probe().getAttribute('data-cmsc-reveal')).toBe('pending');
  });

  it('below 1024 px without desktopOnly it reveals', () => {
    media.desktop = false;
    mount(<Harness reveal={FADE} />);
    expect(probe().getAttribute('data-cmsc-reveal')).toBe('pending');
  });

  it('does nothing for no reveal, effect none, or when disabled (the editor canvas)', () => {
    mount(<Harness reveal={undefined} label="unset" />);
    mount(<Harness reveal={{ effect: 'none', desktopOnly: false }} label="none" />);
    mount(<Harness reveal={FADE} disabled label="disabled" />);
    for (const label of ['unset', 'none', 'disabled']) expect(probe(label).hasAttribute('data-cmsc-reveal')).toBe(false);
  });

  it('does nothing without IntersectionObserver, so content cannot stay hidden', () => {
    observerAvailable = false;
    vi.stubGlobal('IntersectionObserver', undefined);
    mount(<Harness reveal={FADE} />);
    expect(probe().hasAttribute('data-cmsc-reveal')).toBe(false);
  });

  it('leaves content already on screen at mount as it is — no flash, no delayed largest paint', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 200,
      left: 0,
      right: 100,
      width: 100,
      height: 190,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    });
    mount(<Harness reveal={FADE} />);
    expect(probe().hasAttribute('data-cmsc-reveal')).toBe(false);
  });

  it('every revealing element shares one IntersectionObserver', () => {
    mount(
      <>
        <Harness reveal={FADE} label="a" />
        <Harness reveal={{ effect: 'words', desktopOnly: false }} label="b" />
      </>,
    );
    const live = observers.filter((observer) => !observer.disconnected);
    expect(live).toHaveLength(1);
    expect(live[0]!.observed.has(probe('a'))).toBe(true);
    expect(live[0]!.observed.has(probe('b'))).toBe(true);

    act(() => intersect(probe('a')));
    expect(probe('a').getAttribute('data-cmsc-reveal')).toBe('done');
    expect(probe('b').getAttribute('data-cmsc-reveal')).toBe('pending');
  });

  it('unmounting while pending stops watching the element', () => {
    mount(<Harness reveal={FADE} />);
    const element = probe();
    act(() => roots.splice(0).forEach((root) => root.unmount()));
    expect(observers.some((observer) => observer.observed.has(element))).toBe(false);
  });
});
