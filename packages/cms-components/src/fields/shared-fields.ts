import {
  createBorderField,
  createBackgroundField,
  createColorField,
  createSpacingField,
  DEFAULT_BORDER,
  DEFAULT_SPACING,
  PB_RESPONSIVE_METADATA,
  withSharedFieldLabel,
} from '@endora-commerce/page-builder-core';

// R17 (T200): the fields every block shares carry their key in the `core`
// bundle, so they are translated once (`pageBuilder.sharedFields.<key>`).
export const BOX_MARGIN_FIELD = withSharedFieldLabel('margin', createSpacingField({ label: 'Outer spacing' }));
export const BOX_PADDING_FIELD = withSharedFieldLabel('padding', createSpacingField({ label: 'Inner spacing' }));
export const BOX_BORDER_FIELD = withSharedFieldLabel('border', createBorderField());
export const BACKGROUND_FIELD = withSharedFieldLabel('background', createBackgroundField({ label: 'Background' }));
export const TEXT_COLOR_FIELD = withSharedFieldLabel('color', createColorField({ label: 'Color' }));

export const CORNER_RADIUS_FIELD = withSharedFieldLabel('cornerRadius', {
  type: 'select' as const,
  label: 'Rounded corners',
  options: [
    { label: 'None', value: 'none' },
    { label: 'Small', value: 'small' },
    { label: 'Medium', value: 'medium' },
    { label: 'Large', value: 'large' },
  ],
});

export const SHADOW_FIELD = withSharedFieldLabel('shadow', {
  type: 'select' as const,
  label: 'Shadow',
  options: [
    { label: 'None', value: 'none' },
    { label: 'Soft', value: 'soft' },
    { label: 'Medium', value: 'medium' },
  ],
});

export const DEFAULT_CONTENT_MARGIN = {
  mode: 'sides' as const,
  top: 0,
  right: 0,
  bottom: 24,
  left: 0,
};

export const DEFAULT_LAYOUT_PADDING = {
  mode: 'uniform' as const,
  value: 16,
};

export const DEFAULT_LAYOUT_BOX_PROPS = {
  margin: DEFAULT_SPACING,
  padding: DEFAULT_LAYOUT_PADDING,
  border: DEFAULT_BORDER,
  background: { kind: 'none' as const },
  cornerRadius: 'none' as const,
  shadow: 'none' as const,
};

export const DEFAULT_BOX_PROPS = {
  margin: DEFAULT_CONTENT_MARGIN,
  padding: DEFAULT_SPACING,
  border: DEFAULT_BORDER,
  background: { kind: 'none' as const },
  cornerRadius: 'none' as const,
  shadow: 'none' as const,
};

export const RESPONSIVE_GAP_FIELD = {
  type: 'number' as const,
  label: 'Space between blocks',
  min: 0,
  max: 96,
  step: 4,
  metadata: PB_RESPONSIVE_METADATA,
};

// R17 (T209): every height and size in pixels says so.
export const RESPONSIVE_MIN_HEIGHT_FIELD = withSharedFieldLabel('minHeight', {
  type: 'number' as const,
  label: 'Minimum height (px)',
  min: 0,
  max: 800,
  step: 8,
  metadata: PB_RESPONSIVE_METADATA,
});

export const COLUMN_COUNT_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const n = index + 1;
  return { label: n === 1 ? '1 column' : `${n} columns`, value: n };
});

export const RESPONSIVE_COLUMNS_FIELD = {
  type: 'select' as const,
  label: 'Columns',
  metadata: PB_RESPONSIVE_METADATA,
  options: COLUMN_COUNT_OPTIONS,
};

export const TEXT_TYPOGRAPHY_FIELDS = {
  fontFamily: withSharedFieldLabel('fontFamily', {
    type: 'select' as const,
    label: 'Font',
    options: [
      { label: 'Sans-serif', value: 'sans' },
      { label: 'Serif', value: 'serif' },
      { label: 'Monospace', value: 'mono' },
    ],
  }),
  fontStyle: withSharedFieldLabel('fontStyle', {
    type: 'select' as const,
    label: 'Style',
    options: [
      { label: 'Normal', value: 'normal' },
      { label: 'Italic', value: 'italic' },
    ],
  }),
  color: TEXT_COLOR_FIELD,
  fontSize: withSharedFieldLabel('fontSize', {
    type: 'number' as const,
    label: 'Font size (px)',
    min: 10,
    max: 96,
    step: 1,
    metadata: PB_RESPONSIVE_METADATA,
  }),
  fontWeight: withSharedFieldLabel('fontWeight', {
    type: 'select' as const,
    label: 'Font weight',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Light (300)', value: 300 },
      { label: 'Regular (400)', value: 400 },
      { label: 'Medium (500)', value: 500 },
      { label: 'Semibold (600)', value: 600 },
      { label: 'Bold (700)', value: 700 },
      { label: 'Extra bold (800)', value: 800 },
    ],
  }),
  textAlign: withSharedFieldLabel('textAlign', {
    type: 'select' as const,
    label: 'Align',
    metadata: PB_RESPONSIVE_METADATA,
    options: [
      { label: 'Left', value: 'left' },
      { label: 'Center', value: 'center' },
      { label: 'Right', value: 'right' },
    ],
  }),
  lineHeight: withSharedFieldLabel('lineHeight', {
    type: 'number' as const,
    label: 'Line height',
    min: 1,
    max: 2.5,
    step: 0.05,
    metadata: PB_RESPONSIVE_METADATA,
  }),
};

export const COLUMN_SPAN_OPTIONS = Array.from({ length: 12 }, (_, index) => {
  const n = index + 1;
  return { label: n === 12 ? '12/12 (full)' : `${n}/12`, value: n };
});
