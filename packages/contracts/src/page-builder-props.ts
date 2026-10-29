import { z } from 'zod';
import {
  type ASPECT_TOKENS,
  BACKGROUND_REPEATS,
  BACKGROUND_SIZE_KEYWORDS,
  BACKGROUND_SIZE_PERCENT_MAX,
  BACKGROUND_SIZE_PX_MAX,
  COLOR_TOKEN_RE,
  EMPHASIS_VARIANTS,
  FOCAL_TOKENS,
  HEX_COLOR_RE,
  INLINE_ICON_NAME_RE,
  SECTION_ANCHOR_RE,
  isAspectToken,
  isInlineIconOffset,
  isInlineIconSize,
  isSafeLinkUrl,
  plainTextToInlineRichText,
} from './page-builder-values.js';

export * from './page-builder-values.js';

/**
 * The prop shapes page-builder blocks share (`specs/163-page-builder-marketing-pages/`,
 * data-model §3): one link value, one button, one responsive image, the section
 * settings of a top-level block and the inline rich text of short headings.
 *
 * They are stored inside page-builder content (`cms_pages.content` and its
 * siblings), never in a column of their own, so these schemas are what a test or
 * a seeder validates a stored tree against. Renderers read the inferred types
 * through `@endora-commerce/page-builder-core` and stay tolerant of anything a
 * stored tree may hold; the schemas are the strict statement of what an editor
 * writes.
 *
 * The grammars and helpers a renderer needs at run time live in
 * `page-builder-values.ts`, which imports no `zod`, so a client component can
 * use them through `page-builder-core` without pulling the schemas into its
 * bundle. This file re-exports them.
 */

// ── Responsive values ───────────────────────────────────────────────

/**
 * A plain value, or the page builder's per-tier object (`ResponsiveProp` in
 * `page-builder-core`): `base` is mobile and the fallback of the higher tiers.
 */
export function responsiveSchema<T extends z.ZodType>(inner: T) {
  return z.union([
    inner,
    // Exact optional: the inferred type is `ResponsiveProp<T>`'s own
    // (`tablet?: T`), which `exactOptionalPropertyTypes` tells apart from
    // `tablet?: T | undefined`.
    z.object({ base: inner, tablet: inner.exactOptional(), desktop: inner.exactOptional() }),
  ]);
}

export type Responsive<T> = T | { base: T; tablet?: T; desktop?: T };

// ── Colours ─────────────────────────────────────────────────────────

/** A block colour: a brand-token reference or a literal `#rrggbb` override. */
export const colorValueSchema = z.string().refine((value) => HEX_COLOR_RE.test(value) || COLOR_TOKEN_RE.test(value), {
  message: 'Expected a #rrggbb colour or a token:<role> reference',
});
export type ColorValue = z.infer<typeof colorValueSchema>;

// ── Anchors ─────────────────────────────────────────────────────────

export const sectionAnchorSchema = z.string().regex(SECTION_ANCHOR_RE);

// ── LinkValue (data-model §3.1, R-11) ───────────────────────────────

export const linkTargetSchema = z.enum(['_self', '_blank']);
export type LinkTarget = z.infer<typeof linkTargetSchema>;

const linkSlugSchema = z.string().trim().min(1).max(500);

export const linkValueSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('url'),
    href: z.string().max(2048).refine(isSafeLinkUrl, { message: 'Unsafe or unsupported URL' }),
    target: linkTargetSchema.optional(),
  }),
  z.object({ kind: z.literal('page'), slug: linkSlugSchema, target: linkTargetSchema.optional() }),
  z.object({ kind: z.literal('product'), slug: linkSlugSchema, target: linkTargetSchema.optional() }),
  z.object({ kind: z.literal('category'), slug: linkSlugSchema, target: linkTargetSchema.optional() }),
  z.object({ kind: z.literal('asset'), fileAssetId: z.string().uuid(), target: linkTargetSchema.optional() }),
  z.object({ kind: z.literal('anchor'), anchor: sectionAnchorSchema }),
]);
export type LinkValue = z.infer<typeof linkValueSchema>;
export type LinkKind = LinkValue['kind'];

// ── ButtonSpec (data-model §3.2) ────────────────────────────────────

