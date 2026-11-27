/** Breakpoint tier used for responsive prop resolution and hide-on. */
export type BreakpointTier = 'mobile' | 'tablet' | 'desktop';

/** Editor scope selector labels (Base = mobile/default tier). */
export type SettingsScope = 'base' | 'tablet' | 'desktop';

/**
 * Author-facing responsive value with inheritance: desktop ← tablet ← base.
 * `base` applies to mobile and acts as the fallback for higher tiers.
 */
export type ResponsiveProp<T> = {
  base: T;
  tablet?: T;
  desktop?: T;
};

/** Per-tier hide flags — when true, the component is hidden on that screen size. */
export type HideOn = {
  mobile?: boolean;
  tablet?: boolean;
  desktop?: boolean;
};

/**
 * Page Builder surface where a component may appear. `document` is the
 * document-template editor's (`specs/152-compare-pdf-template/`).
 */
export type PageBuilderContext = 'cms' | 'email' | 'invoice' | 'newsletter' | 'document';

export const PAGE_BUILDER_CONTEXTS = ['cms', 'email', 'invoice', 'newsletter', 'document'] as const;

export const DEFAULT_BREAKPOINTS = {
  tabletMin: 768,
  desktopMin: 1024,
} as const;

export type PageBuilderBreakpoints = {
  tabletMin: number;
  desktopMin: number;
};

export const SETTINGS_SCOPE_LABELS: Record<SettingsScope, string> = {
  base: 'Base',
  tablet: 'Tablet',
  desktop: 'Desktop',
};

export function settingsScopeToTier(scope: SettingsScope): BreakpointTier {
  if (scope === 'tablet') return 'tablet';
  if (scope === 'desktop') return 'desktop';
  return 'mobile';
}

const RESPONSIVE_KEYS: ReadonlySet<string> = new Set(['base', 'tablet', 'desktop']);

/**
 * Whether `value` is a per-breakpoint value. One with `base` always is (as
 * written by the editor); one without `base` (an API write, an import) is when
 * it holds `tablet` and/or `desktop` and no other key, so a plain object value
 * — spacing parts, a colour, hide-on flags — is never taken for one
 * (`specs/163-page-builder-marketing-pages/` T170). Without `base`, a value
 * reads as "no value below the first breakpoint that has one": see
 * {@link normalizeResponsive}.
 */
export function isResponsiveProp<T>(value: unknown): value is ResponsiveProp<T> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if ('base' in (value as Record<string, unknown>)) return true;
  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length > 0 && keys.every((key) => RESPONSIVE_KEYS.has(key));
}

/**
 * Coerce a plain or responsive value into `ResponsiveProp<T>`. A responsive
 * value stored without `base` takes `fallback` as its base — what an unset
 * value gives — so the breakpoints below the first one that has a value render
 * as unset and the ones from it up inherit as usual (T170).
 */
export function normalizeResponsive<T>(value: T | ResponsiveProp<T> | undefined, fallback: T): ResponsiveProp<T> {
  if (value === undefined) return { base: fallback };
  if (isResponsiveProp<T>(value)) return value.base === undefined ? { ...value, base: fallback } : value;
  return { base: value };
}

/** Resolve the effective value for a breakpoint tier (inheritance chain). */
export function resolveResponsive<T>(value: T | ResponsiveProp<T> | undefined, tier: BreakpointTier, fallback: T): T {
  const responsive = normalizeResponsive(value, fallback);
  if (tier === 'mobile') return responsive.base;
  if (tier === 'tablet') return responsive.tablet ?? responsive.base;
  return responsive.desktop ?? responsive.tablet ?? responsive.base;
}

/** True when the tier has its own explicit override (not inherited). */
export function hasResponsiveOverride<T>(
  value: T | ResponsiveProp<T> | undefined,
  tier: BreakpointTier,
): boolean {
  if (!isResponsiveProp(value)) return false;
  if (tier === 'tablet') return value.tablet !== undefined;
  if (tier === 'desktop') return value.desktop !== undefined;
  return false;
}

export function tierFromViewportWidth(width: number, breakpoints: PageBuilderBreakpoints = DEFAULT_BREAKPOINTS): BreakpointTier {
  if (width >= breakpoints.desktopMin) return 'desktop';
  if (width >= breakpoints.tabletMin) return 'tablet';
  return 'mobile';
}

export function isHiddenOnTier(hideOn: HideOn | undefined, tier: BreakpointTier): boolean {
  if (!hideOn) return false;
  if (tier === 'mobile') return hideOn.mobile === true;
  if (tier === 'tablet') return hideOn.tablet === true;
  return hideOn.desktop === true;
}

export function hideOnDataAttrs(hideOn: HideOn | undefined): Record<string, string> {
  return {
    'data-hide-mobile': hideOn?.mobile ? '1' : '0',
    'data-hide-tablet': hideOn?.tablet ? '1' : '0',
    'data-hide-desktop': hideOn?.desktop ? '1' : '0',
  };
}

/** Puck field metadata flag — marks a field as responsive (edited per scope). */
export const PB_RESPONSIVE_METADATA = { pageBuilder: { responsive: true as const } };

/** Puck field metadata flag — marks a field for the Data settings tab (source, filters, etc.). */
export const PB_DATA_METADATA = { pageBuilder: { data: true as const } };

/** Puck field metadata flag — marks a field for the Items settings tab (slide/item lists). */
export const PB_ITEMS_METADATA = { pageBuilder: { items: true as const } };

export function isResponsiveField(field: { metadata?: unknown }): boolean {
  const meta = field.metadata as { pageBuilder?: { responsive?: boolean } } | undefined;
  return meta?.pageBuilder?.responsive === true;
}

export function isDataField(field: { metadata?: unknown }): boolean {
  const meta = field.metadata as { pageBuilder?: { data?: boolean } } | undefined;
  return meta?.pageBuilder?.data === true;
}

export function isItemsField(field: { metadata?: unknown }): boolean {
  const meta = field.metadata as { pageBuilder?: { items?: boolean } } | undefined;
  return meta?.pageBuilder?.items === true;
}
