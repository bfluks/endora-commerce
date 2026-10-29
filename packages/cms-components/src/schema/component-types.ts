import type { Slot } from '@puckeditor/core';
import type {
  BorderValue,
  BackgroundProp,
  ButtonSpec,
  InlineRichText,
  CornerRadius,
  HideOn,
  LinkValue,
  ResponsiveImage,
  ResponsiveProp,
  RevealSetting,
  SectionOverlay,
  SectionSettingsValue,
  Shadow,
  SpaceToken,
  SpacingValue,
  StackOrder,
} from '@endora-commerce/page-builder-core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonTarget = '_self' | '_blank';
export type ButtonLinkType = 'url' | 'product' | 'category' | 'page';
export type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export interface HideOnProps {
  editorName?: string;
  hideOn?: HideOn;
  /** T156: the block's place per breakpoint in a flex or grid parent (a Column), from the shared wrapper. */
  stackOrder?: StackOrder | ResponsiveProp<StackOrder>;
}

export interface BoxStyleProps {
  margin?: SpacingValue | ResponsiveProp<SpacingValue>;
  padding?: SpacingValue | ResponsiveProp<SpacingValue>;
  border?: BorderValue | ResponsiveProp<BorderValue>;
}

export interface AppearanceProps {
  background?: BackgroundProp;
  cornerRadius?: CornerRadius;
  shadow?: Shadow;
}

export interface ColumnProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  span: number | ResponsiveProp<number>;
  content: Slot;
  /** T156: how a column taller than its blocks spreads them; unset is today's stack (`start`). */
  distribute?: 'start' | 'center' | 'end' | 'space-between' | 'last-to-bottom';
  /** T165: how many rows of the Row's grid the column spans, per breakpoint; unset is one. */
  rowSpan?: ColumnRowSpan | ResponsiveProp<ColumnRowSpan>;
  /** T165: the column track the column starts at, per breakpoint; unset or `auto` is the next free place. */
  columnStart?: ColumnTrackStart | ResponsiveProp<ColumnTrackStart>;
  /** T165: the grid row the column starts at, per breakpoint; unset or `auto` is the next free place. */
  rowStart?: ColumnRowStart | ResponsiveProp<ColumnRowStart>;
}

/** T165: a Column's row span in its Row's grid. */
export type ColumnRowSpan = 1 | 2 | 3 | 4;
/** T165: a Column's start among its Row's twelve column tracks. */
export type ColumnTrackStart = 'auto' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12';
/** T165: a Column's start among its Row's grid rows. */
export type ColumnRowStart = 'auto' | '1' | '2' | '3' | '4';

export interface RowColumnItem {
  span: number | ResponsiveProp<number>;
  content: Slot;
}

export interface RowProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  content: Slot;
  /** @deprecated migrated to Column components in content slot */
  columnItems?: RowColumnItem[];
  sectionLayout: RowSectionLayout | ResponsiveProp<RowSectionLayout>;
  contentMaxWidth: RowContentMaxWidth | ResponsiveProp<RowContentMaxWidth>;
  customMaxWidthPx?: number | ResponsiveProp<number>;
  /** @deprecated use sectionLayout */
  fullBleed?: boolean;
  /** @deprecated use contentMaxWidth */
  contentWidth?: 'full' | 'narrow' | 'wide' | ResponsiveProp<'full' | 'narrow' | 'wide'>;
  contentPosition: 'top' | 'middle' | 'bottom' | ResponsiveProp<'top' | 'middle' | 'bottom'>;
  minHeight: number | ResponsiveProp<number>;
  gap: number | ResponsiveProp<number>;
  rowGap?: number | ResponsiveProp<number>;
  verticalAlign?: 'top' | 'middle' | 'bottom' | 'stretch' | ResponsiveProp<'top' | 'middle' | 'bottom' | 'stretch'>;
  columnDivider?: boolean;
  reverseOnMobile?: boolean;
  overflow: boolean;
}

/**
 * Feature 163 — `cms.Section`, the one block that carries section settings
 * (FR-000, plan § *Owner ruling 2026-10-23*), and the slot it holds. The
 * settings are its own top-level props (T117): `anchor`, `scheme`,
 * `background`, `width`, `customMaxWidthPx`, `reveal`, and per breakpoint
 * `spaceTop`, `spaceBottom` and `contentPosition`.
 */
export interface SectionBlockProps extends HideOnProps, SectionSettingsValue {
  content: Slot;
}

/**
 * Feature 163, T158 — `cms.SectionGroup`: a top-level container whose slot
 * holds only `cms.Section`s, painting one scheme, background and decorative
 * layer behind all of them (FR-005 as amended, plan § *Owner ruling
 * 2026-10-26*). Its settings are a Section's `anchor`, `scheme`, `background`
 * and, per breakpoint, `spaceTop` and `spaceBottom`.
 */
export interface SectionGroupBlockProps
  extends HideOnProps,
    Pick<SectionSettingsValue, 'anchor' | 'scheme' | 'background' | 'spaceTop' | 'spaceBottom'> {
  content: Slot;
}

export type RowSectionLayout = 'in_flow' | 'full_width' | 'full_viewport' | 'full_bleed';
export type RowContentMaxWidth = 'none' | 'narrow' | 'wide' | 'custom';

export type TextFontFamily = 'sans' | 'serif' | 'mono';
export type TextFontStyle = 'normal' | 'italic';

export interface TypographyProps {
  fontFamily?: TextFontFamily;
  fontStyle?: TextFontStyle;
  color?: string;
  fontSize?: number | ResponsiveProp<number>;
  fontWeight?: number | ResponsiveProp<number>;
  textAlign?: 'left' | 'center' | 'right' | ResponsiveProp<'left' | 'center' | 'right'>;
  lineHeight?: number | ResponsiveProp<number>;
}

/** Feature 163 — the brand type scale's tokens (data-model §2, research R-10). */
export type TypeToken = 'display' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'lead' | 'body' | 'small';
/**
 * A heading's visual size: a type token, or **Custom** — `'custom'` with the
 * literal px in `fontSize`, as today's free size. `{px}` is accepted on read
 * (a seeder may write it) and stored by the editor as `'custom'` + `fontSize`.
 */
export type HeadingSize = TypeToken | 'custom' | { px: number };
/** The heading's font: the brand's heading or body font, or **Custom** (`fontFamily`, `customFontFamily`). */
export type HeadingFont = 'heading' | 'body' | 'custom';
/** The semantic element: a heading level, or a paragraph styled as one. */
export type HeadingTag = HeadingLevel | 'p';
/** Logical alignment; `left`/`right` are read from blocks stored before it. */
export type BlockAlign = 'start' | 'center' | 'end';
type LegacyAlign = 'left' | 'center' | 'right';

/**
 * Feature 163 (contracts/blocks.md `cms.Heading`): the level and the visual
 * size are separate, the text is inline rich text, and today's free typography
 * — `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `lineHeight`, `color` —
 * stays as the Custom overrides of the tokens. A heading stored before has no
 * `font` and no `size`, and renders exactly as it did.
 */
export interface HeadingProps extends HideOnProps, BoxStyleProps, TypographyProps {
  level: HeadingTag;
  /** A one-paragraph document; a plain string stored before is read as one. */
  text: InlineRichText | string;
  size?: HeadingSize | ResponsiveProp<HeadingSize>;
  font?: HeadingFont;
  /** Any CSS font family, with `font: 'custom'`; it wins over `fontFamily`. */
  customFontFamily?: string;
  /** `start`/`center`/`end`; a heading stored before may hold `left`/`right` here or in `textAlign`. */
  align?: BlockAlign | LegacyAlign | ResponsiveProp<BlockAlign | LegacyAlign>;
}

/** A named measure of a text's maximum width, or Custom (`textMaxWidthPx`) — feature 163, T134. */
export type TextMaxWidth = 'none' | 'narrow' | 'medium' | 'wide' | 'custom';

/** The maximum width of a block's text, per breakpoint; unset is today's full width (T134). */
export interface TextMaxWidthProps {
  textMaxWidth?: TextMaxWidth | ResponsiveProp<TextMaxWidth>;
  textMaxWidthPx?: number | ResponsiveProp<number>;
}

export interface TextProps extends HideOnProps, BoxStyleProps, TypographyProps, TextMaxWidthProps {
  text?: string;
  /** Legacy rows saved before Simple Text — read-only fallback at render time. */
  tiptapContent?: { type?: string; content?: unknown[] } | null;
  /** Legacy rows saved before Simple Text — read-only fallback at render time. */
  html?: string;
}

