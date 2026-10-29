import { createToggleField, PB_RESPONSIVE_METADATA, type ButtonSpec } from '@endora-commerce/page-builder-core';
import { BUTTON_SPEC_OBJECT_FIELDS } from '../components/Button.js';
import { createIconPickerField } from '../components/IconPickerField.js';
import { TYPE_SIZE_OPTIONS } from '../components/Heading.js';

/**
 * The field shapes the composition blocks of `specs/163-page-builder-marketing-pages/`
 * US3 share (contracts/blocks.md): a heading's level and size, a Custom px, an
 * image, a button list, an icon, a spacing token. Plain Puck fields, as this
 * package can offer them; the admin swaps the image, the button list and the
 * uploaded icon for its library pickers (`PageBuilderEditor.tsx`).
 */

export const LEVEL_OPTIONS = [
  { label: 'H1', value: 'h1' },
  { label: 'H2', value: 'h2' },
  { label: 'H3', value: 'h3' },
  { label: 'H4', value: 'h4' },
  { label: 'H5', value: 'h5' },
  { label: 'H6', value: 'h6' },
  { label: 'Paragraph (not a heading)', value: 'p' },
];

export function levelField(label: string) {
  return { type: 'select' as const, label, options: LEVEL_OPTIONS };
}

/** A type-token size, responsive, with **Custom (px)**. */
export function sizeField(label: string) {
  return { type: 'select' as const, label, metadata: PB_RESPONSIVE_METADATA, options: TYPE_SIZE_OPTIONS };
}

/**
 * A size whose unset value is the block's own look (today's, for a reshaped
 * block): **Default** first, then the type tokens and Custom (px).
 */
export function sizeFieldWithDefault(label: string) {
  return {
    type: 'select' as const,
    label,
    metadata: PB_RESPONSIVE_METADATA,
    options: [{ label: 'Default', value: 'default' }, ...TYPE_SIZE_OPTIONS],
  };
}

export function sizePxField(label: string, min = 10, max = 200) {
  return { type: 'number' as const, label, min, max, step: 1, metadata: PB_RESPONSIVE_METADATA };
}

/** The spacing tokens with **Custom (px)** — a gap. */
export const GAP_OPTIONS = [
  { label: 'None', value: 'none' },
  { label: 'XS', value: 'xs' },
  { label: 'S', value: 's' },
  { label: 'M', value: 'm' },
  { label: 'L', value: 'l' },
  { label: 'XL', value: 'xl' },
  { label: 'XXL', value: 'xxl' },
  { label: 'Custom (px)', value: 'custom' },
];

export function gapField(label: string) {
  return { type: 'select' as const, label, metadata: PB_RESPONSIVE_METADATA, options: GAP_OPTIONS };
}

export function gapPxField(label: string) {
  return { type: 'number' as const, label, min: 0, max: 160, step: 1, metadata: PB_RESPONSIVE_METADATA };
}

// R17 (T214): the library first, as in every image and video source of the page builder.
const SOURCE_OPTIONS = [
  { label: 'Asset library', value: 'library' },
  { label: 'URL', value: 'url' },
];

/** A `ResponsiveImage` as plain fields; the admin replaces it with the asset-picking image field. */
export function imageObjectField(label: string) {
  return {
    type: 'object' as const,
    label,
    objectFields: {
      imageSource: { type: 'select' as const, label: 'Source', options: SOURCE_OPTIONS },
      src: { type: 'text' as const, label: 'Image URL' },
      assetId: { type: 'text' as const, label: 'Image (asset ID)' },
      mobileSrc: { type: 'text' as const, label: 'Mobile image URL' },
      mobileAssetId: { type: 'text' as const, label: 'Mobile image (asset ID)' },
      alt: { type: 'text' as const, label: 'Alt text' },
      fit: {
        type: 'select' as const,
        label: 'Fit',
        options: [
          { label: 'Cover', value: 'cover' },
          { label: 'Contain', value: 'contain' },
        ],
      },
    },
  };
}

/** A new button: the neutral primary one (plan § Extend, don't narrow, rule 3). */
export const DEFAULT_SECTION_BUTTON: ButtonSpec = {
  label: 'Learn more',
  link: { kind: 'url', href: '/' },
  style: 'primary',
  fill: 'solid',
  size: 'medium',
};

/** A list of `ButtonSpec`s; the admin replaces it with `createButtonListField` and its link pickers. */
export function buttonsField(label: string, max: number) {
  return {
    type: 'array' as const,
    label,
    max,
    arrayFields: BUTTON_SPEC_OBJECT_FIELDS,
    defaultItemProps: { ...DEFAULT_SECTION_BUTTON, label: 'Button' },
    getItemSummary: (item: { label?: string }) => item?.label || 'Button',
  };
}

/** The catalog icon, and an uploaded SVG (asset id) that wins over it; the admin picks the asset from the library. */
export function iconFields() {
  return {
    icon: createIconPickerField('Icon'),
    iconAssetId: { type: 'text' as const, label: 'Uploaded icon (SVG asset ID)' },
  };
}

/** R17 (T215): a side reads Left / Right; the stored values stay `start` / `end`. */
export const SIDE_OPTIONS = [
  { label: 'Left', value: 'start' },
  { label: 'Right', value: 'end' },
];

/** R17 (T206): alignment reads Left / Center / Right in every block; the stored values are unchanged. */
export const ALIGN_OPTIONS = [
  { label: 'Left', value: 'start' },
  { label: 'Center', value: 'center' },
  { label: 'Right', value: 'end' },
];

/** R17 (T219): a vertical alignment reads Top / Center / Bottom; the stored values are unchanged. */
export const VERTICAL_ALIGN_OPTIONS = [
  { label: 'Top', value: 'start' },
  { label: 'Center', value: 'center' },
  { label: 'Bottom', value: 'end' },
];

/** R17 (T206): a block's alignment, one per breakpoint (Responsive tab). */
export function alignField(label = 'Align', options: ReadonlyArray<{ label: string; value: string }> = ALIGN_OPTIONS) {
  return { type: 'select' as const, label, metadata: PB_RESPONSIVE_METADATA, options: [...options] };
}

/**
 * A block's entrance reveal (`RevealSetting`, research R-21): none, fade-and-rise
 * or word by word, optionally on desktop only. Unset means none, so a stored
 * block renders as before.
 */
const REVEAL_DESKTOP_ONLY_FIELD = createToggleField({ label: 'Desktop only' });

export function revealField(label = 'Entrance reveal') {
  return {
    type: 'object' as const,
    label,
    objectFields: {
      effect: {
        type: 'select' as const,
        label: 'Effect',
        options: [
          { label: 'None', value: 'none' },
          { label: 'Fade and rise', value: 'fade-up' },
          { label: 'Word by word', value: 'words' },
        ],
      },
      desktopOnly: REVEAL_DESKTOP_ONLY_FIELD,
    },
  };
}

/** Zoom the image on hover (a CSS transform, never under reduced motion; R-21). Off by default. */
export function hoverZoomField(label = 'Zoom on hover') {
  return createToggleField({ label });
}
