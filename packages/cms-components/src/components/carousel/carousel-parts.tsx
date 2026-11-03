'use client';

import type { ReactNode } from 'react';
import type { Field } from '@puckeditor/core';
import { createColorField, createToggleField, PB_RESPONSIVE_METADATA, type BreakpointTier, type HideOn, type ResponsiveProp } from '@endora-commerce/page-builder-core';
import { createHideOnField } from '@endora-commerce/page-builder-core/fields/hide-on-field';
import type {
  CarouselArrowIcon,
  CarouselArrowShape,
  CarouselArrowSize,
  CarouselArrowVariant,
  CarouselBleed,
  CarouselControlsAlign,
  CarouselControlsAlignTo,
  CarouselControlsPlacement,
  CarouselDisabledArrowLook,
  CarouselEffect,
  CarouselHeaderOptions,
  CarouselNextArrowVariant,
  CarouselTrackOptions,
  SectionGap,
} from '../../schema/component-types.js';
import { createInlineRichTextField } from '../../fields/inline-rich-text-field.js';
import { gapField, gapPxField, levelField, sizeField, sizePxField } from '../../fields/section-block-fields.js';
import { BUTTON_SPEC_OBJECT_FIELDS, specAtTier } from '../Button.js';
import { ButtonView } from '../ButtonView.js';
import { BlockHeading, blockHeadingStyle, blockHeadingStyleFields, gapCss, isEmptyInline } from '../section-parts.js';
import { colorValueToCss } from '../../utils/color-value.js';
import { customOnlyLeading, lineHeightField } from '../text-style.js';
import { tierLeading } from '../tier-leading.js';

/**
 * The Carousel's options as parts, shared by every block that shows a
 * carousel or a carousel header (`specs/163-page-builder-marketing-pages/`
 * research R-12, R-15, R-16): `cms.ContentSlider` itself, the product slider
 * and grid, and `blog.LatestPosts`. One definition of the fields, the header
 * and the shell options, so the blocks cannot drift apart.
 */

const PLACEMENTS: readonly CarouselControlsPlacement[] = ['header', 'below', 'overlay', 'slide'];
const ARROW_VARIANTS: readonly CarouselArrowVariant[] = ['default', 'outline', 'solid'];
const ARROW_SHAPES: readonly CarouselArrowShape[] = ['round', 'square'];
const ARROW_SIZES: readonly CarouselArrowSize[] = ['s', 'm', 'l'];
const ARROW_ICONS: readonly CarouselArrowIcon[] = ['chevron', 'arrow'];
const NEXT_ARROW_VARIANTS: readonly CarouselNextArrowVariant[] = ['same', 'default', 'outline', 'solid'];
const CONTROL_ALIGNS: readonly CarouselControlsAlign[] = ['center', 'start', 'end', 'between', 'split', 'dots-start'];
const DISABLED_ARROW_LOOKS: readonly CarouselDisabledArrowLook[] = ['dim', 'outline-light', 'color'];

/** T147: the alignment of the controls below the track, also the Responsive tab's select; centred is today's. */
export const CAROUSEL_CONTROLS_ALIGN_OPTIONS = [
  { label: 'Center', value: 'center' },
  { label: 'At the start', value: 'start' },
  { label: 'At the end', value: 'end' },
  { label: 'Spread out', value: 'between' },
  { label: 'Arrows at both ends', value: 'split' },
  // R20F (T313): the dots at the start, both arrows together at the end.
  { label: 'Dots at the start, arrows at the end', value: 'dots-start' },
];

/** The placement options, also the Responsive tab's select (T129). */
export const CAROUSEL_PLACEMENT_OPTIONS = [
  { label: 'Below the slides', value: 'below' },
  { label: 'In the header', value: 'header' },
  { label: 'Over the slides', value: 'overlay' },
];


/**
 * R19B (T253): the Carousel's placements — the shared three and "inside each
 * split slide"; the product and post listings hold no split slides, so they
 * keep the three.
 */
export const CONTENT_SLIDER_PLACEMENT_OPTIONS = [
  ...CAROUSEL_PLACEMENT_OPTIONS,
  { label: 'Inside each split slide (under its text)', value: 'slide' },
];

