import { describe, expect, it } from 'vitest';
import {
  hasResponsiveOverride,
  hideOnDataAttrs,
  isHiddenOnTier,
  isResponsiveProp,
  normalizeResponsive,
  resolveResponsive,
  tierFromViewportWidth,
} from './responsive.js';

describe('resolveResponsive', () => {
  it('returns base for mobile', () => {
    expect(resolveResponsive({ base: 'a', tablet: 'b', desktop: 'c' }, 'mobile', 'x')).toBe('a');
  });

  it('inherits tablet from base', () => {
    expect(resolveResponsive({ base: 'a', desktop: 'c' }, 'tablet', 'x')).toBe('a');
  });

  it('inherits desktop from tablet then base', () => {
    expect(resolveResponsive({ base: 'a', tablet: 'b' }, 'desktop', 'x')).toBe('b');
    expect(resolveResponsive({ base: 'a' }, 'desktop', 'x')).toBe('a');
  });

  it('coerces plain values', () => {
    expect(resolveResponsive('plain', 'desktop', 'x')).toBe('plain');
    expect(normalizeResponsive(undefined, 'fb').base).toBe('fb');
  });
});

/**
 * `specs/163-page-builder-marketing-pages/` T170 — a responsive value stored
 * without `base` (an API write, an import: the editor always writes `base`) is
 * read as "no value below the first breakpoint that has one": the tiers below
 * take what an unset value gives (the fallback), the tier that has one and the
 * tiers above it inherit as usual.
 */
describe('a responsive value without base (T170)', () => {
  it('is recognised as a responsive value, not as a plain object value', () => {
    expect(isResponsiveProp({ desktop: 2 })).toBe(true);
    expect(isResponsiveProp({ tablet: 'a', desktop: 'b' })).toBe(true);
    expect(isResponsiveProp({ base: 1 })).toBe(true);
  });

  it('an object with any other key is a plain value (spacing parts, colours, hide-on flags)', () => {
    expect(isResponsiveProp({ top: 1, desktop: 2 })).toBe(false);
    expect(isResponsiveProp({ mobile: true, desktop: true })).toBe(false);
    expect(isResponsiveProp({ token: 'primary' })).toBe(false);
    expect(isResponsiveProp({})).toBe(false);
    expect(isResponsiveProp([1, 2])).toBe(false);
    expect(isResponsiveProp(null)).toBe(false);
  });

  it('resolves to the fallback below the first breakpoint that has a value, and inherits upwards from it', () => {
    expect(resolveResponsive({ desktop: 2 } as never, 'mobile', 1)).toBe(1);
    expect(resolveResponsive({ desktop: 2 } as never, 'tablet', 1)).toBe(1);
    expect(resolveResponsive({ desktop: 2 } as never, 'desktop', 1)).toBe(2);
    expect(resolveResponsive({ tablet: 3 } as never, 'mobile', 1)).toBe(1);
    expect(resolveResponsive({ tablet: 3 } as never, 'desktop', 1)).toBe(3);
  });

  it('normalises with the fallback as its base, keeping the stored tiers', () => {
    expect(normalizeResponsive({ desktop: 'xl' } as never, 'l')).toEqual({ base: 'l', desktop: 'xl' });
    expect(normalizeResponsive({ tablet: 'm', desktop: 'xl' } as never, 'l')).toEqual({ base: 'l', tablet: 'm', desktop: 'xl' });
  });

  it('a stored tier is an override, the missing base is not', () => {
    expect(hasResponsiveOverride({ desktop: 2 } as never, 'desktop')).toBe(true);
    expect(hasResponsiveOverride({ desktop: 2 } as never, 'tablet')).toBe(false);
  });
});

describe('tierFromViewportWidth', () => {
  it('maps widths to tiers', () => {
    expect(tierFromViewportWidth(360)).toBe('mobile');
    expect(tierFromViewportWidth(768)).toBe('tablet');
    expect(tierFromViewportWidth(1024)).toBe('desktop');
  });
});

describe('hideOn', () => {
  it('maps hide flags per tier', () => {
    expect(isHiddenOnTier({ mobile: true }, 'mobile')).toBe(true);
    expect(isHiddenOnTier({ mobile: true }, 'tablet')).toBe(false);
    expect(isHiddenOnTier({ tablet: true }, 'desktop')).toBe(false);
    expect(isHiddenOnTier({ tablet: true }, 'tablet')).toBe(true);
    expect(hideOnDataAttrs({ tablet: true })).toEqual({
      'data-hide-mobile': '0',
      'data-hide-tablet': '1',
      'data-hide-desktop': '0',
    });
  });

  /** CSS in cms-components.css must use these exact viewport ranges per tier. */
  it('documents CSS viewport ranges for hide-on (mobile <768, tablet 768–1023, desktop ≥1024)', () => {
    expect(tierFromViewportWidth(767)).toBe('mobile');
    expect(tierFromViewportWidth(768)).toBe('tablet');
    expect(tierFromViewportWidth(1023)).toBe('tablet');
    expect(tierFromViewportWidth(1024)).toBe('desktop');
  });
});
