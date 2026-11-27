'use client';

import type { ArrayField, Field, ObjectField } from '@puckeditor/core';
import { createColorField, PB_RESPONSIVE_METADATA, type ButtonSpec } from '@endora-commerce/page-builder-core';
import { BUTTON_LOOK_FIELDS, createIconPickerField } from '@endora-commerce/cms-components';
import { createLinkField } from './LinkField.js';

/**
 * The `buttons: ButtonSpec[]` field of the reshaped section blocks — Hero,
 * MediaText, CtaCard, BackgroundPanel, Statement
 * (`specs/163-page-builder-marketing-pages/` research R-11, data-model §3.2).
 *
 * Each item carries everything a button had on `cms.Button` and on the old
 * Hero's single button: label, link (now any `LinkValue` kind), style, fill —
 * `text` is today's `ghost` — size, an optional icon and its position, and the
 * per-button background and text colour overrides (plan § *Extend, don't
 * narrow*). Style and fill are stored as plain values unless `responsive` is
 * set: `cms.Button` keeps today's per-breakpoint variant as a per-breakpoint
 * style and fill (data-model §3.2, {@link createButtonSpecField}); the renderer
 * reads both forms.
 */

export const DEFAULT_BUTTON_SPEC: ButtonSpec = {
  label: 'Learn more',
  link: { kind: 'url', href: '/' },
  style: 'primary',
  fill: 'solid',
  size: 'medium',
};

const BUTTON_STYLE_OPTIONS = [
  { label: 'Primary', value: 'primary' },
  { label: 'Secondary', value: 'secondary' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

const BUTTON_FILL_OPTIONS = [
  { label: 'Solid', value: 'solid' },
  { label: 'Outline', value: 'outline' },
  { label: 'Text only', value: 'text' },
];

const BUTTON_SIZE_OPTIONS = [
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' },
];

const BUTTON_ICON_POSITION_OPTIONS = [
  { label: 'Before the label', value: 'start' },
  { label: 'After the label', value: 'end' },
  { label: 'Icon only (round)', value: 'only' },
];

export interface ButtonListFieldOptions {
  label?: string;
  /** At most this many buttons; data-model §4 caps a section's buttons at 6. */
  max?: number;
  /** The item a new button starts from. */
  defaultItem?: ButtonSpec;
  /** Style and fill per breakpoint (the page builder's responsive select). */
  responsive?: boolean;
}

/**
 * The fields of one `ButtonSpec`, shared by the list and the single-button field.
 * R20E (T296): with the button look (`cms-components`' shared `BUTTON_LOOK_FIELDS`)
 * unless `look` is off — `cms.Button` keeps its look on the block, as stored.
 */
function buttonSpecFields(responsive: boolean, look = true): Partial<Record<keyof ButtonSpec, Field>> {
  const perBreakpoint = responsive ? { metadata: PB_RESPONSIVE_METADATA } : {};
  return {
    label: { type: 'text', label: 'Label' },
    link: createLinkField({ label: 'Link' }),
    style: { type: 'select', label: 'Style', options: BUTTON_STYLE_OPTIONS, ...perBreakpoint },
    fill: { type: 'select', label: 'Fill', options: BUTTON_FILL_OPTIONS, ...perBreakpoint },
    size: { type: 'select', label: 'Size', options: BUTTON_SIZE_OPTIONS },
    icon: createIconPickerField('Icon'),
    iconPosition: { type: 'select', label: 'Icon position', options: BUTTON_ICON_POSITION_OPTIONS },
    backgroundColor: createColorField({ label: 'Background color' }),
    textColor: createColorField({ label: 'Text color' }),
    ...(look ? (BUTTON_LOOK_FIELDS as unknown as Partial<Record<keyof ButtonSpec, Field>>) : {}),
  } as Partial<Record<keyof ButtonSpec, Field>>;
}

/** A Puck array field of `ButtonSpec` items. */
export function createButtonListField(options?: ButtonListFieldOptions): ArrayField<ButtonSpec[]> {
  return {
    type: 'array',
    label: options?.label ?? 'Buttons',
    min: 0,
    max: options?.max ?? 6,
    arrayFields: buttonSpecFields(options?.responsive === true) as ArrayField<ButtonSpec[]>['arrayFields'],
    defaultItemProps: options?.defaultItem ?? DEFAULT_BUTTON_SPEC,
    getItemSummary: (item: ButtonSpec, index?: number): string =>
      item.label.trim() !== '' ? item.label : `Button ${(index ?? 0) + 1}`,
  };
}

export interface ButtonSpecFieldOptions {
  label?: string;
  /** Style and fill per breakpoint, as `cms.Button`'s variant is today. */
  responsive?: boolean;
  /** R20E (T296): the button look fields; off for `cms.Button`, whose look is the block's own. Default on. */
  look?: boolean;
}

/**
 * A Puck object field of one `ButtonSpec` — `cms.Button`'s `button` prop
 * (`specs/163-page-builder-marketing-pages/` T039), with the same fields as an
 * item of {@link createButtonListField}.
 */
export function createButtonSpecField(options?: ButtonSpecFieldOptions): ObjectField<ButtonSpec> {
  return {
    type: 'object',
    label: options?.label ?? 'Button',
    objectFields: buttonSpecFields(options?.responsive === true, options?.look !== false) as ObjectField<ButtonSpec>['objectFields'],
  };
}
