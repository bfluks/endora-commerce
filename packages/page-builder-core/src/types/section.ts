import { normalizeBackground, type BackgroundProp, type BackgroundValue } from './background.js';
import type {
  Responsive,
  SectionBackground,
  SectionContentPosition,
  SectionContentWidth,
  SectionScheme,
  SectionSettings,
  SectionWidth,
  SpaceToken,
  SpaceValue,
} from './page-builder-props.js';

/**
 * The section settings of a top-level block as the editor and the renderers
 * handle them — `specs/163-page-builder-marketing-pages/` data-model §3.4,
 * research R-8, R-9. The shapes are the contracts' (`SectionSettings`,
 * `SectionBackground`); this module adds what a field and a renderer need
 * beside them, with no `zod` so a client bundle can take it.
 */

/**
 * `SectionBackground` is today's `BackgroundValue` (`./background.ts`) plus art
 * direction, a poster, a mobile video, an overlay, a focal point and the
 * decorative backdrop (R-9), so a background stored before feature 163 is a
 * valid section background as it stands.
 */
export type SectionBackgroundValue = BackgroundValue & Omit<SectionBackground, keyof BackgroundValue>;

/** The `section` prop as stored: every key optional, the background in its widened form. */
export type SectionSettingsValue = Partial<Omit<SectionSettings, 'background'>> & {
  background?: SectionBackgroundValue;
};

/** A block's own spacing defaults, where they differ from `'l'` (data-model §3.4). */
export interface SectionDefaults {
  spaceTop?: SpaceValue | Responsive<SpaceValue>;
  spaceBottom?: SpaceValue | Responsive<SpaceValue>;
}

/** The spacing a section uses when neither its settings nor its block set one. */
export const DEFAULT_SECTION_SPACE: SpaceValue = 'l';

export const SECTION_SPACE_TOKENS: readonly SpaceToken[] = ['none', 'xs', 's', 'm', 'l', 'xl', 'xxl'];
export const SECTION_SCHEME_OPTIONS: readonly SectionScheme[] = ['inherit', 'light', 'muted', 'dark'];
export const SECTION_WIDTH_OPTIONS: readonly SectionWidth[] = ['contained', 'wide', 'full', 'viewport', 'bleed', 'custom'];
/** The content frames a `full`, `viewport` or `bleed` section can hold its content in (T124). */
export const SECTION_CONTENT_WIDTH_OPTIONS: readonly SectionContentWidth[] = ['contained', 'wide', 'full', 'custom'];
/** The widths whose background is wider than the page container, so a content width applies. */
export const SECTION_WIDTHS_WITH_CONTENT_WIDTH: readonly SectionWidth[] = ['full', 'viewport', 'bleed'];
export const SECTION_CONTENT_POSITIONS: readonly SectionContentPosition[] = ['start', 'center', 'end'];

/**
 * The built-in size of each spacing token, mobile then desktop — the
 * `DEFAULT_BRAND_TOKENS.spacing` values of `@endora-commerce/contracts`,
 * restated without `zod` because every `--cmsb-space-*` use carries its literal
 * as a fallback (standing rule 9). `cms-components`' `Section.test.tsx` holds
 * the two equal.
 */
export const SECTION_SPACE_FALLBACKS: Readonly<Record<SpaceToken, readonly [number, number]>> = {
  none: [0, 0],
  xs: [8, 12],
  s: [16, 24],
  m: [24, 40],
  l: [40, 64],
  xl: [56, 96],
  xxl: [80, 128],
};

export function isSpaceToken(value: unknown): value is SpaceToken {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SECTION_SPACE_FALLBACKS, value);
}

/** A stored background, of either generation, as a section background (`kind: 'none'` when unset). */
export function normalizeSectionBackground(value: BackgroundProp | SectionBackgroundValue): SectionBackgroundValue {
  return normalizeBackground(value as BackgroundProp) as SectionBackgroundValue;
}
