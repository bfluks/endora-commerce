import { isSpaceToken, SECTION_SPACE_FALLBACKS, type BreakpointTier, type SpaceToken } from '@endora-commerce/page-builder-core';

/**
 * `specs/163-page-builder-marketing-pages/` R23 (T437): one spacing choice for
 * a block's inner spaces, from the brand's spacing steps — instead of a px
 * value per inner element and per breakpoint (R19–R22's `…SpacePx`,
 * `stackedGapPx`, `paddingPx`). The step carries its own phone and desktop
 * values (the brand's `--cmsb-space-<step>`, the built-in px as fallbacks), so
 * one choice follows the breakpoints and the brand's tier scale.
 *
 * Unset or `default` writes nothing: the block keeps today's spaces.
 */

export type BlockSpace = 'default' | SpaceToken;

const SPACE_OPTIONS = [
  { label: 'Default', value: 'default' },
  { label: 'None', value: 'none' },
  { label: 'XS', value: 'xs' },
  { label: 'S', value: 's' },
  { label: 'M', value: 'm' },
  { label: 'L', value: 'l' },
  { label: 'XL', value: 'xl' },
  { label: 'XXL', value: 'xxl' },
];

/** One spacing step for every breakpoint: **Default** (today's) first, then the brand's steps. */
export function spaceTokenField(label: string) {
  return { type: 'select' as const, label, options: SPACE_OPTIONS };
}

/** A stored step, or `null` for unset, `default` or anything unknown. */
export function spaceTokenOf(value: unknown): SpaceToken | null {
  return isSpaceToken(value) ? value : null;
}

/** The step's CSS at a tier: its brand variable with the built-in px for that tier. */
export function spaceTokenCss(token: SpaceToken, tier: BreakpointTier): string {
  const [mobilePx, desktopPx] = SECTION_SPACE_FALLBACKS[token];
  return `var(--cmsb-space-${token}, ${tier === 'desktop' ? desktopPx : mobilePx}px)`;
}

/**
 * The step as the custom properties a block's stylesheet reads per tier
 * (`--<name>`, `-md`, `-lg`), the same names the block's former px values
 * used; in the editor (`tier` set) the previewed tier's value under all three.
 * Nothing while unset.
 */
export function spaceTokenVars(name: string, value: unknown, tier: BreakpointTier | null): Record<string, string> {
  const token = spaceTokenOf(value);
  if (token === null) return {};
  if (tier !== null) {
    const css = spaceTokenCss(token, tier);
    return { [`--${name}`]: css, [`--${name}-md`]: css, [`--${name}-lg`]: css };
  }
  return {
    [`--${name}`]: spaceTokenCss(token, 'mobile'),
    [`--${name}-md`]: spaceTokenCss(token, 'tablet'),
    [`--${name}-lg`]: spaceTokenCss(token, 'desktop'),
  };
}