export type ImageAlign = 'left' | 'center' | 'right';

export interface IconsProps extends HideOnProps, BoxStyleProps {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  align?: ImageAlign | ResponsiveProp<ImageAlign>;
  /** Before R17 (T212): a URL and its target; read as a URL link. */
  href?: string;
  linkTarget?: '_self' | '_blank';
  /** R17 (T212): the link, any kind (`LinkValue`); wins over `href`. */
  link?: LinkValue;
}

export type SocialNetwork =
  | 'facebook'
  | 'x'
  | 'instagram'
  | 'linkedin'
  | 'youtube'
  | 'tiktok'
  | 'website'
  | 'email';

export type SocialLayout = 'icons-only' | 'icons-with-labels' | 'vertical-list' | 'pills';

export interface SocialItem {
  network: SocialNetwork;
  label?: string;
  url: string;
}

export interface SocialProps extends HideOnProps, BoxStyleProps {
  items: SocialItem[];
  layout?: SocialLayout;
  size?: number;
  /** R17 (T207): a size or Custom (with `gapPx`), per breakpoint; a stored number is a px gap. */
  gap?: SectionGap | number | ResponsiveProp<SectionGap | number>;
  gapPx?: number | ResponsiveProp<number>;
  color?: string;
  useBrandColors?: boolean;
  align?: ImageAlign | ResponsiveProp<ImageAlign>;
}

export type ImageObjectFit = 'cover' | 'contain' | 'fill' | 'none';
export type ImageWidthMode = 'auto' | 'full' | 'custom';
export type ImageSourceKind = 'url' | 'library';

export interface ImageProps extends HideOnProps, BoxStyleProps {
  imageSource?: ImageSourceKind;
  src: string;
  assetId?: string;
  alt: string;
  /** Before R17 (T212): a URL and its target; read as a URL link. */
  href?: string;
  linkTarget?: '_self' | '_blank';
  /** R17 (T212): the link, any kind (`LinkValue`); wins over `href`. */
  link?: LinkValue;
  objectFit: ImageObjectFit;
  opacity: number;
  cornerRadius?: CornerRadius;
  widthMode: ImageWidthMode | ResponsiveProp<ImageWidthMode>;
  widthPx: number | ResponsiveProp<number>;
  align: ImageAlign | ResponsiveProp<ImageAlign>;
  /** Feature 163, T127 — art direction: the image below the tablet tier, from the same source. */
  mobileSrc?: string;
  mobileAssetId?: string;
  /** An aspect token per breakpoint; unset or `auto` keeps the image's own ratio. */
  ratio?: string | ResponsiveProp<string>;
  /** A solid or gradient layer over the image (today's slate, as the hero's). */
  overlay?: SectionOverlay;
  /** An optional caption, translatable; below the image or beside it. */
  caption?: string;
  captionPlacement?: ImageCaptionPlacement;
}

export type ImageCaptionPlacement = 'below' | 'beside';

export interface RichContentProps extends HideOnProps, BoxStyleProps, TextMaxWidthProps {
  content: import('@tiptap/core').JSONContent | null;
  /** Synced from TipTap in resolveData — not shown as an author-facing field. */
  html: string;
}

/**
 * Feature 163 (contracts/blocks.md `cms.Button`): one `ButtonSpec`, with a
 * responsive style and fill, and the button's alignment in its box. A button
 * stored before has no `button` and keeps today's fields, which render through
 * the same `ButtonView` (`buttonFromLegacy`).
 */
/** T168: a button's width — fit the label (`auto`, today's) or the full width of its box. */
export type ButtonWidth = 'auto' | 'full';

/** T168: a block's button list at the full width per breakpoint; unset is today's (fit the label). */
export interface ButtonListWidthProps {
  buttonsFullWidth?: ButtonWidth | ResponsiveProp<ButtonWidth>;
}

export interface ButtonProps extends HideOnProps, BoxStyleProps {
  button?: ButtonSpec;
  align?: BlockAlign | ResponsiveProp<BlockAlign>;
  /** T168: the full width per breakpoint (top level, Responsive tab); unset is today's. */
  fullWidth?: ButtonWidth | ResponsiveProp<ButtonWidth>;
  /** @deprecated stored before feature 163 — read as `button.label`. */
  label?: string;
  /** @deprecated stored before feature 163 — read as `button.link`. */
  linkType?: ButtonLinkType;
  /** @deprecated stored before feature 163 — read as `button.link`. */
  linkSlug?: string;
  /** @deprecated stored before feature 163 — read as `button.link`. */
  href?: string;
  /** @deprecated stored before feature 163 — read as `button.link.target`. */
  target?: ButtonTarget;
  /** @deprecated stored before feature 163 — read as `button.style` and `button.fill`. */
  variant?: ButtonVariant | ResponsiveProp<ButtonVariant>;
  /** @deprecated stored before feature 163 — read as `button.backgroundColor`. */
  backgroundColor?: string;
  /** @deprecated stored before feature 163 — read as `button.textColor`. */
  textColor?: string;
}

export interface InsertBlockProps extends HideOnProps {
  code: string;
}

export interface InsertTemplateProps extends HideOnProps {
  code: string;
}

export type VideoProvider = 'auto' | 'youtube' | 'vimeo' | 'generic';
export type VideoAspectRatio = '16:9' | '4:3' | '1:1';
/** Feature 163, T126 — an embed (today) or a self-hosted file. */
export type VideoSource = 'embed' | 'file';

export interface RawHtmlProps extends HideOnProps, BoxStyleProps {
  html: string;
  sanitize?: boolean;
}

export interface RawJsProps extends HideOnProps, BoxStyleProps {
  script: string;
  runOnce?: boolean;
}

export interface VideoProps extends HideOnProps, BoxStyleProps {
  /** Unset (stored before feature 163) is `embed`. */
  source?: VideoSource;
  /** The embed's page URL; for a file, a direct file URL used when no library video is chosen. */
  url: string;
  provider?: VideoProvider;
  /** Today's three values, any aspect token since T126, per breakpoint. */
  aspectRatio?: VideoAspectRatio | string | ResponsiveProp<string>;
  /**
   * T194: where a file and its mobile file come from. Unset or `library`: the
   * library videos win over the URLs (`url`, `mobileUrl`); `url`: the URLs win
   * and the library videos are the fallback. The editor records the source the
   * stored values imply.
   */
  fileSource?: 'library' | 'url';
  /** A file from the asset library, the one below the tablet tier, and the poster shown before it plays. */
  videoAssetId?: string;
  mobileVideoAssetId?: string;
  /** T142: the mobile video by URL, used when no mobile library video is chosen. */
  mobileUrl?: string;
  /** T194: where both posters come from, as `fileSource` for the files. */
  posterSource?: 'library' | 'url';
  posterAssetId?: string;
  /** T194: the poster by URL, made absolute against the media origin. */
  posterUrl?: string;
  /** T162: the mobile video's own poster, a library image or a URL (by `posterSource`); unset, the poster. */
  mobilePosterAssetId?: string;
  mobilePosterUrl?: string;
  title?: string;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  maxWidth?: number | ResponsiveProp<number>;
  align?: ImageAlign | ResponsiveProp<ImageAlign>;
  /** T140: the frame's corners (embed and file); unset is today's 8 px (`medium`). */
  mediaCornerRadius?: CornerRadius;
}

export type CarouselEffect = 'slide' | 'fade';
export type CarouselControlsPlacement = 'header' | 'below' | 'overlay';
export type CarouselBleed = 'none' | 'end' | 'both';
/** Feature 163, T129: the arrows' look; `default` (white, light border), `round` and `m` are today's. */
export type CarouselArrowVariant = 'default' | 'outline' | 'solid';
export type CarouselArrowShape = 'round' | 'square';
export type CarouselArrowSize = 's' | 'm' | 'l';
/** Feature 163, T163: the arrows' icon — today's chevron glyphs, or a drawn arrow. */
export type CarouselArrowIcon = 'chevron' | 'arrow';
/** Feature 163, T130: a carousel (today) or a grid of columns. */
export type CarouselLayout = 'carousel' | 'grid';
/**
 * Feature 163, T147: how the controls below the track are aligned — centred
 * (today), at the start or the end, spread (`between`), or `split`: the
 * previous and next arrows at the two ends with the dots centred between.
 */
