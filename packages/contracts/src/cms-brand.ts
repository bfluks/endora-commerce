import { z } from 'zod';
import { HEX_COLOR_RE } from './page-builder-props.js';

/**
 * Brand tokens — the one global (and per sales channel) set of colours, colour
 * schemes, fonts, type scale, button shape, spacing and layout widths every
 * page-builder block reads (`specs/163-page-builder-marketing-pages/`,
 * data-model §2, research R-1 to R-7).
 *
 * The storefront writes them as `--cmsb-*` CSS variables; every use of such a
 * variable in `cms-components.css` carries today's literal as its fallback, so
 * {@link DEFAULT_BRAND_TOKENS} reproduces today's look and a deployment that
 * never opens the brand screen sees no change.
 */

export const brandHexSchema = z.string().regex(HEX_COLOR_RE, { message: 'Expected a #rrggbb colour' });
export type BrandHex = z.infer<typeof brandHexSchema>;

export const BRAND_TYPE_TOKENS = ['display', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'lead', 'body', 'small'] as const;
export type BrandTypeToken = (typeof BRAND_TYPE_TOKENS)[number];

export const BRAND_SPACE_TOKENS = ['none', 'xs', 's', 'm', 'l', 'xl', 'xxl'] as const;
export type BrandSpaceToken = (typeof BRAND_SPACE_TOKENS)[number];

export const BRAND_SCHEMES = ['light', 'muted', 'dark'] as const;
export type BrandScheme = (typeof BRAND_SCHEMES)[number];

const NEUTRAL_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;

const fontGenericSchema = z.enum(['sans-serif', 'serif']);
const fontFamilySchema = z.string().trim().min(1).max(100);

export const brandFontSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('system'), stack: z.enum(['sans', 'serif', 'mono']) }),
  z.object({
    kind: z.literal('asset'),
    family: fontFamilySchema,
    generic: fontGenericSchema,
    faces: z
      .array(
        z.object({
          weight: z.number().int().min(100).max(900),
          style: z.enum(['normal', 'italic']),
          fileAssetId: z.string().uuid(),
        }),
      )
      .min(1)
      .max(8),
  }),
  z.object({
    kind: z.literal('stylesheet'),
    family: fontFamilySchema,
    generic: fontGenericSchema,
    // A font service's stylesheet (R-5); only `https:` is loaded into a page.
    url: z.string().max(2048).regex(/^https:\/\/[^\s"'<>()\\]+$/i, { message: 'Expected an https: URL' }),
  }),
]);
export type BrandFontSource = z.infer<typeof brandFontSourceSchema>;

/**
 * A media URL a brand token may point at (T154): `https:` or a site-relative
 * path (`/…`, never `//host`), with none of the characters that could end a
 * CSS `url()` or an HTML attribute, and no whitespace. `brandTokensToCss`
 * applies the same rule to whatever is stored.
 */
