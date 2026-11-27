'use client';

import { useEffect, type RefObject } from 'react';
import type { RevealSetting } from '@endora-commerce/page-builder-core';

/**
 * A stored reveal setting: `section.reveal` or a block's own `reveal`
 * (data-model §3.4). Either key may be missing in stored content.
 */
export type RevealValue = Partial<RevealSetting>;

const REDUCED_MOTION_MEDIA = '(prefers-reduced-motion: reduce)';
/** `desktopOnly` means the desktop tier, 1024 px and up — the brand tokens' desktop breakpoint. */
const DESKTOP_MEDIA = '(min-width: 1024px)';
/** Starts a little before the element is fully in view, so the reveal has begun when it is read. */
const ROOT_MARGIN = '0px 0px -10% 0px';

// ── One observer for the whole page (INP) ────────────────────────────

const watched = new Map<Element, () => void>();
let sharedObserver: IntersectionObserver | null = null;

function watch(element: Element, onEnter: () => void): boolean {
  if (sharedObserver === null) {
    try {
      sharedObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const enter = watched.get(entry.target);
            unwatch(entry.target);
            enter?.();
          }
        },
        { rootMargin: ROOT_MARGIN },
      );
    } catch {
      return false;
    }
  }
  watched.set(element, onEnter);
  sharedObserver.observe(element);
  return true;
}

function unwatch(element: Element): void {
  if (!watched.delete(element) || sharedObserver === null) return;
  sharedObserver.unobserve(element);
  if (watched.size === 0) {
    sharedObserver.disconnect();
    sharedObserver = null;
  }
}

/** Whether any part of `element` is inside the viewport right now. */
function onScreen(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const height = window.innerHeight || document.documentElement.clientHeight;
  return rect.bottom > 0 && rect.top < height && rect.height > 0;
}

/**
 * The entrance reveal — `specs/163-page-builder-marketing-pages/` US10,
 * FR-036, FR-037, research R-21.
 *
 * The block renders its content visible, with no reveal attribute, on the
 * server and in the first client render alike, so no hydration mismatch and
 * no hidden content without JavaScript. On mount this effect writes
 * `data-cmsc-reveal="pending"` on `ref` — the only state the stylesheet hides,
 * and only inside `@media (prefers-reduced-motion: no-preference)` — and flips
 * it to `"done"` the first time the element intersects the viewport; then it
 * stops watching (plays once).
 *
 * It does nothing when:
 *
 * - `reveal` is unset or its effect is `none`, or `options.disabled` (the
 *   editor canvas, where every block's content must stay in view to edit);
 * - `prefers-reduced-motion: reduce` matches;
 * - `desktopOnly` is set and the viewport is below 1024 px;
 * - there is no `matchMedia` or `IntersectionObserver` — nothing could ever
 *   reveal it;
 * - the element is already on screen at mount: hiding it then would flash
 *   visible content away and delay the largest paint.
 *
 * Every revealing element shares one `IntersectionObserver`, and the
 * attribute is written straight to the DOM, so a reveal costs no re-render.
 */
export function useReveal(ref: RefObject<HTMLElement | null>, reveal: RevealValue | null | undefined, options: { disabled?: boolean } = {}): void {
  const effect = reveal?.effect ?? 'none';
  const desktopOnly = reveal?.desktopOnly === true;
  const disabled = options.disabled === true;

  useEffect(() => {
    const element = ref.current;
    if (!element || disabled || effect === 'none') return undefined;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    if (typeof IntersectionObserver !== 'function') return undefined;
    if (window.matchMedia(REDUCED_MOTION_MEDIA).matches) return undefined;
    if (desktopOnly && !window.matchMedia(DESKTOP_MEDIA).matches) return undefined;
    if (onScreen(element)) return undefined;

    element.setAttribute('data-cmsc-reveal', 'pending');
    const watching = watch(element, () => element.setAttribute('data-cmsc-reveal', 'done'));
    if (!watching) {
      element.removeAttribute('data-cmsc-reveal');
      return undefined;
    }

    return () => {
      unwatch(element);
      // Torn down before it played (unmount, a changed setting): leave it visible.
      if (element.getAttribute('data-cmsc-reveal') === 'pending') element.removeAttribute('data-cmsc-reveal');
    };
  }, [ref, effect, desktopOnly, disabled]);
}