/** The header above the track: a heading, a lead and one button, with the heading's level and size. */
export const CAROUSEL_HEADER_FIELDS = {
  header: {
    type: 'object' as const,
    label: 'Header',
    objectFields: {
      heading: createInlineRichTextField({ label: 'Heading' }),
      lead: { type: 'textarea' as const, label: 'Lead' },
      button: { type: 'object' as const, label: 'Button', objectFields: BUTTON_SPEC_OBJECT_FIELDS },
    },
  },
  headingLevel: levelField('Heading level'),
  headingSize: sizeField('Heading size'),
  headingSizePx: sizePxField('Custom heading size (px)'),
  // T151/T152: the heading's weight and its maximum width per breakpoint.
  ...blockHeadingStyleFields(),
  // R22I (T379): the heading's line height per breakpoint; empty keeps its size's own. R23 (T435): with a Custom px size only.
  headingLineHeight: lineHeightField('Heading line height'),
};

/** The track's options: slides per view, gap, transition, controls, bleed, autoplay, equal heights. */
export const CAROUSEL_TRACK_FIELDS = {
  slidesPerView: {
    type: 'number' as const,
    label: 'Slides per view',
    min: 1,
    max: 8,
    step: 0.25,
    metadata: PB_RESPONSIVE_METADATA,
  },
  gap: gapField('Gap'),
  gapPx: { ...gapPxField('Custom gap (px)'), max: 160 },
  effect: {
    type: 'select' as const,
    label: 'Transition',
    options: [
      { label: 'Slide', value: 'slide' },
      { label: 'Fade (one per view)', value: 'fade' },
    ],
  },
  // T171: wrap around at the ends (today's, first) or stop there with the arrow at an end disabled.
  // R17 (T204): switches; the stored booleans and their defaults (loop and arrows on, dots off) are unchanged.
  loop: createToggleField({ label: 'Loop at the ends', defaultValue: true }),
  controls: {
    type: 'object' as const,
    label: 'Controls',
    objectFields: {
      arrows: createToggleField({ label: 'Show arrows', defaultValue: true }),
      dots: createToggleField({ label: 'Show dots' }),
      // R20F (T314): the arrows stay (both disabled, the dots hidden) when every slide fits; off hides the controls (today's).
      arrowsWhenFit: createToggleField({ label: 'Keep the arrows when all slides fit' }),
      // T129: the arrows' look; the first option of each is today's.
      arrowVariant: {
        type: 'select' as const,
        label: 'Arrow style',
        options: [
          { label: 'Default (light)', value: 'default' },
          { label: 'Outline', value: 'outline' },
          { label: 'Solid', value: 'solid' },
        ],
      },
      arrowShape: {
        type: 'select' as const,
        label: 'Arrow shape',
        options: [
          { label: 'Round', value: 'round' },
          { label: 'Square', value: 'square' },
        ],
      },
      arrowSize: {
        type: 'select' as const,
        label: 'Arrow size',
        options: [
          { label: 'Small (32 px)', value: 's' },
          { label: 'Medium (36 px)', value: 'm' },
          { label: 'Large (44 px)', value: 'l' },
        ],
      },
      // T163: the arrows' icon; the chevron is today's.
      arrowIcon: {
        type: 'select' as const,
        label: 'Arrow icon',
        options: [
          { label: 'Chevron', value: 'chevron' },
          { label: 'Arrow', value: 'arrow' },
        ],
      },
      arrowColor: createColorField({ label: 'Arrow color' }),
      // T147: the next arrow may differ (e.g. an outline previous and a solid next).
      nextArrowVariant: {
        type: 'select' as const,
        label: 'Next arrow style',
        options: [
          { label: 'Same as the arrow style', value: 'same' },
          { label: 'Default (light)', value: 'default' },
          { label: 'Outline', value: 'outline' },
          { label: 'Solid', value: 'solid' },
        ],
      },
      // T171: the look of an arrow disabled at an end when the carousel does not loop; dimmed first.
      disabledArrowLook: {
        type: 'select' as const,
        label: 'Disabled arrow look (no loop)',
        options: [
          { label: 'Dimmed', value: 'dim' },
          { label: 'Light outline (dark backgrounds)', value: 'outline-light' },
          { label: 'Color', value: 'color' },
        ],
      },
      disabledArrowColor: createColorField({ label: 'Disabled arrow color' }),
      // R19B (T241): the glyph of a solid arrow (white by default), so a light solid arrow can carry a dark glyph.
      arrowGlyphColor: createColorField({ label: 'Arrow icon color (solid style)' }),
      // R19B (T242): the arrows and the dots per breakpoint, the block's "Hide on" control for each.
      hideArrowsOn: hideOnField('Hide the arrows on'),
      hideDotsOn: hideOnField('Hide the dots on'),
    },
  },
  // T129: a placement per breakpoint, on the Responsive tab (it was `controls.placement`).
  controlsPlacement: {
    type: 'select' as const,
    label: 'Arrow placement',
    options: CAROUSEL_PLACEMENT_OPTIONS,
    metadata: PB_RESPONSIVE_METADATA,
  },
  // T147: the alignment of the controls below the track, per breakpoint (Responsive tab).
  controlsAlign: {
    type: 'select' as const,
    label: 'Controls alignment',
    options: CAROUSEL_CONTROLS_ALIGN_OPTIONS,
    metadata: PB_RESPONSIVE_METADATA,
  },
  // T153: the controls below the track lined up with the content edge (today) or the first slide.
  controlsAlignTo: {
    type: 'select' as const,
    label: 'Align the controls to',
    options: [
      { label: 'The content edge', value: 'container' },
      { label: 'The first slide', value: 'slide' },
    ],
  },
  bleed: {
    type: 'select' as const,
    label: 'Bleed past the content edge',
    options: [
      { label: 'None', value: 'none' },
      { label: 'At the end', value: 'end' },
      { label: 'On both sides', value: 'both' },
    ],
  },
  autoplay: createToggleField({ label: 'Autoplay' }),
  intervalMs: { type: 'number' as const, label: 'Autoplay interval (ms)', min: 2000, max: 20000 },
  equalHeight: createToggleField({ label: 'Equal slide height', defaultValue: true }),
};