export const BRAND_MEDIA_URL_RE = /^(?:https:\/\/[^\s"'<>()\\]+|\/(?!\/)[^\s"'<>()\\]+)$/i;
export const brandMediaUrlSchema = z
  .string()
  .max(2048)
  .regex(BRAND_MEDIA_URL_RE, { message: 'Expected an https: URL or a path starting with /' });

const typeStyleSchema = z.object({
  mobilePx: z.number().min(10).max(160),
  desktopPx: z.number().min(10).max(160),
  lineHeight: z.number().min(0.8).max(2.2),
  weight: z.union([z.literal(300), z.literal(400), z.literal(500), z.literal(600), z.literal(700), z.literal(800)]),
  trackingEm: z.number().min(-0.1).max(0.2),
  font: z.enum(['heading', 'body']),
});
export type BrandTypeStyle = z.infer<typeof typeStyleSchema>;

const spaceStepSchema = z.object({
  mobilePx: z.number().int().min(0).max(320),
  desktopPx: z.number().int().min(0).max(320),
});

const schemeSchema = z.object({
  background: brandHexSchema,
  text: brandHexSchema,
  textMuted: brandHexSchema,
  border: brandHexSchema,
  link: brandHexSchema,
  // The decorative backdrop of a dark section (R-8a); the admin offers it on `dark` only.
  decorativeAssetId: z.string().uuid().optional(),
  // T154: the same backdrop given as a URL (as T142 did for video); the asset wins when both are set.
  decorativeUrl: brandMediaUrlSchema.optional(),
});
export type BrandSchemeColors = z.infer<typeof schemeSchema>;

function recordOf<K extends string, S extends z.ZodType>(keys: readonly K[], schema: S) {
  return z.object(Object.fromEntries(keys.map((key) => [key, schema])) as { [P in K]: S });
}

export const cmsBrandTokensSchema = z.object({
  version: z.literal(1),
  colors: z.object({
    primary: brandHexSchema,
    primaryHover: brandHexSchema,
    secondary: brandHexSchema,
    secondaryHover: brandHexSchema,
    neutral: recordOf(NEUTRAL_STEPS, brandHexSchema),
    onPrimary: brandHexSchema,
    onSecondary: brandHexSchema,
  }),
  accentGradient: z.object({ from: brandHexSchema, to: brandHexSchema, angle: z.number().min(0).max(360) }),
  schemes: recordOf(BRAND_SCHEMES, schemeSchema),
  fonts: z.object({ heading: brandFontSourceSchema, body: brandFontSourceSchema }),
  typeScale: recordOf(BRAND_TYPE_TOKENS, typeStyleSchema),
  buttons: z.object({
    radius: z.enum(['square', 'rounded', 'pill']),
    heights: z.object({
      small: z.number().int().min(28).max(72),
      medium: z.number().int().min(28).max(72),
      large: z.number().int().min(28).max(72),
    }),
    fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]),
    textTransform: z.enum(['none', 'uppercase']),
  }),
  spacing: recordOf(BRAND_SPACE_TOKENS, spaceStepSchema),
  layout: z.object({
    containerMaxPx: z.number().int().min(320).max(3840),
    widePx: z.number().int().min(320).max(3840),
    gutterMobilePx: z.number().int().min(0).max(160),
    gutterDesktopPx: z.number().int().min(0).max(160),
  }),
  /**
   * R20F (T322): optional factors on the type sizes and spacing steps — the
   * phone values × `tablet` from 768 to 1023 px, the desktop values ×
   * `smallDesktop` from 1024 to 1279 px. Unset (or 1): today's sizes.
   */
  tierScale: z
    .object({
      tablet: z.number().min(0.5).max(2).optional(),
      smallDesktop: z.number().min(0.5).max(2).optional(),
      /**
       * R21H (T351): above the small-desktop tier, the desktop sizes grow with
       * the viewport from the small-desktop factor to 1, reached at
       * `fluidUntilPx` (unset: `layout.containerMaxPx`). Only with a
       * small-desktop factor below 1.
       */
      fluidDesktop: z.boolean().optional(),
      fluidUntilPx: z.number().int().min(1025).max(3840).optional(),
      /** R21H (T352): the brand's button heights follow the factors too. */
      buttons: z.boolean().optional(),
    })
    .optional(),
});
export type CmsBrandTokens = z.infer<typeof cmsBrandTokensSchema>;

const heading = (px: number): BrandTypeStyle => ({
  mobilePx: px,
  desktopPx: px,
  lineHeight: 1.12,
  weight: 700,
  trackingEm: 0,
  font: 'heading',
});

/**
 * The built-in set: today's literals. Primary `#1261a6`, the slate neutrals,
 * the text colour `#15202b`, the border `#d9e0e7`, Inter (the `sans` system
 * stack), the heading sizes 48/40/32/26/22/18 with no mobile step, the 16 px
 * body at 1.65, today's 40 px / 8 px-radius button and the 1360 px page
 * container. `display` and the three non-heading roles have no literal today and
 * take neutral values.
 */
