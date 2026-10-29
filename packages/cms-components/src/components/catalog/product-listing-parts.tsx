'use client';

import type { ReactNode } from 'react';
import { createColorField, type BreakpointTier } from '@endora-commerce/page-builder-core';
import type { ProductCardTextLine, ProductCardVariant, ProductListingAdditions } from '../../schema/component-types.js';
import { textWeightCss, textWeightField } from '../typography.js';
import { BUTTON_SPEC_OBJECT_FIELDS, specAtTier } from '../Button.js';
import { ButtonView } from '../ButtonView.js';

/**
 * What `catalog.ProductGrid` and `catalog.ProductSlider` gain in feature 163
 * (`specs/163-page-builder-marketing-pages/` contracts/blocks.md, research
 * R-16, FR-027): the card style — today's three and `showcase` — the label of
 * a card's link, and a button below the listing. The header is the Carousel's
 * (`carousel/carousel-parts.tsx`).
 */

export const PRODUCT_CARD_VARIANTS: readonly ProductCardVariant[] = ['default', 'compact', 'horizontal', 'showcase'];

export const PRODUCT_LISTING_CARD_FIELDS = {
  cardVariant: {
    type: 'select' as const,
    label: 'Card style',
    options: [
      { label: 'Default', value: 'default' },
      { label: 'Compact', value: 'compact' },
      { label: 'Horizontal', value: 'horizontal' },
      { label: 'Showcase (image, name, summary, link)', value: 'showcase' },
    ],
  },
  // T135: the line under each card's name; `default` keeps the card style's own.
  // T196: labelled by what each line shows (the summary is the description's first words).
  cardTextLine: {
    type: 'select' as const,
    label: 'Text under the product name',
    options: [
      { label: 'Card style default (SKU; summary on Showcase)', value: 'default' },
      { label: 'Short description (from the product description)', value: 'summary' },
      { label: 'SKU', value: 'sku' },
      { label: 'None', value: 'none' },
    ],
  },
  // T151: the weight of each card's name; Default keeps the card's own.
  cardTitleWeight: textWeightField('Card title weight'),
  // T168: the card's image box background (unset: the card style's own neutral) and a line under each card.
  cardImageBackground: createColorField({ label: 'Card image background' }),
  cardDivider: {
    type: 'select' as const,
    label: 'Divider under each card',
    options: [
      { label: 'None', value: 'none' },
      { label: 'Line', value: 'line' },
    ],
  },
  cardDividerColor: createColorField({ label: 'Divider color' }),
  ctaLabel: { type: 'text' as const, label: 'Card link label' },
};

/** T168: the divider's colour is offered once a line is chosen. */
export function withoutUnusedCardFields(fields: Record<string, unknown>, props: { cardDivider?: unknown }): Record<string, unknown> {
  if (props.cardDivider !== 'line') delete fields['cardDividerColor'];
  return fields;
}

export const PRODUCT_LISTING_FOOTER_FIELDS = {
  footerButton: { type: 'object' as const, label: 'Button below the products', objectFields: BUTTON_SPEC_OBJECT_FIELDS },
};

/** The card style a listing renders: the stored one, else the listing's own default. */
export function listingCardVariant(props: ProductListingAdditions, fallback: ProductCardVariant): ProductCardVariant {
  const stored = props.cardVariant;
  return stored && PRODUCT_CARD_VARIANTS.includes(stored) && stored !== 'default' ? stored : fallback;
}

const CARD_TEXT_LINES: readonly ProductCardTextLine[] = ['default', 'summary', 'sku', 'none'];

/** The line under each card's name, when the listing chose one other than the card style's own (T135). */
export function listingCardTextLine(props: ProductListingAdditions): { textLine?: ProductCardTextLine } {
  const stored = props.cardTextLine;
  return stored && CARD_TEXT_LINES.includes(stored) && stored !== 'default' ? { textLine: stored } : {};
}

/** The weight of each card's name, when the listing chose one (T151). */
export function listingCardTitleWeight(props: ProductListingAdditions): { nameWeight?: number } {
  const weight = textWeightCss(props.cardTitleWeight);
  return weight !== undefined ? { nameWeight: weight } : {};
}

/** T168: the card's image box background and the line under it, when the listing chose them. */
export function listingCardLook(props: ProductListingAdditions): { imageBackground?: string; divider?: 'line'; dividerColor?: string } {
  const background = props.cardImageBackground?.trim() ?? '';
  const lined = props.cardDivider === 'line';
  const color = lined ? (props.cardDividerColor?.trim() ?? '') : '';
  return {
    ...(background ? { imageBackground: background } : {}),
    ...(lined ? { divider: 'line' as const } : {}),
    ...(color ? { dividerColor: color } : {}),
  };
}

/** The card's link label, when one is set. */
export function listingCtaLabel(props: ProductListingAdditions): { ctaLabel?: string } {
  const label = props.ctaLabel?.trim() ?? '';
  return label ? { ctaLabel: label } : {};
}

/** The button below the listing; nothing without a label. */
export function ProductListingFooter({
  props,
  tier,
}: {
  props: ProductListingAdditions;
  tier: BreakpointTier | null;
}): ReactNode {
  const button = props.footerButton;
  if (!button || !button.label?.trim()) return null;
  return (
    <div className="cmsc-pb-product-listing__footer cmsc-pb-actions">
      <ButtonView button={tier !== null ? specAtTier(button, tier) : button} />
    </div>
  );
}
