'use client';

import type { ComponentConfig, Fields, PuckComponent, SlotComponent } from '@puckeditor/core';
import type { ComponentType, ReactNode } from 'react';
import {
  PB_RESPONSIVE_METADATA,
  SECTION_WIDTHS_WITH_CONTENT_WIDTH,
  createSectionAnchorField,
  createSectionBackgroundField,
  createSectionRevealField,
  createSectionSpaceField,
  withHideOn,
  type SectionSettingsValue,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { SectionBlockProps } from '../schema/component-types.js';
import type { LayoutSlotEditProps } from '../editor/slot-edit-props.js';
import { SectionFrame } from './Section.js';

/**
 * `cms.Section` — `specs/163-page-builder-marketing-pages/` FR-000–FR-005,
 * contracts/blocks.md "`cms.Section`", plan § *Owner ruling 2026-10-23*.
 *
 * The one block that carries section settings — and a slot that holds any
 * other blocks. It stands only at the top level of a page — or in the slot of
 * a top-level `cms.SectionGroup` (T158), the one slot that admits it: every
 * other slot refuses it and the editor guard reverts a drop into one
 * (`ROOT_ONLY_TYPES`); a Section stored nested elsewhere renders its children
 * only.
 *
 * Its settings are its own top-level props (T117), one field each, so the
 * editor lays them out as it does every block's: the responsive ones —
 * `spaceTop`, `spaceBottom`, `contentPosition`, `overlap` (T148) — carry the responsive metadata
 * and sit on the **Responsive** tab, edited per breakpoint through its scope
 * switcher, as `cms.Row`'s are; `scheme`, `background`, `width`,
 * `contentWidth` (shown with a `full`, `viewport` or `bleed` width, T124),
 * `customMaxWidthPx` (shown with a custom width), `anchor` and `reveal` stay
 * on the main tab, the rarely used anchor and reveal last.
 *
 * Its defaults are neutral (plan § *Extend, don't narrow*, rule 3): nothing is
 * stored until an edit — no scheme, no background, contained, the default
 * spacing (`'l'`).
 */

/** Section content slot — a vertical stack of blocks. */
const SECTION_SLOT_EDIT_PROPS: LayoutSlotEditProps = {
  minEmptyHeight: 120,
  collisionAxis: 'y',
  className: 'cmsc-pb-slot',
};

/** What a Section's slot refuses: a Column belongs in a Row, and a Section or a Section group stands only at the top level. */
export const SECTION_SLOT_DISALLOW = ['cms.Section', 'cms.SectionGroup', 'cms.Column'] as const;

/** The props `cms.Section`'s frame renders from: its settings, without the slot and the editor's own. */
function settingsOf(props: SectionSettingsValue): SectionSettingsValue {
  const { anchor, scheme, background, width, contentWidth, customMaxWidthPx, spaceTop, spaceBottom, contentPosition, reveal, overlap } =
    props;
  const settings: SectionSettingsValue = {};
  if (anchor !== undefined) settings.anchor = anchor;
  if (scheme !== undefined) settings.scheme = scheme;
  if (background !== undefined) settings.background = background;
  if (width !== undefined) settings.width = width;
  if (contentWidth !== undefined) settings.contentWidth = contentWidth;
  if (customMaxWidthPx !== undefined) settings.customMaxWidthPx = customMaxWidthPx;
  if (spaceTop !== undefined) settings.spaceTop = spaceTop;
  if (spaceBottom !== undefined) settings.spaceBottom = spaceBottom;
  if (contentPosition !== undefined) settings.contentPosition = contentPosition;
  if (reveal !== undefined) settings.reveal = reveal;
  if (overlap !== undefined) settings.overlap = overlap;
  return settings;
}

type SectionRenderProps = Parameters<PuckComponent<SectionBlockProps>>[0];

function SectionEditing({ props }: { props: SectionRenderProps }): ReactNode {
  const tier = usePreviewBreakpointTier();
  const Content = props.content as unknown as ComponentType<LayoutSlotEditProps>;
  return (
    <SectionFrame settings={settingsOf(props)} tier={tier} editing>
      <Content {...SECTION_SLOT_EDIT_PROPS} />
    </SectionFrame>
  );
}

function SectionPublished({ props }: { props: SectionRenderProps }): ReactNode {
  const Content = props.content as unknown as SlotComponent;
  return (
    <SectionFrame settings={settingsOf(props)}>
      <Content />
    </SectionFrame>
  );
}

// Stable field objects: a field recreated on a render loses its input focus.
const SECTION_FIELDS = {
  scheme: {
    type: 'select',
    label: 'Color scheme',
    options: [
      { label: 'Inherit', value: 'inherit' },
      { label: 'Light', value: 'light' },
      { label: 'Muted', value: 'muted' },
      { label: 'Dark', value: 'dark' },
    ],
  },
  background: createSectionBackgroundField({ label: 'Background' }),
  width: {
    type: 'select',
    label: 'Width',
    options: [
      { label: 'Contained (page container)', value: 'contained' },
      { label: 'Wide', value: 'wide' },
      { label: 'Full page width', value: 'full' },
      { label: 'Full viewport height, content in the container', value: 'viewport' },
      { label: 'Full bleed (content to the edges)', value: 'bleed' },
      { label: 'Custom max width', value: 'custom' },
    ],
  },
  // T124: with a background wider than the page container, the content's own frame.
  contentWidth: {
    type: 'select',
    label: 'Content width',
    options: [
      { label: 'Page container', value: 'contained' },
      { label: 'Wide', value: 'wide' },
      { label: 'To the edges', value: 'full' },
      { label: 'Custom max width', value: 'custom' },
    ],
  },
  // R17 (T208, T209): worded and ranged as every custom maximum width (stored values are not clamped).
  customMaxWidthPx: { type: 'number', label: 'Custom max width (px)', min: 160, max: 2000, step: 10 },
  anchor: createSectionAnchorField({ label: 'Anchor' }),
  reveal: createSectionRevealField({ label: 'Entrance reveal' }),
  // Responsive: on the editor's Responsive tab, per breakpoint through its scope switcher.
  spaceTop: createSectionSpaceField({ label: 'Space above' }),
  spaceBottom: createSectionSpaceField({ label: 'Space below' }),
  contentPosition: {
    type: 'select',
    label: 'Content position',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Top', value: 'start' },
      { label: 'Middle', value: 'center' },
      { label: 'Bottom', value: 'end' },
    ],
  },
  // T148: pull the content up into the previous section; none until set.
  overlap: createSectionSpaceField({ label: 'Overlap with the previous section', defaultValue: 'none' }),
  content: {
    type: 'slot',
    label: 'Content',
    disallow: [...SECTION_SLOT_DISALLOW],
  },
} as unknown as Fields<SectionBlockProps>;

