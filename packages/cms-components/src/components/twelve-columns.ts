import { createToggleField, PB_RESPONSIVE_METADATA } from '@endora-commerce/page-builder-core';
import type { TwelveColumnLayout } from '../schema/component-types.js';

/**
 * Media and text side by side on a 12-column grid
 * (`specs/163-page-builder-marketing-pages/` R20F T310, shared by R21G T332):
 * the media `mediaSpan` columns at its side, `textOffset` columns between, the
 * text `textSpan` (the rest by default), mirrored for media at the end. The
 * values are `grid-column` values (`<start> / span <n>`). Nothing set: `null`,
 * so a block keeps its own layout.
 *
 * R22I (T371): `columnsAnchor` — where the pair sits on the 12 columns: at the
 * media's side (`media`, unset: today's — media at the end ends at column 12),
 * from column 1 (`start`) or to column 12 (`end`), whatever the media side.
 */

function wholeColumns(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export interface TwelveColumnSpans {
  mediaSpan?: unknown;
  textSpan?: unknown;
  textOffset?: unknown;
  /** R22I (T371): `'start'`, `'end'`, or the media's side (`'media'`, unset, anything else). */
  columnsAnchor?: unknown;
}

export function twelveColumns(spans: TwelveColumnSpans, side: 'start' | 'end'): { media: string; text: string } | null {
  const media = wholeColumns(spans.mediaSpan, 1, 11);
  const text = wholeColumns(spans.textSpan, 1, 11);
  const offset = wholeColumns(spans.textOffset, 0, 10);
  if (media === undefined && text === undefined && offset === undefined) return null;
  const mediaCols = media ?? 6;
  const gap = Math.min(offset ?? 0, 11 - mediaCols);
  const textCols = Math.max(1, Math.min(text ?? 12 - mediaCols - gap, 12 - mediaCols - gap));
  const anchor = spans.columnsAnchor === 'start' || spans.columnsAnchor === 'end' ? spans.columnsAnchor : side;
  if (anchor !== side) {
    // The pair at the other edge: its first column 1 (anchored at the start) or its last 12 (at the end).
    const first = anchor === 'start' ? 1 : 13 - (mediaCols + gap + textCols);
    return side === 'end'
      ? { media: `${first + textCols + gap} / span ${mediaCols}`, text: `${first} / span ${textCols}` }
      : { media: `${first} / span ${mediaCols}`, text: `${first + mediaCols + gap} / span ${textCols}` };
  }
  if (side === 'end') {
    const mediaStart = 13 - mediaCols;
    return { media: `${mediaStart} / span ${mediaCols}`, text: `${Math.max(1, mediaStart - gap - textCols)} / span ${textCols}` };
  }
  return { media: `1 / span ${mediaCols}`, text: `${mediaCols + gap + 1} / span ${textCols}` };
}

/**
 * R22I (T371): where the pair sits on the 12 columns. Unset is today's — at the
 * media's side, so media at the end ends at column 12 — which the first option
 * names, as a select shows its first option for an unset value.
 */
export const COLUMNS_ANCHOR_FIELD = {
  type: 'select' as const,
  label: 'Columns aligned to',
  options: [
    { label: 'The media side', value: 'media' },
    { label: 'Start (column 1)', value: 'start' },
    { label: 'End (column 12)', value: 'end' },
  ],
};

/**
 * R22I (T370): the space between the 12 columns per breakpoint, in px. Empty
 * keeps today's: the brand's grid gap where it writes one, else the side gutter.
 */
export const COLUMN_GAP_PX_FIELD = {
  type: 'number' as const,
  label: 'Space between columns (px)',
  min: 0,
  max: 200,
  step: 1,
  metadata: PB_RESPONSIVE_METADATA,
};

/** R22I: the fields that apply only with the columns of 12 (a block hides them otherwise). */
export const TWELVE_COLUMN_KEYS: ReadonlySet<string> = new Set(['columnsAnchor', 'columnGapPx']);

// ── R23 (T438): a layout preset, the raw numbers behind an Advanced switch ──

/**
 * The 12-column layouts an editor picks from: media columns, columns between,
 * text columns (named media first; a block with media at the end mirrors it).
 */
export const LAYOUT_PRESETS = {
  '6-6': [6, 0, 6],
  '7-5': [7, 0, 5],
  '5-7': [5, 0, 7],
  '8-4': [8, 0, 4],
  '4-8': [4, 0, 8],
  '5-1-6': [5, 1, 6],
  '6-1-5': [6, 1, 5],
} as const satisfies Record<TwelveColumnLayout, readonly [number, number, number]>;

const PRESET_LABELS: Record<TwelveColumnLayout, string> = {
  '6-6': '6 – 6',
  '7-5': '7 – 5',
  '5-7': '5 – 7',
  '8-4': '8 – 4',
  '4-8': '4 – 8',
  '5-1-6': '5 – 1 – 6 (a column between)',
  '6-1-5': '6 – 1 – 5 (a column between)',
};

/**
 * The layout select: **Default** (the block's own layout) first, then the
 * presets — all of them, or the ones a block can draw (`only`).
 */
export function layoutPresetField(label: string, only: readonly TwelveColumnLayout[] = Object.keys(LAYOUT_PRESETS) as TwelveColumnLayout[]) {
  return {
    type: 'select' as const,
    label,
    options: [{ label: 'Default', value: 'default' }, ...only.map((value) => ({ label: PRESET_LABELS[value], value }))],
  };
}

/** The presets without a column between: two tracks side by side (a card's image and text). */
export const TWO_TRACK_PRESETS: readonly TwelveColumnLayout[] = ['6-6', '7-5', '5-7', '8-4', '4-8'];

/** A preset's spans, or `null` for unset, `default` or an unknown value. */
export function presetSpans(layout: unknown): { mediaSpan: number; textOffset: number; textSpan: number } | null {
  if (typeof layout !== 'string' || !Object.prototype.hasOwnProperty.call(LAYOUT_PRESETS, layout)) return null;
  const [mediaSpan, textOffset, textSpan] = LAYOUT_PRESETS[layout as TwelveColumnLayout];
  return { mediaSpan, textOffset, textSpan };
}

/** The Advanced switch: shows the raw spans, offset and anchor, which then win over the preset. */
export const LAYOUT_ADVANCED_FIELD = createToggleField({ label: 'Advanced layout (columns of 12)' });

export interface TwelveColumnChoice extends TwelveColumnSpans {
  layout?: unknown;
  layoutAdvanced?: unknown;
}

const RAW_KEYS = ['mediaSpan', 'textSpan', 'textOffset', 'columnsAnchor'] as const;

/**
 * Whether the raw numbers apply: the switch on — or, with the switch never
 * stored and no preset chosen, raw numbers stored before it existed (R21G,
 * R22I), which keep rendering as they did.
 */
export function usesAdvancedLayout(props: TwelveColumnChoice, rawKeys: readonly string[] = RAW_KEYS): boolean {
  if (props.layoutAdvanced === true) return true;
  if (props.layoutAdvanced === false) return false;
  if (presetSpans(props.layout) !== null) return false;
  const record = props as Record<string, unknown>;
  return rawKeys.some((key) => record[key] !== undefined && record[key] !== null);
}

/** The spans `twelveColumns` reads: the raw ones with Advanced, else the preset's, else none. */
export function chosenSpans(props: TwelveColumnChoice): TwelveColumnSpans {
  if (usesAdvancedLayout(props)) {
    const out: TwelveColumnSpans = {};
    for (const key of RAW_KEYS) if (props[key] !== undefined && props[key] !== null) out[key] = props[key];
    return out;
  }
  return presetSpans(props.layout) ?? {};
}