export type CarouselControlsAlign = 'center' | 'start' | 'end' | 'between' | 'split';
/** Feature 163, T147: the next arrow's own style, or `same` (the arrows' style). */
export type CarouselNextArrowVariant = 'same' | CarouselArrowVariant;
/** Feature 163, T143: the filter bar's look — pills (today) or underlined tabs — and its alignment. */
export type CarouselFilterStyle = 'pills' | 'underline';
export type CarouselFilterAlign = 'start' | 'center' | 'end';
/** Feature 163, T144: the font a carousel item's text takes — its own (`default`), or the brand's heading or body font. */
export type ItemFontRole = 'default' | 'heading' | 'body';
/** Feature 163, T151: a text's weight — `default` keeps the block's own (today's), else 300–800. */
export type TextWeight = 'default' | 300 | 400 | 500 | 600 | 700 | 800;
/** Feature 163, T153: what the controls below a carousel's track line up with — the content edge (today) or the first slide. */
export type CarouselControlsAlignTo = 'container' | 'slide';
/**
 * Feature 163, T171: how an arrow disabled at a non-looping carousel's end
 * looks — dimmed (the default), a light outline (for dark backgrounds), or an
 * outline in `disabledArrowColor`.
 */
export type CarouselDisabledArrowLook = 'dim' | 'outline-light' | 'color';

/**
 * Feature 163, T151/T152: a block heading's weight and its maximum width per
 * breakpoint (a named measure or a Custom px). Unset keeps today's heading.
 */
export interface BlockHeadingStyleProps {
  headingWeight?: TextWeight;
  headingMaxWidth?: TextMaxWidth | ResponsiveProp<TextMaxWidth>;
  headingMaxWidthPx?: number | ResponsiveProp<number>;
}
/** Feature 163, T144: a link tile's label — a text link with an arrow (today), a button look, or none. */
export type LinkTileLabelStyle = 'link' | 'button' | 'none';

/** The carousel's controls: arrows, dots and the arrows' look. */
export interface CarouselControls {
  arrows?: boolean;
  dots?: boolean;
  /**
   * Stored before T129: the placement at every breakpoint. Read when
   * `controlsPlacement` is unset, and carried there by `contentSliderFromLegacy`.
   */
  placement?: CarouselControlsPlacement;
  arrowVariant?: CarouselArrowVariant;
  arrowShape?: CarouselArrowShape;
  arrowSize?: CarouselArrowSize;
  /** T163: the arrows' icon; unset or `chevron` is today's. */
  arrowIcon?: CarouselArrowIcon;
  /** A brand colour token (`token:<role>`) or a hex: the outline and icon, or the solid fill. */
  arrowColor?: string;
  /** T147: the next arrow's own style; unset or `same` is the arrows' style. */
  nextArrowVariant?: CarouselNextArrowVariant;
  /** T171: the look of an arrow disabled at an end when the carousel does not loop; unset is dimmed. */
  disabledArrowLook?: CarouselDisabledArrowLook;
  /** T171: with `disabledArrowLook: 'color'`, a brand colour token (`token:<role>`) or a hex. */
  disabledArrowColor?: string;
}

/** Feature 163, T131: one tag the Carousel filters by — its key, and the label shown (translatable). */
export interface CarouselFilterTag {
  tag: string;
  label?: string;
}

/** Feature 163, T131: the Carousel's optional filter bar ("All" plus its tags). */
export interface CarouselFilter {
  show?: boolean;
  /** The "All" button's label; empty: the page language's word. */
  allLabel?: string;
  tags?: CarouselFilterTag[];
  /** T143: pills (unset, today) or underlined tabs. */
  style?: CarouselFilterStyle;
  /** T143: the bar's alignment; unset is the start (today). */
  align?: CarouselFilterAlign;
}

/** Above the track: a heading, a lead and one button. */
export interface CarouselHeader {
  heading?: InlineRichText | string;
  lead?: string;
  button?: ButtonSpec;
}

/**
 * Feature 163 (contracts/blocks.md `cms.ContentSlider`, labelled "Carousel",
 * research R-12). Slides per view (fractions give the peek) and the gap are CSS
 * per breakpoint; a slide or fade transition; arrows and dots placed over the
 * track, below it or in the header; a bleed past the content edge. Plan
 * § *Extend, don't narrow*: today's px `gap` is its Custom (px) case and
 * today's `showArrows`/`showDots` are `controls` (`contentSliderFromLegacy`).
 */
export interface ContentSliderProps extends HideOnProps, BoxStyleProps, BlockHeadingStyleProps {
  header?: CarouselHeader;
  headingLevel?: HeadingTag;
  headingSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  headingSizePx?: number | ResponsiveProp<number>;
  slides: Slot;
  slidesPerView?: number | ResponsiveProp<number>;
  gap?: SectionGap | number | ResponsiveProp<SectionGap | number>;
  gapPx?: number | ResponsiveProp<number>;
  effect?: CarouselEffect;
  controls?: CarouselControls;
  /** T129: where the arrows sit, per breakpoint. */
  controlsPlacement?: CarouselControlsPlacement | ResponsiveProp<CarouselControlsPlacement>;
  /** T147: how the controls below the track are aligned, per breakpoint; unset is centred. */
  controlsAlign?: CarouselControlsAlign | ResponsiveProp<CarouselControlsAlign>;
  /** T153: the controls below the track lined up with the content edge (unset, today) or the first slide. */
  controlsAlignTo?: CarouselControlsAlignTo;
  /** T171: whether the arrows wrap around at the ends; unset or `true` is today's wrap-around. */
  loop?: boolean;
  bleed?: CarouselBleed;
  autoplay?: boolean;
  intervalMs?: number;
  equalHeight?: boolean;
  /** T130: a carousel (default) or a grid of `columns` per breakpoint. */
  layout?: CarouselLayout;
  columns?: number | ResponsiveProp<number>;
  /** T131: an optional filter bar over the items' tags. */
  filter?: CarouselFilter;
  /** @deprecated stored before feature 163 — read as `controls.arrows`. */
  showArrows?: boolean;
  /** @deprecated stored before feature 163 — read as `controls.dots`. */
  showDots?: boolean;
}

export interface SlideProps extends HideOnProps, BoxStyleProps {
  content: Slot;
  /** T131: comma-separated tags the Carousel's filter matches. */
  tags?: string;
}

/** Feature 163, T129: a scrim behind an overlay caption — a gradient from its edge, or a uniform tint. */
export interface CarouselCaptionScrim {
  kind?: 'none' | 'gradient' | 'solid';
  /** 0–90 (%). */
  strength?: number;
}

/** Where a carousel image's caption sits: every corner and the centre over the image, or below it. */
export type CarouselCaptionPlacement =
  | 'none'
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'below';

export interface CarouselCaptionStyle {
  background?: string;
  color?: string;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: CornerRadius;
  paddingPx?: number;
}

/** Feature 163 (contracts/blocks.md `cms.CarouselImage`): a wide image or a gallery photo. */
export interface CarouselImageProps extends HideOnProps {
  image?: Partial<ResponsiveImage>;
  caption?: InlineRichText | string;
  captionPlacement?: CarouselCaptionPlacement;
  captionStyle?: CarouselCaptionStyle;
  /** T129: a scrim behind an overlay caption; none by default. */
  captionScrim?: CarouselCaptionScrim;
  link?: LinkValue;
  hoverZoom?: boolean;
  /** T131: comma-separated tags the Carousel's filter matches. */
  tags?: string;
  /** T140: the image frame's corners; unset is today's 8 px (`medium`). */
  mediaCornerRadius?: CornerRadius;
  /** T144: the caption's size per breakpoint (a type token, Custom px, or `default`: today's). */
  captionSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  captionSizePx?: number | ResponsiveProp<number>;
  /** T144: the caption's font role; unset is today's. */
  captionFont?: ItemFontRole;
  /** T151: the caption's weight; unset or `default` is today's. Per breakpoint since T188. */
  captionWeight?: TextWeight | ResponsiveProp<TextWeight>;
  /** T172: the caption's colour while the item is hovered or holds focus — a brand colour token or a hex; unset, today's. */
  captionHoverColor?: string;
}