/** R19B (T242): the block's "Hide on" checkboxes, relabelled for one control (so not the shared "Hide on" key). */
function hideOnField(label: string): Field<HideOn | undefined> {
  const { metadata: _shared, ...field } = createHideOnField();
  return { ...field, label } as Field<HideOn | undefined>;
}

/** The arrows' look: shown only while the arrows are (R17, T218). */
const ARROW_LOOK_KEYS = ['arrowVariant', 'arrowShape', 'arrowSize', 'arrowIcon', 'arrowColor', 'nextArrowVariant', 'hideArrowsOn', 'arrowsWhenFit'] as const;
/** R19B (T242): the dots' breakpoints, only while the dots show. R23 (T448): their colours follow the scheme. */
const DOT_KEYS = ['hideDotsOn'] as const;
/** Where the controls go and how they line up: only while there are controls. */
const CONTROLS_PLACEMENT_KEYS = ['controlsPlacement', 'controlsAlign', 'controlsAlignTo'] as const;

// Per host `controls` field object and the sub-fields kept, so Puck gets the same object each time (focus is kept).
const controlsFieldCache = new WeakMap<object, Map<string, unknown>>();

function controlsFieldWith(field: unknown, keep: (key: string) => boolean): unknown {
  const source = field as { type?: string; objectFields?: Record<string, unknown> } | null;
  if (!source || source.type !== 'object' || !source.objectFields) return field;
  const kept = Object.keys(source.objectFields).filter(keep);
  if (kept.length === Object.keys(source.objectFields).length) return field;
  const key = kept.join(',');
  let byKeys = controlsFieldCache.get(source);
  if (!byKeys) {
    byKeys = new Map();
    controlsFieldCache.set(source, byKeys);
  }
  const cached = byKeys.get(key);
  if (cached) return cached;
  const next = { ...source, objectFields: Object.fromEntries(kept.map((name) => [name, source.objectFields![name]])) };
  byKeys.set(key, next);
  return next;
}

