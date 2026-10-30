import type { CSSProperties } from 'react';
import { COLOR_TOKEN_RE, HEX_COLOR_RE, resolveColorValue } from '@endora-commerce/page-builder-core';

/**
 * A block colour (`ColorValue`, research R-6) as CSS — `token:<role>` as
 * `var(--cmsb-color-<role>, <literal>)`, anything else as it is. The role list
 * and its fallback literals are `page-builder-core`'s `BRAND_COLOR_ROLES`,
 * which the colour field's palette lists too.
 */
export { resolveColorValue };

/**
 * The strict form, for a colour that replaces a component's own: a `#rrggbb`
 * literal or a known `token:<role>`. Anything else — `transparent`, an unknown
 * role, a malformed value — is `undefined`, which leaves the component's own
 * colour in place.
 */
export function colorValueToCss(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (HEX_COLOR_RE.test(value)) return value;
  if (!COLOR_TOKEN_RE.test(value)) return undefined;
  return resolveColorValue(value);
}

/**
 * The props that colour a Lucide icon. A literal is its `color` attribute, as
 * before; a brand token is a CSS variable, which an SVG attribute does not
 * read, so the icon strokes `currentColor` and the variable is its CSS colour.
 */
export function iconColorProps(value: string | undefined): { color?: string; style?: CSSProperties } {
  const resolved = resolveColorValue(value);
  if (resolved === undefined) return {};
  if (resolved.startsWith('var(')) return { color: 'currentColor', style: { color: resolved } };
  return { color: resolved };
}