export const buttonStyleSchema = z.enum(['primary', 'secondary', 'light', 'dark']);
/** `text` is today's `ghost` variant. */
export const buttonFillSchema = z.enum(['solid', 'outline', 'text']);
export const buttonSizeSchema = z.enum(['small', 'medium', 'large']);
export const buttonIconPositionSchema = z.enum(['start', 'end', 'only']);
/** A key of the curated icon catalog in `cms-components` (`icon-catalog.ts`). */
export const iconNameSchema = z.string().regex(/^[a-z][a-zA-Z0-9]{0,63}$/);

export type ButtonStyle = z.infer<typeof buttonStyleSchema>;
export type ButtonFill = z.infer<typeof buttonFillSchema>;
export type ButtonSize = z.infer<typeof buttonSizeSchema>;
export type ButtonIconPosition = z.infer<typeof buttonIconPositionSchema>;

export const buttonSpecSchema = z
  .object({
    label: z.string().max(200),
    link: linkValueSchema,
    style: responsiveSchema(buttonStyleSchema).default('primary'),
    fill: responsiveSchema(buttonFillSchema).default('solid'),
    size: buttonSizeSchema.default('medium'),
    backgroundColor: colorValueSchema.optional(),
    textColor: colorValueSchema.optional(),
    icon: iconNameSchema.optional(),
    iconPosition: buttonIconPositionSchema.optional(),
  })
  .superRefine((value, ctx) => {
    // An icon-only button is still named for a screen reader: its label is the
    // accessible name (R-11).
    if (value.iconPosition === 'only' && value.label.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['label'], message: 'An icon-only button needs a label' });
    }
  });
export type ButtonSpec = z.infer<typeof buttonSpecSchema>;

// ── ResponsiveImage (data-model §3.3) ───────────────────────────────

export const aspectTokenSchema = z.string().refine(isAspectToken, {
  message: 'Expected a preset ratio or w:h with integers from 1 to 100',
});
export const focalTokenSchema = z.enum(FOCAL_TOKENS);
export const mediaSourceSchema = z.enum(['url', 'library']);

export type AspectToken = (typeof ASPECT_TOKENS)[number] | `${number}:${number}`;
export type FocalToken = z.infer<typeof focalTokenSchema>;

const mediaUrlSchema = z.string().max(2048);

export const responsiveImageSchema = z.object({
  imageSource: mediaSourceSchema.default('url'),
  src: mediaUrlSchema.optional(),
  assetId: z.string().uuid().optional(),
  mobileSrc: mediaUrlSchema.optional(),
  mobileAssetId: z.string().uuid().optional(),
  alt: z.string().max(500).default(''),
  ratio: responsiveSchema(aspectTokenSchema).optional(),
  fit: z.enum(['cover', 'contain']).optional(),
  position: focalTokenSchema.optional(),
});
export type ResponsiveImage = z.infer<typeof responsiveImageSchema>;

// ── SectionSettings (data-model §3.4, R-8, R-9): `cms.Section`'s own top-level props (T117) ──

export const SPACE_TOKENS = ['none', 'xs', 's', 'm', 'l', 'xl', 'xxl'] as const;
export const spaceTokenSchema = z.enum(SPACE_TOKENS);
export type SpaceToken = z.infer<typeof spaceTokenSchema>;

/** A spacing token, or the "Custom (px)" literal that keeps today's free padding (plan § Extend, don't narrow). */
export const spaceValueSchema = z.union([spaceTokenSchema, z.object({ px: z.number().int().min(0).max(320) })]);
export type SpaceValue = z.infer<typeof spaceValueSchema>;

export const SECTION_SCHEMES = ['inherit', 'light', 'muted', 'dark'] as const;
export const sectionSchemeSchema = z.enum(SECTION_SCHEMES);
export type SectionScheme = z.infer<typeof sectionSchemeSchema>;

/**
 * `contained`, `wide` and `full` are the section widths; `viewport`, `bleed` and
 * `custom` keep today's Row `full_viewport`, `full_bleed` and custom max width.
 */
export const SECTION_WIDTHS = ['contained', 'wide', 'full', 'viewport', 'bleed', 'custom'] as const;
export const sectionWidthSchema = z.enum(SECTION_WIDTHS);
export type SectionWidth = z.infer<typeof sectionWidthSchema>;