/**
 * R17 (T213): a slider's settings shown only where they apply — the autoplay
 * interval while autoplay is on; the arrows' look while the arrows show; the
 * disabled-arrow look (and its colour, for **Color**) for arrows on a carousel
 * that stops at its ends; the controls' placement and alignment while arrows
 * or dots show. Filters `fields` in place (the host's, so the admin's pickers
 * and translations survive); `controls` is replaced by a cached copy with the
 * sub-fields kept, so Puck keeps the input's focus. Nothing stored changes.
 */
export function withoutUnusedCarouselFields(
  props: Pick<CarouselTrackOptions, 'controls' | 'autoplay' | 'loop'>,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const controls = props.controls ?? {};
  const arrows = controls.arrows !== false;
  const dots = controls.dots === true;
  // R20F (T314): arrows kept when every slide fits are disabled too, so their look applies to a looping carousel.
  const stops = props.loop === false || controls.arrowsWhenFit === true;
  if (props.autoplay !== true) delete fields['intervalMs'];
  if (!arrows && !dots) for (const key of CONTROLS_PLACEMENT_KEYS) delete fields[key];
  if ('controls' in fields) {
    fields['controls'] = controlsFieldWith(fields['controls'], (key) => {
      if ((ARROW_LOOK_KEYS as readonly string[]).includes(key)) return arrows;
      if (key === 'disabledArrowLook') return arrows && stops;
      if (key === 'disabledArrowColor') return arrows && stops && controls.disabledArrowLook === 'color';
      if ((DOT_KEYS as readonly string[]).includes(key)) return dots;
      // R19B (T241): the glyph colour only for a solid arrow (the others draw their glyph in the arrow colour).
      if (key === 'arrowGlyphColor') return arrows && (controls.arrowVariant === 'solid' || controls.nextArrowVariant === 'solid');
      return true;
    });
  }
  return fields;
}

/**
 * What a block may change in the shared header (T189, `blog.LatestPosts`):
 * the lead's text wrapped by the caller (its size), the button left out
 * (placed elsewhere by the caller), and classes on the button's row.
 */
export interface CarouselHeaderNodeOptions {
  lead?: (text: string) => ReactNode;
  button?: boolean;
  actionClassNames?: readonly string[];
}

/** The header's content, or `null` when it has none. Puck's tier while editing, `null` (CSS) when published. */
export function carouselHeaderNode(
  props: CarouselHeaderOptions,
  tier: BreakpointTier | null,
  options: CarouselHeaderNodeOptions = {},
): ReactNode {
  const header = props.header;
  if (!header) return null;
  const heading = !isEmptyInline(header.heading);
  const lead = header.lead?.trim() ?? '';
  const button = options.button !== false && header.button && header.button.label?.trim() ? header.button : null;
  if (!heading && !lead && !button) return null;
  const actionClass = ['cmsc-pb-carousel__header-action', 'cmsc-pb-actions', ...(options.actionClassNames ?? [])].join(' ');
  // R22I (T379): the heading's line height per breakpoint, written only where chosen — R23 (T435): only from
  // a breakpoint sized in Custom px (a token brings its own).
  const leading = tierLeading(customOnlyLeading(props.headingSize, props.headingLineHeight), tier);
  return (
    <>
      <BlockHeading
        value={header.heading}
        level={props.headingLevel}
        size={props.headingSize}
        sizePx={props.headingSizePx}
        {...blockHeadingStyle(props)}
        {...(Object.keys(leading.style).length > 0 ? { style: leading.style } : {})}
        className={['cmsc-pb-carousel__heading', ...leading.classes].join(' ')}
        tier={tier}
      />
      {lead ? <p className="cmsc-pb-carousel__lead">{options.lead ? options.lead(lead) : lead}</p> : null}
      {button ? (
        <div className={actionClass}>
          <ButtonView button={tier !== null ? specAtTier(button, tier) : button} />
        </div>
      ) : null}
    </>
  );
}

/** The header as a block of its own, above a grid (no track to join): nothing when it is empty. */
export function CarouselHeaderBlock({
  props,
  tier,
  options,
}: {
  props: CarouselHeaderOptions;
  tier: BreakpointTier | null;
  options?: CarouselHeaderNodeOptions;
}): ReactNode {
  const node = carouselHeaderNode(props, tier, options);
  if (node === null) return null;
  return <div className="cmsc-pb-carousel__header cmsc-pb-block-header">{node}</div>;
}

