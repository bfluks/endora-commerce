# Data model: Page builder for corporate marketing pages

**Spec**: [spec.md](./spec.md) · **Research**: [research.md](./research.md)

The feature changes three kinds of data:

- **Persisted rows**: new columns on `cms_pages` and `blog_posts`, and a new table
  `cms_brand_tokens` for the brand tokens.
- **Settings values**: the default sharing image, and the shop logo and profiles.
- **Stored page-builder props**: the shapes inside the `content` JSON of pages, blocks and
  templates.

Every shape below is a Zod schema in `packages/contracts/` first (Principle II). TypeScript
types are inferred from it.

---

## 1. Database

### 1.1 `cms_pages` (module `cms`), one migration

| Column | Type | Rule |
| --- | --- | --- |
| `parent_page_id` | `uuid null` | FK → `cms_pages(id)`, `on delete set null`. Not equal to `id`; no cycle; depth ≤ 8 (service rule, `CMS_PAGE_PARENT_CYCLE`) |
| `breadcrumbs_visible` | `boolean not null default true` | |
| `breadcrumbs_scheme` | `text not null default 'light'` | check `in ('light','muted','dark')` |
| `share_image_asset_id` | `uuid null` | An asset id. It is not an FK, because assets live in `assets_library`; the column is listed in the `cms` asset-reference scan |
| `parent_path_in_url` | `boolean not null default false` | **R19D**, its own migration (`Migration20261027T165458CmsPageParentPathInUrl`). On: the public path is the parent's public path, `/` and the page's slug. The path is computed on read, never stored |
| `breadcrumbs_overlay` | `boolean not null default false` | **R21H** (T355), its own migration (`Migration20261028T090524CmsPageBreadcrumbsOverlay`). On: the storefront draws the trail over the first section instead of in a band above it |
| `translations` | `jsonb not null default '{}'` | **R24** (issue #521), its own migration (`Migration20261029T131218CmsPageTranslations`). `{ <lang>: { name?, slug?, description? } }`; a blank or absent field inherits the page's own column (`cmsLocalizedPage`). An entry counts only while the page declares its language. See §5.2 |

- **Index**: `cms_pages_parent_page_id_idx`.
- **Entity**: `CmsPage` gains `parentPageId`, `breadcrumbsVisible`, `breadcrumbsScheme` and
  `shareImageAssetId`.
- **Audit**: the `cms_page.update` Command's before/after state includes the four fields,
  `parentPathInUrl` (R19D) and `breadcrumbsOverlay` (R21H).

### 1.2 `blog_posts` (module `blog`), one migration

| Column | Type | Rule |
| --- | --- | --- |
| `main_image_asset_id` | `uuid null` | An asset id, added to `blog-asset-references.ts` |

`toPostCard` already reads `main_image_asset_id`, so it starts returning images without a code
change. The blog admin post editor gains an image picker. The blog post update Command snapshot
includes the field.

### 1.3 `cms_brand_tokens` (module `cms`), one migration (R-1)

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `uuid pk` | |
| `sales_channel_id` | `uuid null` | `null` is the global row. `unique nulls not distinct`, so there is at most one row per scope. Not an FK, because channels belong to `sales_channels`; a row for a deleted channel is never read |
| `tokens` | `jsonb not null` | A complete `BrandTokens` object (§2), validated at the write route |
| `version` | `integer not null default 1` | Optimistic locking; incremented by every write |
| `updated_at` | `timestamptz not null default now()` | |

- **Entity**: `CmsBrandTokens`.
- **Writes**: only the `cms.brand_tokens.update` Command, which writes one audit entry with
  before/after.
- **Read**: `select … where sales_channel_id = $1 or sales_channel_id is null`; the channel row
  wins, then the global row, then `DEFAULT_BRAND_TOKENS`.
- **Tenancy**: platform content, not tenant-scoped (plan XI).

### 1.4 Settings declarations

| Code | Owner | Type | Default | Notes |
| --- | --- | --- | --- | --- |
| `cms.default_share_image_asset_id` | `cms` | `string`, group `cms_page_builder` | `''` | `*_asset_id` naming gives the generic screen its asset picker |
| `shop.logo_asset_id` | `settings` | `string`, group `shop` | `''` | |
| `shop.social_profiles` | `settings` | `string_list`, group `shop` | `[]` | `https:` URLs only (a write validator) |

---

## 2. Brand tokens (`packages/contracts/src/cms-brand.ts`)

```ts
type Hex = `#${string}`;                         // /^#[0-9a-fA-F]{6}$/

interface BrandTokens {
  version: 1;
  colors: {
    primary: Hex; primaryHover: Hex;
    secondary: Hex; secondaryHover: Hex;
    neutral: { 50: Hex; 100: Hex; 200: Hex; 300: Hex; 400: Hex; 500: Hex; 600: Hex; 700: Hex; 800: Hex; 900: Hex };
    onPrimary: Hex; onSecondary: Hex;           // label colour on solid buttons
  };
  accentGradient: { from: Hex; to: Hex; angle: number };   // angle 0–360
  schemes: Record<'light' | 'muted' | 'dark', {
    background: Hex; text: Hex; textMuted: Hex; border: Hex; link: Hex;
    decorativeAssetId?: string;                  // dark only in the admin UI; R-8a. Any image asset,
                                                 // an (animated) SVG included: painted per section,
                                                 // reduced motion is the SVG's own media query (T136)
    decorativeUrl?: string;                      // T154: the same backdrop by URL (`brandMediaUrlSchema`:
                                                 // https: or `/path`, ≤ 2048, no quotes, parentheses,
                                                 // backslashes, `<`/`>` or whitespace); the asset wins
                                                 // when both are set; `/path` is rebased on the API
                                                 // origin by `brandTokensToCss`' `mediaUrl`
  }>;
  fonts: { heading: FontSource; body: FontSource };
  typeScale: Record<TypeToken, {
    mobilePx: number; desktopPx: number;        // 10–160
    lineHeight: number;                          // 0.8–2.2
    weight: 300 | 400 | 500 | 600 | 700 | 800;
    trackingEm: number;                          // -0.1–0.2
    font: 'heading' | 'body';
  }>;
  buttons: {
    radius: 'square' | 'rounded' | 'pill';
    heights: { small: number; medium: number; large: number };  // px, 28–72
    fontWeight: 400 | 500 | 600 | 700;
    textTransform: 'none' | 'uppercase';
  };
  spacing: Record<SpaceToken, { mobilePx: number; desktopPx: number }>;  // 0–320
  layout: { containerMaxPx: number; widePx: number; gutterMobilePx: number; gutterDesktopPx: number };
  tierScale?: { tablet?: number; smallDesktop?: number;  // R20F (T322): 0.5–2; unset or 1 = no scaling
                fluidDesktop?: boolean;        // R21H (T351): grow from the small-desktop factor to 1
                fluidUntilPx?: number;         // R21H (T351): 1025–3840 integer; unset = layout.containerMaxPx
                buttons?: boolean;             // R21H (T352): button heights follow the factors
              };
  // R23 (T432): R21H's smallDesktopUntilPx and per-tier gutters/container, R22J's blockPx, buttonLabels,
  // fluidContainer, breadcrumbsPaddingYPx and typeScale.<token>.trackingMobileEm were removed. The schema is
  // not strict: a stored key is stripped on the next parse (and so on the next save) and writes nothing.
}

type TypeToken = 'display' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'lead' | 'body' | 'small';
type SpaceToken = 'none' | 'xs' | 's' | 'm' | 'l' | 'xl' | 'xxl';

type FontSource =
  | { kind: 'system'; stack: 'sans' | 'serif' | 'mono' }
  | { kind: 'asset'; family: string; generic: 'sans-serif' | 'serif';
      faces: Array<{ weight: number; style: 'normal' | 'italic'; fileAssetId: string }> }   // 1–8 faces
  | { kind: 'stylesheet'; family: string; generic: 'sans-serif' | 'serif'; url: string };  // https: only
```

- **Defaults.** `DEFAULT_BRAND_TOKENS` in `contracts` reproduces today's literals: Inter, primary
  `#1261a6`, the slate neutrals and the heading sizes 48/40/32/26/22/18. A deployment that never
  opens the brand screen therefore sees no visual change.
- **Contrast.** `assessBrandContrast(tokens): ContrastFinding[]` returns findings of the form
  `{pair: 'schemes.dark.text/background', ratio, required: 4.5 | 3}` (R-7).
- **CSS.** `brandTokensToCss(tokens): {css: string; fontLinks: Array<{href; rel; as?; crossOrigin?}>}`
  lives in `cms-components/src/brand/brand-css.ts`. It writes the `:root` variables, the three
  `[data-cmsb-scheme=…]` rebinding rules, the `@font-face` rules, one rule per heading level
  `h1`–`h6` whose type style is set giving rich-text headings (`.cmsc-pb-rich-content`,
  `.cmsc-pb-rich`, `.cmsc-pb-hero__body`, `.cmsc-pb-feature-list__body`) that level's `-size`,
  `-lh`, `-w` and `-ls` (T163; only the parts that are numbers; none without a type scale) and a
  `@media (min-width: 1024px)` block for desktop sizes. R20F (T322): with `tierScale.tablet`
  other than 1, a `768–1023.98px` block before it rebinds `t-<token>-size` and `space-<token>` to
  the mobile px × the factor; with `tierScale.smallDesktop`, a `1024–1279.98px` block after it does
  the same from the desktop px. Unset: neither block, the output unchanged. R21H (T351, T352): with
  `fluidDesktop` and a small-desktop factor below 1, a block from 1280 px to `fluidUntilPx - 0.02`
  writes every desktop size and step as `clamp(px × factor, px × 100 / until vw, px)`; with
  `buttons`, `btn-h-s|m|l` join the tablet, small-desktop and fluid blocks. Each unset: nothing
  written. R23 (T431–T433): the small-desktop block always ends at `1279.98px`; no tier rebinds the
  gutter or the container; no `px`, `btn-px` or `grid-gap` variable is written (blocks write
  their Custom px as literal px).
- **Variable names**, all prefixed `--cmsb-`:
  - `color-primary` and the other colour roles;
  - `n-50`…`n-900`;
  - `grad`;
  - `fg`, `bg`, `fg-muted`, `border`, `link`;
  - `font-heading`, `font-body`;
  - `t-<token>-size`, `-lh`, `-w`, `-ls`, `-font`;
  - `btn-radius`, `btn-h-s`, `-m`, `-l`, `btn-weight`, `btn-transform`;
  - `space-<token>`;
  - `container`, `wide`, `gutter`.

---

## 3. Shared prop shapes (stored inside page-builder content)

All in `packages/page-builder-core/src/types/`, with Zod schemas re-exported by `contracts` for
validation in tests and seeders.

### 3.1 `LinkValue`

```ts
{ kind: 'url'; href: string; target?: '_self' | '_blank' }
| { kind: 'page' | 'product' | 'category'; slug: string; target?: '_self' | '_blank' }
| { kind: 'asset'; fileAssetId: string; target?: '_self' | '_blank' }
| { kind: 'anchor'; anchor: string }
```

The `url` kind accepts `https:`, `http:`, `mailto:`, `tel:` and root-relative `/…`. Anything else
renders as no link.

### 3.2 `ButtonSpec`

```ts
{ label: string; link: LinkValue;
  style: Responsive<'primary' | 'secondary' | 'light' | 'dark'>;
  fill: Responsive<'solid' | 'outline' | 'text'>;      // 'text' is today's `ghost`
  size: 'small' | 'medium' | 'large';
  backgroundColor?: ColorValue; textColor?: ColorValue;  // today's per-button overrides
  icon?: IconName; iconPosition?: 'start' | 'end' | 'only';
  // R20E (T296): cms.Button's look on every embedded button; unset = today's
  transparentOutline?: boolean;                       // the outline fill transparent
  borderColor?: ColorValue;
  iconOnlyShape?: 'circle' | 'pill' }                 // unset = circle; a pill is 1.15 × its height
  // R23 (T447): R20E's iconSizePx and iconOnlyWidthPx were removed (stripped on parse)
```

`ColorValue` is `token:<role>` or a hex value (R-6).

`IconName` is the curated Lucide set (`icon-catalog.ts`) plus `arrow-down`, `arrow-right`,
`download` and `check`, which are added if missing.

### 3.3 `ResponsiveImage`

```ts
{ imageSource: 'url' | 'library'; src?: string; assetId?: string;
  mobileSrc?: string; mobileAssetId?: string;
  alt: string; ratio?: Responsive<AspectToken>; fit?: 'cover' | 'contain'; position?: FocalToken;
  desktopFrom?: 'tablet' | 'desktop' }   // R19C (T263): where the mobile image gives way; unset = 'tablet' (768 px)
```

- `AspectToken` is `'auto' | '1:1' | '4:3' | '3:4' | '16:9' | '21:9' | '3:1' | '2:1' | '4:5'`,
  or a custom `'w:h'` with integers ≤ 100.
- `FocalToken` is `'center' | 'top' | 'bottom' | 'left' | 'right'`.

### 3.4 `SectionSettings` (the top-level props of `cms.Section`; R-8, T117)

```ts
{ anchor?: string;                                // ^[a-z][a-z0-9-]{0,63}$ after normalisation
  scheme?: 'inherit' | 'light' | 'muted' | 'dark';  // default 'inherit'
  background?: SectionBackground;
  spaceTop?: Responsive<SpaceToken | { px: number }>;     // default 'l'
  spaceBottom?: Responsive<SpaceToken | { px: number }>;  // default 'l'
  width?: Responsive<'contained' | 'wide' | 'full' | 'viewport' | 'bleed' | 'custom'>;  // default 'contained'; R19C (T260): per breakpoint, a single stored value read as it is
  contentWidth?: 'contained' | 'wide' | 'full' | 'custom';  // T124: with width full/viewport/bleed only
  customMaxWidthPx?: number;                         // with width or contentWidth 'custom'; one px value
  contentPosition?: Responsive<'start' | 'center' | 'end'>;  // where the frame sits in a taller section
  reveal?: RevealSetting;
  overlap?: Responsive<SpaceToken | { px: number }> }  // T148: pull the content up into the previous section; unset = none
```

**Owner review 2026-10-23 (T117).** These keys are `cms.Section`'s own top-level props, not
one `section` object: a value per breakpoint must be edited on the editor's Responsive tab, as
`cms.Row`'s are, and Puck gives a field one tab, so a responsive key nested in an object prop
could not reach it. `spaceTop`, `spaceBottom`, `contentPosition` and `overlap` (T148) are the block's
`responsiveFields`; the rest are main-tab fields. `customMaxWidthPx` is one px value.

**R19C (2026-10-27).** `width` and `outsetPx` join the `responsiveFields` (Responsive tab). R23
(T449) removed `outsetPx` (a stored one is stripped on parse and not rendered).
`SectionBackground` gains `desktopFrom?: 'tablet' | 'desktop'` (T263), as `ResponsiveImage`
does. A `custom` width wider than the page container widens the section box itself, up to the
viewport less the gutters (T262); until R19C it was capped at the container.

**Owner ruling 2026-10-23.** `SectionSettings` belongs to one block,
`cms.Section`, which holds the settings and a slot for any blocks and stands only at the top
level of a page (contracts/blocks.md `cms.Section`). It replaced the earlier model, in which
every section block carried `section` and `cms.Row` mapped its `sectionLayout`, background and
vertical padding into it at the top level (T034, T035). `cms.Row` is back to its `origin/master`
shape; the width names keep the Row's: `in_flow` ~ `contained`, `full_width` ~ `full`,
`full_viewport` ~ `viewport` (which on the Section is also at least the viewport tall),
`full_bleed` ~ `bleed`. A `section` prop stored on any other block during this feature's
development is ignored at render; the branch was never released, so no content needs it.

```ts

SectionBackground = BackgroundValue & {
  mobileImageAssetId?: string; mobileImageUrl?: string;
  videoPosterAssetId?: string; mobileVideoAssetId?: string;
  overlay?: { kind: 'none' | 'solid' | 'gradient';
              direction?: 'to-top' | 'to-bottom' | 'to-left' | 'to-right'; strength: number };  // 0–100
  position?: FocalToken; decorative?: boolean;
  // T167: the image's size and repeat, and the decorative layer's size, repeat and position.
  // BackgroundSize = 'cover' | 'contain' | 'auto' | { px: 1–4000, whole } | { percent: 1–400 }
  size?: BackgroundSize; repeat?: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y';
  decorativeSize?: BackgroundSize; decorativeRepeat?: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y';
  decorativePosition?: FocalToken }   // all unset = today's cover, no repeat; the layer from the top centre

RevealSetting = { effect: 'none' | 'fade-up' | 'words'; desktopOnly: boolean }
```

### 3.4a `SectionGroupSettings` (the top-level props of `cms.SectionGroup`; T158)

```ts
{ anchor?: string;                                  // as SectionSettings.anchor
  scheme?: 'inherit' | 'light' | 'muted' | 'dark';  // default 'inherit'
  background?: SectionBackground;                   // painted once behind all the group's Sections
  spaceTop?: Responsive<SpaceToken | { px: number }>;     // default 'none'
  spaceBottom?: Responsive<SpaceToken | { px: number }> } // default 'none'
```

**Owner ruling 2026-10-26.** `cms.SectionGroup` is a top-level container whose `content` slot
holds only `cms.Section`s; it is the one place a Section may be nested. `sectionGroupSettingsSchema`
in `packages/contracts/src/page-builder-props.ts`. `spaceTop` and `spaceBottom` are its
`responsiveFields`. No migration: the props live in the page's JSONB content.

### 3.5 `InlineRichText`

A TipTap document restricted to one paragraph:

- **Marks**: `bold`, `italic`, `link` and `emphasis{variant: 'gradient' | 'accent' | 'muted'}`.
  T175 adds an optional `color` to `emphasis` — a colour value (`#rrggbb` or `token:<role>`,
  `colorValueSchema`), `null` accepted as unset — painted over the variant's colour (a gradient
  then reads as solid text); unset = today's span. The mark is the same in rich bodies.
