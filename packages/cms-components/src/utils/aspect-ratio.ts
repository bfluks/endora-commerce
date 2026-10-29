import { isAspectToken, normalizeResponsive, type Responsive } from '@endora-commerce/page-builder-core';

/**
 * Aspect ratios as CSS — shared by `Picture`, `cms.Video`, `cms.Image` and the
 * hero and media-and-text video frames (`specs/163-page-builder-marketing-pages/`
 * research R-9, T126, T127).
 */

/** `'16:9'` → `'16 / 9'`, the `aspect-ratio` syntax; `'auto'` stays as it is. */
export function ratioToCss(token: string): string {
  const [width, height] = token.split(':');
  return height === undefined ? token : `${width} / ${height}`;
}

/** `'16:9'` → `'56.25%'`: the padding that makes a box of that ratio (today's embed frame). */
export function ratioPadding(token: string): string {
  const [width, height] = token.split(':').map(Number);
  if (!width || !height) return '56.25%';
  return `${(height / width) * 100}%`;
}

/**
 * The ratio as `--pb-ratio`, `--pb-ratio-md` and `--pb-ratio-lg`, each tier
 * inheriting the one below, as `buildResponsiveCSSValueVars` writes numbers;
 * the stylesheet reads them per tier. Nothing for no ratio.
 */
export function ratioVars(ratio: Responsive<string> | undefined): Record<string, string> {
  if (ratio === undefined || ratio === null || ratio === '') return {};
  const responsive = normalizeResponsive<string>(ratio, 'auto');
  const tablet = responsive.tablet ?? responsive.base;
  const desktop = responsive.desktop ?? tablet;
  return {
    '--pb-ratio': ratioToCss(responsive.base),
    '--pb-ratio-md': ratioToCss(tablet),
    '--pb-ratio-lg': ratioToCss(desktop),
  };
}

/**
 * A stored ratio kept only where each breakpoint's value is an aspect token
 * (and not `auto`, unless `allowAuto`): an unknown value falls back to
 * `fallback` at that breakpoint, so a hand-edited prop never writes CSS.
 */
export function sanitizeRatio(
  ratio: Responsive<string> | undefined,
  fallback: string | undefined,
  allowAuto = true,
): Responsive<string> | undefined {
  if (ratio === undefined || ratio === null || ratio === '') return fallback;
  const valid = (value: unknown): value is string =>
    typeof value === 'string' && isAspectToken(value) && (allowAuto || value !== 'auto');
  if (typeof ratio === 'string') return valid(ratio) ? ratio : fallback;
  const responsive = normalizeResponsive<string>(ratio, fallback ?? 'auto');
  const base = valid(responsive.base) ? responsive.base : fallback;
  if (base === undefined) return undefined;
  const tablet = valid(responsive.tablet) ? responsive.tablet : undefined;
  const desktop = valid(responsive.desktop) ? responsive.desktop : undefined;
  if (tablet === undefined && desktop === undefined) return base;
  return { base, ...(tablet !== undefined ? { tablet } : {}), ...(desktop !== undefined ? { desktop } : {}) };
}

/** The one ratio every breakpoint resolves to, or `null` when they differ. */
export function uniformRatio(ratio: Responsive<string>): string | null {
  if (typeof ratio === 'string') return ratio;
  const responsive = normalizeResponsive<string>(ratio, 'auto');
  const tablet = responsive.tablet ?? responsive.base;
  const desktop = responsive.desktop ?? tablet;
  return responsive.base === tablet && tablet === desktop ? responsive.base : null;
}
