import { PB_RESPONSIVE_METADATA, resolveResponsive, type BreakpointTier } from '@endora-commerce/page-builder-core';
import type { TextMaxWidth, TextMaxWidthProps } from '../schema/component-types.js';

/**
 * The maximum width of a block's text (`specs/163-page-builder-marketing-pages/`
 * T134): a named measure or a Custom px, per breakpoint. Unset or `none` at
 * every breakpoint writes nothing, so the text keeps today's full width.
 *
 * Published, the element carries `cmsc-text-max` and one custom property per
 * breakpoint (`--cmsc-text-max`, `-md`, `-lg`), which the stylesheet reads in
 * its breakpoint rules; in the editor canvas the previewed tier's value is the
 * inline `max-width`.
 */

/** The named measures: about 60, 80 and 100 characters of body text. */
const MEASURE_CSS: Record<Exclude<TextMaxWidth, 'custom'>, string> = {
  none: 'none',
  narrow: '36rem',
  medium: '48rem',
  wide: '60rem',
};

const DEFAULT_CUSTOM_PX = 720;

export function textMaxWidthField(label = 'Max text width') {
  return {
    type: 'select' as const,
    label,
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'None (full width)', value: 'none' },
      { label: 'Narrow', value: 'narrow' },
      { label: 'Medium', value: 'medium' },
      { label: 'Wide', value: 'wide' },
      { label: 'Custom (px)', value: 'custom' },
    ],
  };
}

export function textMaxWidthPxField(label = 'Custom max text width (px)') {
  return { type: 'number' as const, label, min: 160, max: 2000, step: 10, metadata: PB_RESPONSIVE_METADATA };
}

/** The fields, to spread into a block's field set. */
export function textMaxWidthFields() {
  return { textMaxWidth: textMaxWidthField(), textMaxWidthPx: textMaxWidthPxField() };
}

/** Whether a (responsive) value holds `'custom'` at any tier — `textMaxWidthPx` is shown then. */
export function usesCustomTextMaxWidth(value: unknown): boolean {
  if (value === 'custom') return true;
  if (value !== null && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(usesCustomTextMaxWidth);
  return false;
}

function measureAt(props: TextMaxWidthProps, tier: BreakpointTier): string {
  const value = resolveResponsive<TextMaxWidth>(props.textMaxWidth, tier, 'none');
  if (value === 'custom') {
    const px = resolveResponsive<number>(props.textMaxWidthPx, tier, DEFAULT_CUSTOM_PX);
    return `${Number.isFinite(px) && px > 0 ? px : DEFAULT_CUSTOM_PX}px`;
  }
  return MEASURE_CSS[value as Exclude<TextMaxWidth, 'custom'>] ?? 'none';
}

/**
 * The class and style that hold an element's text to the chosen measure, or
 * nothing when no breakpoint sets one. `tier` is the editor's previewed tier,
 * `null` on the storefront.
 */
export function textMaxWidthAttrs(
  props: TextMaxWidthProps,
  tier: BreakpointTier | null,
): { className: string; style: Record<string, string> } | null {
  const mobile = measureAt(props, 'mobile');
  const tablet = measureAt(props, 'tablet');
  const desktop = measureAt(props, 'desktop');
  if (mobile === 'none' && tablet === 'none' && desktop === 'none') return null;
  if (tier !== null) return { className: 'cmsc-text-max', style: { maxWidth: measureAt(props, tier) } };
  return {
    className: 'cmsc-text-max',
    style: { '--cmsc-text-max': mobile, '--cmsc-text-max-md': tablet, '--cmsc-text-max-lg': desktop },
  };
}