/** The gap per breakpoint as CSS lengths: a spacing token's variable, or the Custom px. */
function gapLengths(props: CarouselTrackOptions, fallbackPx: number): ResponsiveProp<string> {
  const gap = props.gap as SectionGap | number | ResponsiveProp<SectionGap | number> | undefined;
  return {
    base: gapCss(gap, props.gapPx, fallbackPx, 'mobile'),
    tablet: gapCss(gap, props.gapPx, fallbackPx, 'tablet'),
    desktop: gapCss(gap, props.gapPx, fallbackPx, 'desktop'),
  };
}

/** A placement, one per breakpoint or the same for all; anything unknown is `below`. */
function placementOption(
  value: unknown,
): CarouselControlsPlacement | ResponsiveProp<CarouselControlsPlacement> {
  const valid = (entry: unknown): entry is CarouselControlsPlacement =>
    typeof entry === 'string' && PLACEMENTS.includes(entry as CarouselControlsPlacement);
  if (valid(value)) return value;
  if (value !== null && typeof value === 'object') {
    const stored = value as Record<string, unknown>;
    const out: ResponsiveProp<CarouselControlsPlacement> = { base: valid(stored['base']) ? stored['base'] : 'below' };
    if (valid(stored['tablet'])) out.tablet = stored['tablet'];
    if (valid(stored['desktop'])) out.desktop = stored['desktop'];
    return out;
  }
  return 'below';
}

/**
 * T129, for the editor's `resolveData`: a placement stored inside `controls`
 * (before T129) moved to `controlsPlacement`, so the Responsive tab shows it and
 * a later edit there is not overridden by the stored one. Idempotent.
 */
export function carouselPlacementMoved<T extends Pick<CarouselTrackOptions, 'controls' | 'controlsPlacement'>>(props: T): T {
  const stored = props.controls?.placement;
  if (stored === undefined) return props;
  const { placement: _placement, ...controls } = props.controls ?? {};
  return { ...props, controls, controlsPlacement: stored };
}

/** T147: an alignment, one per breakpoint or the same for all; anything unknown is centred. */
function alignOption(value: unknown): CarouselControlsAlign | ResponsiveProp<CarouselControlsAlign> {
  const valid = (entry: unknown): entry is CarouselControlsAlign =>
    typeof entry === 'string' && CONTROL_ALIGNS.includes(entry as CarouselControlsAlign);
  if (valid(value)) return value;
  if (value !== null && typeof value === 'object') {
    const stored = value as Record<string, unknown>;
    const out: ResponsiveProp<CarouselControlsAlign> = { base: valid(stored['base']) ? stored['base'] : 'center' };
    if (valid(stored['tablet'])) out.tablet = stored['tablet'];
    if (valid(stored['desktop'])) out.desktop = stored['desktop'];
    return out;
  }
  return 'center';
}

/** One of a closed set, or `undefined`. */
function oneOf<T extends string>(value: unknown, options: readonly T[]): T | undefined {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : undefined;
}

/** `CarouselShell`'s options from the track's props, with a block's own fallbacks. */
export function carouselShellOptions(
  props: CarouselTrackOptions,
  fallbacks: { slidesPerView?: number | ResponsiveProp<number>; intervalMs?: number; gapPx?: number } = {},
) {
  const controls = props.controls ?? {};
  const effect: CarouselEffect = props.effect === 'fade' ? 'fade' : 'slide';
  const bleed: CarouselBleed = props.bleed === 'end' || props.bleed === 'both' ? props.bleed : 'none';
  return {
    slidesPerView: props.slidesPerView ?? fallbacks.slidesPerView ?? 1,
    gap: gapLengths(props, fallbacks.gapPx ?? 16),
    effect,
    bleed,
    autoplay: props.autoplay === true,
    intervalMs: props.intervalMs ?? fallbacks.intervalMs ?? 6000,
    showArrows: controls.arrows !== false,
    showDots: controls.dots === true,
    // T129: the placement per breakpoint. One stored inside `controls` (before T129) wins: the
    // editor's canvas merges the defaults in until `carouselPlacementMoved` has moved it.
    controlsPlacement: placementOption(controls.placement ?? props.controlsPlacement),
    ...(props.controlsAlign !== undefined ? { controlsAlign: alignOption(props.controlsAlign) } : {}),
    ...(props.controlsAlignTo === 'slide' ? { controlsAlignTo: 'slide' as CarouselControlsAlignTo } : {}),
    ...arrowLook(controls),
    ...controlsLook(controls),
    ...endsOptions(props.loop, controls),
    // R20F (T314): only when on, with arrows to keep.
    ...(controls.arrowsWhenFit === true && controls.arrows !== false ? { keepArrowsWhenFit: true } : {}),
    equalHeight: props.equalHeight !== false,
  };
}