/** Feature 163 (contracts/blocks.md `cms.CarouselSplit`): media beside an icon, a title, text and buttons. */
export interface CarouselSplitProps extends HideOnProps, IconChoice, ButtonListWidthProps {
  media?: MediaTextMedia;
  mediaSide?: 'start' | 'end';
  title?: InlineRichText | string;
  body?: import('@tiptap/core').JSONContent | string | null;
  buttons?: ButtonSpec[];
  /** Zoom the image on hover (US10, R-21); off by default. */
  hoverZoom?: boolean;
  /** T131: comma-separated tags the Carousel's filter matches. */
  tags?: string;
}

/** Feature 163 (contracts/blocks.md `cms.LinkTile`): an image, a title and a "more" link. */
export interface LinkTileProps extends HideOnProps {
  image?: Partial<ResponsiveImage>;
  title?: InlineRichText | string;
  linkLabel?: string;
  link?: LinkValue;
  /** The image frame's ratio, `w:h`; per breakpoint since T130. */
  ratio?: string | ResponsiveProp<string>;
  /** T140: the image frame's corners; unset is today's 8 px (`medium`). */
  mediaCornerRadius?: CornerRadius;
  /** Zoom the image on hover (US10, R-21); off by default. */
  hoverZoom?: boolean;
  /** T131: comma-separated tags the Carousel's filter matches. */
  tags?: string;
  /** T144: the title's and the label's size per breakpoint and font role; unset is today's. */
  titleSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  titleSizePx?: number | ResponsiveProp<number>;
  titleFont?: ItemFontRole;
  /** T151: the title's weight; unset or `default` is today's. Per breakpoint since T188. */
  titleWeight?: TextWeight | ResponsiveProp<TextWeight>;
  /** T178: the title's resting colour — a brand colour token or a hex; unset, today's. Per breakpoint since T181. */
  titleColor?: string | ResponsiveProp<string>;
  /** T172: the title's colour while the tile is hovered or focused — a brand colour token or a hex; unset, today's. */
  titleHoverColor?: string;
  labelSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  labelSizePx?: number | ResponsiveProp<number>;
  labelFont?: ItemFontRole;
  /** T151: the label's weight; unset or `default` is today's. Per breakpoint since T188. */
  labelWeight?: TextWeight | ResponsiveProp<TextWeight>;
  /** T178: the text-link label's resting colour — a brand colour token or a hex; unset, today's. Per breakpoint since T181. */
  labelColor?: string | ResponsiveProp<string>;
  /** T172: the text-link label's colour while the tile is hovered or focused; unset, today's. */
  labelHoverColor?: string;
  /** T144: the label as a text link with an arrow (unset, today), a button look, or not shown. */
  labelStyle?: LinkTileLabelStyle;
}

/** Feature 163 (contracts/blocks.md `cms.DownloadTile`): a library file, downloaded by identity. */
export interface DownloadTileProps extends HideOnProps {
  title?: string;
  subtitle?: string;
  fileAssetId?: string;
  hoverImage?: Partial<ResponsiveImage>;
  linkLabel?: string;
  /** T131: comma-separated tags the Carousel's filter matches. */
  tags?: string;
}

/**
 * Feature 163 (research R-13): a tab or accordion panel holds blocks in its
 * `panel` slot. A page stored before holds the panel as HTML in `content`
 * instead; that string renders as it did until the editor converts it into a
 * `cms.RichContent` block in the slot (`tabsFromLegacy`, `accordionFromLegacy`).
 * The slot has a key of its own because Puck cannot read a string as a slot.
 */
export interface PanelItem {
  panel?: Slot;
  /** Stored before feature 163: the panel as HTML. Never written any more. */
  content?: string;
}

export interface TabItem extends PanelItem {
  label: string;
}

export interface TabsProps extends HideOnProps, BoxStyleProps {
  items: TabItem[];
  defaultTab?: number;
  variant?: 'underline' | 'pills' | 'boxed';
  /**
   * Feature 163: how the panel changes — instant (today), a crossfade (`fade`) or a crossfade with a short
   * sideways shift (`slide`, T174); the panels' height follows. Instant under reduced motion.
   */
  effect?: 'none' | 'fade' | 'slide';
  align?: 'start' | 'center' | 'stretch';
  /** Feature 163, T132: the tab bar's look; nothing set keeps today's. */
  tabStyle?: TabsStyle;
  /** T146: the space between the tab bar and the panel, per breakpoint; unset is today's 12 px. */
  panelGap?: SectionGap | ResponsiveProp<SectionGap>;
  /** The Custom (px) case of `panelGap`. */
  panelGapPx?: number | ResponsiveProp<number>;
  /** T155: tabs that do not fit wrap onto more lines (unset, today) or scroll in one line. */
  barOverflow?: 'wrap' | 'scroll';
  /** T163: the tab size per breakpoint; unset reads `tabStyle.size` (T132), else today's medium. */
  tabSize?: TabSize | ResponsiveProp<TabSize>;
}

/** Feature 163, T132/T163: a tab's size — small, medium (today) or large. */
export type TabSize = 's' | 'm' | 'l';

/**
 * Feature 163, T132: the tab bar's look. Colours are a brand token
 * (`token:<role>`) or a hex; the bar is drawn (a capsule around pills) once it
 * has a background or a border colour.
 */
export interface TabsStyle {
  /** Stored by T132; since T163 the editor offers `TabsProps.tabSize` (per breakpoint) and moves it there. */
  size?: TabSize;
  barBackground?: string;
  barBorderColor?: string;
  activeBackground?: string;
  activeColor?: string;
  inactiveBackground?: string;
  inactiveColor?: string;
  /** T174: a tab that is not selected, under the pointer; unset keeps today's (no hover change). */
  hoverBackground?: string;
  hoverColor?: string;
}

export interface AccordionItem extends PanelItem {
  title: string;
}

export interface AccordionProps extends HideOnProps, BoxStyleProps {
  items: AccordionItem[];
  allowMultiple?: boolean;
  /** A list of item indexes; the editor's number field writes one index. */
  defaultOpen?: number[] | number;
  iconPosition?: 'start' | 'end';
  variant?: 'default' | 'flush' | 'bordered';
  /** Each trigger inside a heading of this level (T134); unset or `none` is today's bare button. */
  titleLevel?: 'none' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  /** The title's size: a type token, Custom (`titleSizePx`) or `default` — today's 15 px semibold. */
  titleSize?: TypeToken | 'custom' | 'default' | ResponsiveProp<TypeToken | 'custom' | 'default'>;
  titleSizePx?: number | ResponsiveProp<number>;
  /** T175: the open/close icon — `plus` (today's plus/minus glyph, also when unset) or a turning `chevron`. */
  icon?: AccordionIcon;
  /** T175: the lines of plain items — none, between items, or above, between and below; unset is the style's own. */
  dividers?: AccordionDividers;
  /** T175: `boxed` items (a bordered box each) or `plain` ones; unset follows `variant` (`bordered` is boxed). */
  itemStyle?: AccordionItemStyle;
  /** T175: the title's block padding — a spacing token or Custom (`titlePaddingPx`); unset is today's 12 px. */
  titlePadding?: SpaceToken | 'custom' | ResponsiveProp<SpaceToken | 'custom'>;
  titlePaddingPx?: number | ResponsiveProp<number>;
  /** T179: the triggers' colour (title and icon) — a brand colour token or a hex; unset, today's (inherited). */
  titleColor?: string;
  /** T179: the line of an item with one under the item (`item`, today's, also when unset) or under its title. */
  dividerPosition?: AccordionDividerPosition;
  /** T179: the icon's size — a token (s 16, m 20, l 24 px) or Custom (`iconSizePx`); unset, today's (the trigger's text). */
  iconSize?: AccordionIconSize;
  iconSizePx?: number;
  /** T182: the space between a title (its line) and its open panel — a spacing token or Custom (`panelGapPx`); unset, today's. */
  panelGap?: SpaceToken | 'custom' | ResponsiveProp<SpaceToken | 'custom'>;
  panelGapPx?: number | ResponsiveProp<number>;
  /** T182: the space between items — a spacing token or Custom (`itemGapPx`); unset, today's (none; 8 px for boxed items). */
  itemGap?: SpaceToken | 'custom' | ResponsiveProp<SpaceToken | 'custom'>;
  itemGapPx?: number | ResponsiveProp<number>;
  /**
   * T183: the titles' weight; unset or `default` is today's (the trigger's semibold).
   * T185: or one per breakpoint (a tier without one reads the tier below; below the first, today's).
   */
  titleWeight?: TextWeight | ResponsiveProp<TextWeight>;
  /** T186: the space below an open panel — a spacing token or Custom (`panelPaddingBottomPx`); unset, today's 12 px. */
  panelPaddingBottom?: SpaceToken | 'custom' | ResponsiveProp<SpaceToken | 'custom'>;
  panelPaddingBottomPx?: number | ResponsiveProp<number>;
  /** T186: the space after an open item, instead of the item gap — a spacing token or Custom (`openItemGapPx`); unset, the item gap. */
  openItemGap?: SpaceToken | 'custom' | ResponsiveProp<SpaceToken | 'custom'>;
  openItemGapPx?: number | ResponsiveProp<number>;
}

