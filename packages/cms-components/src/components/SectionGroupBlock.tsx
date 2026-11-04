'use client';

import type { ComponentConfig, Fields, PuckComponent, SlotComponent } from '@puckeditor/core';
import type { ComponentType, ReactNode } from 'react';
import {
  createSectionAnchorField,
  createSectionBackgroundField,
  createSectionSpaceField,
  withHideOn,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { SectionGroupBlockProps } from '../schema/component-types.js';
import type { LayoutSlotEditProps } from '../editor/slot-edit-props.js';
import { SectionGroupFrame, type SectionGroupSettingsValue } from './Section.js';

/**
 * `cms.SectionGroup` — `specs/163-page-builder-marketing-pages/` T158, FR-005
 * as amended 2026-10-26, contracts/blocks.md "`cms.SectionGroup`", plan
 * § *Owner ruling 2026-10-26: a Section group container*.
 *
 * A top-level container whose slot holds only `cms.Section`s. It owns a
 * colour scheme, a background (solid, gradient, image or video with its
 * overlay, and the decorative layer) and optional spacing, painted once
 * behind all its Sections, so the decorative layer has no seam at a Section
 * boundary. The Sections in it inherit its scheme unless they set their own.
 * It is the one place a Section may be nested; the group itself stands only
 * at the top level (`ROOT_ONLY_TYPES`), and every other slot refuses it.
 *
 * Neutral by default: nothing stored until an edit — no scheme, no
 * background, no spacing (`none`), so an empty group of plain Sections looks
 * exactly as those Sections would without it.
 */

/** The group's slot: a vertical stack of Sections. */
const GROUP_SLOT_EDIT_PROPS: LayoutSlotEditProps = {
  minEmptyHeight: 120,
  collisionAxis: 'y',
  className: 'cmsc-pb-slot',
};

/** What a group's slot admits: Sections, and nothing else. */
export const SECTION_GROUP_SLOT_ALLOW = ['cms.Section'] as const;

/** The props the group's frame renders from: its settings, without the slot and the editor's own. */
function settingsOf(props: SectionGroupSettingsValue): SectionGroupSettingsValue {
  const { anchor, scheme, background, spaceTop, spaceBottom } = props;
  const settings: SectionGroupSettingsValue = {};
  if (anchor !== undefined) settings.anchor = anchor;
  if (scheme !== undefined) settings.scheme = scheme;
  if (background !== undefined) settings.background = background;
  if (spaceTop !== undefined) settings.spaceTop = spaceTop;
  if (spaceBottom !== undefined) settings.spaceBottom = spaceBottom;
  return settings;
}

type SectionGroupRenderProps = Parameters<PuckComponent<SectionGroupBlockProps>>[0];

function SectionGroupEditing({ props }: { props: SectionGroupRenderProps }): ReactNode {
  const tier = usePreviewBreakpointTier();
  const Content = props.content as unknown as ComponentType<LayoutSlotEditProps>;
  return (
    <SectionGroupFrame settings={settingsOf(props)} tier={tier} editing>
      <Content {...GROUP_SLOT_EDIT_PROPS} />
    </SectionGroupFrame>
  );
}

function SectionGroupPublished({ props }: { props: SectionGroupRenderProps }): ReactNode {
  const Content = props.content as unknown as SlotComponent;
  return (
    <SectionGroupFrame settings={settingsOf(props)}>
      <Content />
    </SectionGroupFrame>
  );
}

// Stable field objects: a field recreated on a render loses its input focus.
const SECTION_GROUP_FIELDS = {
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
  anchor: createSectionAnchorField({ label: 'Anchor' }),
  // Responsive: on the editor's Responsive tab; none until set.
  spaceTop: createSectionSpaceField({ label: 'Space above', defaultValue: 'none' }),
  spaceBottom: createSectionSpaceField({ label: 'Space below', defaultValue: 'none' }),
  content: {
    type: 'slot',
    label: 'Sections',
    allow: [...SECTION_GROUP_SLOT_ALLOW],
  },
} as unknown as Fields<SectionGroupBlockProps>;

/** The group's prop keys that support a value per breakpoint (`responsiveFields`, the manifest's too). */
export const SECTION_GROUP_RESPONSIVE_FIELDS = ['spaceTop', 'spaceBottom'] as const;

const sectionGroupConfig: ComponentConfig<{ props: SectionGroupBlockProps }> = {
  label: 'Section group',
  fields: SECTION_GROUP_FIELDS,
  defaultProps: {
    content: [],
  },
  render: (props) =>
    props.puck?.isEditing ? <SectionGroupEditing props={props} /> : <SectionGroupPublished props={props} />,
};

/** `cms.SectionGroup` — exported under the block name's local segment, as every block is. */
export const SectionGroup = withHideOn(sectionGroupConfig);