/**
 * T171: the ends for the shell — only when the carousel does not loop, and a
 * disabled look only when it is not the dimmed one. R20F (T314): the look also
 * for arrows kept (disabled) when every slide fits, on a looping carousel too.
 */
function endsOptions(
  loop: boolean | undefined,
  controls: NonNullable<CarouselTrackOptions['controls']>,
): { loop?: false; disabledArrowLook?: CarouselDisabledArrowLook; disabledArrowColor?: string } {
  const kept = controls.arrowsWhenFit === true && controls.arrows !== false;
  if (loop !== false && !kept) return {};
  const look = oneOf(controls.disabledArrowLook, DISABLED_ARROW_LOOKS);
  const color = colorValueToCss(controls.disabledArrowColor);
  return {
    ...(loop === false ? { loop: false as const } : {}),
    ...(look && look !== 'dim' ? { disabledArrowLook: look } : {}),
    ...(look === 'color' && color ? { disabledArrowColor: color } : {}),
  };
}

/**
 * R19B (T241, T242): the glyph colour and the breakpoints hiding the arrows or
 * the dots, only what is set. R23 (T448): the dots follow the colour scheme
 * (R19B T240's dot colours were removed; a stored one is ignored).
 */
function controlsLook(controls: NonNullable<CarouselTrackOptions['controls']>): {
  arrowGlyphColor?: string;
  hideArrowsOn?: HideOn;
  hideDotsOn?: HideOn;
} {
  const glyph = colorValueToCss(controls.arrowGlyphColor);
  const hideArrowsOn = ticked(controls.hideArrowsOn);
  const hideDotsOn = ticked(controls.hideDotsOn);
  return {
    ...(glyph ? { arrowGlyphColor: glyph } : {}),
    ...(hideArrowsOn ? { hideArrowsOn } : {}),
    ...(hideDotsOn ? { hideDotsOn } : {}),
  };
}

/** The ticked breakpoints of a "Hide on" value, or `undefined` when none is. */
function ticked(value: unknown): HideOn | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const stored = value as Record<string, unknown>;
  const out: HideOn = {};
  for (const tier of ['mobile', 'tablet', 'desktop'] as const) if (stored[tier] === true) out[tier] = true;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The arrows' look for the shell: only what is set (T129). */
function arrowLook(controls: NonNullable<CarouselTrackOptions['controls']>): {
  arrowVariant?: CarouselArrowVariant;
  arrowShape?: CarouselArrowShape;
  arrowSize?: CarouselArrowSize;
  arrowColor?: string;
  arrowIcon?: CarouselArrowIcon;
  nextArrowVariant?: CarouselNextArrowVariant;
} {
  const variant = oneOf(controls.arrowVariant, ARROW_VARIANTS);
  const nextVariant = oneOf(controls.nextArrowVariant, NEXT_ARROW_VARIANTS);
  const shape = oneOf(controls.arrowShape, ARROW_SHAPES);
  const size = oneOf(controls.arrowSize, ARROW_SIZES);
  const icon = oneOf(controls.arrowIcon, ARROW_ICONS);
  const color = colorValueToCss(controls.arrowColor);
  return {
    ...(variant ? { arrowVariant: variant } : {}),
    ...(shape ? { arrowShape: shape } : {}),
    ...(size ? { arrowSize: size } : {}),
    ...(color ? { arrowColor: color } : {}),
    ...(icon === 'arrow' ? { arrowIcon: icon } : {}),
    ...(nextVariant && nextVariant !== 'same' ? { nextArrowVariant: nextVariant } : {}),
  };
}