/** The section's prop keys that support a value per breakpoint (`responsiveFields`, the manifest's too). */
export const SECTION_RESPONSIVE_FIELDS = ['spaceTop', 'spaceBottom', 'contentPosition', 'overlap'] as const;

const sectionConfig: ComponentConfig<{ props: SectionBlockProps }> = {
  label: 'Section',
  fields: SECTION_FIELDS,
  defaultProps: {
    content: [],
  },
  // The content width only with a background wider than the page container
  // (T124); the custom max width only with a custom width or content width, as
  // `cms.Row` offers its own.
  resolveFields: (data, { fields }) => {
    const width = data.props.width ?? 'contained';
    const withContentWidth = SECTION_WIDTHS_WITH_CONTENT_WIDTH.includes(width);
    const custom = width === 'custom' || (withContentWidth && data.props.contentWidth === 'custom');
    // Filtered in place, so the fields keep their order.
    return Object.fromEntries(
      Object.entries(fields as Record<string, unknown>).filter(
        ([key]) => (key !== 'contentWidth' || withContentWidth) && (key !== 'customMaxWidthPx' || custom),
      ),
    ) as Fields<SectionBlockProps>;
  },
  render: (props) =>
    props.puck?.isEditing ? <SectionEditing props={props} /> : <SectionPublished props={props} />,
};

/** `cms.Section` — exported under the block name's local segment, as every block is. */
export const Section = withHideOn(sectionConfig);