- **Nodes**: `hardBreak`; T163 adds `inlineIcon{name}` — an icon of the page builder's catalog by
  name (`INLINE_ICON_NAME_RE`, `/^[a-z][A-Za-z0-9]{0,63}$/`), atomic, marks allowed, rendered as
  inline SVG with `aria-hidden` (an unknown name renders nothing); it is not text
  (`inlineRichTextToPlain` drops it). T166 adds optional `size` (`'0.5em'`–`'3em'`, up to two
  decimals, or whole `'8px'`–`'200px'`; `INLINE_ICON_SIZE_RE` + `isInlineIconSize`) and `offset`
  (em of the text, −1–1, the SVG's `vertical-align`; `isInlineIconOffset`), each also accepted as
  `null` (unset); unset = today's 1 em on the stylesheet's `-0.125em`.

A plain string is accepted on read and normalised to a document, which the editor does once. It
is translated with `format: 'tiptap'`; an inline icon travels as one opaque `<n/>` tag.

### 3.6 Rich text: the read-more passage

`readMore{open: boolean = false, summaryStyle: 'text' | 'chevron' = 'text', chevronPosition: 'start' | 'center' | 'end' = 'start', revealAbove: boolean = false}` holding one
`readMoreSummary` (inline content) and one or more blocks (R-14). T168 adds `summaryStyle`:
`chevron` is stored as the class `cmsc-read-more--chevron` on the `<details>` and read back from
it; anything else is `text` and writes today's markup. The summary text is kept in both styles
(the accessible name of the chevron) and is translated as before. T173 adds `chevronPosition`
(`center` / `end` stored as `cmsc-read-more--center` / `--end`; `start` writes nothing) and
`revealAbove` (`cmsc-read-more--reveal-above`: the open passage shows its content above the
summary, by CSS order only — the DOM keeps the summary first), each read back from its class.

---

## 4. Blocks: new, reshaped, removed

Full field lists and translatable paths are in [contracts/blocks.md](./contracts/blocks.md).
Since the owner ruling of 2026-10-23 only `cms.Section` carries section settings (FR-000); the blocks
below keep their intrinsic visuals and render the same inside a Section as outside one.

| Block | Owner | Status | Notes |
| --- | --- | --- | --- |
| `cms.Section` | cms | new | The one block with section settings, as its own props (§3.4), and a `content` slot; top level only (every slot refuses it, the editor guard reverts a drop into one), or in a `cms.SectionGroup`'s slot (T158); `translatable: []` |
| `cms.SectionGroup` | cms | new (T158) | Top-level container of Sections (§3.4a): scheme, background (decorative layer included) and spacing painted once behind its Sections; slot `allow: ['cms.Section']`; root only; `translatable: []` |
| `cms.Row` | cms | unchanged | Its `origin/master` shape |
| `cms.Heading` | cms | reshaped | `level`, `size` (token or Custom px), `font` (role or Custom family), `fontWeight`, `fontStyle`, `lineHeight`, `color`, `text: InlineRichText`, `align` |
| `cms.Text`, `cms.RichContent` | cms | extended (T134) | Typography reads tokens. RichContent gets the R-14 extensions. Both gain `textMaxWidth` / `textMaxWidthPx` (responsive; unset is full width) |
| `cms.Button` | cms | reshaped | Props become `ButtonSpec` plus `align` |
| `cms.Hero` | cms | reshaped | See contracts. T133 adds `order` (array of `{element}`; unset is today's order) and `mediaWidth` (`content` / `viewport`; unset is `content`); T145 adds `spaceAfter` (array of `{element, space: SpaceToken \| 'custom', spacePx?}`; unset adds nothing); T142 adds `media.mobileVideoUrl`; T162 adds `media.mobilePosterAssetId`, `media.mobilePosterUrl`; T191 adds `media.posterSource` (`library` / `url`; unset reads as `library`), `media.posterUrl`; T193 adds `order[].space` / `order[].spacePx` and deprecates `spaceAfter` (still read; carried into `order` by the editor) |
| `cms.FeatureList` | cms | reshaped | Heading, columns 1–4 per breakpoint, `items[]{icon | iconAssetId, title, body: rich}`, `image?` below |
| `cms.Stats` | cms | reshaped | Heading, `image?`, `grid` per breakpoint, `items[]{value, label}` |
| `cms.Testimonial` | cms | reshaped | Image card with overlay quote, author and role |
| `cms.Tabs`, `cms.Accordion` | cms | reshaped | Panels become slots (R-13). Tabs: T132 adds `tabStyle` (bar background and border, active and other tabs' colours, size). Accordion: T134 adds `titleLevel` (`none`, `h2`–`h6`) and `titleSize` / `titleSizePx`; T175 adds `icon` (`plus` / `chevron`), `itemStyle` (`plain` / `boxed`), `dividers` (`none` / `between` / `all`, plain items only) and `titlePadding` / `titlePaddingPx` (responsive, in `responsiveFields`), all unset by default (today's look), and an animated open/close (stylesheet, after hydration, never under reduced motion). T146 adds Tabs `panelGap` / `panelGapPx` (responsive, in `responsiveFields`; unset is today's 12 px). T149: element ids from the block id |
| `cms.ContentSlider` | cms | reshaped, label "Carousel" | R-12. R5: `controlsPlacement` (responsive; was `controls.placement`, carried by `contentSliderFromLegacy` and moved by `resolveData`), `controls.arrowVariant/arrowShape/arrowSize/arrowColor` (T129), `layout` + responsive `columns` (T130), `filter {show, allLabel, tags[{tag, label}]}` (T131). R7: `filter.style`/`filter.align` (T143), responsive `controlsAlign` and `controls.nextArrowVariant` (T147; also on `catalog.ProductSlider` and `blog.LatestPosts`) |
| `cms.Slide` | cms | extended | Carousel item, free content; T131 adds `tags` |
| `cms.ImageSlider` | cms | **removed** | Replaced by Carousel + `cms.CarouselImage` |
| `cms.NewsletterSignup` | cms | kept (T076, option a) | The external-endpoint form, with an optional consent checkbox (contracts/blocks.md, `newsletter.Signup`) |
| `cms.MediaText` | cms | new | T142 adds `media.videoSource` (`library` / `url`; unset is `library`), `media.videoUrl`, `media.mobileVideoAssetId`, `media.mobileVideoUrl` (also on `cms.CarouselSplit`, which shares the media); T160 adds `featureTitleSize` / `featureTitleSizePx` (responsive) and `featureTitleWeight`; T162 adds `media.mobilePosterAssetId`, `media.mobilePosterUrl` (also on `rows[].media` and `cms.CarouselSplit`) |
| `cms.BackgroundPanel` | cms | new | |
| `cms.CtaCard` | cms | new | |
| `cms.Statement` | cms | new | T134 adds `textMaxWidth` / `textMaxWidthPx` |
| `cms.LinkList` | cms | new | |
| `cms.CarouselImage`, `cms.CarouselSplit`, `cms.LinkTile`, `cms.DownloadTile` | cms | new, hidden category | Allowed only in Carousel `slides`. R5: `tags` on each (T131), `CarouselImage.captionScrim {kind, strength}` (T129), `LinkTile.ratio` responsive (T130); R6: `mediaCornerRadius` on `CarouselImage` and `LinkTile` (T140). R7 (T144): `CarouselImage.captionSize/captionSizePx` (responsive) + `captionFont`; `LinkTile.titleSize/titleSizePx/labelSize/labelSizePx` (responsive) + `titleFont/labelFont` + `labelStyle` |
| `catalog.ProductGrid`, `catalog.ProductSlider` | catalog | reshaped | `header?`, `cardVariant`, `cardTextLine` (T135; unset is the card style's own line), `ctaLabel`. Slider takes the R-12 options |
| `blog.LatestPosts` | blog | new | |
| `newsletter.Signup` | newsletter | new | |

`cms.LogoStrip`, `cms.Map`, `cms.SimpleTable`, `catalog.CategoryGrid` and
`catalog.CategoryList` are unchanged (T035 had given them `section`; the ruling took it back).

Extended by R5 (contracts/blocks.md; every `origin/master` field kept, defaults unchanged):

| Block | Owner | Status | Notes |
| --- | --- | --- | --- |
| `cms.Video` | cms | extended (T126) | `source: 'embed' \| 'file'` (unset is `embed`), `videoAssetId`, `mobileVideoAssetId`, `posterAssetId`; `aspectRatio` becomes `Responsive<AspectToken>` (no `auto`), in `responsiveFields`; R6: `mediaCornerRadius` (T140); R7: `mobileUrl` (T142); R9: `mobilePosterAssetId`, `mobilePosterUrl` (T162); T194: `fileSource`, `posterSource` (`library` / `url`; unset reads as `library`), `posterUrl` |
| `cms.Image` | cms | extended (T127) | `mobileSrc` / `mobileAssetId`, `ratio: Responsive<AspectToken>` (in `responsiveFields`), `overlay: SectionOverlay`, `caption` (translatable), `captionPlacement: 'below' \| 'beside'` |

The hero's and the media-and-text video media gain `ratio?: Responsive<AspectToken>` (unset is
16:9), and the rich-text image node `size` / `align` plus an `inlineImage` node (T126, T128).

R8 (T151–T153; contracts/blocks.md § R8; all unset by default, none translatable): a heading
`headingWeight` (`'default' | 300–800`) on every block whose heading is a `BlockHeading` with a
size, and `headingMaxWidth` / `headingMaxWidthPx` (responsive, in `responsiveFields`) on the same
blocks except `cms.Statement`; `cms.Hero` `titleWeight`, `titleMaxWidth` / `titleMaxWidthPx`;
`cms.FeatureList.titleWeight`, `cms.CarouselImage.captionWeight`, `cms.LinkTile.titleWeight` /
`labelWeight`, `catalog.ProductGrid|ProductSlider.cardTitleWeight`; `controlsAlignTo:
'container' | 'slide'` on the three carousels. No schema or API change.

R8 (T155, T156; contracts/blocks.md § "R8: tab bar overflow …"; all unset by default, none
translatable): `cms.Tabs.barOverflow` (`'wrap' | 'scroll'`), `cms.Column.distribute` (`'start' |
'center' | 'end' | 'space-between' | 'last-to-bottom'`), and the shared wrapper's `stackOrder`
(`Responsive<'auto' | 'first' | '1'–'6' | 'last'>`) on a block whose parent is a `cms.Column` —
a CSS `order` per breakpoint, visual only: DOM, reading and focus order stay the stored order.
T154 adds `schemes.dark.decorativeUrl` to the brand tokens (§2); it travels in the existing
`cms_brand_tokens.tokens` JSONB, so no migration.

R9 (T159–T162; contracts/blocks.md § R9; all unset by default, none translatable): `cms.Column`
`stackOrder` (the T156 vocabulary, the column's own order among the Row's columns per breakpoint;
visual only, DOM and focus order stay the stored order); `cms.MediaText` `featureTitleSize` /
`featureTitleSizePx` / `featureTitleWeight`; `cms.ContentSlider` `filter.overflow` (`'wrap' |
'scroll'`); a mobile poster (`mobilePosterAssetId` / `mobilePosterUrl`) on `cms.Video` (file),
the hero's and the media-and-text video media. No schema or API change.

R9 (T163; contracts/blocks.md § "R9: cosmetic options"; all unset by default, none translatable):
`cms.Tabs.tabSize` (`Responsive<'s' | 'm' | 'l'>`, Responsive tab, in `responsiveFields`; takes
over T132's `tabStyle.size`, which still renders and is moved by `resolveData`);
`controls.arrowIcon` (`'chevron' | 'arrow'`) on `cms.ContentSlider`, `catalog.ProductSlider` and
`blog.LatestPosts`; the `inlineIcon` node of `InlineRichText` (§3.5, an additive contracts
change); rich-text headings read the type scale through `brandTokensToCss` (§2). No migration, no
API change.

R10 (T165; contracts/blocks.md § "R10: column placement …"; all unset by default, none
translatable): `cms.Column` `rowSpan` (`Responsive<1 | 2 | 3 | 4>`), `columnStart`
(`Responsive<'auto' | '1'–'12'>`) and `rowStart` (`Responsive<'auto' | '1'–'4'>`), Responsive tab —
the column's placement in its Row's twelve-track grid, written on the published cell only when set;
a Row holding a placed column packs densely. Visual only: DOM, reading and focus order stay the
stored order. `cms.Row` unchanged. No schema, migration or API change.

R10 (T166, T167; contracts/blocks.md § "R10: inline icon size and offset, background size, repeat
and position"; all unset by default, none translatable): the `inlineIcon` node's `size` and
`offset` (§3.5) and the section background's `size`, `repeat`, `decorativeSize`,
`decorativeRepeat` and `decorativePosition` (§3.4, on `cms.Section` and `cms.SectionGroup`) —
additive contracts changes inside the page's JSONB content. No migration, no API change.

R10 (T168; contracts/blocks.md § "R10: card image box …"; all unset by default, none
translatable): `catalog.ProductGrid|ProductSlider` `cardImageBackground`, `cardDivider` (`'none' |
'line'`) and `cardDividerColor`; `cms.Button.fullWidth` and a block-level `buttonsFullWidth` on
`cms.Hero`, `cms.MediaText`, `cms.CtaCard`, `cms.BackgroundPanel` and `cms.CarouselSplit` (both
`Responsive<'auto' | 'full'>`, Responsive tab; `ButtonSpec` §3.2 unchanged); the read-more node's
`summaryStyle` (§3.6). No schema, migration or API change.

R11 (T174; contracts/blocks.md § "R11: tab hover look and panel change"; unset by default, none
translatable): `cms.Tabs.tabStyle.hoverBackground` / `hoverColor` (`ColorValue`) and a third
`effect` value, `slide` (after `none` and `fade`; the default stays `none`). No schema, migration
or API change.

R11 (T171, T172; contracts/blocks.md § "R11: carousel ends and item hover colours"; unset by
default, none translatable): `loop` (`boolean`, unset = today's wrap-around),
`controls.disabledArrowLook` (`'dim' | 'outline-light' | 'color'`) and
`controls.disabledArrowColor` (`ColorValue`) on `cms.ContentSlider`, `catalog.ProductSlider` and
`blog.LatestPosts`; `cms.CarouselImage.captionHoverColor` and `cms.LinkTile.titleHoverColor` /
`labelHoverColor` (`ColorValue`). T170: a responsive value (§3) stored without `base` is read as
"no value below the first breakpoint that has one". No schema, migration or API change.

R12 (T178, T179; contracts/blocks.md § "R12: animated reveal above, resting tile colours, …";
unset by default, none translatable): `cms.LinkTile.titleColor` / `labelColor` (`ColorValue`);
`cms.Accordion.titleColor` (`ColorValue`), `dividerPosition` (`'item' | 'title'`, unset =
`'item'`), `iconSize` (`'s' | 'm' | 'l' | 'custom'`) + `iconSizePx` (number, 8–64). T177 is a
stylesheet fix only. No schema, migration or API change.

R13 (T181–T183; contracts/blocks.md § "R13: resting tile colours per breakpoint, …"; unset by
default, none translatable): `cms.LinkTile.titleColor` / `labelColor` widen to `ColorValue |
Responsive<ColorValue>` (a stored single value is read as before; a value without `base` follows
§3's T170 reading); `cms.Accordion.panelGap` / `itemGap` (`Responsive<SpaceToken | 'custom'>`) +
`panelGapPx` / `itemGapPx` (`Responsive<number>`, 0–160) and `titleWeight` (`'default' | 300–800`).
No schema, migration or API change.

R14 (T185, T186; contracts/blocks.md § "R14: accordion title weight per breakpoint, …"; unset by
default, none translatable): `cms.Accordion.titleWeight` widens to `TextWeight |
Responsive<TextWeight>` (a stored single weight is read as before; a value without `base` follows
§3's T170 reading); `cms.Accordion.panelPaddingBottom` / `openItemGap` (`Responsive<SpaceToken |
'custom'>`) + `panelPaddingBottomPx` / `openItemGapPx` (`Responsive<number>`, 0–160). No schema,
migration or API change.

R14 (T188; contracts/blocks.md § "R14: tile title and label weight and caption weight per
breakpoint (T188)"; unset by default, none translatable): `cms.LinkTile.titleWeight` /
`labelWeight` and `cms.CarouselImage.captionWeight` widen to `TextWeight |
Responsive<TextWeight>` (a stored single weight is read as before; a value without `base` follows
§3's T170 reading). No schema, migration or API change.

R15 (T189; contracts/blocks.md § "R15: post card look, lead and header button placement (T189)";
unset by default, none translatable): `blog.LatestPosts` gains `cardBackground` (colour value),
`cardRadius` (`CornerRadius`), `cardPadding` / `cardTextPadding` (`Responsive<SpaceToken |
'custom'>`) + `cardPaddingPx` / `cardTextPaddingPx` (`Responsive<number>`, 0–80), `imageRatio`
(`Responsive<string>`, aspect token or `w:h`), `hoverZoom` (`boolean`), `chipStyle` (`'filled' |
'outline' | 'none'`), `cardTitleSize` / `leadSize` (`Responsive<SectionTextSize>`) +
`cardTitleSizePx` / `leadSizePx` (`Responsive<number>`, 10–80), `cardTitleWeight`
(`TextWeight | Responsive<TextWeight>`), `readMoreIcon` (`'none' | 'arrow' | 'plus'`),
`readMoreAlign` (`'start' | 'end'`), `readMoreWeight` (`TextWeight`), `leadColor` (colour value),
`headerButtonPlacement` (`Responsive<'below' | 'end' | 'after'>`) and `headerButtonFullWidth`
(`Responsive<'auto' | 'full'>`). No schema, migration or API change.

R17 (T198–T220; contracts/blocks.md § "R17: one settings panel"; nothing translatable added):
`cms.Image`, `cms.Icons`, `cms.AnnouncementBar` and each `cms.LogoStrip` item gain `link`
(`LinkValue`, §3.1), their stored `href` (+ `linkTarget`) read as a `url` link with the same target
(a logo's as `_blank`) and carried into `link` by the editor; `cms.Map` `markers[].link` widens to
`string | LinkValue`; `cms.Social`, `cms.LogoStrip`, `catalog.ProductGrid` and
`catalog.CategoryGrid` widen `gap` to `Responsive<SpaceToken | 'custom' | number>` with `gapPx`
(`Responsive<number>`), a stored number read as Custom px; `align` of `cms.Icons`, `cms.Social`,
`cms.LogoStrip`, `cms.FeatureList`, `cms.Stats`, `cms.Statement`, `cms.Hero` and `cms.Tabs`,
`headingWeight` of every block heading, `titleWeight` of `cms.FeatureList` and `cms.Hero`,
`featureTitleWeight` of `cms.MediaText` and `equalItemHeight` of the two grids widen to their
`Responsive<…>` form (a stored single value is every breakpoint's); `cms.MediaText` /
`cms.CarouselSplit` media gain `posterSource` (`'library' | 'url'`) and `posterUrl`. No schema,
migration or API change.

R19A (T223–T239; contracts/blocks.md § "R19A: text and content options"): every addition is
optional and unset renders today's markup. `TextLineHeight` = `number | Responsive<number>`
(0.8–3) and `ResponsiveTextWeight` = `TextWeight | Responsive<TextWeight>` are new shared shapes.
`cms.FeatureList` gains `titleLineHeight`, `bodySize` / `bodySizePx`, `bodyWeight`,
`bodyLineHeight`, `bodyColor`, `iconPosition` (`'above' | 'beside'`), `iconSpacePx`,
`titleSpacePx` (`Responsive<number>`); `cms.Hero` gains `subheading…` / `statement…`
`Weight`, `LineHeight`, `MaxWidth`, `MaxWidthPx`, `bodySize` / `bodySizePx`, `bodyWeight`,
`bodyLineHeight`, `bodyMaxWidth` / `bodyMaxWidthPx`, and `gaps` widens to `SpaceToken | 'custom'`
with `gapsPx`, plus `mediaSpace` (`Responsive<SpaceToken | 'custom'>`) with `mediaSpacePx`;
`cms.Statement` gains `minHeight` (`Responsive<'default' | HeroMinHeight>`) / `minHeightPx`,
`headingLineHeight`, `bodySize` / `bodySizePx`, `bodyWeight`, `bodyLineHeight`, `bodyColor`;
`cms.Stats` gains `labelSize` / `labelSizePx`, `labelWeight`, `labelColor`, `imageSpan`,
`figuresSpan`, `figuresOffset` (numbers, columns of 12) and `figuresAlign`
(`'center' | 'start' | 'end' | 'spread'`); `cms.LinkList` gains `titleSize` / `titleSizePx`,
`titleWeight`; `cms.CtaCard` gains `cardRadius` (`'default' | CornerRadius`), `imageInset`
(`'default' | 'none' | 'custom'`) and `imageInsetPx`; `cms.MediaText` gains `sideBySide`
(`'tablet' | 'desktop'`); `cms.RichContent` gains `textSize` / `textSizePx`; `cms.Heading` gains
`hangingIcon` (`boolean`) and `hangingIconGapPx` (`Responsive<number>`); `cms.Text`'s `text`
widens to `string | InlineRichText` (a stored string is unchanged until edited; its translatable
path becomes `format: 'tiptap'`, which reads a string as plain text). Rich text (§3.6's
neighbours): a `textSize` mark (`attrs.size`: a type token or `'<8–200>px'`) and the bullet list's
`listStyle` widened to `'check' | 'chevron' | 'none'`. No schema, migration or API change.

R19B (T240–T259; contracts/blocks.md § "R19B: carousel controls, buttons, download tiles, image
cards, sign-up layout"; only `cms.CarouselImage.moreLabel` is translatable): the carousels'
`controls` gain `dotColor`, `activeDotColor`, `arrowGlyphColor` (colour values) and
`hideArrowsOn`, `hideDotsOn` (`HideOn`); `cms.ContentSlider.controlsPlacement` accepts `slide`;
the product listings gain `footerButtonAlign`; `cms.Button` gains `transparentOutline`,
`iconSizePx` (`Responsive<number>`) and `borderColor`; `cms.DownloadTile` gains `scheme`,
`cardBackground`, `cardBorder`, `cornerRadius`, `paddingPx`, `titleSizePx`, `showType`,
`hoverImageLook`, `linkLook`, `iconButtonSizePx`, `iconButtonBorderColor`; `cms.CarouselImage`
gains `moreLabel`, `moreLabelPlacement`, `moreLabelSizePx`, `moreLabelIcon` and
`captionPaddingPx`; `cms.Image.captionPlacement` widens to its `Responsive<…>` form (a stored
value is every breakpoint's) beside `captionSizePx`, `captionAlign`, `captionWeight`,
`captionColor`; `newsletter.Signup` gains `buttonPlacement`, `fieldShape`, `topicsColumns`,
`hideEmailLabel`. `ButtonSpec` (§3.2) is unchanged: the button options are `cms.Button`'s own.
No schema, migration or API change.

R20E (T290–T309; contracts/blocks.md § "R20E"): `ButtonSpec` (§3.2) gains `transparentOutline`,
`iconSizePx`, `borderColor`, `iconOnlyShape` and `iconOnlyWidthPx` (`buttonSpecSchema`, all
optional — a button stored before parses to the same value); `cms.Button` gains `iconOnlyShape` and
`iconOnlyWidthPx` beside its R19B block-level look. `cms.Hero` gains `titleLineHeight`,
`eyebrowColor`, `titleColor`, `subheadingColor`, `statementColor`, `bodyColor`,
`bodyListMarkerColor`, `eyebrowSizePx`, `eyebrowWeight`, `eyebrowLineHeight`, `eyebrowUppercase`
and `proofCaptionPlacement`, `proofCaptionSizePx`, `proofCaptionMaxWidthPx`, `proofCaptionWeight`,
`proofCaptionColor`; `cms.DownloadTile` gains `linkTo` (`'file' | 'link'`), `link` (`LinkValue`),
`minHeightPx`, `subtitleSizePx`, `subtitleColor`; `cms.CarouselImage` gains `moreLabelColor`,
`moreLabelIconColor`, `moreLabelWeight`; `cms.Image` gains `captionMinWidthPx`, `captionMaxWidthPx`;
`cms.RichContent` gains `listMarkerColor`. Nothing is translatable. No schema, migration or API
change beyond `buttonSpecSchema`'s optional keys.

R20F (T310–T322; contracts/blocks.md § "R20F: split-slide layout, carousel controls alignment,
block spacing, tier type scale"; nothing new is translatable): `cms.CarouselSplit` gains
`sideBySide`, `mediaSpan`, `textSpan`, `textOffset`, `mediaCornerRadius`, `titleSize` /
`titleSizePx`, `titleWeight`, `titleLineHeight`, `titleHangingIcon`, `titleHangingIconGapPx`,
`bodySize` / `bodySizePx`, `bodyWeight`, `bodyLineHeight`; the carousels' `controlsAlign` accepts
`'dots-start'` and `controls` gains `arrowsWhenFit`; `cms.MediaText` gains `headingSpacePx`,
`bodySpacePx`, `stackedGapPx`, `bodySize` / `bodySizePx`, `bodyLineHeight` and
`rows[].verticalAlign` (`BlockAlign | 'inherit'`); `cms.BackgroundPanel` gains `mobileLayout`
(`'stack' | 'overlay'`), `textBoxMarginPx`, `textBoxPaddingPx`; `cms.FeatureList` gains
`rowGapPx`, `titleLetterSpacing`, `listLineHeight`, `bodySpacePx`; `cms.CtaCard` gains
`paddingPx`, `imageColumns`; `cms.Stats` gains `labelLineHeight`; `cms.LinkList` gains
`dividerAfterLast`; `cms.Accordion.icon` accepts `'chevron-circle'` beside `iconCircleColor`. The
brand tokens (§2) gain the optional `tierScale`, an additive contract change (a set without it
parses as before). No migration or API change.

R21G (T330–T338; contracts/blocks.md § "R21G: social-proof caption fix, stacking breakpoints,
column layouts, text options"; nothing new is translatable): `cms.Hero` gains
`proofCaptionLineHeight`; `cms.MediaText` gains `mediaSpan`, `textSpan`, `textOffset`,
`listMarkerColor`, `bodyWeight`, `headingLineHeight`; `cms.CtaCard` gains `mobileImagePosition`
(`'above' | 'below'`), `sideBySide`, `bodySize` / `bodySizePx`, `listSize` / `listSizePx`, and its
`imageInsetPx` accepts a value per breakpoint (a stored number keeps its meaning); `cms.Stats`
gains `sideBySide`; `cms.CarouselSplit` gains `bodyIndent` (`'none' | 'title'`), `stackedGapPx`,
`titleSpacePx`, `controlsSpacePx`; `cms.Image` gains `desktopFrom`; `cms.Heading` gains
`textMaxWidth` / `textMaxWidthPx`; `cms.RichContent` gains `listLineHeight`; `cms.Accordion` gains
`titleLineHeight`; `newsletter.Signup` gains `buttonHeightPx`, `buttonTextSizePx`, `buttonWeight`;
`catalog.ProductGrid` and `catalog.ProductSlider` gain `leadSize` / `leadSizePx`, `leadWeight`,
`leadColor`; `cms.DownloadTile` gains `titleWeight`. No schema, migration or API change.

R21H (T350–T355; contracts/blocks.md § "R21H"): the carousels' track options gain
`slidesPerViewSmallDesktop` and `gapSmallDesktopPx` (numbers, dedicated props — `Responsive<T>`
keeps three tiers); the brand tokens (§2) gain `tierScale.smallDesktopUntilPx`, `fluidDesktop`,
`fluidUntilPx`, `buttons` and `layout.gutterTabletPx`, `gutterSmallDesktopPx`,
`containerSmallDesktopPx`, all optional; `cms_pages` gains `breadcrumbs_overlay` (§1.1, a
migration) and the admin page shapes `breadcrumbsOverlay`; the resolved page's `breadcrumbs`
gains an optional `overlay` (§5), written only when on.

R22I (T370–T382; contracts/blocks.md § "R22I"; nothing new is translatable): `cms.MediaText`
gains `columnsAnchor` (`'media' | 'start' | 'end'`), `columnGapPx`, `featureBodySize` /
`featureBodySizePx`, `featureBodyWeight`, `featureBodyColor`; `cms.CarouselSplit` gains
`columnsAnchor`, `columnGapPx`; `cms.Stats` gains `columnGapPx`, `valueLineHeight`; `cms.CtaCard`
gains `headingSpacePx`, `bodyWeight`, `textMaxWidth` / `textMaxWidthPx`; `cms.RichContent` gains
`textWeight`, `listWeight`; `cms.FeatureList`'s `iconPosition` accepts a value per breakpoint (a
stored string keeps its meaning) and its items gain `span`; the carousel header
(`cms.ContentSlider`, `catalog.ProductSlider`, `catalog.ProductGrid`, `blog.LatestPosts`) gains
`headingLineHeight`; `cms.LinkList` gains `titleLineHeight`; `blog.LatestPosts` gains
`leadWeight`; `newsletter.Signup` gains `topicLabelSizePx`, `buttonIcon`; `cms.Testimonial` gains
`quoteSize` / `quoteSizePx`; `cms.DownloadTile` gains `iconButtonIcon`. No schema, migration or API
change.

R23 (T430–T449; §7 below; contracts/blocks.md § "R23"): the R19–R22 options above are simplified —
pixel-matching options removed per owner decision. The props it removes stay readable as ignored
data, the props it adds are listed in §7.

---

## 5. Resolved page (storefront read): additions to `cmsResolvedPageSchema`

```ts
breadcrumbs: { visible: boolean; scheme: 'light' | 'muted' | 'dark';
               overlay?: boolean;                                       // R21H (T355): present (true) only when on
               trail: Array<{ name: string; slug: string | null }> };   // root-first; excludes Home and the page itself
share: { imageUrl: string | null };            // page image, else the default, else null
languages: string[];                           // the page's languages, for og:locale:alternate
```

- **Trail rule.** The resolver walks `parent_page_id` up to 8 levels. For each ancestor it reads
  the channel's slug from `cms_page_sales_channels`. When the ancestor is not published and
  active in the channel, the entry has `slug: null` (FR-030a).
- **Crumb name.** The name is the ancestor's `name`, as the page's own crumb is (R19C, T270; until
  then it was the ancestor's `metaTitle` in the request language, falling back to its `name`).

### 5.1 Public path (R19D)

```ts
path?: string;                                  // the page's public path in the channel, no leading '/'
trail: Array<{ name; slug; path?: string | null }>;  // path: the ancestor's public path; null exactly when slug is
// GET /api/v1/cms/pages/by-channel entries gain `path?: string`
```

- **Rule** (`cmsPagePublicPaths`, `packages/contracts/src/cms.ts`, one home for backend, admin and
  storefront): per channel, from each page's channel slug. A page without `parentPathInUrl`, or
  whose parent the channel does not serve, is at its own slug. Otherwise it is at its parent's
  path + `/` + its slug. A stored loop, or a chain of more than 8 slugs, falls back to the slug.
- **Resolution.** `by-slug?slug=` matches the whole path first, then a page's own channel slug;
  the answer's `path` is canonical and the storefront redirects (308) when it differs from the
  request. The optional fields stay optional only for an answer cached before R19D.
- **Links.** A `LinkValue` of kind `page` keeps storing the flat slug; the resolver rewrites it to
  the target's path in the request's channel, in the page tree and its inlined embeds.
- **Moves.** Renaming or moving a parent moves its nested descendants; the old path stops
  answering (no redirects facility exists to carry it). A write that moves a nested path drops
  every cached page answer (`CmsContentChange.addressesMoved` → the broad `cms:page` tag).

### 5.2 Per-language name, slug and description (R24, issue #521)

```ts
// summary, detail, create, patch (replaced whole when present):
translations: Record<lang, { name?: string; slug?: string /* cmsSlugRe */; description?: string }>;
// resolved page:
url?: string;                                   // cmsPageUrl(path, served language)
alternates?: Array<{ language; url }>;          // one per servable language
name: string;                                   // the served language's
// by-channel entries gain url?: string and alternates?: Array<{ language; url }>
```

- **Effective values** (`cmsLocalizedPage`, `packages/contracts/src/cms.ts`): a language's
  override, else the page's own field; a blank override and an override of an undeclared language
  inherit. A request naming an undeclared language is refused with
  `400 CMS_LANGUAGE_NOT_IN_CHANNEL_SCOPE`; a stored one is kept, unused.
- **URL** (`cmsPageUrl`): `/<path>`, plus `?lang=<L>` when L is not the channel default — the rule
  `productPath` states for a product. Built by the backend only. **Superseded by
  `specs/167-storefront-locale-path/`**: the language is the URL's path prefix
  (`/<prefix>/<path>`), `cmsPageUrl` takes the channel's URL facts, and `?lang=` is never emitted.
- **Trees.** A channel is addressed through its channel-slug tree (§5.1) and one tree per
  language its pages declare, each from every page's effective slug in that language. Paths are
  unique per tree: a write producing a duplicate is refused with `409 CMS_SLUG_CONFLICT`
  (`details.language` when the tree is a language's), nothing written or audited. One slug in two
  languages of two pages is allowed.
- **Resolution.** `by-slug` asks the requested language's tree, then the channel default's, then
  every other language's, then the channel-slug tree (the identity a `LinkValue`, the home-page
  setting and the mega menu name a page by); each by whole path, then flat slug. The page is
  served in the requested language by the existing fallback, at that language's `path`; the
  storefront redirects (308) to `url` when the request differs.
- **Trail and links** read each ancestor's name and slug in the served language; a `page` link is
  rewritten to its target's path in it (keyed by the target's own slug, then its language slug).
- **Invalidation** names every address of the written subtree in every tree, before and after;
  any patch snapshots the subtree, since a name is in the descendants' trails.

---

## 6. State and validation rules

| Rule | Where | Error |
| --- | --- | --- |
| Duplicate anchor in one page tree. The set covers the `anchor` prop of each top-level `cms.Section`, of each top-level `cms.SectionGroup` and of each `cms.Section` in such a group's slot (T158), and the rich-text heading anchors at any depth, in every language tree. An anchor may repeat across languages | `CmsPageService.setContent`, `CmsBlockService.setContent`, `CmsTemplateService.setContent` | `CMS_DUPLICATE_ANCHOR` with token `anchor` |
| Reserved anchor (`main-content`, `cmsb`, and the ids from `storefront/app/reserved-anchors.ts`) | same | `CMS_RESERVED_ANCHOR` with token `anchor` |
| Parent cycle or depth > 8 | `cms_page.update` Command | `CMS_PAGE_PARENT_CYCLE` |
| Two pages of one channel at one public path, one of them the written page or a descendant (R19D) | `cms_page.create` / `cms_page.update` Commands, after the write | `409 CMS_SLUG_CONFLICT` with token `path` |
| Brand-token shape | write route (`cmsBrandTokensSchema`) | `VALIDATION_ERROR` (existing envelope) |
| Brand-token version mismatch | `cms.brand_tokens.update` Command | `VERSION_CONFLICT` (existing) |
| Contrast below AA | write route response `warnings[]` | not an error (FR-006b) |
| Stylesheet font URL not `https:` | schema | `VALIDATION_ERROR` |

The three new codes are minted through the existing error-code ledger
(`backend/test/fixtures/error-code-routing/reference-ledgers.ts`).

---

## 7. R23: simplification of the R19–R22 options (2026-10-28)

**Why.** R19–R22 (rounds of fixes found while rebuilding reference pages) added about 200 options.
Many existed only to match a measured page to the pixel: a size, weight, line height and colour per
text and per breakpoint, a px space per inner element, 12-column grids typed as numbers, and brand
switches that scaled every block's own px values in tiers the editor cannot preview. **Pixel-matching
options removed per owner decision**; every structural capability and every bug fix stays. Nothing
of R19–R22 was released, so no stored data needs a migration: a removed block prop is ignored data
(readers never crash on it), a removed brand key is stripped on the next parse. Everything stored
before R19 renders byte for byte as before (option-parity and fallback-parity tests, and an offline
render of a pre-R19 tree against the pre-R19 renderer).

**Rules that replace per-element options.**

- *Typography* (T435). A type-token size carries the token's line height, weight and letter spacing
  wherever a block text takes one (`textStyleAttrs` writes `--cmsb-t-<token>-lh|-w|-ls` with the
  built-in values as fallbacks; T350's `tokenTierStyle` keeps doing it for the heading helpers). A
  line height applies, and its field shows, only at a breakpoint whose size is Custom px
  (`customOnlyLeading` for a heading whose size another helper writes). The weights R19–R22 added
  are one value (`TextWeight`); a stored per-breakpoint weight reads as its `desktop` value, else
  its `base` (`singleWeight`). Weights that were per breakpoint before R19 (R17's heading, title,
  card title and caption weights) stay per breakpoint.
- *Colours* (T436). A block text takes the block's colour (the scheme's, or the hero's
  `textColor`); an accent stays where a block has one (`cms.Hero.eyebrowColor`,
  `cms.Stats.valueColor`, the listings' `leadColor`, list marker colours).
- *Spacing* (T437). A block's inner spaces are one `BlockSpace` (`'default' | SpaceToken`), one
  value for every breakpoint, written as the brand's `--cmsb-space-<step>` with the built-in phone
  and desktop px as fallbacks.
- *12-column layouts* (T438, T440). A `layout` preset (`'default' | '6-6' | '7-5' | '5-7' | '8-4' |
  '4-8' | '5-1-6' | '6-1-5'`, media/image first, mirrored with the side; the card offers the five
  without a column between) and `layoutAdvanced` (boolean). With `layoutAdvanced` on, the raw
  numbers win; with it off they are not read; with it never stored and no preset, stored raw numbers
  read as on (and `resolveData` stores it on, so the editor shows them). `cms.MediaText` keeps its
  `split` as the preset and gains only `layoutAdvanced`.

**Props added** (all optional; unset renders as before):

| Block | Prop | Shape | Replaces |
| --- | --- | --- | --- |
| `cms.Hero` | `eyebrowSize` | `SectionTextSize` (`Responsive`) | — (with `eyebrowSizePx`, which now needs `'custom'`; a stored px without a size reads as Custom) |
| `cms.FeatureList` | `innerSpace` | `BlockSpace` | `iconSpacePx`, `titleSpacePx`, `bodySpacePx` |
| `cms.MediaText` | `innerSpace`, `stackedGap`, `layoutAdvanced` | `BlockSpace`, `BlockSpace`, boolean | `headingSpacePx` + `bodySpacePx`, `stackedGapPx` |
| `cms.CarouselSplit` | `layout`, `layoutAdvanced`, `innerSpace`, `stackedGap` | preset, boolean, `BlockSpace`, `BlockSpace` | the raw spans as main field, `titleSpacePx` + `controlsSpacePx`, `stackedGapPx` |
| `cms.Stats` | `layout`, `layoutAdvanced` | preset, boolean | `imageSpan`/`figuresSpan`/`figuresOffset` as main field |
| `cms.CtaCard` | `layout`, `layoutAdvanced`, `cardPadding`, `headingSpace` | preset (two tracks), boolean, `BlockSpace`, `BlockSpace` | `imageColumns` as main field, `paddingPx`, `headingSpacePx` |
| `cms.DownloadTile` | `titleSize`, `cardPadding` | `SectionTextSize` (`Responsive`), `BlockSpace` | `titleSizePx` alone (now the Custom px; a stored px without a size reads as Custom), `paddingPx` |
| `cms.Image` | `captionSize` | `SectionTextSize` (`Responsive`) | `captionSizePx` alone (as above) |

**Props removed** (stored values ignored):

| Block / area | Removed |
| --- | --- |
| Brand (§2) | `tierScale.smallDesktopUntilPx`, `blockPx`, `buttonLabels`; `layout.gutterTabletPx`, `gutterSmallDesktopPx`, `containerSmallDesktopPx`, `fluidContainer`, `breadcrumbsPaddingYPx`; `typeScale.<token>.trackingMobileEm` |
| `cms.Section` | `outsetPx` |
| `cms.BackgroundPanel` | `textBoxMarginPx`, `textBoxPaddingPx` |
| `cms.Hero` | `titleColor`, `subheadingColor`, `statementColor`, `bodyColor`, `bodyListMarkerColor`, `eyebrowWeight`, `proofCaptionSizePx`, `proofCaptionWeight`, `proofCaptionColor`, `proofCaptionLineHeight` |
| `cms.Heading` | `hangingIconGapPx` (the indent's own 0.35 em) |
| Rich text | the `textSize` mark's Custom px (a stored px mark still renders) |
| `cms.RichContent` | `listWeight` |
| `cms.Statement` | `bodyColor` |
| `cms.FeatureList` | `bodyColor`, `titleLetterSpacing`, `iconSpacePx`, `titleSpacePx`, `bodySpacePx` |
| `cms.MediaText` | `headingSpacePx`, `bodySpacePx`, `stackedGapPx`, `featureBodyColor` |
| `cms.CarouselSplit` | `titleHangingIconGapPx`, `stackedGapPx`, `titleSpacePx`, `controlsSpacePx` |
| Carousels | `controls.dotColor`, `controls.activeDotColor`, `slidesPerViewSmallDesktop`, `gapSmallDesktopPx` |
| `cms.Button`, `ButtonSpec` | `iconSizePx`, `iconOnlyWidthPx` |
| `cms.DownloadTile` | `paddingPx`, `iconButtonSizePx`, `iconButtonBorderColor`, `subtitleSizePx`, `subtitleColor` |
| `cms.CarouselImage` | `moreLabelSizePx`, `moreLabelColor`, `moreLabelIconColor`, `moreLabelWeight`, `captionPaddingPx` |
| `cms.Image` | `captionWeight`, `captionColor`, `captionMinWidthPx` |
| `cms.Stats` | `labelColor` |
| `cms.CtaCard` | `listSize`, `listSizePx` (the list follows `bodySize`), `paddingPx`, `headingSpacePx` |
| `cms.Accordion` | `icon: 'chevron-circle'` (reads as `'chevron'`), `iconCircleColor` |
| `newsletter.Signup` | `buttonHeightPx`, `buttonTextSizePx`, `buttonWeight`, `topicLabelSizePx` |

**Props narrowed to one value** (a stored per-breakpoint value reads as its desktop value, else its
base): the R19–R22 weights (`cms.Hero` `subheadingWeight`, `statementWeight`, `bodyWeight`;
`cms.Statement`, `cms.FeatureList`, `cms.MediaText`, `cms.CarouselSplit` `bodyWeight`;
`cms.MediaText.featureBodyWeight`; `cms.CarouselSplit.titleWeight`; `cms.Stats.labelWeight`;
`cms.LinkList.titleWeight`; `cms.RichContent.textWeight`; `cms.CtaCard.bodyWeight`; the
listings' and `blog.LatestPosts`' `leadWeight`), `cms.CtaCard.imageInsetPx` and
`cms.DownloadTile.minHeightPx`.

**Unchanged and kept**: `tierScale.tablet`, `smallDesktop`, `fluidDesktop`, `fluidUntilPx`,
`buttons`; `parentPathInUrl` and `breadcrumbsOverlay` (§1.1, their migrations); the section width
per breakpoint, the Column outset, the art-direction tier, the stacking breakpoints, the controls
inside a slide, `dots-start`, `arrowsWhenFit`, the transparent outline, the pill shape, the download
tile link and look, the read-more label, the caption placement per breakpoint, the sign-up layout
options, the hanging indent, the feature-list icon position and item span, the rich-text token size
mark and list markers, the measures, and every R19–R22 bug fix.
