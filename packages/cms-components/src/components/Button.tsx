'use client';

import { type ComponentConfig, type Fields, type PuckComponent } from '@puckeditor/core';
import {
  createColorField,
  isResponsiveProp,
  PB_RESPONSIVE_METADATA,
  resolveTextAlignForTier,
  responsiveTextAlignClass,
  textAlignDataAttrs,
  withHideOn,
  type ButtonFill,
  type ButtonSpec,
  type LinkValue,
  type ResponsiveProp,
} from '@endora-commerce/page-builder-core';
import { usePreviewBreakpointTier } from '@endora-commerce/page-builder-core/client';
import type { ButtonProps, ButtonVariant } from '../schema/component-types.js';
import { BoxStyled } from './box-styles.js';
import { ButtonView } from './ButtonView.js';
import { createIconPickerField } from './IconPickerField.js';
import { physicalAlign } from './block-align.js';
import { buttonWidthClasses, buttonWidthField } from './button-full-width.js';
import { BOX_BORDER_FIELD, BOX_MARGIN_FIELD, BOX_PADDING_FIELD, DEFAULT_BOX_PROPS } from '../fields/shared-fields.js';

/**
 * `cms.Button` (`specs/163-page-builder-marketing-pages/` contracts/blocks.md,
 * research R-11): one `ButtonSpec`, rendered by the shared `ButtonView`, and the
 * button's alignment in its box.
 *
 * Plan § *Extend, don't narrow*: today's responsive `variant` is a responsive
 * style and fill — `primary` → primary/solid, `secondary` → primary/outline
 * (white-filled on a light page, as today: `cmsc-pb-button` gives the outline
 * fill the scheme's background), `ghost` → primary/text — and today's
 * `backgroundColor` / `textColor` stay as the spec's overrides. A button stored
 * before the reshape keeps its fields and renders through the same renderer
 * ({@link buttonFromLegacy}); the editor carries it into the new shape once.
 */

const VARIANT_FILL: Record<ButtonVariant, ButtonFill> = { primary: 'solid', secondary: 'outline', ghost: 'text' };

function fillOf(variant: unknown): ButtonFill {
  return VARIANT_FILL[variant as ButtonVariant] ?? 'solid';
}

function fillFromVariant(variant: ButtonProps['variant']): ButtonFill | ResponsiveProp<ButtonFill> {
  // A value without `base` (T170): unset below its first breakpoint, so `fillOf` gives the default there.
  if (isResponsiveProp<ButtonVariant>(variant)) {
    const out: ResponsiveProp<ButtonFill> = { base: fillOf(variant.base) };
    if (variant.tablet !== undefined) out.tablet = fillOf(variant.tablet);
    if (variant.desktop !== undefined) out.desktop = fillOf(variant.desktop);
    return out;
  }
  return fillOf(variant);
}

function legacyLink(props: ButtonProps): LinkValue {
  const target = props.target === '_blank' ? { target: '_blank' as const } : {};
  const slug = props.linkSlug?.trim() ?? '';
  switch (props.linkType) {
    case 'product':
    case 'category':
    case 'page':
      return { kind: props.linkType, slug, ...target };
    default:
      return { kind: 'url', href: props.href?.trim() || '#', ...target };
  }
}

function overrideColor(value: string | undefined): string | undefined {
  return value && value !== 'transparent' ? value : undefined;
}

/**
 * Today's button as a `ButtonSpec`, value for value (the option-parity test
 * holds it): label, link type, slug or URL and target as the `LinkValue`,
 * variant as the style and fill, the colour overrides as they are.
 */
export function buttonFromLegacy(props: Record<string, unknown>): ButtonSpec {
  const legacy = props as ButtonProps;
  const backgroundColor = overrideColor(legacy.backgroundColor);
  const textColor = overrideColor(legacy.textColor);
  return {
    label: legacy.label ?? '',
    link: legacyLink(legacy),
    style: 'primary',
    fill: fillFromVariant(legacy.variant ?? 'primary'),
    size: 'medium',
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(textColor ? { textColor } : {}),
  };
}

const LEGACY_KEYS = ['label', 'linkType', 'linkSlug', 'href', 'target', 'variant', 'backgroundColor', 'textColor'] as const;

function specOf(props: ButtonProps): ButtonSpec {
  return props.button ?? buttonFromLegacy(props as unknown as Record<string, unknown>);
}

/** T168: the block's class, plus the full width per breakpoint when one is chosen. */
function buttonClassName(fullWidth: ButtonProps['fullWidth'], tier: 'mobile' | 'tablet' | 'desktop' | null): string {
  return ['cmsc-pb-button', ...buttonWidthClasses(fullWidth, tier, 'cmsc-btn')].join(' ');
}

const ButtonEditingRender: PuckComponent<ButtonProps> = (props) => {
  const tier = usePreviewBreakpointTier();
  const { button: _button, align, fullWidth, ...rest } = props;
  const box = withoutLegacy(rest);
  const textAlign = physicalAlign(align);
  return (
    <BoxStyled
      previewTier={tier}
      className="cmsc-pb-text-align"
      style={{ textAlign: resolveTextAlignForTier(textAlign, tier, 'left') }}
      {...box}
    >
      <ButtonView button={specAtTier(specOf(props), tier)} className={buttonClassName(fullWidth, tier)} />
    </BoxStyled>
  );
};

