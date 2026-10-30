import {
  PB_RESPONSIVE_METADATA,
  resolveResponsive,
  type BreakpointTier,
  type ResponsiveProp,
} from '@endora-commerce/page-builder-core';
import type { ButtonWidth } from '../schema/component-types.js';

/**
 * `specs/163-page-builder-marketing-pages/` T168 (R10): a button that spans the
 * full width of its box per breakpoint. `cms.Button` carries it as `fullWidth`
 * and every block with a button list as `buttonsFullWidth` — a top-level
 * responsive value on the Responsive tab, never a value inside the nested
 * `ButtonSpec`. `auto` (fit the label) is today's; unset writes nothing.
 */

const WIDTHS: readonly ButtonWidth[] = ['auto', 'full'];

/** The select of the Responsive tab: fit the label (today) first. */
export function buttonWidthField(label: string) {
  return {
    type: 'select' as const,
    label,
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Fit the label', value: 'auto' },
      { label: 'Full width', value: 'full' },
    ],
  };
}

function widthAt(value: ButtonWidth | ResponsiveProp<ButtonWidth>, tier: BreakpointTier): ButtonWidth {
  const width = resolveResponsive<ButtonWidth>(value, tier, 'auto');
  return WIDTHS.includes(width) ? width : 'auto';
}

/**
 * The width classes under `prefix` (`cmsc-btn` on a button, `cmsc-btn-list` on
 * a list). The page writes the phone's (`--full`, none for `auto`) and a
 * `--md-*` / `--lg-*` class where the tablet or the desktop changes it, which
 * the stylesheet applies from 768 and 1024 px; the editor canvas writes its
 * previewed breakpoint's only.
 */
export function buttonWidthClasses(
  value: ButtonWidth | ResponsiveProp<ButtonWidth> | undefined,
  tier: BreakpointTier | null,
  prefix: string,
): string[] {
  if (value === undefined || value === null) return [];
  const mobile = widthAt(value, tier ?? 'mobile');
  const classes = mobile === 'full' ? [`${prefix}--full`] : [];
  if (tier !== null) return classes;
  const tablet = widthAt(value, 'tablet');
  const desktop = widthAt(value, 'desktop');
  if (tablet !== mobile) classes.push(`${prefix}--md-${tablet}`);
  if (desktop !== tablet) classes.push(`${prefix}--lg-${desktop}`);
  return classes;
}
