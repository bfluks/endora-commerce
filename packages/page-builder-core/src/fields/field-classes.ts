/**
 * The class strings of the page builder's field controls
 * (`specs/163-page-builder-marketing-pages/` T115, T116). A module of plain
 * constants, without `'use client'`, so a server-rendered block's editing
 * branch reads them as strings.
 *
 * The colours are Puck's own variables (with Puck's values as fallbacks), the
 * focus ring is the admin's `ring` token: the controls sit among Puck's native
 * fields and must look like them (Law of Similarity).
 */

/**
 * The text input / select / number input of a page-builder field.
 *
 * It replaces `_Input-input_bsxfo_26`, Puck's CSS-module class from before
 * 0.23 that eighteen files spelled out: Puck renamed it (`_Input-input_qyenz_29`
 * in 0.23), so every custom control was rendering unstyled, at the browser's
 * intrinsic width — a `<select>` as wide as its longest option, an `<input>`
 * 20 characters wide — which is what made the side bar scroll sideways.
 * `w-full min-w-0 max-w-full` is what keeps a control inside its column.
 */
export const PB_FIELD_INPUT_CLASS =
  'box-border block w-full min-w-0 max-w-full rounded-[4px] border border-solid ' +
  'border-[color:var(--puck-color-border,#dcdcdc)] bg-[color:var(--puck-color-surface,#ffffff)] ' +
  'px-3 py-2 font-[inherit] text-sm text-[color:var(--puck-color-text,#000000)] ' +
  'hover:border-[color:var(--puck-color-border-hover,#767676)] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:cursor-default disabled:bg-[color:var(--puck-color-surface-muted,#f5f5f5)] ' +
  '[&[readonly]]:bg-[color:var(--puck-color-surface-muted,#f5f5f5)]';

/** A control's own label: smaller than Puck's field label, never faded below 4.5:1. */
export const PB_FIELD_LABEL_CLASS = 'text-xs font-medium text-[color:var(--puck-color-text-secondary,#5a5a5a)]';

/** Help text under a control. Same colour as the label (no opacity: it would drop under 4.5:1). */
export const PB_FIELD_HINT_CLASS = 'm-0 text-xs text-[color:var(--puck-color-text-secondary,#5a5a5a)]';
