import { isResponsiveProp, type ResponsiveProp } from '@endora-commerce/page-builder-core';
import type { BlockAlign } from '../schema/component-types.js';

/**
 * Feature 163 — a block's logical alignment (`start`/`center`/`end`,
 * contracts/blocks.md), and today's `left`/`center`/`right` read from blocks
 * stored before it. The page builder's alignment classes
 * (`cmsc-pb-text-align[data-align=…]`) read the physical values.
 */

const LOGICAL_ALIGN: Record<string, BlockAlign> = { left: 'start', start: 'start', center: 'center', right: 'end', end: 'end' };
const PHYSICAL_ALIGN: Record<BlockAlign, 'left' | 'center' | 'right'> = { start: 'left', center: 'center', end: 'right' };

function mapResponsive<T, U>(value: T | ResponsiveProp<T> | undefined, map: (inner: T) => U | undefined): U | ResponsiveProp<U> | undefined {
  if (value === undefined) return undefined;
  if (isResponsiveProp<T>(value)) {
    const responsive = value;
    const tablet = responsive.tablet === undefined ? undefined : map(responsive.tablet);
    const desktop = responsive.desktop === undefined ? undefined : map(responsive.desktop);
    const tiers = { ...(tablet !== undefined ? { tablet } : {}), ...(desktop !== undefined ? { desktop } : {}) };
    // Stored without `base` (T170): unset below its first breakpoint, kept so the reader applies its default there.
    if (responsive.base === undefined) return Object.keys(tiers).length > 0 ? (tiers as ResponsiveProp<U>) : undefined;
    const base = map(responsive.base);
    if (base === undefined) return undefined;
    return { base, ...tiers };
  }
  return map(value as T);
}

/** Today's `left`/`center`/`right` (from `textAlign` or the deprecated `align`) as the logical value. */
export function logicalAlign(value: unknown): BlockAlign | ResponsiveProp<BlockAlign> | undefined {
  return mapResponsive<string, BlockAlign>(value as string | ResponsiveProp<string> | undefined, (inner) => LOGICAL_ALIGN[inner]);
}

/** The alignment as the `left`/`center`/`right` the page builder's alignment classes read. */
export function physicalAlign(value: unknown): ResponsiveProp<string> | string | undefined {
  const logical = logicalAlign(value);
  return mapResponsive<BlockAlign, string>(logical, (inner) => PHYSICAL_ALIGN[inner]);
}
