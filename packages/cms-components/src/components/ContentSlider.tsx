'use client';

import type { ComponentType, ReactNode } from 'react';
import type { ComponentConfig, Fields, PuckComponent } from '@puckeditor/core';
import { createToggleField, PB_RESPONSIVE_METADATA, withHideOn, type BreakpointTier, type ResponsiveProp } from '@endora-commerce/page-builder-core';
import { CAROUSEL_SLIDE_TYPES, getSlotZoneItemCount } from '@endora-commerce/page-builder-core/editor/puck-guards';
import { useEditorCarouselPage } from '@endora-commerce/page-builder-core/editor/carousel-preview';
import { usePageBuilderPuck } from '@endora-commerce/page-builder-core/editor/use-page-builder-puck';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { CarouselControls, ContentSliderProps } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import {
  BOX_BORDER_FIELD,
  BOX_MARGIN_FIELD,
  BOX_PADDING_FIELD,
  DEFAULT_BOX_PROPS,
  DEFAULT_LAYOUT_PADDING,
} from '../fields/shared-fields.js';
import { CarouselShell, CarouselSlides } from './carousel/CarouselShell.js';
import {
  CAROUSEL_HEADER_FIELDS,
  CAROUSEL_TRACK_FIELDS,
  carouselHeaderNode,
  carouselPlacementMoved,
  carouselShellOptions,
  withoutUnusedCarouselFields,
} from './carousel/carousel-parts.js';
import { carouselFilterFromProps } from './carousel/carousel-filter.js';
import { CONTENT_SLIDER_SLOT_EDIT_PROPS } from '../editor/slot-edit-props.js';
import { isUnusedHeadingMaxWidthPx, usesCustom } from './section-parts.js';

/**
 * `cms.ContentSlider`, labelled "Carousel" — `specs/163-page-builder-marketing-pages/`
 * contracts/blocks.md, research R-12, US4, FR-019–FR-022.
 *
 * The one carousel: its `slides` slot takes free-content `cms.Slide`s (and a
 * `cms.Row`, wrapped into one by the editor) beside the four item blocks —
 * `cms.CarouselImage`, `cms.CarouselSplit`, `cms.LinkTile` and
 * `cms.DownloadTile`. An optional header holds a heading, a lead and a button.
 * Slides per view (fractions peek) and the gap are CSS per breakpoint; the
 * transition slides or fades; arrows and dots sit over the track, below it or
 * in the header and hide themselves when everything fits; the track may bleed
 * past the content edge; autoplay is off unless chosen.
 *
 * Plan § *Extend, don't narrow*: every option of today's content slider is
 * kept — slides per view 1–8, a px gap (its **Custom** case), autoplay and its
 * interval, arrows, dots, equal heights and the box fields. A slider stored
 * before renders as today (`contentSliderFromLegacy`: arrows over the edges,
 * dots below).
 *
 * R5 (T129–T131): the arrow placement is a value per breakpoint
 * (`controlsPlacement`, Responsive tab) and the arrows have a style, shape,
 * size and colour; `layout: 'grid'` shows the same items as a grid of
 * `columns` per breakpoint; an optional filter bar over the items' `tags`
 * hides the others on the client, every item staying in the server HTML.
 *
 * R7 (T143, T147): the filter bar is pills or underlined tabs, aligned at the
 * start, centre or end; the controls below the track are aligned per
 * breakpoint (`controlsAlign`, Responsive tab), and the next arrow may take a
 * style of its own. R9 (T161): filter buttons that do not fit wrap (today) or
 * scroll in one line inside the block.
 */

/** A gap stored before feature 163: a number of px, or one per breakpoint. */
function isLegacyGap(value: unknown): value is number | ResponsiveProp<number> {
  if (typeof value === 'number') return true;
  if (value === null || typeof value !== 'object') return false;
  return Object.values(value as Record<string, unknown>).some((inner) => typeof inner === 'number');
}

/**
 * A slider stored before feature 163, in the new shape, value for value:
 * `showArrows`/`showDots` become `controls` with today's placement (arrows
 * over the track's edges, dots below), a px `gap` its Custom case. Idempotent.
 */
export function contentSliderFromLegacy<T extends Record<string, unknown>>(props: T): T & ContentSliderProps {
  const next: Record<string, unknown> = { ...props };
  if (next['controls'] === undefined || next['controls'] === null) {
    next['controls'] = {
      arrows: props['showArrows'] !== false,
      dots: props['showDots'] !== false,
      placement: 'overlay',
    } satisfies CarouselControls;
  }
  delete next['showArrows'];
  delete next['showDots'];
  if (isLegacyGap(props['gap'])) {
    next['gap'] = 'custom';
    next['gapPx'] = props['gap'];
  }
  if (next['effect'] === undefined) next['effect'] = 'slide';
  if (next['bleed'] === undefined) next['bleed'] = 'none';
  // T129: the placement is a value per breakpoint now; one stored inside `controls` is it.
  const storedPlacement = (next['controls'] as CarouselControls | null | undefined)?.placement;
  if (storedPlacement !== undefined) next['controlsPlacement'] = storedPlacement;
  return next as T & ContentSliderProps;
}