export type AccordionIcon = 'plus' | 'chevron';
export type AccordionDividerPosition = 'item' | 'title';
export type AccordionIconSize = 's' | 'm' | 'l' | 'custom';
export type AccordionDividers = 'none' | 'between' | 'all';
export type AccordionItemStyle = 'plain' | 'boxed';

export type ProductSource = 'manual' | 'category' | 'query';

export interface CmsProductCardProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  productSlug: string;
  showPrice?: boolean;
  showSku?: boolean;
  showStock?: boolean;
  imageRatio?: 'square' | '4:3' | '16:9' | 'auto';
  imageObjectFit?: 'cover' | 'contain' | 'fill' | 'none';
  /** Max card width in px; omit or 0 = stretch to container. */
  maxWidthPx?: number | ResponsiveProp<number>;
  /** Fixed media height in px; when set, overrides aspect-ratio from imageRatio. */
  imageHeightPx?: number | ResponsiveProp<number>;
  /** `showcase` (feature 163): the image on a neutral backdrop, the name, the summary and a "more" link. */
  variant?: 'default' | 'compact' | 'horizontal' | 'showcase';
  ctaLabel?: string;
}

/**
 * The Carousel's header options, shared by every block with a carousel-style
 * header (feature 163, contracts/blocks.md: `header?` "as Carousel").
 */
export interface CarouselHeaderOptions extends BlockHeadingStyleProps {
  header?: CarouselHeader;
  headingLevel?: HeadingTag;
  headingSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  headingSizePx?: number | ResponsiveProp<number>;
}

/** The Carousel's track options, shared by every block that shows a carousel (feature 163). */
export interface CarouselTrackOptions {
  slidesPerView?: number | ResponsiveProp<number>;
  gap?: SectionGap | number | ResponsiveProp<SectionGap | number>;
  gapPx?: number | ResponsiveProp<number>;
  effect?: CarouselEffect;
  controls?: CarouselControls;
  /** T129: where the arrows sit, per breakpoint. */
  controlsPlacement?: CarouselControlsPlacement | ResponsiveProp<CarouselControlsPlacement>;
  /** T147: how the controls below the track are aligned, per breakpoint; unset is centred. */
  controlsAlign?: CarouselControlsAlign | ResponsiveProp<CarouselControlsAlign>;
  /** T153: the controls below the track lined up with the content edge (unset, today) or the first slide. */
  controlsAlignTo?: CarouselControlsAlignTo;
  /** T171: whether the arrows wrap around at the ends; unset or `true` is today's wrap-around. */
  loop?: boolean;
  bleed?: CarouselBleed;
  autoplay?: boolean;
  intervalMs?: number;
  equalHeight?: boolean;
}

/** One row of `cms.LinkList`: a title, an optional description and a button. */
export interface LinkListItem {
  title: string;
  description?: string;
  button: ButtonSpec;
}

/** `cms.LinkList` (feature 163, contracts/blocks.md, FR-028): rows (1–50) and a divider. */
export interface LinkListProps extends HideOnProps, BlockHeadingStyleProps {
  heading?: InlineRichText | string;
  headingLevel?: HeadingTag;
  headingSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  headingSizePx?: number | ResponsiveProp<number>;
  items?: LinkListItem[];
  divider?: boolean;
}

/**
 * `blog.LatestPosts` (feature 163, contracts/blocks.md, owner `blog`): the
 * newest `limit` posts (1–12), optionally of one category, as cards in a
 * carousel (the Carousel's options) or a grid of `columns`.
 */
export interface LatestPostsProps extends HideOnProps, CarouselHeaderOptions, CarouselTrackOptions {
  limit?: number;
  categorySlug?: string;
  layout?: 'carousel' | 'grid';
  /** Grid columns per breakpoint (1–4). */
  columns?: number | ResponsiveProp<number>;
  readMoreLabel?: string;
  // T189 (R15): the post card's look, the lead and the header button. Unset is today's look.
  /** The card's background, a hex or `token:<role>`; unset is the scheme's background. */
  cardBackground?: string;
  /** The card's corners; unset is today's 8 px. */
  cardRadius?: CornerRadius;
  /** The space around the card's image and text, per breakpoint; unset is none. */
  cardPadding?: SectionGap | ResponsiveProp<SectionGap>;
  cardPaddingPx?: number | ResponsiveProp<number>;
  /** The space above and beside the text under the image, per breakpoint; unset is today's 16 px above. */
  cardTextPadding?: SectionGap | ResponsiveProp<SectionGap>;
  cardTextPaddingPx?: number | ResponsiveProp<number>;
  /** The image frame's ratio per breakpoint (an aspect token or `w:h`); unset is 2:1. */
  imageRatio?: string | ResponsiveProp<string>;
  hoverZoom?: boolean;
  /** The category chip: today's filled pill, an outline, or none. */
  chipStyle?: PostChipStyle;
  cardTitleSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  cardTitleSizePx?: number | ResponsiveProp<number>;
  cardTitleWeight?: TextWeight | ResponsiveProp<TextWeight>;
  readMoreIcon?: PostReadMoreIcon;
  readMoreAlign?: 'start' | 'end';
  readMoreWeight?: TextWeight;
  leadSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  leadSizePx?: number | ResponsiveProp<number>;
  leadColor?: string;
  /** Where the header's button sits per breakpoint: below the lead (today), at the header's end, or after the posts. */
  headerButtonPlacement?: HeaderButtonPlacement | ResponsiveProp<HeaderButtonPlacement>;
  headerButtonFullWidth?: ButtonWidth | ResponsiveProp<ButtonWidth>;
}

/** T189: a post card's category chip. */
export type PostChipStyle = 'filled' | 'outline' | 'none';
/** T189: the icon after a post card's read-more label. */
export type PostReadMoreIcon = 'none' | 'arrow' | 'plus';
/** T189: where a listing header's button sits. */
export type HeaderButtonPlacement = 'below' | 'end' | 'after';

/** The card style of a product listing (feature 163): today's three and `showcase`. */
export type ProductCardVariant = 'default' | 'compact' | 'horizontal' | 'showcase';

/**
 * The line of text a product card shows under its name (feature 163, T135):
 * `default` is the card style's own — the SKU on today's three, the summary on
 * `showcase` — or the summary, the SKU, or none.
 */
export type ProductCardTextLine = 'default' | 'summary' | 'sku' | 'none';
/** T168: a line under each card of a listing; `none` (unset) is today's. */
export type ProductCardDivider = 'none' | 'line';

/**
 * What feature 163 adds to both product listings (contracts/blocks.md): a
 * carousel-style header, the card style, the label of a card's "more" link
 * and a button below the listing.
 */
export interface ProductListingAdditions extends CarouselHeaderOptions {
  cardVariant?: ProductCardVariant;
  /** Unset is `default`: the card style's own line, as today (T135). */
  cardTextLine?: ProductCardTextLine;
  /** T151: the weight of each card's name; unset or `default` is the card's own. */
  cardTitleWeight?: TextWeight;
  /** T168: the card's image box background (`#rrggbb` or `token:<role>`); unset keeps the card style's own neutral. */
  cardImageBackground?: string;
  /** T168: a divider under each card; unset or `none` is today's (none). */
  cardDivider?: ProductCardDivider;
  /** T168: the divider's colour (`#rrggbb` or `token:<role>`); unset is the neutral border colour. Read only with a line. */
  cardDividerColor?: string;
  ctaLabel?: string;
  footerButton?: ButtonSpec;
}

