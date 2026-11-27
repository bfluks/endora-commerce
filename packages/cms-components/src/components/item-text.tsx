import type { CSSProperties, ReactNode } from 'react';
import { isResponsiveProp, resolveResponsive, type BreakpointTier, type ResponsiveProp } from '@endora-commerce/page-builder-core';
import type { ItemFontRole, TypeToken } from '../schema/component-types.js';
import { FONT_FAMILY_CSS, HEADING_FONT_CSS, TYPE_SCALE_FALLBACKS, isTypeToken, textWeightCss } from './typography.js';
import { isDefaultSize, sizedTextProps, type TextSize } from './section-parts.js';

/**
 * A carousel item's text with its own size and font role
 * (`specs/163-page-builder-marketing-pages/` T144): `cms.CarouselImage`'s
 * caption, `cms.LinkTile`'s title and label.
 *
 * With nothing chosen the text renders as today, straight inside its box,
 * which keeps the block's own look. A size (a type token or a Custom px, per
 * breakpoint, through {@link sizedTextProps}) or a font role wraps the text in
 * one span carrying the token's class and the size's custom properties: the
 * item's own rules size its box, the span's own class sizes the text, so no
 * rule has to out-rank another.
 *
 * T151 adds a weight (300–800, `textWeightField`): it goes on the same span,
 * over the size token's own weight; `default` or unset adds nothing.
 *
 * T188 makes that weight a value per breakpoint, as T185 did for the
 * accordion's titles. One weight for every width (plain, stored with only its
 * base, or the same at every tier) stays T151's inline `font-weight`, byte for
 * byte; the editor shows the previewed tier's the same way. Weights that differ
 * add `cmsc-pb-item-weight` and `--pb-item-weight(-md|-lg)` to the span, every
 * tier written: a tier with no weight of its own gets today's — a sized
 * text's token weight, else `initial`, which leaves the variable invalid so
 * the span inherits the item's own weight, as the text did with no span.
 */

const FONT_ROLES: readonly ItemFontRole[] = ['default', 'heading', 'body'];

/** The font role select: the item's own font first (today's), then the brand's heading or body font. */
export function itemFontField(label: string) {
  return {
    type: 'select' as const,
    label,
    options: [
      { label: 'Default', value: 'default' },
      { label: 'Heading font', value: 'heading' },
      { label: 'Body font', value: 'body' },
    ],
  };
}

/** A font role's `font-family`, with today's stack as the fallback (standing rule 9); none for `default`. */
export function itemFontFamily(font: unknown): string | undefined {
  if (typeof font !== 'string' || !FONT_ROLES.includes(font as ItemFontRole)) return undefined;
  if (font === 'heading') return HEADING_FONT_CSS;
  if (font === 'body') return FONT_FAMILY_CSS.sans;
  return undefined;
}

export interface ItemTextProps {
  /** The span's own class, e.g. `cmsc-pb-link-tile__title-text`. */
  className: string;
  size: TextSize | ResponsiveProp<TextSize> | undefined;
  sizePx: number | ResponsiveProp<number> | undefined;
  font: ItemFontRole | undefined;
  /** T151: a weight (300–800), per breakpoint since T188; `default` or unset keeps the item's own. */
  weight?: unknown;
  /** The token a breakpoint left on `default` reads, among chosen ones. */
  fallback: TypeToken;
  /** The editor's previewed breakpoint, or `null` when published (CSS per breakpoint). */
  tier: BreakpointTier | null;
  children: ReactNode;
}

const TIERS: readonly BreakpointTier[] = ['mobile', 'tablet', 'desktop'];
const TIER_SUFFIX: Record<BreakpointTier, string> = { mobile: '', tablet: '-md', desktop: '-lg' };

/**
 * T188: the text's weight. `inline` — one weight for every width (in the
 * editor, the previewed tier's) — or `vars`, a weight per tier, `today` where
 * a tier has none of its own.
 */
function itemWeightOf(value: unknown, tier: BreakpointTier | null, today: string): { inline?: number; vars?: Record<string, string> } {
  const at = (t: BreakpointTier) => textWeightCss(isResponsiveProp(value) ? resolveResponsive<unknown>(value, t, undefined) : value);
  const weights = { mobile: at('mobile'), tablet: at('tablet'), desktop: at('desktop') };
  if (tier !== null) return weights[tier] !== undefined ? { inline: weights[tier] } : {};
  const chosen = TIERS.map((t) => weights[t]);
  if (chosen.every((w) => w === undefined)) return {};
  if (chosen.every((w) => w === chosen[0])) return { inline: chosen[0]! };
  const vars: Record<string, string> = {};
  for (const t of TIERS) vars[`--pb-item-weight${TIER_SUFFIX[t]}`] = weights[t] !== undefined ? String(weights[t]) : today;
  return { vars };
}

/** T188: a text's own weight today: its size token's, or (no token) the item's, which `initial` lets it inherit. */
function todaysItemWeight(classes: readonly string[]): string {
  const token = classes.map((c) => /^cmsc-t--([a-z0-9]+)$/.exec(c)?.[1]).find((t) => t !== undefined);
  return isTypeToken(token) ? `var(--cmsb-t-${token}-w, ${TYPE_SCALE_FALLBACKS[token].weight})` : 'initial';
}

/**
 * R17 (T211): a weight per breakpoint for a text that is not an item text — a
 * block heading, the hero title, a feature title. One weight for every width
 * (a plain stored value among them) is the inline `font-weight` the element
 * always carried (`inline`). Weights that differ go on one inner span
 * (`WeightSpan`) carrying `cmsc-pb-item-weight` and its variables, a tier with
 * no weight of its own reading `initial` — the span then inherits the
 * element's own weight, whatever rule gives it.
 */
export function responsiveWeightProps(
  value: unknown,
  tier: BreakpointTier | null,
): { inline: Record<string, string>; span?: Record<string, string> } {
  const weighed = itemWeightOf(value, tier, 'initial');
  if (weighed.vars) return { inline: {}, span: weighed.vars };
  return { inline: weighed.inline !== undefined ? { fontWeight: String(weighed.inline) } : {} };
}

/** The inner span of {@link responsiveWeightProps}, or the children as they are. */
export function WeightSpan({ vars, children }: { vars: Record<string, string> | undefined; children: ReactNode }): ReactNode {
  if (!vars) return children;
  return (
    <span className="cmsc-pb-item-weight" style={vars as CSSProperties}>
      {children}
    </span>
  );
}

/** The text as today when nothing is chosen; otherwise wrapped in one sized span. */
export function ItemText({ className, size, sizePx, font, weight, fallback, tier, children }: ItemTextProps): ReactNode {
  const family = itemFontFamily(font);
  const sized = isDefaultSize(size) ? null : sizedTextProps(size as TextSize, sizePx, fallback, tier);
  const weighed = itemWeightOf(weight, tier, todaysItemWeight(sized?.classes ?? []));
  if (!sized && !family && weighed.inline === undefined && !weighed.vars) return children;
  const style: Record<string, string> = {
    ...(sized?.style ?? {}),
    ...(family ? { fontFamily: family } : {}),
    ...(weighed.inline !== undefined ? { fontWeight: String(weighed.inline) } : {}),
    ...(weighed.vars ?? {}),
  };
  return (
    <span
      className={[className, ...(sized?.classes ?? []), ...(weighed.vars ? ['cmsc-pb-item-weight'] : [])].join(' ')}
      {...(Object.keys(style).length > 0 ? { style: style as CSSProperties } : {})}
    >
      {children}
    </span>
  );
}