function headerNode(props: ContentSliderProps, tier: BreakpointTier | null): ReactNode {
  return carouselHeaderNode(props, tier);
}

function shellOptions(props: ContentSliderProps) {
  const filter = carouselFilterFromProps(props.filter);
  return {
    ...carouselShellOptions(props),
    layout: props.layout === 'grid' ? ('grid' as const) : ('carousel' as const),
    ...(props.columns !== undefined ? { columns: props.columns } : {}),
    ...(filter ? { filter } : {}),
  };
}

/** The box fields today's slider had, for `BoxStyled`. */
function boxOf(props: ContentSliderProps) {
  return {
    ...(props.margin !== undefined ? { margin: props.margin } : {}),
    ...(props.padding !== undefined ? { padding: props.padding } : {}),
    ...(props.border !== undefined ? { border: props.border } : {}),
  };
}

const ContentSliderEditingRender: PuckComponent<ContentSliderProps> = (raw) => {
  const tier = usePreviewBreakpointTier();
  const props = contentSliderFromLegacy(raw as unknown as Record<string, unknown>) as unknown as ContentSliderProps;
  const Slot = props.slides as unknown as ComponentType<typeof CONTENT_SLIDER_SLOT_EDIT_PROPS>;
  const sliderId = (raw as { id?: string }).id ?? '';
  const previewPage = useEditorCarouselPage(sliderId);
  const editorSlideCount = usePageBuilderPuck((state) => getSlotZoneItemCount(state.appState.data, `${sliderId}:slides`));
  const header = headerNode(props, tier);

  return (
    <BoxStyled {...boxOf(props)} previewTier={tier}>
      <CarouselShell
        {...shellOptions(props)}
        header={header}
        slotMode
        editorPreview
        previewTier={tier}
        previewPage={previewPage}
        editorCarouselId={sliderId}
        editorSlideCount={editorSlideCount}
      >
        <Slot {...CONTENT_SLIDER_SLOT_EDIT_PROPS} />
      </CarouselShell>
    </BoxStyled>
  );
};

type PublishedSlot = ComponentType<{ className?: string; as?: typeof CarouselSlides }>;

const ContentSliderPublishedRender: PuckComponent<ContentSliderProps> = (raw) => {
  const props = contentSliderFromLegacy(raw as unknown as Record<string, unknown>) as unknown as ContentSliderProps;
  const Slot = props.slides as unknown as PublishedSlot;
  const header = headerNode(props, null);
  const label = typeof props.header?.heading === 'string' ? props.header.heading : undefined;
  // The block's id, not `useId()`: the same on the server and on hydration (T141).
  const sliderId = (raw as { id?: string }).id;

  return (
    <BoxStyled {...boxOf(props)}>
      <CarouselShell
        {...shellOptions(props)}
        header={header}
        {...(label ? { label } : {})}
        {...(sliderId ? { instanceId: sliderId } : {})}
        slotMode
      >
        {/* Each slot child becomes a slide group, "n of m". */}
        <Slot className="cmsc-pb-content-slider-slot" as={CarouselSlides} />
      </CarouselShell>
    </BoxStyled>
  );
};

// R17 (T204): a switch; stored `true` / `false` as before.
const FILTER_SHOW_FIELD = createToggleField({ label: 'Show a filter bar' });

