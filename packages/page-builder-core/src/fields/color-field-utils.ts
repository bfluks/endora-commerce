import { BRAND_COLOR_ROLES, brandColorFallback, brandColorRole } from '../types/brand-colors.js';

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export { BRAND_COLOR_ROLES };

/**
 * Feature 163, T040 (research R-6) — whether a colour field may store a
 * brand-token reference. The page builder's blocks resolve `token:<role>` to a
 * CSS variable; the e-mail builder renders HTML for mail clients, where a CSS
 * variable means nothing, so tokens are opt-in per palette.
 */
export interface ColorValueOptions {
  tokens?: boolean;
}

/** A `token:<role>` value naming one of the brand colour roles. */
export function isBrandColorToken(value: string): boolean {
  return brandColorRole(value) !== null;
}

/** The value a colour field stores for "inherit the surrounding text colour" (R18, T222). */
export const INHERITED_COLOR = 'currentColor';

/**
 * Whether `value` inherits the surrounding text colour — `currentColor` (the
 * stored default of a new `cms.Icons` / `cms.Social`) or `inherit`. The field
 * shows it as an "Inherited (text color)" state, never as the raw word.
 */
export function isInheritedColor(value: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const normalised = value.trim().toLowerCase();
  return normalised === 'currentcolor' || normalised === 'inherit';
}

/** Display value for the text input — empty string means transparent, or inherited (R18, T222). */
export function colorFieldDisplayValue(value: string | undefined): string {
  if (value === undefined || value === '' || value === 'transparent' || isInheritedColor(value)) return '';
  return value;
}

/** Committed Puck value — undefined means transparent. A brand token only where tokens are allowed. */
export function colorFieldCommitValue(next: string, options?: ColorValueOptions): string | undefined {
  if (!next || next === 'transparent') return undefined;
  if (HEX_COLOR.test(next)) return next;
  if (options?.tokens === true && isBrandColorToken(next)) return next;
  return undefined;
}

/** @deprecated Use colorFieldDisplayValue — kept for internal comparisons. */
export function normalizeColorFieldValue(value: string | undefined): string {
  return colorFieldDisplayValue(value);
}

export function isTransparentColor(value: string): boolean {
  return value === 'transparent' || value === '';
}

/** Native color input only accepts #RRGGBB — use a neutral preview when transparent. */
export function colorPickerDisplayHex(value: string): string {
  if (isTransparentColor(value)) return '#ffffff';
  if (HEX_COLOR.test(value)) return value;
  // A brand token previews the literal it falls back to.
  const role = brandColorRole(value);
  if (role) return brandColorFallback(role);
  return '#ffffff';
}

export function parseColorTextInput(
  raw: string,
  options?: ColorValueOptions,
): { display: string; commit?: string | undefined } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'transparent') {
    return { display: '', commit: undefined };
  }
  if (trimmed.startsWith('token:')) {
    return options?.tokens === true && isBrandColorToken(trimmed) ? { display: trimmed, commit: trimmed } : { display: raw };
  }
  const next = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  if (HEX_COLOR.test(next)) {
    return { display: next, commit: next };
  }
  return { display: raw };
}

export function isValidHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}
