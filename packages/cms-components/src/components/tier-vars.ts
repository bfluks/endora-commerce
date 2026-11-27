import { isResponsiveProp, type BreakpointTier, type ResponsiveProp } from '@endora-commerce/page-builder-core';

/**
 * A value per breakpoint as custom properties that are written **only where
 * the editor set one** (`specs/163-page-builder-marketing-pages/` R20F).
 *
 * Each tier inherits the tier below it (a tablet value left empty reads the
 * phone value), resolved here, so the stylesheet reads `--<name>`,
 * `--<name>-md` and `--<name>-lg` each with the block's own value at that
 * breakpoint as the fallback — not a chain — and a tier no value reaches keeps
 * today's look. Nothing set: an empty object, so a block stored before keeps
 * its markup byte for byte.
 *
 * In the editor (`tier` set) the previewed tier's value is written under all
 * three names, so whichever media query the canvas matches reads it.
 */

const SUFFIX: Record<BreakpointTier, string> = { mobile: '', tablet: '-md', desktop: '-lg' };
const TIERS: readonly BreakpointTier[] = ['mobile', 'tablet', 'desktop'];

function tierValue<T>(value: T | ResponsiveProp<T> | undefined | null, tier: BreakpointTier): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isResponsiveProp(value)) return value as T;
  const responsive = value as ResponsiveProp<T>;
  const base = responsive.base ?? undefined;
  const tablet = responsive.tablet ?? base;
  if (tier === 'mobile') return base;
  if (tier === 'tablet') return tablet;
  return responsive.desktop ?? tablet;
}

/** `toCss` returns `undefined` for a value it refuses (not a finite number, out of range): that tier is left unwritten. */
export function tierVars<T>(
  name: string,
  value: T | ResponsiveProp<T> | undefined | null,
  tier: BreakpointTier | null,
  toCss: (value: T) => string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (tier !== null) {
    const at = tierValue(value, tier);
    const css = at === undefined || at === null ? undefined : toCss(at);
    if (css !== undefined) for (const t of TIERS) out[`--${name}${SUFFIX[t]}`] = css;
    return out;
  }
  for (const t of TIERS) {
    const at = tierValue(value, t);
    const css = at === undefined || at === null ? undefined : toCss(at);
    if (css !== undefined) out[`--${name}${SUFFIX[t]}`] = css;
  }
  return out;
}

/** A px length from 0 to `max`, or `undefined` for anything that is not a finite number. */
export function pxCss(max = 400): (value: number) => string | undefined {
  return (value) => (typeof value === 'number' && Number.isFinite(value) ? `${Math.min(max, Math.max(0, value))}px` : undefined);
}

/** A unitless line height from 0.8 to 3, or `undefined`. */
export function lineHeightCss(value: number): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.8 && value <= 3 ? String(value) : undefined;
}

/** A px space per breakpoint as the class that reads it and its variables; nothing at all while unset. */
export function pxTierOption(
  className: string,
  name: string,
  value: number | ResponsiveProp<number> | undefined | null,
  tier: BreakpointTier | null,
  max = 400,
): { classes: string[]; vars: Record<string, string> } {
  const vars = tierVars<number>(name, value, tier, pxCss(max));
  return Object.keys(vars).length > 0 ? { classes: [className], vars } : { classes: [], vars: {} };
}
