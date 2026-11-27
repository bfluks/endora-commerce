import { COLOR_TOKEN_RE, HEX_COLOR_RE } from '@endora-commerce/page-builder-core';
import { colorValueToCss } from '../utils/color-value.js';

/**
 * `specs/163-page-builder-marketing-pages/` T175: an `emphasis` mark's colour
 * as stored and as painted — a `#rrggbb` literal, or a known brand colour token
 * (`token:<role>`, painted as its variable with today's literal). Anything else
 * is `null`, which leaves the variant's own colour. Shared by `InlineRich` (no
 * TipTap) and the TipTap mark, so both write the same colour.
 */
export function emphasisColor(value: unknown): { value: string; css: string } | null {
  if (typeof value !== 'string' || !(HEX_COLOR_RE.test(value) || COLOR_TOKEN_RE.test(value))) return null;
  const css = colorValueToCss(value);
  return css === undefined ? null : { value, css };
}

/** The attribute naming an emphasis's stored colour, which the sanitiser keeps on a `<span>` with a colour value only. */
export const EMPHASIS_COLOR_ATTR = 'data-cms-em-color';