/**
 * The content frame of a section whose background is wider than the page
 * container (`full`, `viewport`, `bleed`), chosen apart from that extent (T124):
 * `contained` the page container, `wide` the wide frame, `full` to the edges,
 * `custom` `customMaxWidthPx`. Unset, the width's own frame applies, as before.
 */
export const SECTION_CONTENT_WIDTHS = ['contained', 'wide', 'full', 'custom'] as const;
export const sectionContentWidthSchema = z.enum(SECTION_CONTENT_WIDTHS);
export type SectionContentWidth = z.infer<typeof sectionContentWidthSchema>;

export const sectionOverlaySchema = z.object({
  kind: z.enum(['none', 'solid', 'gradient']),
  direction: z.enum(['to-top', 'to-bottom', 'to-left', 'to-right']).optional(),
  strength: z.number().min(0).max(100),
});
export type SectionOverlay = z.infer<typeof sectionOverlaySchema>;

/** T167: a background size — `cover`, `contain`, `auto`, or a width in whole px (1–4000) or % (1–400). */
export const backgroundSizeSchema = z.union([
  z.enum(BACKGROUND_SIZE_KEYWORDS),
  z.object({ px: z.number().int().min(1).max(BACKGROUND_SIZE_PX_MAX) }),
  z.object({ percent: z.number().min(1).max(BACKGROUND_SIZE_PERCENT_MAX) }),
]);
export const backgroundRepeatSchema = z.enum(BACKGROUND_REPEATS);

/** `BackgroundValue` (`page-builder-core/src/types/background.ts`) plus art direction and an overlay (R-9). */
export const sectionBackgroundSchema = z.object({
  kind: z.enum(['none', 'solid', 'gradient', 'image', 'video']),
  color: colorValueSchema.optional(),
  gradientFrom: colorValueSchema.optional(),
  gradientTo: colorValueSchema.optional(),
  gradientAngle: z.number().min(0).max(360).optional(),
  imageSource: mediaSourceSchema.optional(),
  imageUrl: mediaUrlSchema.optional(),
  imageAssetId: z.string().uuid().optional(),
  videoSource: mediaSourceSchema.optional(),
  videoUrl: mediaUrlSchema.optional(),
  videoAssetId: z.string().uuid().optional(),
  mobileImageAssetId: z.string().uuid().optional(),
  mobileImageUrl: mediaUrlSchema.optional(),
  videoPosterAssetId: z.string().uuid().optional(),
  mobileVideoAssetId: z.string().uuid().optional(),
  overlay: sectionOverlaySchema.optional(),
  position: focalTokenSchema.optional(),
  // T167: the image's size and repeat (unset: today's `cover`, no repeat).
  size: backgroundSizeSchema.optional(),
  repeat: backgroundRepeatSchema.optional(),
  decorative: z.boolean().optional(),
  // T167: the decorative layer's own size, repeat and position (unset: today's `cover` from the top centre, no repeat).
  decorativeSize: backgroundSizeSchema.optional(),
  decorativeRepeat: backgroundRepeatSchema.optional(),
  decorativePosition: focalTokenSchema.optional(),
});
export type SectionBackground = z.infer<typeof sectionBackgroundSchema>;

export const sectionContentPositionSchema = z.enum(['start', 'center', 'end']);
export type SectionContentPosition = z.infer<typeof sectionContentPositionSchema>;

export const revealSettingSchema = z.object({
  effect: z.enum(['none', 'fade-up', 'words']),
  desktopOnly: z.boolean().default(false),
});
export type RevealSetting = z.infer<typeof revealSettingSchema>;

export const sectionSettingsSchema = z.object({
  // A cleared anchor field stores `''`; it means "no anchor", not an invalid one.
  anchor: z.preprocess((value) => (value === '' ? undefined : value), sectionAnchorSchema.optional()),
  scheme: sectionSchemeSchema.default('inherit'),
  background: sectionBackgroundSchema.optional(),
  spaceTop: responsiveSchema(spaceValueSchema).default('l'),
  spaceBottom: responsiveSchema(spaceValueSchema).default('l'),
  width: sectionWidthSchema.default('contained'),
  // With `full`, `viewport` or `bleed` only: the content frame inside that background (T124).
  contentWidth: sectionContentWidthSchema.optional(),
  // One px value, on the editor's main tab with the custom width (T117).
  customMaxWidthPx: z.number().int().min(0).max(10_000).optional(),
  // Per breakpoint, as today's Row `contentPosition` (top/middle/bottom) is.
  contentPosition: responsiveSchema(sectionContentPositionSchema).optional(),
  reveal: revealSettingSchema.optional(),
  // T148: pull the content up into the previous section by a spacing token or px, per breakpoint; unset, none.
  overlap: responsiveSchema(spaceValueSchema).optional(),
});
export type SectionSettings = z.infer<typeof sectionSettingsSchema>;

