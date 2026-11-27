import type { BreakpointTier } from '@endora-commerce/page-builder-core';

/**
 * `specs/163-page-builder-marketing-pages/` R19B — a px number, one value or
 * one per breakpoint, as the custom properties `--pb-<name>`, `--pb-<name>-md`
 * and `--pb-<name>-lg`, **each written only where a value is set**: the
 * stylesheet reads `var(--pb-<name>-lg, var(--pb-<name>-md, var(--pb-<name>, <today's>)))`,
 * so an unset breakpoint inherits the one below and an unset value is today's.
 *
 * In the editor (`tier` set) only `--pb-<name>` is written, with the previewed
 * breakpoint's value (inheriting the one below). Out-of-range values are
 * clamped and rounded; anything not a finite number is ignored. `null` when
 * nothing is written, so a block can keep today's markup.
 */
export function responsivePxVars(
  name: string,
  value: unknown,
  tier: BreakpointTier | null,
  range: { min: number; max: number },
): Record<string, string> | null {
  const px = (entry: unknown): string | undefined =>
    typeof entry === 'number' && Number.isFinite(entry)
      ? `${Math.min(range.max, Math.max(range.min, Math.round(entry * 10) / 10))}px`
      : undefined;
  const stored = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : { base: value };
  const base = px(stored['base']);
  const tablet = px(stored['tablet']);
  const desktop = px(stored['desktop']);
  if (tier !== null) {
    const at = tier === 'desktop' ? (desktop ?? tablet ?? base) : tier === 'tablet' ? (tablet ?? base) : base;
    return at === undefined ? null : { [`--pb-${name}`]: at };
  }
  const out: Record<string, string> = {};
  if (base !== undefined) out[`--pb-${name}`] = base;
  if (tablet !== undefined) out[`--pb-${name}-md`] = tablet;
  if (desktop !== undefined) out[`--pb-${name}-lg`] = desktop;
  return Object.keys(out).length > 0 ? out : null;
}