export interface ProductGridProps extends HideOnProps, BoxStyleProps, ProductListingAdditions {
  source?: ProductSource;
  productSlugs?: string[];
  categorySlug?: string;
  searchQuery?: string;
  limit?: number;
  columns?: number | ResponsiveProp<number>;
  /** R17 (T207): a size or Custom (with `gapPx`), per breakpoint; a stored number is a px gap. */
  gap?: SectionGap | number | ResponsiveProp<SectionGap | number>;
  gapPx?: number | ResponsiveProp<number>;
  view?: 'grid' | 'list' | ResponsiveProp<'grid' | 'list'>;
  /** R17 (T219): one per breakpoint since the switch sits on the Responsive tab; a stored boolean is every breakpoint's. */
  equalItemHeight?: boolean | ResponsiveProp<boolean>;
}

/**
 * Feature 163: the slider takes the Carousel's options (`CarouselTrackOptions`);
 * a slider stored before carries `showArrows`/`showDots` and a px `gap`,
 * read through `productSliderFromLegacy`.
 */
export interface ProductSliderProps extends HideOnProps, BoxStyleProps, ProductListingAdditions, CarouselTrackOptions {
  source?: ProductSource;
  productSlugs?: string[];
  categorySlug?: string;
  searchQuery?: string;
  limit?: number;
  /** @deprecated stored before feature 163 — read as `controls.arrows`. */
  showArrows?: boolean;
  /** @deprecated stored before feature 163 — read as `controls.dots`. */
  showDots?: boolean;
}

export type CategorySelectionMode = 'all' | 'manual' | 'childrenOf';

export interface CategoryListProps extends HideOnProps, BoxStyleProps {
  selectionMode?: CategorySelectionMode;
  categorySlugs?: string[];
  parentSlug?: string;
  layout?: 'list' | 'inline' | 'chips';
  showCounts?: boolean;
  maxDepth?: number;
}

export interface CategoryGridProps extends HideOnProps, BoxStyleProps {
  selectionMode?: CategorySelectionMode;
  categorySlugs?: string[];
  parentSlug?: string;
  columns?: number | ResponsiveProp<number>;
  /** R17 (T207): a size or Custom (with `gapPx`), per breakpoint; a stored number is a px gap. */
  gap?: SectionGap | number | ResponsiveProp<SectionGap | number>;
  gapPx?: number | ResponsiveProp<number>;
  showImage?: boolean;
  cardStyle?: 'overlay' | 'stacked' | 'minimal';
  showCounts?: boolean;
  maxDepth?: number;
  /** R17 (T219): one per breakpoint since the switch sits on the Responsive tab; a stored boolean is every breakpoint's. */
  equalItemHeight?: boolean | ResponsiveProp<boolean>;
}

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  /** A URL before R17 (T212); a `LinkValue` since. */
  link?: string | LinkValue;
}

export type MapProvider = 'leaflet' | 'google';

export interface MapProps extends HideOnProps, BoxStyleProps {
  provider?: MapProvider;
  height?: number | ResponsiveProp<number>;
  centerLat?: number;
  centerLng?: number;
  zoom?: number;
  markers?: MapMarker[];
  googleApiKey?: string;
}

export interface SpacerProps extends HideOnProps {
  heightPx?: number | ResponsiveProp<number>;
  showDivider?: boolean;
  dividerColor?: string;
}

/**
 * Feature 163 (contracts/blocks.md) — a size whose unset value is the block's
 * own look: a type token, **Custom** (`'custom'` with its px), or `'default'`.
 */
export type SectionTextSize = TypeToken | 'custom' | 'default';

/** A gap: a spacing token or **Custom** (`'custom'` with its px). A number is a gap stored before feature 163 (px). */
export type SectionGap = SpaceToken | 'custom';

/** An icon from the curated catalog, or an uploaded SVG (`iconAssetId`), which wins. */
export interface IconChoice {
  icon?: string;
  iconAssetId?: string;
}

export interface FeatureListItem extends IconChoice {
  /** Inline rich text; a plain string stored before is read as one. */
  title: InlineRichText | string;
  /** A TipTap document. */
  body?: import('@tiptap/core').JSONContent | string | null;
  /** @deprecated stored before feature 163 — read as `body`. */
  description?: string;
}

export type FeatureListIconSize = 'small' | 'medium' | 'large' | 'custom';

/**
 * Feature 163 (contracts/blocks.md `cms.FeatureList`): a heading, 1–4 columns
 * per breakpoint, rich item bodies, catalog or uploaded icons and an image
 * below the grid. Plan § *Extend, don't narrow*: today's `gap` and `iconSize`
 * are their Custom (px) cases, its `align` the logical one; a list stored
 * before renders through the same renderer (`featureListFromLegacy`).
 */
export interface FeatureListProps extends HideOnProps, BoxStyleProps, BlockHeadingStyleProps {
  heading?: InlineRichText | string;
  headingLevel?: HeadingTag;
  headingSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  headingSizePx?: number | ResponsiveProp<number>;
  items: FeatureListItem[];
  columns?: number | ResponsiveProp<number>;
  gap?: SectionGap | number | ResponsiveProp<SectionGap | number>;
  gapPx?: number | ResponsiveProp<number>;
  iconColor?: string;
  iconSize?: FeatureListIconSize | number;
  iconSizePx?: number;
  align?: BlockAlign | ImageAlign;
  /** Unset or `'default'`: today's title look. */
  titleSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  titleSizePx?: number | ResponsiveProp<number>;
  /** T151: each item title's weight; unset or `default` is today's. */
  titleWeight?: TextWeight;
  image?: Partial<ResponsiveImage>;
}

/**
 * Feature 163 (contracts/blocks.md `cms.Hero`) — the hero's media: today's
 * solid and gradient backgrounds, an art-directed image, or a video pair
 * (desktop and mobile) with a poster. A video keeps today's URL source beside
 * the asset library.
 */
export type HeroMedia =
  | { kind: 'none' }
  | { kind: 'solid'; color?: string }
  | { kind: 'gradient'; from?: string; to?: string; angle?: number }
  | { kind: 'image'; image?: Partial<ResponsiveImage> }
  | {
      kind: 'video';
      videoSource?: 'url' | 'library';
      videoUrl?: string;
      videoAssetId?: string;
      mobileVideoAssetId?: string;
      /** T142: the mobile video by URL — the one used with the URL source, the fallback with the library. */
      mobileVideoUrl?: string;
      posterAssetId?: string;
      /**
       * T191: where both posters come from. Unset or `library`: the library
       * image wins over the URL; `url`: the URL wins and the library image is
       * the fallback. The editor shows the source the stored values imply.
       */
      posterSource?: 'library' | 'url';
      /** T191: the poster by URL, made absolute against the media origin. */
      posterUrl?: string;
      /** T162: the mobile video's own poster, a library image or a URL (by `posterSource`); unset, the poster. */
      mobilePosterAssetId?: string;
      mobilePosterUrl?: string;
      /** T126: the frame's ratio above the content, per breakpoint; unset is 16:9. */
      ratio?: string | ResponsiveProp<string>;
    };

export type HeroMinHeight = 'auto' | 'half' | 'tall' | 'screen' | 'custom';

/** One of the hero's texts: a size token, or **Custom** (`'custom'` + its `…SizePx`). */
export type HeroTextSize = TypeToken | 'custom';

/** One of the hero's elements, in the order an editor may choose (T133). */
export type HeroElement = 'eyebrow' | 'title' | 'subheading' | 'statement' | 'body' | 'buttons' | 'socialProof';

/** T145: the space after one hero element — a spacing token, or Custom with its px. */
export interface HeroSpaceAfter {
  element?: HeroElement;
  space?: SpaceToken | 'custom';
  spacePx?: number;
}

/**
 * T193: one item of the hero's element list — its place in the order and,
 * optionally, the space after it (a spacing token or Custom with its px).
 * `default` or no space keeps `gaps` or today's spacing (and reads a stored
 * `spaceAfter` entry for the element).
 */
export interface HeroOrderItem {
  element?: HeroElement;
  space?: SpaceToken | 'custom' | 'default';
  spacePx?: number;
}

/** The social-proof line: a small image (an avatar group, a badge) and a caption. */
export interface HeroSocialProof {
  image?: Partial<ResponsiveImage>;
  caption?: string;
}

/**
 * Feature 163 (contracts/blocks.md `cms.Hero`): media with a mobile
 * alternative, an eyebrow, a title, a subheading and a statement with their own
 * level and size, rich text, a list of buttons and a social-proof line. Plan §
 * *Extend, don't narrow*: every field of today's hero has its counterpart, and
 * a hero stored before keeps today's fields until the editor opens it; it
 * renders through the same renderer (`heroFromLegacy`).
 */