const ButtonPublishedRender: PuckComponent<ButtonProps> = (props) => {
  const { button: _button, align, fullWidth, ...rest } = props;
  const box = withoutLegacy(rest);
  const textAlign = physicalAlign(align);
  return (
    <div className={responsiveTextAlignClass(textAlign, 'left')} {...textAlignDataAttrs(textAlign, 'left')}>
      <BoxStyled {...box}>
        <ButtonView button={specOf(props)} className={buttonClassName(fullWidth, null)} />
      </BoxStyled>
    </div>
  );
};

/** In the editor canvas, the style and fill of the previewed breakpoint (as today's variant). */
export function specAtTier(spec: ButtonSpec, tier: 'mobile' | 'tablet' | 'desktop'): ButtonSpec {
  const pick = <T,>(value: T | ResponsiveProp<T>): T => {
    // A value without `base` (T170) is unset below its first breakpoint: `ButtonView` applies its default there.
    if (isResponsiveProp<T>(value)) {
      const responsive = value;
      if (tier === 'mobile') return responsive.base;
      if (tier === 'tablet') return responsive.tablet ?? responsive.base;
      return responsive.desktop ?? responsive.tablet ?? responsive.base;
    }
    return value as T;
  };
  return { ...spec, style: pick(spec.style), fill: pick(spec.fill) };
}

function withoutLegacy<T extends Record<string, unknown>>(props: T): T {
  const out = { ...props };
  for (const key of LEGACY_KEYS) delete out[key];
  return out;
}

// ── Fields ───────────────────────────────────────────────────────────

/**
 * The button's fields as this package can offer them: a plain link editor
 * (kind, URL, slug, anchor, target). The admin replaces `button` with
 * `page-builder-admin`'s `createButtonSpecField`, whose link field has the page,
 * product, category and file pickers (`PageBuilderEditor.tsx`).
 */
/** The properties of one `ButtonSpec` as plain fields — also each item of a hero's button list. */
export const BUTTON_SPEC_OBJECT_FIELDS = {
  label: { type: 'text' as const, label: 'Label' },
  link: {
    type: 'object' as const,
    label: 'Link',
    objectFields: {
      kind: {
        type: 'select' as const,
        label: 'Link type',
        options: [
          { label: 'URL', value: 'url' },
          { label: 'CMS page', value: 'page' },
          { label: 'Product', value: 'product' },
          { label: 'Category', value: 'category' },
          { label: 'File', value: 'asset' },
          { label: 'Section on this page', value: 'anchor' },
        ],
      },
      href: { type: 'text' as const, label: 'URL' },
      slug: { type: 'text' as const, label: 'Slug' },
      fileAssetId: { type: 'text' as const, label: 'File ID' },
      anchor: { type: 'text' as const, label: 'Anchor' },
      target: {
        type: 'select' as const,
        label: 'Target',
        options: [
          { label: 'Same tab', value: '_self' },
          { label: 'New tab', value: '_blank' },
        ],
      },
    },
  },
  style: {
    type: 'select' as const,
    label: 'Style',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Primary', value: 'primary' },
      { label: 'Secondary', value: 'secondary' },
      { label: 'Light', value: 'light' },
      { label: 'Dark', value: 'dark' },
    ],
  },
  fill: {
    type: 'select' as const,
    label: 'Fill',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Solid', value: 'solid' },
      { label: 'Outline', value: 'outline' },
      { label: 'Text only', value: 'text' },
    ],
  },
  size: {
    type: 'select' as const,
    label: 'Size',
    options: [
      { label: 'Small', value: 'small' },
      { label: 'Medium', value: 'medium' },
      { label: 'Large', value: 'large' },
    ],
  },
  icon: createIconPickerField('Icon'),
  iconPosition: {
    type: 'select' as const,
    label: 'Icon position',
    options: [
      { label: 'Before the label', value: 'start' },
      { label: 'After the label', value: 'end' },
      { label: 'Icon only (round)', value: 'only' },
    ],
  },
  backgroundColor: createColorField({ label: 'Background color' }),
  textColor: createColorField({ label: 'Text color' }),
};

const BUTTON_SPEC_FIELD = {
  type: 'object' as const,
  label: 'Button',
  objectFields: BUTTON_SPEC_OBJECT_FIELDS,
};

const BUTTON_FIELDS = {
  button: BUTTON_SPEC_FIELD,
  align: {
    type: 'select' as const,
    label: 'Align',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Start', value: 'start' },
      { label: 'Center', value: 'center' },
      { label: 'End', value: 'end' },
    ],
  },
  // T168: the full width per breakpoint (top level, Responsive tab); unset keeps today's.
  fullWidth: buttonWidthField('Width'),
  margin: BOX_MARGIN_FIELD,
  padding: BOX_PADDING_FIELD,
  border: BOX_BORDER_FIELD,
};

const buttonConfig: ComponentConfig<{ props: ButtonProps }> = {
  label: 'Button',
  fields: BUTTON_FIELDS as unknown as Fields<ButtonProps>,
  defaultProps: {
    button: { label: 'Call to action', link: { kind: 'url', href: '/' }, style: 'primary', fill: 'solid', size: 'medium' },
    align: 'start',
    ...DEFAULT_BOX_PROPS,
  },
  resolveData: async ({ props }) => {
    // A button stored before the reshape is carried into it once, with no change to its render.
    if (props.button === undefined) {
      return { props: { ...withoutLegacy(props as unknown as Record<string, unknown>), button: buttonFromLegacy(props as unknown as Record<string, unknown>) } as ButtonProps };
    }
    return { props };
  },
  render: (props) =>
    props.puck?.isEditing ? <ButtonEditingRender {...props} /> : <ButtonPublishedRender {...props} />,
};

export const Button = withHideOn(buttonConfig);
