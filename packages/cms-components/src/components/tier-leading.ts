import type { BreakpointTier, ResponsiveProp } from '@endora-commerce/page-builder-core';
import { lineHeightCss, tierVars } from './tier-vars.js';

/**
 * A line height per breakpoint for a text whose own line height comes from its
 * type token (`specs/163-page-builder-marketing-pages/` R22I, T375/T379): a
 * figure's value, a carousel header's heading.
 *
 * Unlike `textStyleAttrs`, a breakpoint below the first one set writes
 * **nothing** — no class, no variable — so there the text keeps its token's
 * line height (one token, or one per breakpoint through `cmsc-pb-text-token`)
 * instead of an inherited one. Each tier from the first set up inherits the
 * one below it (`tierVars`).
 *
 * - nothing set: nothing at all (today's markup);
 * - the same value at every breakpoint (or the editor's previewed tier): the
 *   inline `line-height`;
 * - otherwise one class per tier written (`cmsc-pb-lh`, `-md`, `-lg`) and its
 *   variable (`--pb-lh`, `-md`, `-lg`). The stylesheet's rules double the class
 *   and sit at its end, so they win over a token's and a block's own rule.
 */
const TIER_CLASSES: ReadonlyArray<[string, string]> = [
  ['--pb-lh', 'cmsc-pb-lh'],
  ['--pb-lh-md', 'cmsc-pb-lh-md'],
  ['--pb-lh-lg', 'cmsc-pb-lh-lg'],
];

export function tierLeading(value: unknown, tier: BreakpointTier | null): { classes: string[]; style: Record<string, string> } {
  // A stored value per breakpoint may lack its base (a tablet or desktop value only); `tierVars` reads either.
  const stored = value as number | ResponsiveProp<number> | undefined | null;
  if (tier !== null) {
    const at = tierVars<number>('pb-lh', stored, tier, lineHeightCss)['--pb-lh'];
    return { classes: [], style: at === undefined ? {} : { lineHeight: at } };
  }
  const vars = tierVars<number>('pb-lh', stored, null, lineHeightCss);
  const written = TIER_CLASSES.filter(([name]) => vars[name] !== undefined);
  if (written.length === 0) return { classes: [], style: {} };
  if (written.length === TIER_CLASSES.length && new Set(Object.values(vars)).size === 1) {
    return { classes: [], style: { lineHeight: vars['--pb-lh']! } };
  }
  return { classes: written.map(([, className]) => className), style: vars };
}
