// The prop shapes page-builder blocks share — `LinkValue`, `ButtonSpec`,
// `ResponsiveImage`, `SectionSettings` and `InlineRichText`
// (`specs/163-page-builder-marketing-pages/` data-model §3).
//
// They are authored once, as Zod schemas, in `@endora-commerce/contracts`,
// because a seeder and a server-bound test validate stored trees against them
// and this package cannot be the thing `contracts` depends on (the
// `block-name.ts` reasoning). This module hands the block renderers and editor
// fields the inferred types, and the zod-free helpers through the
// `page-builder-values` subpath, so no schema reaches a client bundle.

export type {
  AspectToken,
  ButtonFill,
  ButtonIconPosition,
  ButtonSize,
  ButtonSpec,
  ButtonStyle,
  ColorValue,
  EmphasisVariant,
  FocalToken,
  InlineRichMark,
  InlineRichNode,
  InlineRichText,
  LinkKind,
  LinkTarget,
  LinkValue,
  Responsive,
  ResponsiveImage,
  RevealSetting,
  SectionBackground,
  SectionContentPosition,
  SectionContentWidth,
  SectionOverlay,
  SectionScheme,
  SectionSettings,
  SectionWidth,
  SpaceToken,
  SpaceValue,
} from '@endora-commerce/contracts/page-builder-props';

export {
  ASPECT_TOKENS,
  BACKGROUND_REPEATS,
  BACKGROUND_SIZE_KEYWORDS,
  BACKGROUND_SIZE_PERCENT_MAX,
  BACKGROUND_SIZE_PX_MAX,
  INLINE_ICON_NAME_RE,
  INLINE_ICON_OFFSET_EM,
  INLINE_ICON_SIZE_EM,
  INLINE_ICON_SIZE_PX,
  INLINE_ICON_SIZE_RE,
  backgroundSizeToCss,
  isBackgroundRepeat,
  isInlineIconOffset,
  isInlineIconSize,
  COLOR_TOKEN_RE,
  EMPHASIS_VARIANTS,
  FOCAL_TOKENS,
  HEX_COLOR_RE,
  SECTION_ANCHOR_MAX_LENGTH,
  SECTION_ANCHOR_RE,
  inlineRichTextToPlain,
  isAspectToken,
  isSafeLinkUrl,
  normalizeAnchor,
  plainTextToInlineRichText,
} from '@endora-commerce/contracts/page-builder-values';

export type { BackgroundRepeat, BackgroundSizeKeyword, BackgroundSizeValue } from '@endora-commerce/contracts/page-builder-values';