/**
 * `cms.SectionGroup` (T158, FR-005 as amended 2026-10-26): a top-level
 * container of Sections that paints one scheme, background and decorative
 * layer behind all of them. Its settings are a Section's anchor, scheme,
 * background and spacing — the spacing `none` by default, since its Sections
 * carry their own; no width, content position, reveal or overlap.
 */
export const sectionGroupSettingsSchema = z.object({
  anchor: z.preprocess((value) => (value === '' ? undefined : value), sectionAnchorSchema.optional()),
  scheme: sectionSchemeSchema.default('inherit'),
  background: sectionBackgroundSchema.optional(),
  spaceTop: responsiveSchema(spaceValueSchema).default('none'),
  spaceBottom: responsiveSchema(spaceValueSchema).default('none'),
});
export type SectionGroupSettings = z.infer<typeof sectionGroupSettingsSchema>;

// ── InlineRichText (data-model §3.5, R-10) ──────────────────────────

export const emphasisVariantSchema = z.enum(EMPHASIS_VARIANTS);

export type EmphasisVariant = z.infer<typeof emphasisVariantSchema>;

export const inlineRichMarkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bold') }),
  z.object({ type: z.literal('italic') }),
  // TipTap writes `rel` and `class` beside `href`; they are kept so a document
  // round-trips through this schema unchanged.
  z.object({
    type: z.literal('link'),
    attrs: z.looseObject({ href: z.string().max(2048), target: z.string().nullable().optional() }),
  }),
  // Feature 163, T175: an optional colour — a brand colour token or a `#rrggbb` literal — painted
  // over the variant's own; the editor writes an unset one as `null`.
  z.object({
    type: z.literal('emphasis'),
    attrs: z.object({ variant: emphasisVariantSchema, color: colorValueSchema.nullable().optional() }),
  }),
]);
export type InlineRichMark = z.infer<typeof inlineRichMarkSchema>;

export const inlineRichNodeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().min(1), marks: z.array(inlineRichMarkSchema).optional() }),
  z.object({ type: z.literal('hardBreak'), marks: z.array(inlineRichMarkSchema).optional() }),
  // Feature 163, T163: an icon of the page builder's icon catalog, by name — an atomic inline node
  // rendered as inline SVG hidden from assistive technology. The catalog itself is the renderer's;
  // an unknown name renders nothing.
  z.object({
    type: z.literal('inlineIcon'),
    // T166: an optional size and vertical offset; the editor writes an unset one as `null`.
    attrs: z.object({
      name: z.string().regex(INLINE_ICON_NAME_RE),
      size: z.string().refine(isInlineIconSize, 'inline icon size: 0.5–3 em or 8–200 px').nullable().optional(),
      offset: z.number().refine(isInlineIconOffset, 'inline icon offset: −1–1 em').nullable().optional(),
    }),
    marks: z.array(inlineRichMarkSchema).optional(),
  }),
]);
export type InlineRichNode = z.infer<typeof inlineRichNodeSchema>;

const inlineRichParagraphSchema = z.object({
  type: z.literal('paragraph'),
  attrs: z.record(z.string(), z.unknown()).optional(),
  content: z.array(inlineRichNodeSchema).optional(),
});

/** The stored document: exactly one paragraph of text and hard breaks. */
export const inlineRichTextDocSchema = z.object({
  type: z.literal('doc'),
  content: z.tuple([inlineRichParagraphSchema]),
});
export type InlineRichText = z.infer<typeof inlineRichTextDocSchema>;

/**
 * Inline rich text as a block prop: a document, or a legacy plain string that is
 * read as one (the editor writes it back as a document once).
 */
export const inlineRichTextSchema = z
  .union([z.string(), inlineRichTextDocSchema])
  .transform((value): InlineRichText => (typeof value === 'string' ? plainTextToInlineRichText(value) : value));