const CONTENT_SLIDER_FIELDS = {
  ...CAROUSEL_HEADER_FIELDS,
  slides: {
    type: 'slot' as const,
    label: 'Slides',
    // Row is accepted then wrapped into a Slide by the page-builder onAction handler.
    allow: [...CAROUSEL_SLIDE_TYPES, 'cms.Row'],
    disallow: ['cms.Column', 'cms.ContentSlider'],
  },
  // T130: the same items as a carousel or a grid.
  layout: {
    type: 'radio' as const,
    label: 'Layout',
    options: [
      { label: 'Carousel', value: 'carousel' },
      { label: 'Grid', value: 'grid' },
    ],
  },
  columns: { type: 'number' as const, label: 'Columns', min: 1, max: 6, metadata: PB_RESPONSIVE_METADATA },
  ...CAROUSEL_TRACK_FIELDS,
  // T131: an optional filter bar over the items' tags.
  filter: {
    type: 'object' as const,
    label: 'Filter',
    objectFields: {
      show: FILTER_SHOW_FIELD,
      allLabel: { type: 'text' as const, label: '“All” label (empty: the page language’s word)' },
      tags: {
        type: 'array' as const,
        label: 'Tags to filter by',
        arrayFields: {
          tag: { type: 'text' as const, label: 'Tag (as on the items)' },
          label: { type: 'text' as const, label: 'Label shown' },
        },
        defaultItemProps: { tag: '', label: '' },
        getItemSummary: (item: { tag?: string; label?: string }, index?: number) =>
          item.label?.trim() || item.tag?.trim() || `Tag ${(index ?? 0) + 1}`,
      },
      // T143: the bar's look and alignment; pills at the start are today's.
      style: {
        type: 'select' as const,
        label: 'Bar style',
        options: [
          { label: 'Pills', value: 'pills' },
          { label: 'Underlined tabs', value: 'underline' },
        ],
      },
      align: {
        type: 'select' as const,
        label: 'Bar alignment',
        options: [
          { label: 'Left', value: 'start' },
          { label: 'Center', value: 'center' },
          { label: 'Right', value: 'end' },
        ],
      },
      // T161: buttons that do not fit; unset keeps today's wrapping.
      overflow: {
        type: 'radio' as const,
        label: 'Buttons that do not fit',
        options: [
          { label: 'Wrap onto more lines', value: 'wrap' },
          { label: 'Scroll in one line', value: 'scroll' },
        ],
      },
    },
  },
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

/** The carousel-only options, hidden for the grid (T130). */
const CAROUSEL_ONLY = new Set(['slidesPerView', 'effect', 'controls', 'controlsPlacement', 'controlsAlign', 'controlsAlignTo', 'loop', 'bleed', 'autoplay', 'intervalMs']);

/** Three image slides, so a new carousel shows what it is (contracts/blocks.md). */
function defaultSlides() {
  return [1, 2, 3].map(() => ({
    type: 'cms.CarouselImage',
    props: {
      image: { imageSource: 'library', alt: '', ratio: '4:3' },
      captionPlacement: 'bottom-center',
      captionStyle: { borderWidth: 0, borderRadius: 'small', paddingPx: 8 },
      hoverZoom: false,
    },
  }));
}

const contentSliderConfig: ComponentConfig<{ props: ContentSliderProps }> = {
  label: 'Carousel',
  fields: CONTENT_SLIDER_FIELDS as unknown as Fields<ContentSliderProps>,
  defaultProps: {
    headingLevel: 'h2',
    headingSize: 'h3',
    slides: defaultSlides() as unknown as ContentSliderProps['slides'],
    slidesPerView: { base: 1.15, tablet: 2, desktop: 3 },
    gap: 's',
    effect: 'slide',
    controls: { arrows: true, dots: false },
    controlsPlacement: 'below',
    bleed: 'none',
    autoplay: false,
    intervalMs: 6000,
    equalHeight: true,
    layout: 'carousel',
    columns: { base: 1, tablet: 2, desktop: 3 },
    filter: { show: false, allLabel: '', tags: [] },
    ...DEFAULT_BOX_PROPS,
    padding: DEFAULT_LAYOUT_PADDING,
  } as unknown as ContentSliderProps,
  // A slider stored before is carried into the new shape when it is opened.
  resolveData: ({ props }) => ({
    props: carouselPlacementMoved(contentSliderFromLegacy(props as unknown as Record<string, unknown>)) as unknown as ContentSliderProps,
  }),
  // Filters the host's field set, so the admin's pickers survive; the Custom px show once Custom is chosen.
  resolveFields: (data, params) => {
    const props = contentSliderFromLegacy(data.props as unknown as Record<string, unknown>) as unknown as ContentSliderProps;
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries((params?.fields as Record<string, unknown> | undefined) ?? CONTENT_SLIDER_FIELDS)) {
      if (key === 'gapPx' && !usesCustom(props.gap)) continue;
      if (key === 'headingSizePx' && !usesCustom(props.headingSize)) continue;
      if (isUnusedHeadingMaxWidthPx(key, props)) continue;
      if (key === 'slidesPerView' && props.effect === 'fade') continue;
      if (props.layout === 'grid' && CAROUSEL_ONLY.has(key)) continue;
      if (props.layout !== 'grid' && key === 'columns') continue;
      fields[key] = field;
    }
    // R17 (T213): the interval, the arrows' look and the controls' placement only where they apply.
    if (props.layout !== 'grid') withoutUnusedCarouselFields(props, fields);
    return fields as unknown as Fields<ContentSliderProps>;
  },
  render: (props) =>
    props.puck?.isEditing ? <ContentSliderEditingRender {...props} /> : <ContentSliderPublishedRender {...props} />,
};

export const ContentSlider = withHideOn(contentSliderConfig);