export const DEFAULT_BRAND_TOKENS: CmsBrandTokens = {
  version: 1,
  colors: {
    primary: '#1261a6',
    primaryHover: '#0f5189',
    secondary: '#0f766e',
    secondaryHover: '#115e59',
    neutral: {
      '50': '#f8fafc',
      '100': '#f1f5f9',
      '200': '#e2e8f0',
      '300': '#cbd5e1',
      '400': '#94a3b8',
      '500': '#64748b',
      '600': '#475569',
      '700': '#334155',
      '800': '#1e293b',
      '900': '#0f172a',
    },
    onPrimary: '#ffffff',
    onSecondary: '#ffffff',
  },
  accentGradient: { from: '#3b82f6', to: '#0f766e', angle: 135 },
  schemes: {
    light: { background: '#ffffff', text: '#15202b', textMuted: '#64748b', border: '#d9e0e7', link: '#1261a6' },
    muted: { background: '#f8fafc', text: '#15202b', textMuted: '#64748b', border: '#e2e8f0', link: '#1261a6' },
    dark: { background: '#0f172a', text: '#f8fafc', textMuted: '#cbd5e1', border: '#334155', link: '#93c5fd' },
  },
  fonts: {
    heading: { kind: 'system', stack: 'sans' },
    body: { kind: 'system', stack: 'sans' },
  },
  typeScale: {
    display: { mobilePx: 40, desktopPx: 56, lineHeight: 1.08, weight: 700, trackingEm: 0, font: 'heading' },
    h1: heading(48),
    h2: heading(40),
    h3: heading(32),
    h4: heading(26),
    h5: heading(22),
    h6: heading(18),
    lead: { mobilePx: 18, desktopPx: 20, lineHeight: 1.6, weight: 400, trackingEm: 0, font: 'body' },
    body: { mobilePx: 16, desktopPx: 16, lineHeight: 1.65, weight: 400, trackingEm: 0, font: 'body' },
    small: { mobilePx: 14, desktopPx: 14, lineHeight: 1.5, weight: 400, trackingEm: 0, font: 'body' },
  },
  buttons: {
    radius: 'rounded',
    heights: { small: 32, medium: 40, large: 48 },
    fontWeight: 700,
    textTransform: 'none',
  },
  spacing: {
    none: { mobilePx: 0, desktopPx: 0 },
    xs: { mobilePx: 8, desktopPx: 12 },
    s: { mobilePx: 16, desktopPx: 24 },
    m: { mobilePx: 24, desktopPx: 40 },
    l: { mobilePx: 40, desktopPx: 64 },
    xl: { mobilePx: 56, desktopPx: 96 },
    xxl: { mobilePx: 80, desktopPx: 128 },
  },
  layout: { containerMaxPx: 1360, widePx: 1600, gutterMobilePx: 24, gutterDesktopPx: 24 },
};

// ── Contrast (R-7) ──────────────────────────────────────────────────

/** WCAG 2.2 AA for body text, and for large (display-size) text. */
export const CONTRAST_REQUIRED_BODY = 4.5;
export const CONTRAST_REQUIRED_LARGE = 3;

export interface ContrastFinding {
  /** `<foreground path>/<background path>`; a background in the same group is named by its key alone. */
  pair: string;
  ratio: number;
  required: typeof CONTRAST_REQUIRED_BODY | typeof CONTRAST_REQUIRED_LARGE;
}

function channelToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a `#rrggbb` colour. */
export function relativeLuminance(hex: string): number {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channelToLinear(red) + 0.7152 * channelToLinear(green) + 0.0722 * channelToLinear(blue);
}

/** WCAG contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Every foreground/background pair the tokens put on a page that falls below
 * WCAG 2.2 AA. A warning, never a refusal (FR-006b): the brand screen shows it
 * and the write route returns it beside a successful save.
 *
 * - Each scheme's text, muted text and link against its background, at 4.5:1.
 * - Each solid button's label against its fill and its hover fill, at 4.5:1.
 * - The accent gradient's two stops against each scheme's background, at 3:1:
 *   the gradient emphasis is a display-size device (hero and section headings),
 *   so it is held to the large-text threshold.
 */
