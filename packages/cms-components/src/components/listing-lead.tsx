import type { CSSProperties } from 'react';
import { createColorField, type BreakpointTier } from '@endora-commerce/page-builder-core';
import type { ResponsiveTextWeight, SectionTextSize } from '../schema/component-types.js';
import { sizeFieldWithDefault, sizePxField } from '../fields/section-block-fields.js';
import type { CarouselHeaderNodeOptions } from './carousel/carousel-parts.js';
import { textStyleAttrs, type TextStyleValues } from './text-style.js';
import { textWeightField } from './typography.js';

/**
 * `specs/163-page-builder-marketing-pages/` R21G (T338): a product listing's
 * header lead with a look of its own — its size (a type token or Custom px) and
 * weight per breakpoint, and its colour — as `blog.LatestPosts`' lead size and
 * colour. The lead's text is wrapped in one span through the shared header's
 * `lead` hook (`CarouselHeaderNodeOptions`), so the header itself is not
 * changed; with nothing set there is no hook and the header renders as before.
 */

export interface ListingLeadProps {
  leadSize?: SectionTextSize | Record<string, SectionTextSize> | undefined;
  leadSizePx?: number | Record<string, number> | undefined;
  leadWeight?: ResponsiveTextWeight | undefined;
  leadColor?: string | undefined;
}

/** The lead's own text (the header's `<p>`): inherited, read by a breakpoint left on Default when another is set. */
const LEAD_TODAY = { size: 'inherit', lineHeight: 'inherit' };

/** The header options carrying the lead's look, or `undefined` while none is set (today's header). */
export function listingLeadOptions(props: ListingLeadProps, tier: BreakpointTier | null): CarouselHeaderNodeOptions | undefined {
  const look = textStyleAttrs(
    {
      size: props.leadSize as TextStyleValues['size'],
      sizePx: props.leadSizePx as TextStyleValues['sizePx'],
      weight: props.leadWeight,
      color: props.leadColor || undefined,
    },
    tier,
    LEAD_TODAY,
  );
  if (look.classes.length === 0 && Object.keys(look.style).length === 0) return undefined;
  const className = ['cmsc-pb-carousel__lead-text', ...look.classes].join(' ');
  return {
    lead: (text: string) => (
      <span className={className} style={look.style as CSSProperties}>
        {text}
      </span>
    ),
  };
}

/** The lead's fields, after the shared header's: size, Custom px, weight (R23: one value), colour. */
export const LISTING_LEAD_FIELDS = {
  leadSize: sizeFieldWithDefault('Lead size'),
  leadSizePx: sizePxField('Custom lead size (px)', 10, 80),
  leadWeight: textWeightField('Lead weight'),
  leadColor: createColorField({ label: 'Lead color' }),
};