export interface HeroProps extends HideOnProps, BoxStyleProps, ButtonListWidthProps {
  media?: HeroMedia;
  mediaPlacement?: 'background' | 'above';
  overlay?: SectionOverlay;
  textColor?: string;
  eyebrow?: string;
  title?: InlineRichText | string;
  titleLevel?: HeadingTag;
  /** Unset on a hero carried from before feature 163: today's title look. */
  titleSize?: HeroTextSize | ResponsiveProp<HeroTextSize>;
  titleSizePx?: number | ResponsiveProp<number>;
  /** T151: the title's weight; unset or `default` is the size's own. */
  titleWeight?: TextWeight;
  /** T152: the title's maximum width per breakpoint; unset is today's full width. */
  titleMaxWidth?: TextMaxWidth | ResponsiveProp<TextMaxWidth>;
  titleMaxWidthPx?: number | ResponsiveProp<number>;
  subheading?: InlineRichText | string;
  subheadingLevel?: HeadingTag;
  subheadingSize?: HeroTextSize | ResponsiveProp<HeroTextSize>;
  subheadingSizePx?: number | ResponsiveProp<number>;
  statement?: InlineRichText | string;
  statementLevel?: HeadingTag;
  statementSize?: HeroTextSize | ResponsiveProp<HeroTextSize>;
  statementSizePx?: number | ResponsiveProp<number>;
  /** A TipTap document. */
  body?: import('@tiptap/core').JSONContent | null;
  buttons?: ButtonSpec[];
  socialProof?: HeroSocialProof;
  align?: BlockAlign;
  minHeight?: HeroMinHeight | ResponsiveProp<HeroMinHeight>;
  /** The Custom (px) case of `minHeight`: today's `minHeightPx`. */
  minHeightPx?: number | ResponsiveProp<number>;
  /** Unset on a hero carried from before feature 163: today's spacing between its texts. */
  gaps?: SpaceToken | ResponsiveProp<SpaceToken>;
  cornerRadius?: CornerRadius;
  shadow?: Shadow;
  /** The entrance reveal of the statement and the body (US10, R-21); unset is none. */
  reveal?: Partial<RevealSetting>;
  /**
   * The order of the elements (T133): listed ones first, in this order; the
   * others follow in the default order. Unset is the default order — eyebrow,
   * title, subheading, statement, body, buttons, social proof. T193: an item
   * may carry the space after its element (`space`, `spacePx`).
   */
  order?: HeroOrderItem[];
  /** `viewport`: image or video media reaches the window's edges (T133). Unset is `content`, today's. */
  mediaWidth?: 'content' | 'viewport';
  /**
   * T145: the space after given elements — a spacing token or Custom px. The
   * first entry per element counts; an element not listed keeps `gaps` (or,
   * without it, today's spacing). Unset adds nothing.
   *
   * @deprecated T193: the space is an item's own in `order`. A stored list is
   * still read for an element whose item has no space, and the editor carries
   * it into `order` once.
   */
  spaceAfter?: HeroSpaceAfter[];

  /** @deprecated stored before feature 163 — read as `title`. */
  heading?: string;
  /** @deprecated stored before feature 163 — read as `subheading`. */
  subtitle?: string;
  /** @deprecated stored before feature 163 — read as `buttons[0].label`. */
  buttonLabel?: string;
  /** @deprecated stored before feature 163 — read as `buttons[0].link`. */
  buttonLinkType?: ButtonLinkType;
  /** @deprecated stored before feature 163 — read as `buttons[0].link`. */
  buttonLinkSlug?: string;
  /** @deprecated stored before feature 163 — read as `buttons[0].link`. */
  buttonHref?: string;
  /** @deprecated stored before feature 163 — read as `buttons[0].link.target`. */
  buttonTarget?: ButtonTarget;
  /** @deprecated stored before feature 163 — read as `buttons[0].style` and `.fill`. */
  buttonVariant?: ButtonVariant | ResponsiveProp<ButtonVariant>;
  /** @deprecated stored before feature 163 — read as `buttons[0].backgroundColor`. */
  buttonBackgroundColor?: string;
  /** @deprecated stored before feature 163 — read as `buttons[0].textColor`. */
  buttonTextColor?: string;
  /** @deprecated stored before feature 163 — read as `media`. */
  background?: BackgroundProp;
  /** @deprecated stored before feature 163 — read as `overlay`. */
  overlayOpacity?: number;
  /** @deprecated stored before feature 163 — read as `align`. */
  contentAlign?: ImageAlign;
}

export interface LogoStripItem {
  /** Nested image control (URL vs asset library) — same pattern as Image Slider. */
  image?: {
    imageSource?: ImageSourceKind;
    src?: string;
    assetId?: string;
  };
  imageSource?: ImageSourceKind;
  src?: string;
  assetId?: string;
  alt?: string;
  /** Before R17 (T212): a URL, opened in a new tab; read as a URL link. */
  href?: string;
  /** R17 (T212): the link, any kind (`LinkValue`); wins over `href`. */
  link?: LinkValue;
}

export interface LogoStripProps extends HideOnProps, BoxStyleProps {
  items: LogoStripItem[];
  /** R17 (T207): a size or Custom (with `gapPx`), per breakpoint; a stored number is a px gap. */
  gap?: SectionGap | number | ResponsiveProp<SectionGap | number>;
  gapPx?: number | ResponsiveProp<number>;
  logoMaxHeightPx?: number;
  grayscale?: boolean;
  align?: ImageAlign;
}

/**
 * Feature 163 (contracts/blocks.md `cms.Testimonial`): a rich quote, an image,
 * today's card or an image card with the quote laid over it, and the avatar as
 * one `ResponsiveImage`. A testimonial stored before keeps today's avatar
 * fields until the editor opens it (`testimonialFromLegacy`).
 */
export interface TestimonialProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  /** A TipTap document; a plain string stored before is read as one paragraph. */
  quote: import('@tiptap/core').JSONContent | string;
  author?: string;
  role?: string;
  layout?: 'card' | 'image-overlay';
  image?: Partial<ResponsiveImage>;
  avatar?: Partial<ResponsiveImage>;
  /** @deprecated stored before feature 163 — read as `avatar.imageSource`. */
  avatarSource?: ImageSourceKind;
  /** @deprecated stored before feature 163 — read as `avatar.src`. */
  avatarUrl?: string;
  /** @deprecated stored before feature 163 — read as `avatar.assetId`. */
  avatarAssetId?: string;
}

export interface StatsItem {
  value: string;
  label: string;
}

/**
 * Feature 163 (contracts/blocks.md `cms.Stats`): a heading, an image beside the
 * figures and a grid per breakpoint. The contract's `grid` is today's
 * `columns`, kept by name and range (1–6); today's `gap` is the Custom (px)
 * case of a token gap and its `align` the logical one (`statsFromLegacy`).
 */
export interface StatsProps extends HideOnProps, BoxStyleProps, BlockHeadingStyleProps {
  heading?: InlineRichText | string;
  headingLevel?: HeadingTag;
  headingSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  headingSizePx?: number | ResponsiveProp<number>;
  image?: Partial<ResponsiveImage>;
  imageSide?: 'start' | 'end';
  items: StatsItem[];
  columns?: number | ResponsiveProp<number>;
  gap?: SectionGap | number | ResponsiveProp<SectionGap | number>;
  gapPx?: number | ResponsiveProp<number>;
  align?: BlockAlign | ImageAlign;
  valueColor?: string;
  /** Unset or `'default'`: today's value look. */
  valueSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  valueSizePx?: number | ResponsiveProp<number>;
}

/** Feature 163 (contracts/blocks.md `cms.MediaText`) — the media: an art-directed image or a video with a poster. */
export type MediaTextMedia =
  | { kind: 'image'; image?: Partial<ResponsiveImage> }
  | {
      kind: 'video';
      /** T142: `url` plays `videoUrl`/`mobileVideoUrl`; unset or `library` the library videos (a URL as the fallback). */
      videoSource?: 'url' | 'library';
      videoUrl?: string;
      videoAssetId?: string;
      /** T142: the video below the tablet tier, from the library or by URL. */
      mobileVideoAssetId?: string;
      mobileVideoUrl?: string;
      /**
       * R17 (T217): where both posters come from. Unset, the library image wins over a
       * URL (today's); `url`, the URLs first and the library images as the fallback.
       */
      posterSource?: 'library' | 'url';
      posterAssetId?: string;
      /** R17 (T217): the poster by URL. */
      posterUrl?: string;
      /** T162: the mobile video's own poster, a library image (wins) or a URL; unset, the poster. */
      mobilePosterAssetId?: string;
      mobilePosterUrl?: string;
      autoplay?: boolean;
      /** T126: the frame's ratio per breakpoint; unset is 16:9. */
      ratio?: string | ResponsiveProp<string>;
    };