export function assessBrandContrast(tokens: CmsBrandTokens): ContrastFinding[] {
  const findings: ContrastFinding[] = [];
  const check = (
    pair: string,
    foreground: string,
    background: string,
    required: ContrastFinding['required'],
  ): void => {
    const ratio = contrastRatio(foreground, background);
    if (ratio < required) findings.push({ pair, ratio: Math.round(ratio * 100) / 100, required });
  };

  for (const scheme of BRAND_SCHEMES) {
    const colors = tokens.schemes[scheme];
    check(`schemes.${scheme}.text/background`, colors.text, colors.background, CONTRAST_REQUIRED_BODY);
    check(`schemes.${scheme}.textMuted/background`, colors.textMuted, colors.background, CONTRAST_REQUIRED_BODY);
    check(`schemes.${scheme}.link/background`, colors.link, colors.background, CONTRAST_REQUIRED_BODY);
  }

  const { colors } = tokens;
  check('colors.onPrimary/primary', colors.onPrimary, colors.primary, CONTRAST_REQUIRED_BODY);
  check('colors.onPrimary/primaryHover', colors.onPrimary, colors.primaryHover, CONTRAST_REQUIRED_BODY);
  check('colors.onSecondary/secondary', colors.onSecondary, colors.secondary, CONTRAST_REQUIRED_BODY);
  check('colors.onSecondary/secondaryHover', colors.onSecondary, colors.secondaryHover, CONTRAST_REQUIRED_BODY);

  for (const stop of ['from', 'to'] as const) {
    for (const scheme of BRAND_SCHEMES) {
      check(
        `accentGradient.${stop}/schemes.${scheme}.background`,
        tokens.accentGradient[stop],
        tokens.schemes[scheme].background,
        CONTRAST_REQUIRED_LARGE,
      );
    }
  }

  return findings;
}

// ────────────────────────────────────────────────────────────────────
// HTTP shapes (`contracts/storefront-and-admin-api.md` §1)
// ────────────────────────────────────────────────────────────────────

export const contrastFindingSchema = z.object({
  pair: z.string(),
  ratio: z.number(),
  required: z.union([z.literal(CONTRAST_REQUIRED_BODY), z.literal(CONTRAST_REQUIRED_LARGE)]),
});

/** Which set a write addresses: the global one, or one sales channel's override. */
export const cmsBrandTokensScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('channel'), salesChannelId: z.string().uuid() }),
]);
export type CmsBrandTokensScope = z.infer<typeof cmsBrandTokensScopeSchema>;

/**
 * `PUT /api/v1/admin/cms/brand-tokens`. `tokens: null` removes a channel's
 * override, or resets the global set to the built-in defaults.
 * `expectedVersion` is the scope's `version` as last read; a scope with no
 * stored set reads as version 0.
 */
export const putCmsBrandTokensRequestSchema = z.object({
  scope: cmsBrandTokensScopeSchema,
  tokens: cmsBrandTokensSchema.nullable(),
  expectedVersion: z.number().int().min(0),
});
export type PutCmsBrandTokensRequest = z.infer<typeof putCmsBrandTokensRequestSchema>;

export const putCmsBrandTokensResponseSchema = z.object({
  data: z.object({ version: z.number().int().min(0), warnings: z.array(contrastFindingSchema) }),
});

/** One scope's stored set; `tokens: null` and version 0 when nothing is stored. */
export const cmsBrandTokensScopeStateSchema = z.object({
  tokens: cmsBrandTokensSchema.nullable(),
  version: z.number().int().min(0),
});
export type CmsBrandTokensScopeState = z.infer<typeof cmsBrandTokensScopeStateSchema>;

/** `GET /api/v1/admin/cms/brand-tokens[?salesChannelId=]`. */
export const cmsBrandTokensAdminReadSchema = z.object({
  global: cmsBrandTokensScopeStateSchema,
  channel: cmsBrandTokensScopeStateSchema.extend({ salesChannelId: z.string().uuid() }).optional(),
  /** channel ?? global ?? {@link DEFAULT_BRAND_TOKENS}. */
  effective: cmsBrandTokensSchema,
  warnings: z.array(contrastFindingSchema),
});
export type CmsBrandTokensAdminRead = z.infer<typeof cmsBrandTokensAdminReadSchema>;

/** `GET /api/v1/storefront/cms/brand-tokens` — the effective set for the resolved channel. */
export const cmsBrandTokensStorefrontResponseSchema = z.object({ data: cmsBrandTokensSchema });