/** An icon item: an icon, an inline rich title and a short plain text. */
export interface IconTextItem extends IconChoice {
  title?: InlineRichText | string;
  body?: string;
}

export interface MediaTextRow {
  media?: MediaTextMedia;
  heading?: InlineRichText | string;
  body?: import('@tiptap/core').JSONContent | string | null;
  features?: IconTextItem[];
  buttons?: ButtonSpec[];
}

export type MediaTextSplit = '5-5' | '6-6' | '5-6' | '4-7' | '7-4';

/**
 * Feature 163 (contracts/blocks.md `cms.MediaText`, FR-013): media beside text,
 * the media side on desktop and the stacking order on mobile, an icon-item
 * list, buttons, a footnote, and repeated rows that alternate their sides.
 */
export interface MediaTextProps extends HideOnProps, BlockHeadingStyleProps, ButtonListWidthProps {
  heading?: InlineRichText | string;
  headingLevel?: HeadingTag;
  headingSize?: TypeToken | 'custom' | ResponsiveProp<TypeToken | 'custom'>;
  headingSizePx?: number | ResponsiveProp<number>;
  media?: MediaTextMedia;
  mediaSide?: 'start' | 'end';
  mobileOrder?: 'media-first' | 'text-first';
  split?: MediaTextSplit;
  verticalAlign?: BlockAlign;
  body?: import('@tiptap/core').JSONContent | string | null;
  features?: IconTextItem[];
  buttons?: ButtonSpec[];
  footnote?: import('@tiptap/core').JSONContent | string | null;
  rows?: MediaTextRow[];
  alternate?: boolean;
  divider?: boolean;
  /** T160: every feature title's size per breakpoint; unset or `default` is today's 16 px. */
  featureTitleSize?: SectionTextSize | ResponsiveProp<SectionTextSize>;
  featureTitleSizePx?: number | ResponsiveProp<number>;
  /** T160: every feature title's weight; unset or `default` is today's 600. */
  featureTitleWeight?: TextWeight;
}

export type BackgroundPanelHeight = 'medium' | 'tall' | 'screen';

/**
 * Feature 163 (contracts/blocks.md `cms.BackgroundPanel`, FR-014): a full-bleed
 * image with the text in one half on desktop, stacked on mobile.
 */
export interface BackgroundPanelProps extends HideOnProps, IconChoice, BlockHeadingStyleProps, ButtonListWidthProps {
  image?: Partial<ResponsiveImage>;
  textSide?: 'start' | 'end';
  mobileTextPosition?: 'top' | 'bottom';
  heading?: InlineRichText | string;
  headingLevel?: HeadingTag;
  headingSize?: TypeToken | 'custom' | ResponsiveProp<TypeToken | 'custom'>;
  headingSizePx?: number | ResponsiveProp<number>;
  body?: import('@tiptap/core').JSONContent | string | null;
  buttons?: ButtonSpec[];
  minHeight?: BackgroundPanelHeight | ResponsiveProp<BackgroundPanelHeight>;
}

export interface CtaCardListItem {
  icon?: string;
  text: string;
}

/**
 * Feature 163 (contracts/blocks.md `cms.CtaCard`, FR-015): a boxed call to
 * action in a muted, dark or light card, with an icon list, buttons and an
 * image.
 */
export interface CtaCardProps extends HideOnProps, BlockHeadingStyleProps, ButtonListWidthProps {
  cardScheme?: 'muted' | 'dark' | 'light';
  decorative?: boolean;
  heading?: InlineRichText | string;
  headingLevel?: HeadingTag;
  headingSize?: TypeToken | 'custom' | ResponsiveProp<TypeToken | 'custom'>;
  headingSizePx?: number | ResponsiveProp<number>;
  body?: import('@tiptap/core').JSONContent | string | null;
  list?: CtaCardListItem[];
  listColumns?: 1 | 2;
  buttons?: ButtonSpec[];
  image?: Partial<ResponsiveImage>;
  imageSide?: 'start' | 'end';
}

/**
 * Feature 163 (contracts/blocks.md `cms.Statement`, FR-016): a large heading
 * with an optional muted continuation (the `muted` emphasis), supporting text,
 * and optionally a full-bleed image with the text at the bottom or centre.
 */
export interface StatementProps extends HideOnProps, TextMaxWidthProps {
  heading?: InlineRichText | string;
  headingLevel?: HeadingTag;
  headingSize?: TypeToken | 'custom' | ResponsiveProp<TypeToken | 'custom'>;
  headingSizePx?: number | ResponsiveProp<number>;
  /** T151: the heading's weight; its measure is the block's `textMaxWidth`. */
  headingWeight?: TextWeight;
  body?: import('@tiptap/core').JSONContent | string | null;
  align?: 'start' | 'center';
  background?: { image?: Partial<ResponsiveImage>; textPosition?: 'bottom' | 'center' };
  /** The entrance reveal of the heading and the body (US10, R-21); unset is none. */
  reveal?: Partial<RevealSetting>;
}

export interface AnnouncementBarProps extends HideOnProps {
  text: string;
  /** Before R17 (T212): a URL; read as a URL link. */
  href?: string;
  /** R17 (T212): the link, any kind (`LinkValue`); wins over `href`. */
  link?: LinkValue;
  backgroundColor?: string;
  textColor?: string;
}

export interface SimpleTableHeader {
  label: string;
}

export interface SimpleTableCell {
  value: string;
}

export interface SimpleTableRow {
  cells: SimpleTableCell[];
}

export interface SimpleTableProps extends HideOnProps, BoxStyleProps {
  /** @deprecated legacy pipe-separated headers — migrated in resolveData */
  headers?: string | SimpleTableHeader[];
  /** @deprecated legacy pipe-separated rows — migrated in resolveData */
  rows?: string | SimpleTableRow[];
  columns?: SimpleTableHeader[];
  tableRows?: SimpleTableRow[];
  striped?: boolean;
}

export interface NewsletterSignupProps extends HideOnProps, BoxStyleProps, AppearanceProps {
  heading?: string;
  description?: string;
  placeholder?: string;
  buttonLabel?: string;
  /** Form action URL (newsletter endpoint or external). */
  actionUrl?: string;
  /** Feature 163 (T076): a required consent checkbox in the form. Off by default. */
  showConsent?: boolean;
  /** Its label, inline rich text that may hold a link. */
  consentLabel?: InlineRichText | string;
}

/** One topic of `newsletter.Signup`: a checkbox that adds the newsletter tag `tagCode`. */
export interface NewsletterSignupTopic {
  label?: string;
  tagCode?: string;
}

/** The messages `newsletter.Signup` shows for each outcome of a sign-up. */
export interface NewsletterSignupMessages {
  pending?: string;
  active?: string;
  consent?: string;
  email?: string;
  topics?: string;
  unavailable?: string;
}

/**
 * `newsletter.Signup` (feature 163, contracts/blocks.md, owner `newsletter`,
 * FR-029): the sign-up that subscribes through the newsletter module, posting
 * to the storefront's `/newsletter/subscribe`.
 */
export interface NewsletterSignupFormProps extends HideOnProps {
  heading?: InlineRichText | string;
  headingLevel?: HeadingTag;
  text?: unknown;
  placeholder?: string;
  buttonLabel?: string;
  /** 0–12 topics, rendered as a checkbox group. */
  topics?: NewsletterSignupTopic[];
  /** Whether at least one topic must be chosen. */
  topicsRequired?: boolean;
  topicsLegend?: string;
  emailLabel?: string;
  consentLabel?: InlineRichText | string;
  layout?: 'inline' | 'boxed';
  messages?: NewsletterSignupMessages;
}

export interface ContactFormEmbedProps extends HideOnProps, BoxStyleProps {
  heading?: string;
  description?: string;
  /** External form embed URL (iframe) or leave empty for mailto fallback. */
  embedUrl?: string;
  mailto?: string;
  heightPx?: number;
}
