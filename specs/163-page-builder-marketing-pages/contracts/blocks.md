# Contract: blocks

This is the binding prop shape of every new or reshaped block. The shared types `LinkValue`,
`ButtonSpec`, `ResponsiveImage`, `SectionSettings`, `InlineRichText` and `Responsive<T>` are
defined in [../data-model.md](../data-model.md) §3.

**Translatable** lists the manifest `translatable` paths. Each path is a plain string unless it
says `(tiptap)` or `(html)`. Slot children are translated through their own declarations.

**Defaults** must render a non-empty, non-loading block, as `storefront/test/ssr/blocks.test.tsx`
requires. They must also be neutral and consistent with today's blocks (plan § *Extend, don't
narrow*, rule 3).

**Extend, don't narrow.** Every reshaped block keeps a superset of its options on
`origin/master`. The plan's table of kept options is binding, and each reshaped or removed block
has an option-parity test. Wherever a block reads a brand token, it also offers a **Custom**
literal value in an "Advanced" group: px for sizes and spacing, hex for colours, any family for
fonts. This is written below as `TypeToken | Custom`.

Every block on this list:

- keeps `editorName` and `hideOn`, injected by `withHideOn`;
- is declared once in its owner's manifest with `labelKey`, `descriptionKey`, `category`,
  `contexts: ['cms']`, `responsiveFields` and `translatable`;
- ships `en` and `pl` label keys, and field labels under `blocks.<name>.fields.*` (R-24);
- renders identically in the admin canvas and on the storefront (FR-038).

---

## `cms.Section` (new; owner ruling 2026-10-23)

The one block that carries section settings (FR-000; plan § *Owner ruling 2026-10-23*, which
replaced "section settings on every section block"). No other block on this list has them; a
`section` prop stored on any block while this feature was developed (including the Section's
own `section` object before T117) is ignored at render (the branch was never released, so it
needs no compatibility).

The settings are the block's own top-level props (`SectionSettings`, data-model §3.4; T117,
owner review 2026-10-23: a value per breakpoint is edited on the editor's Responsive tab, as on
`cms.Row`, not with a switch inside a field). Nothing is stored until an edit.

| Prop | Shape | Editor tab | Default |
| --- | --- | --- | --- |
| `anchor` | string, normalised as typed | General (last) | none |
| `scheme` | `'inherit' \| 'light' \| 'muted' \| 'dark'` | General | `inherit` |
| `background` | `SectionBackground` (custom field, the admin's asset picker) | General | none |
| `width` | `'contained' \| 'wide' \| 'full' \| 'viewport' \| 'bleed' \| 'custom'` | General | `contained` |
| `contentWidth` | `'contained' \| 'wide' \| 'full' \| 'custom'`, shown with `width` `full`, `viewport` or `bleed` (T124): the content frame inside a background of that extent, written as `data-content-width`; only `viewport` adds the full height | General | none (the width's own frame) |
| `customMaxWidthPx` | number (px), shown with `width: 'custom'` or `contentWidth: 'custom'` | General | 1200 |
| `reveal` | `RevealSetting` (`none` or `fade-up`, optionally desktop only) | General (last) | none |
| `spaceTop`, `spaceBottom` | `Responsive<SpaceToken \| {px}>` | **Responsive** | `l` |
| `contentPosition` | `Responsive<'start' \| 'center' \| 'end'>` | **Responsive** | none (start) |
| `overlap` | `Responsive<SpaceToken \| {px}>` (T148): pull the content up into the previous section; the same field as the spacing, showing `none` until set | **Responsive** | none |
| `content` | slot; `disallow: ['cms.Section', 'cms.SectionGroup', 'cms.Column']` | — | `[]` |

`responsiveFields: ['spaceTop', 'spaceBottom', 'contentPosition', 'overlap']` in the registration and the
manifest; their fields carry `PB_RESPONSIVE_METADATA`.

- **Top level only.** Every slot in the config refuses `cms.Section` (its `disallow`, or an
  `allow` list without it), and the editor guard reverts an insert or a move of it into any
  zone but the root (`ROOT_ONLY_TYPES`, `shouldRevertPuckAction`). Stored nested anyway, it
  renders its children with no wrapper and ignores its settings.
- **Rendering** (`SectionFrame`): at the top level, `<section class="cmsc-section" id={anchor}
  data-cmsb-scheme={scheme} data-width={width} data-position…>` with the background layer (a
  `<picture>` or a `<video>` pair, plus the overlay), padding from `spaceTop` and `spaceBottom`,
  and a content frame of `container`, `wide`, full or custom width. `viewport` is the full
  viewport wide and at least `100svh` tall; `contentPosition` places the frame inside it.
  `scroll-margin-top: var(--cmsb-header-offset, 0px)` serves FR-001 acceptance 2.
- **Overlap** (T148): with an `overlap` that is not `none` at some breakpoint, the section
  carries `data-overlap="1"` and `--cmsc-section-overlap(-md|-lg)`; nothing is written
  otherwise. The stylesheet gives it `z-index: 1` (above the previous section, which is
  `position: relative` with no z-index) and `display: flow-root` (unless `data-position` makes
  it flex), and pulls the **frame** up by `margin-top: calc(-1 * overlap)` per breakpoint, so
  the content sits over the previous section's background while the section's own box and
  background stay in place; no horizontal overflow (a vertical margin). The page's first block
  (`.cmsc-pb-hide-on:first-child`) is not pulled. **Editor (decision):** the canvas does not
  pull (`.cmsc-section--tier`), so the previous section stays selectable and droppable; it
  writes the previewed tier's value only and draws a hatched, `pointer-events: none` band of
  that height at the top of the section.
- **Empty collapse** (T148): pure CSS, no DOM change. A published section (not `--tier`, not
  `data-media`) whose frame holds nothing but empty block wrappers — `section > .frame > slot
  div > .cmsc-pb-hide-on:empty` — drops its padding, minimum height and pull-up
  (`:not(:has(> .cmsc-section__frame > * > :not(.cmsc-pb-hide-on:empty)))`); per breakpoint
  a wrapper hidden there (`[data-hide-<tier>='1']`) counts as empty too. A data block with no
  data renders `null`, so its wrapper is empty. A section with an image or video background
  keeps its size (the media is content). Fallback: without `:has()` support the rules are
  dropped and the padding stays, as before. A server-side decision was rejected: whether a
  block renders anything is known only when it renders (block data, hide-on per breakpoint).
- **Palette**: `layout` category, label "Section" / "Sekcja".
- **Translatable**: none (an anchor is an address); the slot's blocks are translated through
  their own declarations.
- **Anchors** (data-model §6): only the `anchor` prop of a top-level `cms.Section` takes part
  in the duplicate and reserved guard, with the rich-text heading anchors at any depth.
- **Lead image** (R-23): the hero leads the page when it is the first top-level block, or the
  first block of a first top-level Section.
- **Presets** (R-22): each preset is one `cms.Section` holding its block.
- Blocks keep their intrinsic visuals (a hero's media, a panel's image, a card's fill). A
  full-bleed statement or panel is a Section with `width: 'bleed'` or `'full'` around it.
- **In a group** (T158): a Section may also stand directly in the slot of a top-level
  `cms.SectionGroup` (below), where it renders exactly as at the top level.

---

## `cms.SectionGroup` (new, T158; owner ruling 2026-10-26)

A top-level container whose slot holds only `cms.Section`s (FR-005 as amended; plan § *Owner
ruling 2026-10-26: a Section group container*, which superseded R-8a's "per section only"). It
paints one colour scheme, background and decorative layer behind all its Sections, so the
layer has no seam at a Section boundary. Its settings are the Section's
(`sectionGroupSettingsSchema`, data-model §3.4a); nothing is stored until an edit.

| Prop | Shape | Editor tab | Default |
| --- | --- | --- | --- |
| `scheme` | `'inherit' \| 'light' \| 'muted' \| 'dark'` | General | `inherit` |
| `background` | `SectionBackground` (the Section's custom field, the admin's asset picker) | General | none |
| `anchor` | string, normalised as typed | General | none |
| `spaceTop`, `spaceBottom` | `Responsive<SpaceToken \| {px}>` (the Section's spacing field, showing `none` until set) | **Responsive** | `none` |
| `content` | slot; `allow: ['cms.Section']` | — | `[]` |

`responsiveFields: ['spaceTop', 'spaceBottom']` in the registration and the manifest. No width,
content width, content position, reveal or overlap: those stay on its Sections.

- **Placement.** `cms.SectionGroup` is in `ROOT_ONLY_TYPES`: every other slot refuses it (its
  `disallow`, or an `allow` list without it) and the editor guard reverts an insert or a move of
  it into any zone but the root. Its own slot `allow`s `cms.Section` only, and the guard reverts
  an insert or a move of anything else into a group's `content` zone
  (`isSectionGroupContentZone`, `SECTION_GROUP_CHILD_TYPES`); a Section may be inserted or moved
  into it (the one zone besides the root). A move's source type is read from the parent's slot
  prop when the zone is a slot (`{parentId}:{slot}`), not only from `data.zones`.
- **Rendering** (`SectionGroupFrame`): at the top level, `<div class="cmsc-section-group"
  id={anchor} data-cmsb-scheme={scheme} data-paint data-media data-decorative>` with
  `--cmsc-group-p(t|b)(-md|-lg)` as padding per breakpoint and, when it paints (a scheme or a
  background), one `<div class="cmsc-section-group__paint" aria-hidden>`: the scheme's
  `--cmsb-bg`, a solid or gradient paint, an image or video pair with its overlay
  (`.cmsc-section__media`) and, with `decorative`, `--cmsb-decorative` as one cover image from
  the group's top. The group box keeps the page container's width (each Section sizes itself as
  at the top level); the paint layer spans the window (`left: calc(50% - 50vw); width: 100vw`;
  100 % in the Puck preview). Stored nested, it renders its children only, and a Section in it
  is not a section.
- **Sections inside.** A Section directly in a top-level group renders as a top-level Section
  (`data-in-group="1"`): its own anchor, width, spacing, overlap and empty collapse. It
  inherits the group's scheme through the CSS variables unless it sets its own. While the group
  paints, a Section with no background of its own (no solid, gradient, image, video or
  `decorative`) and the group's scheme or none carries `data-transparent="1"`, which drops its
  scheme's background colour; a Section with its own background or another scheme paints it. A
  sign-up in a grouped Section without an anchor returns to the group's anchor.
- **Overlap** (T148 in a group): the first Section of a group pulls its frame up over the block
  before the group (`.cmsc-pb-hide-on:first-child > .cmsc-section[data-in-group][data-overlap]`
  restores the pull the first-block rule removes); the group's own space above is covered first;
  the first Section of a group that is the page's first block is not pulled. Recorded
  behaviour: the pulled content paints above the previous block in document order; a previous
  Section with its own `data-overlap` (`z-index: 1`) stays above it.
- **Empty collapse.** A grouped Section collapses by T148's rule (its DOM is unchanged). A
  published group (not `--tier`, not `data-media`) none of whose Sections shows anything drops
  its own padding: `:not(:has(…))` over the Sections' frames, per breakpoint counting a Section
  or block hidden there; a Section over media, or anything other than a Section stored in the
  slot, counts as content.
- **Palette**: `layout` category, weight 6, label "Section group" / "Grupa sekcji".
- **Translatable**: none; the Sections' blocks are translated through their own declarations.
- **Anchors** (data-model §6): the group's `anchor` and the `anchor` of each Section in its
  slot take part in the duplicate and reserved guard and are listed by the link picker
  (`collectAnchors`).
- **Lead image** (R-23): the hero also leads the page as the first block of the first Section
  of a first top-level group.
- **Presets** (R-22): with the selected block in a grouped Section, a preset Section is
  inserted into that group after it.

---

## `cms.Hero` (reshaped)

| Prop | Type | Default |
| --- | --- | --- |
| `media` | `{kind: 'none'} \| {kind: 'solid', color} \| {kind: 'gradient', from, to, angle} \| {kind: 'image', image: ResponsiveImage} \| {kind: 'video', videoSource?: 'url' \| 'library', videoUrl?, videoAssetId, mobileVideoAssetId?, mobileVideoUrl?, posterSource?: 'library' \| 'url', posterAssetId?, posterUrl?, mobilePosterAssetId?, mobilePosterUrl?, ratio?: Responsive<AspectToken>}` (today's solid and gradient backgrounds kept; T126: `ratio` is the frame's ratio when the video is above the content, `auto` excluded; T142: the mobile video follows the source — `mobileVideoUrl` with `url`, `mobileVideoAssetId` with `library` — and takes the other kind when its own is unset; T191: `posterSource` governs both posters — unset or `library`, the library image wins over the URL; `url`, the URL wins and the library image is the fallback; a URL is made absolute against the media origin. The admin control shows `library` (the two pickers) or `url` (the two URL boxes), and for a stored media with no `posterSource` the source its values imply: a URL set and no library image is `url`, anything else `library`) | `{kind: 'none'}`; a video's `ratio` unset is 16:9 |
| `mediaPlacement` | `'background' \| 'above'` | `'background'` |
| `overlay` | as in `SectionBackground.overlay`. `solid` with `strength` is today's `overlayOpacity`. T192: the panel (labelled *Overlay (darkens the background media)*, its select *Type*) offers `direction` for `gradient` only and `strength` for `solid` and `gradient` (`resolveFields`, one field object per type) | `{kind: 'none'}`. The admin proposes a 40% solid overlay when image or video media is first chosen |
| `textColor` | token or hex (today's field) | inherit from the scheme |
| `eyebrow` | string | `''` |
| `title` | `InlineRichText` | `"Page title"` |
| `titleLevel` / `titleSize` | `'h1'…'p'` / `TypeToken \| Custom` | `'h1'` / `'h1'` |
| `subheading` | `InlineRichText` | empty |
| `subheadingLevel` / `subheadingSize` | | `'p'` / `'lead'` |
| `statement` | `InlineRichText` | empty |
| `statementLevel` / `statementSize` | | `'p'` / `'h4'` |
| `body` | rich text (TipTap doc) | empty |
| `buttons` | `ButtonSpec[]` (0–6) | one primary button |
| `socialProof` | `{image?: ResponsiveImage, caption: string}` | none |
| `align` | `'start' \| 'center' \| 'end'` (today's `contentAlign`) | `'start'`, as today's hero (`contentAlign: 'left'`) |
| `minHeight` | `Responsive<'auto' \| 'half' \| 'tall' \| 'screen' \| Custom px>` (today's `minHeightPx` is the Custom case) | `'auto'` |
| `cornerRadius`, `shadow` | as today | `'none'` |
| `gaps` | `Responsive<SpaceToken \| {px}>` | today's text spacing (12 px mobile, 20 px desktop) |
| `reveal` | `RevealSetting`, applied to `statement` and `body` | none |
| `order` | `Array<{element: 'eyebrow' \| 'title' \| 'subheading' \| 'statement' \| 'body' \| 'buttons' \| 'socialProof', space?: SpaceToken \| 'custom' \| 'default', spacePx?: number}>` (0–7, T133; labelled *Elements: order and spacing* since T193): the listed elements first, each once, then the rest in the default order; an unknown or repeated entry is ignored. Not per breakpoint: the DOM order is the reading and focus order. T193: an item's `space` is the space below its element, as `spaceAfter` wrote it; `default` or none keeps `gaps` or today's spacing | unset: eyebrow, title, subheading, statement, body, buttons, social proof (today's) |
| `spaceAfter` | **Deprecated by T193; no longer in the panel.** `Array<{element: HeroElement, space: SpaceToken \| 'custom', spacePx?: number}>` (0–7, T145): the space below each listed element (a token's `--cmsb-space-*` with its built-in px below / at the desktop tier, or Custom px), in either spacing mode; the next element adds none above it. The first entry per element counts; an entry with an unknown element or space is ignored. Rendered as `data-space-after` on `.cmsc-pb-hero__content` and `--cmsc-hero-after-<element>(-lg)` — the names in the default element order, for an `order` item's space and a stored entry alike. Still read for an element whose `order` item has no space. The editor's `resolveData` carries it into `order` once: the list becomes the full effective order (`heroElementOrder`, so nothing moves), each item takes its element's space when it has none of its own, and `spaceAfter` is dropped | unset: `gaps`, or today's spacing |
| `mediaWidth` | `'content' \| 'viewport'` (T133): `viewport` lets image or video media reach the window's edges (above: a full-width band; behind: a full-width backdrop with its overlay) while the texts stay in the hero; not in the editor canvas | unset (`content`, today's) |

**Translatable**: `eyebrow`; `title`, `subheading` and `statement` (tiptap); `body` (tiptap);
`buttons[].label`; `socialProof.caption`; `media.image.alt`.

**Media loading**: as the page's lead block — the first top-level block, or the first block of a
first top-level `cms.Section` — the hero's media is eager with `fetchpriority="high"`.
Everywhere else it is lazy.

---

## `cms.MediaText` (new)

| Prop | Type | Default |
| --- | --- | --- |
| `heading` | `InlineRichText` + `headingLevel` + `headingSize` | `"Heading"`, `h2`, `h3` |
| `media` | `{kind: 'image', image} \| {kind: 'video', videoSource?: 'library' \| 'url', videoAssetId?, videoUrl?, mobileVideoAssetId?, mobileVideoUrl?, posterAssetId?, autoplay: boolean, ratio?: Responsive<AspectToken>}` (T126: the video frame's ratio, `auto` excluded; T142: library videos or URLs, each kind the other's fallback; a distinct mobile video makes a pair `data-bp="mobile"`/`"desktop"` of which the stylesheet shows one, an autoplaying one marked `data-autoplay` and started by `useBreakpointVideo`) | image placeholder; `videoSource` unset is `library`; a video's `ratio` unset is 16:9 |
| `mediaSide` | `'start' \| 'end'` | `'start'` |
| `mobileOrder` | `'media-first' \| 'text-first'` | `'media-first'` |
| `split` | `'5-5' \| '6-6' \| '5-6' \| '4-7' \| '7-4'` | `'5-5'` |
| `verticalAlign` | `'start' \| 'center' \| 'end'` | `'center'` |
| `body` | rich text | sample paragraph |
| `features` | `Array<{icon?: IconName, iconAssetId?, title: InlineRichText, body: string}>` (0–8) | `[]` |
| `buttons` | `ButtonSpec[]` (0–4) | `[]` |
| `footnote` | rich text | empty |
| `rows` | `Array<{media, heading, body, features, buttons}>` (0–12) | `[]` |
| `alternate` | boolean; with `rows`, each row flips `mediaSide` | `true` |
| `divider` | boolean, a rule between rows | `false` |

**Translatable**: `heading` (tiptap), `body` (tiptap), `features[].title` (tiptap),
`features[].body`, `buttons[].label`, `footnote` (tiptap), `media.image.alt`, `rows[].heading`
(tiptap), `rows[].body` (tiptap), `rows[].features[].title` (tiptap), `rows[].features[].body`,
`rows[].buttons[].label`.

---

## `cms.BackgroundPanel` (new)

| Prop | Type | Default |
| --- | --- | --- |
| `image` | `ResponsiveImage` (required) | placeholder |
| `textSide` | `'start' \| 'end'` | `'end'` |
| `mobileTextPosition` | `'top' \| 'bottom'` | `'top'` |
| `icon` / `iconAssetId` | optional | none |
| `heading`, `headingLevel`, `headingSize` | as MediaText | |
| `body` | rich text | |
| `buttons` | `ButtonSpec[]` (0–3) | one |
| `minHeight` | `Responsive<'medium' \| 'tall' \| 'screen'>` | `'tall'` |

**Translatable**: `heading` (tiptap), `body` (tiptap), `buttons[].label`, `image.alt`.

---

## `cms.CtaCard` (new)

| Prop | Type | Default |
| --- | --- | --- |
| `cardScheme` | `'muted' \| 'dark' \| 'light'` | `'muted'` |
| `decorative` | boolean, the tokens' dark decorative layer | `false` |
| `heading`, `headingLevel`, `headingSize` | | |
| `body` | rich text | |
| `list` | `Array<{icon?: IconName, text: string}>` (0–12) | `[]` |
| `listColumns` | `1 \| 2` | `2` |
| `buttons` | `ButtonSpec[]` (0–3) | one |
| `image` | `ResponsiveImage` (optional) | none |
| `imageSide` | `'start' \| 'end'` | `'end'` |

**Translatable**: `heading` (tiptap), `body` (tiptap), `list[].text`, `buttons[].label`,
`image.alt`.

---

## `cms.Statement` (new)

| Prop | Type | Default |
| --- | --- | --- |
| `heading` | `InlineRichText`, with the muted `emphasis` used for the continuation | |
| `headingLevel` / `headingSize` | | `h2` / `h3` |
| `body` | rich text, rendered muted | empty |
| `align` | `'start' \| 'center'` | `'start'` |
| `background` | `{image?: ResponsiveImage, textPosition: 'bottom' \| 'center'}`; with an image, the image fills the block (edge to edge is the enclosing Section's `bleed` width) | none |
| `reveal` | `RevealSetting` | none |
| `textMaxWidth` / `textMaxWidthPx` | `Responsive<'none' \| 'narrow' \| 'medium' \| 'wide' \| 'custom'>` (36 / 48 / 60 rem, or the Custom px) on the heading and the body; centred with a centred statement (T134) | unset (full width) |

**Translatable**: `heading` (tiptap), `body` (tiptap), `background.image.alt`.

---

## `cms.FeatureList` (reshaped)

| Prop | Type | Default |
| --- | --- | --- |
| `heading`, `headingLevel`, `headingSize` | optional | empty |
| `columns` | `Responsive<1 \| 2 \| 3 \| 4>` | `3`, today's default (plan rule 3) |
| `gap` | `Responsive<SpaceToken \| Custom px>` (today's field) | Custom 24 px, today's default |
| `iconSize` | `'small' \| 'medium' \| 'large' \| Custom px` (today's numeric size is the Custom case) | today's default |
| `iconColor` | token or hex (today's field) | inherit |
| `align` | `'start' \| 'center'` (today's field) | today's default |
| `titleSize` | `TypeToken \| Custom \| 'default'` | `'default'` (today's look) |
| `items` | `Array<{icon?: IconName, iconAssetId?, title: InlineRichText, body: rich}>` (1–24) | three items |
| `image` | `ResponsiveImage`, optional, below the grid | none |

- An uploaded SVG icon is drawn with `mask-image: url(...)` filled with `currentColor`, so it
  inherits the scheme (US3 acceptance 2).
- **Translatable**: `heading` (tiptap), `items[].title` (tiptap), `items[].body` (tiptap),
  `image.alt`.

## `cms.Stats` (reshaped)

`heading?`, `image?: ResponsiveImage`, `imageSide`, `grid: Responsive<1–4 columns>`,
`items: Array<{value: string, label: string}>` (1–12), `valueSize: TypeToken | Custom`, and today's
`gap`, `align` and `valueColor` (token or hex). Without a heading and an image, the default render
equals today's.

**Translatable**: `heading` (tiptap), `items[].value`, `items[].label`, `image.alt`.

## `cms.Testimonial` (reshaped)

`image?: ResponsiveImage`, `quote: rich`, `author`, `role`,
`layout: 'card' | 'image-overlay'` (default `'card'`, today's look), `avatar?: ResponsiveImage`
(today's avatar URL or library), and today's `background`, `cornerRadius` and `shadow`.

**Translatable**: `quote` (tiptap), `author`, `role`, `image.alt`, `avatar.alt`.

## `cms.Tabs` / `cms.Accordion` (reshaped)

- **Tabs**: `items: Array<{label: string, panel: Slot, content?: string}>` (1–8). A stored HTML
  `content` renders as today until the editor moves it into `panel` (T059),
  `variant: 'underline' | 'pills' | 'boxed'`, `effect: 'none' | 'fade' | 'slide'` (`slide` and the crossfade: T174, § R11), `align` and
  `defaultTab`. T132 adds `tabStyle?: {size?: 's' | 'm' | 'l' (offered as `tabSize` per breakpoint since T163, § R9), barBackground?, barBorderColor?,
  activeBackground?, activeColor?, inactiveBackground?, inactiveColor?}` (each colour a
  `ColorValue`: a brand token or a hex); unset, today's look. A bar background or border draws the
  bar (a capsule around `pills`, `fit-content`, still wrapping at 375 px as T123 made it).
  T146 adds `panelGap?: Responsive<SpaceToken | 'custom'>` and `panelGapPx?: Responsive<number>`
  (Responsive tab, the px shown with Custom): the space below the bar, as
  `cmsc-pb-tabs--panel-gap` and `--cmsc-tabs-panel-gap(-md|-lg)`; unset, today's 12 px. A panel
  in columns is a `cms.Row` of `cms.Column`s inside the panel (not a new layout).
  **Translatable**: `items[].label`.
- **Accordion**: `items: Array<{title: string, panel: Slot, content?: string}>` (1–24), `allowMultiple`,
  `defaultOpen`, `variant` and `iconPosition`; T134 adds `titleLevel: 'none' | 'h2' … 'h6'` (unset:
  today's bare trigger; set: the trigger button inside that heading, the WAI-ARIA accordion
  pattern; no `h1`) and `titleSize` / `titleSizePx` (`Responsive<TypeToken | 'custom' | 'default'>`,
  unset: today's 15 px semibold). **Translatable**: `items[].title`.
- **Panel slot**: disallows `cms.Column`, `cms.Tabs`, `cms.Accordion` and `cms.Section`.
- **Element ids** (T149): the tab, panel, trigger and region ids are built from the block's id
  (`useId()` only without one), so they hydrate whatever is rendered above the page.

## `cms.ContentSlider` ("Carousel", reshaped)

| Prop | Type | Default |
| --- | --- | --- |
| `header` | `{heading?: InlineRichText, lead?: string, button?: ButtonSpec}` | none |
| `slides` | slot; allows `cms.Slide`, `cms.CarouselImage`, `cms.CarouselSplit`, `cms.LinkTile`, `cms.DownloadTile`, `cms.Row` (wrapped into a Slide, existing) | three `cms.CarouselImage` |
| `slidesPerView` | `Responsive<number>`, 1–8 in steps of 0.25 (today's range kept) | `{base: 1.15, tablet: 2, desktop: 3}` |
| `gap` | `Responsive<SpaceToken>` | `'s'` |
| `effect` | `'slide' \| 'fade'` (fade forces 1 per view) | `'slide'` |
| `controls` | `{arrows: boolean, dots: boolean, arrowVariant?: 'default' \| 'outline' \| 'solid', arrowShape?: 'round' \| 'square', arrowSize?: 's' \| 'm' \| 'l', arrowColor?: ColorValue, nextArrowVariant?: 'same' \| 'default' \| 'outline' \| 'solid'}` (T129: the look; T147: the next arrow's own style, unset or `same` = `arrowVariant`; `placement` stored before T129 is read and moved to `controlsPlacement`) | arrows on, dots off, today's look |
| `controlsPlacement` | `Responsive<'header' \| 'below' \| 'overlay'>`, Responsive tab (T129) | `'below'` |
| `controlsAlign` | `Responsive<'center' \| 'start' \| 'end' \| 'between' \| 'split'>`, Responsive tab (T147; the rows below the track; carousel only) | unset = `'center'` (today) |
| `bleed` | `'none' \| 'end' \| 'both'` | `'none'` |
| `autoplay` / `intervalMs` | boolean / 2000–20000 | `false` / 6000 |
| `equalHeight` | boolean | `true` |
| `layout` | `'carousel' \| 'grid'` (T130; the grid hides the carousel-only options) | `'carousel'` |
| `columns` | `Responsive<number>`, 1–6, Responsive tab (T130, grid only) | `{base: 1, tablet: 2, desktop: 3}` |
| `filter` | `{show: boolean, allLabel: string, tags: Array<{tag: string, label?: string}>, style?: 'pills' \| 'underline', align?: 'start' \| 'center' \| 'end'}` (T131; T143: the bar's look and alignment, unset = pills at the start) | `{show: false, allLabel: '', tags: []}` |

`controlsPlacement`, `controls.arrow*` are shared by every carousel (`catalog.ProductSlider`,
`blog.LatestPosts`). A placement per breakpoint renders each placement used once; the stylesheet
removes a group where its placement does not apply. The grid renders the slot as a `role="list"`
of `listitem`s with `--pb-cols(-md|-lg)`. The filter bar (`role="toolbar"`, `aria-pressed`
buttons, a roving tab stop, a polite `role="status"` count) hides in the browser the items whose
`tags` lack the pressed tag; the server HTML holds every item, none hidden. An empty `allLabel`
reads the page language's word (`CmsCarouselLabelText.filterAll`).

R7: the filter bar's `style`/`align` are classes of the bar (`__filter--underline`,
`__filter--align-center|end`); the toolbar semantics are the same for both looks (T143).
`controlsAlign` and `controls.nextArrowVariant` are shared by every carousel (T147).
`controlsAlign` writes root classes `--ctl-<value>` (unless centred) and `--ctl-md|lg-<value>`
where a breakpoint changes it; `split` puts the arrows at the two ends of the row below with the
dots centred between; the DOM order (previous, dots, pause, next) never changes. The next arrow's
style is a root class `--next-arrow-<variant>` read on `__arrow--next`: both arrows keep one
markup, which is what makes a per-arrow style possible without new markup.

**Translatable**: `header.heading` (tiptap), `header.lead`, `header.button.label`,
`filter.allLabel`, `filter.tags[].label` (T131; `filter.tags[].tag` is a key, not prose).

### Carousel items (hidden category, only inside `slides`)

| Block | Props | Translatable |
| --- | --- | --- |
| `cms.CarouselImage` | `image: ResponsiveImage`, `caption?: InlineRichText`, `captionPlacement` (every value of today's ImageSlider `titlePlacement`, plus `'below'`), `captionStyle: {background, color, borderColor, borderWidth, borderRadius, paddingPx}` (today's five title style fields plus colour), `captionScrim?: {kind: 'none' \| 'gradient' \| 'solid', strength: 0–90}` (T129; overlay captions only; default `none`), `link?: LinkValue`, `hoverZoom`, `mediaCornerRadius?: CornerRadius` (T140; the frame's corners, default `medium` = today's 8 px), `captionSize?: Responsive<TypeToken \| 'custom' \| 'default'>` + `captionSizePx?: Responsive<number>` (Responsive tab) and `captionFont?: 'default' \| 'heading' \| 'body'` (T144; unset = today's 14 px semibold) | `image.alt`, `caption` (tiptap) |
| `cms.CarouselSplit` | `media` (as MediaText), `mediaSide`, `icon?`/`iconAssetId?`, `title: InlineRichText`, `body: rich`, `buttons: ButtonSpec[]` (0–2) | `title` (tiptap), `body` (tiptap), `buttons[].label`, `media.image.alt` |
| `cms.LinkTile` | `image: ResponsiveImage`, `title: InlineRichText`, `linkLabel`, `link: LinkValue`, `ratio` (`Responsive<w:h>`, Responsive tab since T130; a plain string is every breakpoint), `mediaCornerRadius?: CornerRadius` (T140; the image frame's corners, default `medium` = today's 8 px), `titleSize?`/`labelSize?: Responsive<TypeToken \| 'custom' \| 'default'>` + `titleSizePx?`/`labelSizePx?` (Responsive tab), `titleFont?`/`labelFont?: 'default' \| 'heading' \| 'body'`, `labelStyle?: 'link' \| 'button' \| 'none'` (T144; unset = today's text link with an arrow; `button` is a `span` with the primary button's classes inside the tile's one link) | `title` (tiptap), `linkLabel`, `image.alt` |
| `cms.DownloadTile` | `title`, `subtitle?`, `fileAssetId` (required), `hoverImage?: ResponsiveImage`, `linkLabel` (accessible name, default "Download") | `title`, `subtitle`, `linkLabel`, `hoverImage.alt` |

Every item and `cms.Slide` take `tags?: string` (T131, comma-separated keys, written on the item's
root as `data-pb-tags`, trimmed and lower-cased); not translatable.

`cms.DownloadTile` renders as a single `<a href={assetUrl} download>`. When the asset is missing
from the render-time map, it renders nothing for customers and a warning in the preview (spec
edge case).

## `cms.LinkList` (new)

`heading?`, `items: Array<{title: string, description?: string, button: ButtonSpec}>` (1–50),
`divider: boolean`.

**Translatable**: `heading` (tiptap), `items[].title`, `items[].description`,
`items[].button.label`.

## `cms.Heading` / `cms.Button` (reshaped)

- **Heading**: `text: InlineRichText`, `level: 'h1'…'h6' | 'p'`, `size: TypeToken`,
  `align: Responsive<'start' | 'center' | 'end'>`, `color` (token or hex) and `reveal?`. The
  default is `size: 'h2'`. Today's free typography stays as Custom overrides:
  - `size` becomes `TypeToken | Custom px`, responsive as today's `fontSize`;
  - `font` is `'heading' | 'body' | Custom` (today's `sans`/`serif`/`mono` and any family);
  - `fontWeight`, `fontStyle` and `lineHeight` are kept.

  **Translatable**: `text` (tiptap).
- **Button**: `button: ButtonSpec` and `align`. Today's `variant` maps to `ButtonSpec`:
  `primary` → `primary`/`solid`, `secondary` → `primary`/`outline`, `ghost` → `primary`/`text`.
  It stays responsive. Today's `backgroundColor` and `textColor` stay as overrides on the spec.
  **Translatable**: `button.label`.

## `catalog.ProductGrid` / `catalog.ProductSlider` (reshaped, owner `catalog`)

- **Additions**: `header?` (as Carousel), `cardVariant: 'default' | 'compact' | 'horizontal' |
  'showcase'`, `cardTextLine?: 'default' | 'summary' | 'sku' | 'none'` (T135; unset `default` is
  the card style's own line — the SKU on today's three, the summary on `showcase`; T196: labelled
  *Text under the product name*, `summary` as *Short description (from the product description)*;
  the summary rule is `productSummaryText` of `@endora-commerce/contracts`, which the catalogue's
  listing and the editor's preview both use), `ctaLabel`
  and `footerButton?: ButtonSpec`.
- **Slider**: takes the Carousel options.
- **Translatable**: adds `header.heading` (tiptap), `header.lead`, `header.button.label`,
  `ctaLabel` and `footerButton.label`.

## `blog.LatestPosts` (new, owner `blog`)

`header?` (as Carousel), `limit` (1–12, default 6), `categorySlug?`, `layout: 'carousel' | 'grid'`
and the carousel options when `layout === 'carousel'`.

- **Card**: image (ratio `'2:1'`), primary category chip, title, a read-more link with
  `readMoreLabel`.
- **Translatable**: `header.heading` (tiptap), `header.lead`, `header.button.label`,
  `readMoreLabel`.
- **Empty state**: with no posts, customers see nothing. The preview shows "No posts".

## `newsletter.Signup` (new, owner `newsletter`)

`heading?: InlineRichText`, `text?: rich`, `placeholder`, `buttonLabel`,
`topics: Array<{label: string, tagCode: string}>` (0–12), `topicsRequired: boolean`,
`consentLabel: InlineRichText` (required) and `layout: 'inline' | 'boxed'`.

It keeps every field of the removed `cms.NewsletterSignup`: `heading`, `description` → `text`,
`placeholder` and `buttonLabel`. **Open point (decided with the owner in T076)**: today's
`actionUrl`, a form posting to any external endpoint, cannot live in a block owned by
`newsletter`, because that block disappears while the module is off. **Decided 2026-10-23
(T076, option a):** `cms.NewsletterSignup` stays as the external-endpoint form, reshaped with
an optional consent checkbox (its `section` removed by the owner ruling of 2026-10-23), beside
`newsletter.Signup`. Its palette label names it
as the external form so editors can tell the two apart.

- **Translatable**: `heading` (tiptap), `text` (tiptap), `placeholder`, `buttonLabel`,
  `topics[].label`, `consentLabel` (tiptap).
- **Rendering**: a `<form method="post" action="/newsletter/subscribe">` with the hidden fields
  `returnTo` and `anchor` — the anchor of the enclosing `cms.Section`, when it has one
  (`useSectionAnchor()`). See [storefront-and-admin-api.md](./storefront-and-admin-api.md) §4.
- **Element ids** (T149): the field, error and consent ids, here and in `cms.NewsletterSignup`, are
  built from the block's id (`useId()` only without one), as the carousel's are (T141).

## `cms.Text` / `cms.RichContent` (extended, T134)

Both keep every field and gain `textMaxWidth` / `textMaxWidthPx`, as on `cms.Statement`, on the
Responsive tab. Unset, nothing is written and the text spans its column (today's look). On
`cms.Text` the measure follows the text's alignment per breakpoint (centred or at the end).
Nothing translatable is added.

## `cms.Video` (extended, T126)

Every field of `origin/master` is kept with its values; a stored video with no `source` is an
embed and renders today's markup.

| Prop | Type | Default |
| --- | --- | --- |
| `source` | `'embed' \| 'file'` | `'embed'` (unset is `embed`) |
| `url` | string: the embed's page URL; for a file, a direct file URL used when no library video is chosen | `''` |
| `provider` | `'auto' \| 'youtube' \| 'vimeo' \| 'generic'` (embed only) | `'auto'` |
| `videoAssetId`, `mobileVideoAssetId`, `posterAssetId` | asset ids (file only): the video, the one below the tablet tier, the poster | none |
| `fileSource`, `posterSource` | `'library' \| 'url'` (file only, T194): where the videos (`videoAssetId`, `mobileVideoAssetId` / `url`, `mobileUrl`) and the posters (`posterAssetId`, `mobilePosterAssetId` / `posterUrl`, `mobilePosterUrl`) come from. The chosen source's value wins and the other's is the fallback; unset reads as `library` (a library video or image wins over a URL, as before). The panel offers only the chosen sources' fields; an embed offers `url` and `provider` and none of them. A file stored with no source gets, from `resolveData`, the source its values imply — a URL set and no library asset is `url`, anything else `library` — which renders what it rendered | unset |
| `posterUrl` | string (file only, T194): the poster by URL, made absolute against the media origin | none |
| `mobileUrl` | string (file only, T142): the video below the tablet tier by URL, used when no `mobileVideoAssetId` is chosen; made absolute against the media origin as `url` is | none |
| `aspectRatio` | `Responsive<AspectToken>` without `auto`, on the Responsive tab (`createAspectRatioField`); today's `16:9`, `4:3`, `1:1` are tokens | `'16:9'` |
| `mediaCornerRadius` | `CornerRadius` (T140): the corners of the file frame, the embed's frame and its iframe; the box's `cornerRadius` stays the box's | `'medium'` (today's 8 px; unset reads the same) |
| `title`, `autoplay`, `muted`, `loop`, `controls`, `maxWidth`, `align`, box fields | as today | as today |

- **Embed**: one ratio at every breakpoint keeps today's padded frame; a ratio per breakpoint
  writes `--pb-ratio`, `--pb-ratio-md`, `--pb-ratio-lg` on `.cmsc-pb-video__frame`.
- **File**: a frame `.cmsc-pb-video__frame--file` reserving the ratio; one `<video>` per
  breakpoint (`data-bp="mobile"`/`"desktop"`, or `"all"`), each `preload="none"`, `playsinline`,
  with the poster and the title as `aria-label`, never the `autoplay` attribute. With `autoplay`
  the video is muted and marked `data-autoplay`; `useBreakpointVideo` starts the one for the
  current breakpoint only on screen and never under `prefers-reduced-motion`. Otherwise the visitor
  starts it (`controls`, today's default on). Nothing chosen renders no player for customers.
- **Translatable**: `title` (unchanged).

## `cms.Image` (extended, T127)

Every field of `origin/master` is kept; with none of the additions set, the block renders today's
single `<img>`, now with `loading="lazy"` and `decoding="async"`.

| Prop | Type | Default |
| --- | --- | --- |
| `mobileSrc` / `mobileAssetId` | the image below the tablet tier, from the same `imageSource` | `''` |
| `ratio` | `Responsive<AspectToken>` on the Responsive tab (`createAspectRatioField`); `auto` is the image's own ratio | unset (`auto`) |
| `overlay` | `SectionOverlay` (`none` / `solid` / `gradient`, `direction`, `strength`), black as the Section's | `{kind: 'none', direction: 'to-top', strength: 40}` |
| `caption` | string | `''` |
| `captionPlacement` | `'below' \| 'beside'` (shown once there is a caption) | `'below'` |

- A mobile image is a `<picture class="cmsc-pb-image__picture">` (`display: contents`) with a
  `<source media="(max-width: 767.98px)">`; a ratio other than `auto`, or an overlay, wraps the
  image in `.cmsc-pb-image__frame` (`--ratio` reserves the space per breakpoint; the overlay is an
  `aria-hidden` layer); a caption is a `<figure class="cmsc-pb-image__figure" data-caption>` with
  a `<figcaption>`. A link wraps the image, never the caption.
- **Full width** is the existing `widthMode: 'full'`; edge to edge is a Section with the
  **Bleed** width around the block.
- **Translatable**: `alt`, `caption`.

## Rich-text images (extended, T128)

The rich text image node (every `RichBody` and `cms.RichContent`) gains `size` (a width,
`/^(\d{1,4}px|(100|[1-9]?\d)%)$/`) and `align` (`'left' \| 'center' \| 'right'`), rendered as
`class="cmsc-rich-img cmsc-rich-img--<align>"` and `style="width: <size>"`; a new inline node
`inlineImage` (`src`, `alt`, `title`, `size`) sits in the line of text as
`<img class="cmsc-rich-img cmsc-rich-img--inline">`. An image stored before renders unchanged. The
sanitiser keeps a `width` declaration in px or % on an `<img>` only. The editor's image dialog
inserts or edits either kind.

T195: the stored node does not change. Where the host provides an image picker
(`PageBuilderImagePickerProvider` of `@endora-commerce/page-builder-core`, mounted by the admin's
`PageBuilderColorPaletteProvider` with the asset library), the dialog offers an **Image source**:
the library — the chosen asset's stable file URL (`fileUrl`, made absolute) is inserted as `src`,
and its alternative text in the admin's language as `alt` when the field is empty — or a URL.
Without a provider (the storefront, a test) only the URL. A new image starts on the library, an
existing one on its URL. The width's number takes the row; its unit select is a fixed 76 px.

T197: the editors' degradation merge (FR-019 of `specs/096-page-builder-block-ownership/`) reads
the components a document places — `countComponentNames`, an object with a string `type` beside a
`props` object — and no longer `countBlockNames`, whose every-`type` walk also offered the TipTap
nodes and marks of each rich-text prop (`doc`, `paragraph`, `text`, `image`, …) and so registered a
"(missing renderer)" block for each. The rename migrations and their report keep
`countBlockNames`.

## R8: text weight, heading measure, controls to the first slide (T150–T153)

Additions only; nothing is in any `defaultProps`, nothing is translatable (option-parity case
"R8 …", `fallback-parity.test.tsx` R8 cases).

| Prop | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `headingWeight` | `cms.MediaText`, `cms.BackgroundPanel`, `cms.CtaCard`, `cms.LinkList`, `cms.FeatureList`, `cms.Stats`, `cms.Statement`, and the carousel header (`cms.ContentSlider`, `catalog.ProductGrid`, `catalog.ProductSlider`, `blog.LatestPosts`) | `'default' \| 300 \| 400 \| 500 \| 600 \| 700 \| 800` (T151), an inline `font-weight` on the `BlockHeading` | unset = the size token's weight (today) |
| `headingMaxWidth` / `headingMaxWidthPx` | the same, except `cms.Statement` (its `textMaxWidth` already holds the heading) | `Responsive<'none' \| 'narrow' \| 'medium' \| 'wide' \| 'custom'>` + `Responsive<number>` (160–2000, shown only with Custom), Responsive tab, in `responsiveFields` (T152) | unset = full width (today) |
| `titleWeight`, `titleMaxWidth` / `titleMaxWidthPx` | `cms.Hero` | as above, on the title | unset = today's title |
| `titleWeight` | `cms.FeatureList` (every item title), `cms.LinkTile` | weight | unset = today's 600 |
| `captionWeight` | `cms.CarouselImage` | weight | unset = today's 600 |
| `labelWeight` | `cms.LinkTile` | weight | unset = today's |
| `cardTitleWeight` | `catalog.ProductGrid`, `catalog.ProductSlider` | weight, handed to every card as `CmsProductCardView.nameWeight` | unset = the card style's own |
| `controlsAlignTo` | `cms.ContentSlider`, `catalog.ProductSlider`, `blog.LatestPosts` (carousel only) | `'container' \| 'slide'` (T153) | unset = `'container'` (today) |

A held heading or hero title is `BlockHeading`/`HeroText` with the T134 measure
(`cmsc-text-max` + `--cmsc-text-max(-md|-lg)`, the editor's previewed tier inline) and, in a
centred or end-aligned block (`cms.Stats`, `cms.FeatureList`, `cms.Hero`), `data-align` so the
held box sits where the text does. A weight on an item text is one more property of the T144
`ItemText` span (no span when nothing is chosen). `controlsAlignTo: 'slide'` is the root class
`cmsc-pb-carousel--ctl-to-slide`: the rows below the track (`__controls--below`,
`__controls--dots`) take `width: var(--cmsc-slide-w)`, one slide's width, so their alignment
(`controlsAlign`) is the first slide's; header and overlay controls are unaffected.

T150 (bug R7-1): `.cmsc-pb-carousel` and `.cmsc-pb-product-card` join the zero-specificity
`font-family: var(--cmsb-font-body, inherit)` group of T122, so the filter bar, the header lead,
the controls and the card texts take the brand body font; with no brand font they inherit the
page's, as before.

## R8: tab bar overflow, column distribution, block order (T155, T156)

Additions only; nothing is in any `defaultProps`, nothing is translatable (option-parity case
"R8 tab bar overflow …", `fallback-parity.test.tsx` R8 cases; `block-declarations.test.ts` carries
each as non-prose).

| Prop | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `barOverflow` | `cms.Tabs` | `'wrap' \| 'scroll'`, General tab (T155) | unset = `'wrap'`, the T123 wrapping bar |
| `distribute` | `cms.Column` | `'start' \| 'center' \| 'end' \| 'space-between' \| 'last-to-bottom'`, General tab (T156) | unset = `'start'`, today's stack |
| `stackOrder` | every block wrapped by `withHideOn`, offered only when its parent is one of `BLOCK_ORDER_PARENTS` (`['cms.Column']`) | `Responsive<'auto' \| 'first' \| '1' … '6' \| 'last'>`, Responsive tab (T156); added by `withHideOn`'s `resolveFields`, so no block's static field set changes and it is not in any manifest's `responsiveFields` (a wrapper field, as `hideOn`) | unset = `'auto'`, the stored order |

- **Tabs, `scroll`**: the root gains `cmsc-pb-tabs--scroll`; the list stays one line
  (`flex-wrap: nowrap`, `overflow: auto hidden`, `max-width: 100%`, `scroll-snap-type: x proximity`),
  each tab `flex-shrink: 0; white-space: nowrap; scroll-snap-align: start`; a centred bar centres
  with auto margins (no unreachable start); the underline/boxed bar line is an inset shadow so the
  active underline still meets it inside the clip; the focus ring is drawn inside the tab. Roles,
  ids, roving tab index and arrow/Home/End keys are unchanged; a tab chosen with the pointer is
  `scrollIntoView({block: 'nearest', inline: 'nearest'})`. The tab focus ring of R-13
  (`.cmsc-pb-tabs__tab:focus-visible`), cut off by T146's insertion, is restored.
- **Column, `distribute`**: `data-pb-distribute` on `.cmsc-pb-row-col`; the column, its box, the
  box's `.cmsc-pb-bg-content` layer and the block stack become flex columns, the stack's
  `justify-content` (or `margin-top: auto` on its last block) distributes. The published slot is
  now named `cmsc-pb-column-stack` (also appended to the editing slot's classes); unset, nothing
  else changes. `cms.Row` is untouched (byte-identical to `origin/master`).
- **`stackOrder`**: the `withHideOn` wrapper gains `data-pb-order="1"` and
  `--pb-order(-md|-lg)` (`first` −1, `1`–`6`, `last` 99, `auto` 0; a missing tier inherits the one
  below), read as `order` per breakpoint by `.cmsc-pb-hide-on[data-pb-order]`; unset or `auto`
  everywhere, the wrapper's markup is byte-identical. A column stack holding an ordered block is a
  flex column (`.cmsc-pb-column-stack:has(> .cmsc-pb-hide-on[data-pb-order])`). **DOM and focus
  order stay the stored order** (CSS `order` is visual only, WCAG 1.3.2 / 2.4.3); the docs tell
  editors to reorder only where both orders make sense. The editor canvas keeps the stored order
  (Puck's own wrapper sits between the stack and the block), so drag-and-drop matches the outline.
- In a distributed or ordered column the blocks are flex items, so neighbouring vertical margins
  add up instead of collapsing; with neither option set the stack stays a block flow.

## R9: column order, feature titles, filter overflow, mobile posters (T159–T162)

Additions only; nothing is in any `defaultProps`, nothing is translatable (option-parity case
"R9 column order …", `fallback-parity.test.tsx` R9 cases; `block-declarations.test.ts` carries
each as non-prose).

| Prop | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `stackOrder` | `cms.Column` | `Responsive<'auto' \| 'first' \| '1' … '6' \| 'last'>`, the T156 vocabulary, labelled **Order in the row**, Responsive tab (T159); a static field of the Column, in `responsiveFields` of the registry and the cms manifest | unset = `'auto'`, the stored order |
| `featureTitleSize` / `featureTitleSizePx` | `cms.MediaText` | `Responsive<'default' \| TypeToken \| 'custom'>` + Custom px, Responsive tab, in `responsiveFields`; the px shows only once a tier is Custom (T160) | unset = today's 16 px |
| `featureTitleWeight` | `cms.MediaText` | `'default' \| 300–800`, one value (T160) | unset = today's 600 |
| `filter.overflow` | `cms.ContentSlider` | `'wrap' \| 'scroll'`, General tab, after `filter.align` (T161) | unset = `'wrap'`, today's wrapping bar |
| `mobilePosterAssetId` / `mobilePosterUrl` | `cms.Video` (file source only), `cms.Hero` `media`, `cms.MediaText` `media` and `rows[].media` (and `cms.CarouselSplit`, which shares that media) | an image asset id / an image URL (T162) | unset = the poster on every video |

- **Column order**: the published Column's grid cell (`.cmsc-pb-row-col`, which already carries
  the wrapper class `cmsc-pb-hide-on`) gains `data-pb-order="1"` and `--pb-order(-md|-lg)`, built by
  page-builder-core's newly exported `stackOrderAttributes` (the helper `withHideOn` uses), and read
  as `order` per breakpoint by the existing `.cmsc-pb-hide-on[data-pb-order]` rule — the Row's
  columns are grid items, so no stylesheet change. The field is page-builder-core's newly exported
  `createStackOrderField(label)`. Unset or `auto` everywhere: the cell's markup is unchanged.
  **DOM, reading and focus order stay the stored order** (CSS `order` is visual only, WCAG 1.3.2 /
  2.4.3); the docs tell editors to reorder only where both orders make sense. The editor canvas
  writes no order, so dragging a column matches the outline. `cms.Row` is untouched
  (byte-identical to `origin/master`).
- **Feature titles**: the title text goes through the shared `ItemText` (T144/T151) as
  `span.cmsc-pb-media-text__feature-title-text` (`display: block`) inside the unchanged `h3`, with
  the size token's class (`body` for a tier left on Default among chosen ones), `--pb-text-size*`
  published or the previewed tier's inline size in the editor, and an inline `font-weight`.
  Nothing chosen: no span, today's markup. Every row's titles share the one setting.
- **Filter overflow, `scroll`**: the bar gains `cmsc-pb-carousel__filter--scroll` — one line
  (`flex-wrap: nowrap`, `overflow: auto hidden`, `max-width: 100%`, `scroll-snap-type: x proximity`),
  each button `flex-shrink: 0; white-space: nowrap; scroll-snap-align: start`; centred and end
  alignment become auto margins (no unreachable start); underlined, the bar line is an inset shadow
  and the buttons lose the −1 px overlap; the focus ring is drawn inside the button. Toolbar,
  `aria-pressed`, the roving tab stop and the keys are unchanged; a button pressed with the pointer
  is `scrollIntoView({block: 'nearest', inline: 'nearest'})`.
- **Mobile poster**: the library image wins over the URL; a relative URL is made absolute against
  the media origin, as the videos' URLs are; unset, the poster. The mobile video of a pair takes it.
  One video with a mobile poster different from the poster renders the breakpoint pair of the same
  file (`data-bp="mobile"|"desktop"`, each `preload="none"`, so nothing loads twice) so the mobile
  frame shows its own still; the existing per-breakpoint display rules pick one. A mobile poster
  equal to the poster changes nothing. Admin: the hero and media-and-text media controls show a
  **Mobile poster image** picker and a **Mobile poster URL** input whatever the video source;
  `cms.Video` gets the library picker for `mobilePosterAssetId`.

## R9: cosmetic options (T163)

Additions only; nothing is in any `defaultProps`, nothing is translatable (option-parity case
"R9 tab size per breakpoint and the carousel arrow icon", `fallback-parity.test.tsx` R9 (T163)
cases; `block-declarations.test.ts` carries the props as non-prose).

| Prop / shape | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `tabSize` | `cms.Tabs` | `Responsive<'s' \| 'm' \| 'l'>`, Responsive tab, in `responsiveFields` of the registry and the cms manifest | unset = `tabStyle.size` if stored, else today's medium |
| `controls.arrowIcon` | `cms.ContentSlider`, `catalog.ProductSlider`, `blog.LatestPosts` (the shared `CAROUSEL_TRACK_FIELDS`) | `'chevron' \| 'arrow'`, General tab, after `controls.arrowSize` | unset = `'chevron'`, today's `‹` `›` glyphs |
| `inlineIcon` node | every `InlineRichText` (headings, titles, captions) | `{type: 'inlineIcon', attrs: {name}, marks?}` (data-model §3.5) | — |

- **Tab size**: `tabSize` replaces T132's `tabStyle.size` field (one control per concept); every
  value is kept. A stored `tabStyle.size` renders while `tabSize` is unset and is moved to `tabSize`
  by `resolveData` (`tabSizeMoved`). The phone's size writes T132's class (`cmsc-pb-tabs--size-s|l`,
  none for medium); a tablet / desktop size that differs from the breakpoint below adds
  `cmsc-pb-tabs--size-md-<s|m|l>` / `--size-lg-<s|m|l>`, applied from 768 / 1024 px with T132's
  paddings and font sizes (13/14/16 px) and the pill capsule's 24/28 px radius. One size for every
  breakpoint writes exactly T132's markup; the editor canvas writes its previewed tier's class.
- **Arrow icon**: `arrow` puts the icon catalog's `arrowLeft` / `arrowRight` (inline SVG,
  `aria-hidden`, `focusable="false"`, class `cmsc-pb-carousel__arrow-icon`, 0.8 em square) in the
  previous / next button in place of the glyph span; the button, its `aria-label`, its classes and
  the T129/T147 arrow look are unchanged. `carouselShellOptions` hands `arrowIcon` on only for
  `arrow`.
- **Inline icon**: the inline rich-text field's toolbar gains **Insert icon** (a searchable grid
  of the catalog); the editor shows the icon through a React node view. `InlineRich` renders
  `resolveCmsIcon(name)` as `<svg class="… cmsc-inline-icon" width="1em" height="1em"
  aria-hidden="true" focusable="false">` inside the node's marks; unknown names render nothing and
  the word reveal skips it. As HTML (clipboard, `getHTML()`, the DOM-free `tiptap-html.ts`) the
  node is `<span class="cmsc-inline-icon" data-cms-icon="<name>" aria-hidden="true"></span>`,
  identical through both serializers and parsed back (`inlineIconNode` in `rich-content-shared.ts`).
  CSS: `vertical-align: -0.125em`; inside a gradient emphasis (transparent text) the icon takes
  `var(--cmsb-link, #1261a6)`. The translation codec carries it as one atomic `<n/>` tag (no codec
  change; guarded by `tiptap-inline-codec.test.ts` and `extract.test.ts`).
- **Rich-text headings and the type scale**: `brandTokensToCss` writes, per heading level whose type
  style is set, `.cmsc-pb-rich-content hN, .cmsc-pb-rich hN, .cmsc-pb-hero__body hN,
  .cmsc-pb-feature-list__body hN {font-size: var(--cmsb-t-hN-size); line-height: …-lh;
  font-weight: …-w; letter-spacing: …-ls}` (only the numeric parts). It is not a stylesheet rule
  with literal fallbacks because a rich body's headings have no single look of today: they take
  the host page's heading styles (on the storefront the theme's base `h1`–`h3`), which an unlayered
  fallback would override. With no brand nothing is written, so every page looks as before.
- **Product card look: not extended.** The remaining differences recorded by the local rebuild are
  a "+" link glyph (the card link label already takes any text), a rule under each card and a
  tagline-length text (data: the product summary, which `cardTextLine: 'summary'` already shows).
  A card border/divider option would be a fifth styling axis on all four card styles of two
  listings for one site's look, against plan § *Extend, don't narrow* rule 4; recorded, not built.


## R10: column placement in the row's grid (T165)

Additions to `cms.Column` only; nothing is in `defaultProps`, nothing is translatable (option-parity
case "R10 column placement …"; `block-declarations.test.ts` carries each as non-prose). Each is a
static field on the Responsive tab, in `responsiveFields` of the registry and the cms manifest.
`cms.Row` is byte-identical to `origin/master`.

| Prop | Shape | Label | Default |
| --- | --- | --- | --- |
| `rowSpan` | `Responsive<1 \| 2 \| 3 \| 4>` | **Height in rows** | unset = 1 |
| `columnStart` | `Responsive<'auto' \| '1' … '12'>` | **Start at column** | unset = `'auto'`, the next free place |
| `rowStart` | `Responsive<'auto' \| '1' … '4'>` | **Start at row** | unset = `'auto'`, the next free place |

- **Markup**: when some breakpoint is not one row at the next free place, the published grid cell
  (`.cmsc-pb-row-col`) gains `data-pb-place="1"` and nine custom properties beside its span vars:
  `--pb-col-start(-md|-lg)`, `--pb-row-start(-md|-lg)` (`auto` or a number) and
  `--pb-row-span(-md|-lg)`; a missing or unreadable tier inherits the one below. A column start that
  would run past track 12 at that tier's span is clamped to `13 − span`. Unset (or 1 / `auto` on
  every tier): the cell's markup is unchanged, byte for byte.
- **Stylesheet**: `.cmsc-pb-row-col[data-pb-place] { grid-column: var(--pb-col-start, auto) / span
  var(--pb-col-span, 12); grid-row: var(--pb-row-start, auto) / span var(--pb-row-span, 1) }` with
  the `-md` / `-lg` tiers in the 768 / 1024 px queries, and
  `.cmsc-pb-row-cols:has(> .cmsc-pb-row-col[data-pb-place], > * > .cmsc-pb-row-col[data-pb-place])
  { grid-auto-flow: row dense }` — only a Row holding a placed column packs densely; every other
  Row keeps today's sparse flow.
- **Target layout** (owner gap list (a)1, `column-placement.test.tsx`, laid out from the built
  sheet with CSS Grid auto-placement): four columns `span {base: 12, desktop: 4}`; B and C
  `rowSpan {desktop: 2}`; D `columnStart {desktop: '1'}` (optionally `rowStart {desktop: '2'}`).
  Desktop: A (1, 1), B (5, 1–2), C (9, 1–2), D (1, 2). Below 1024 px: A, B, C, D stacked full width
  in the stored order. Nothing is duplicated.
- **DOM, reading and focus order stay the stored order** (grid placement is visual only, WCAG
  1.3.2 / 2.4.3); documented in `cms/index.md` § "Columns: placement in the row's grid". **Editor
  (decision, as T159)**: the canvas writes no placement, only its tier's span, so dragging a column
  matches the outline; the published page shows the placement.


## R10: card image box and divider, chevron read-more, full-width buttons (T168)

Additions only; nothing is in any `defaultProps`, nothing is translatable (option-parity case
"R10 card image box and divider, full-width buttons (T168)"; `fallback-parity.test.tsx` R10
(T168) cases; `block-declarations.test.ts` carries the button widths as non-prose). The owner's
R10 request supersedes the T163 note "Product card look: not extended" for the image box and the
divider only; the "+" glyph and the tagline stay data (the card link label, `cardTextLine`).

| Prop / shape | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `cardImageBackground` | `catalog.ProductGrid`, `catalog.ProductSlider` (`PRODUCT_LISTING_CARD_FIELDS`) | colour value (`#rrggbb` or `token:<role>`, `createColorField`), General tab | unset = the card style's own neutral (`--cmsb-n-50` `#f8fafc`, showcase `--cmsb-n-100` `#f1f5f9`) |
| `cardDivider` | same | `'none' \| 'line'`, General tab | unset = `'none'` |
| `cardDividerColor` | same | colour value, shown only with `'line'` (`resolveFields`) | unset = `var(--cmsb-border, var(--cmsb-n-200, #e2e8f0))` |
| `fullWidth` | `cms.Button` | `Responsive<'auto' \| 'full'>`, Responsive tab, top level, in `responsiveFields` of the registry and the cms manifest | unset = `'auto'` (fit the label) |
| `buttonsFullWidth` | `cms.Hero`, `cms.MediaText` (every row), `cms.CtaCard`, `cms.BackgroundPanel`, `cms.CarouselSplit` | `Responsive<'auto' \| 'full'>`, Responsive tab, block level (never inside the nested `ButtonSpec`), in `responsiveFields` | unset = `'auto'` |
| `readMore.attrs.summaryStyle` | every rich body (`RichContent` and the rich bodies of other blocks) | `'text' \| 'chevron'` (data-model §3.6) | `'text'`, today's summary |

- **Card look**: `CmsProductCardView` takes `imageBackground`, `divider` and `dividerColor`
  (`listingCardLook`). A valid colour (`colorValueToCss`, strict) is the media link's inline
  `background`; a line adds `cmsc-pb-product-card--divider` to the `<article>` and, with a colour,
  `--pb-card-divider`. CSS: `border-bottom: 1px solid var(--pb-card-divider, var(--cmsb-border,
  var(--cmsb-n-200, #e2e8f0)))` (also inside a colour scheme, where T139 recolours the card's
  border); a showcase card gets `padding-bottom: 16px`. Unset: no class, no style — today's markup.
- **Full width**: `buttonWidthClasses(value, tier, prefix)` (`button-full-width.ts`). The page
  writes the phone's class (`<prefix>--full`, none for `auto`) and `--md-<w>` / `--lg-<w>` where the
  tablet / desktop value differs from the breakpoint below (768 / 1024 px media rules); the editor
  canvas writes its previewed tier's only. `cms.Button` marks the button (`cmsc-btn--full`:
  `display: flex; width: 100%`); a list marks its container (`cmsc-btn-list--full`:
  `flex-direction: column; align-items: stretch`), via `ButtonRow`'s `fullWidth` and the Hero's
  actions row. Unset: no class.
- **Chevron read-more**: `summaryStyle: 'chevron'` renders `<details class="cmsc-read-more
  cmsc-read-more--chevron">` — one class, written identically by TipTap's `generateHTML` and the
  DOM-free `tiptap-html.ts`, parsed back from the class; the sanitiser is unchanged (`class` was
  already allowed). The summary keeps its text, the control's accessible name; the stylesheet makes
  the summary a 44 px box, drops the marker, pushes the text out of view (`text-indent: 100%`,
  `overflow: hidden`, `white-space: nowrap`) and draws a chevron (`::after`, `currentColor`, turned
  when `[open]`, no transition under reduced motion). The editor keeps the summary text visible and
  editable (node view `data-summary-style`); the toolbar's **Read more as a chevron** toggles it.

## R10: inline icon size and offset, background size, repeat and position (T166, T167)

Additive contracts changes; nothing is in any `defaultProps`, nothing is translatable, no migration
(option-parity case "R10 background size, repeat and position …"; `fallback-parity.test.tsx` R10
(T166, T167) cases; contracts `page-builder-props.test.ts`).

| Prop / attribute | Where | Shape | Default |
| --- | --- | --- | --- |
| `inlineIcon.attrs.size` | every `InlineRichText` | `'<0.25–3>em'` (up to two decimals) or `'<8–200>px'` (whole), or `null` | unset = `1em` |
| `inlineIcon.attrs.offset` | every `InlineRichText` | number, em of the text, −1–1, or `null` | unset = the stylesheet's `-0.125em` |
| `background.size` | `cms.Section`, `cms.SectionGroup` (image) | `'cover' \| 'contain' \| 'auto' \| {px: 1–4000} \| {percent: 1–400}` | unset = `cover` |
| `background.repeat` | same (image) | `'no-repeat' \| 'repeat' \| 'repeat-x' \| 'repeat-y'` | unset = no repeat |
| `background.decorativeSize`, `decorativeRepeat`, `decorativePosition` | same (with `decorative`) | the size and repeat above; a `FocalToken` | unset = `cover`, `no-repeat`, `top center` |

- **Inline icon (T166)**: `InlineRich` draws the SVG with `width`/`height` = `size` and, with an
  offset, `style="vertical-align:<offset>em"` (positive raises it); a value outside the grammar is
  ignored, so an icon with neither is T163's markup byte for byte (`inlineIconPresentation`, shared
  with the editor's node view). The TipTap node's attributes default to `undefined` (a stored
  `{name}` round-trips unchanged) and serialize as `data-cms-icon-size` / `data-cms-icon-offset`,
  identically through `generateHTML` and the DOM-free `tiptap-html.ts`, parsed back with the same
  check. The icon dialog (now translated through the page builder's field text, en + pl) sets
  **Icon size** (text size / em / px with its number, clamped into range) and **Vertical offset
  (em)** before an icon is picked; with an icon selected the toolbar button reads **Edit icon**, the
  dialog opens on its values, **Apply** writes size and offset, picking another icon replaces it.
  The translation codec still carries the node as one atomic `<n/>`, attributes included.
- **Background (T167)**: an image with `size` unset, `cover` or `contain` and no repeat stays the
  `<picture>` (`object-fit`; unset byte for byte); `auto`, px, % or any repeat paints one
  `<div class="cmsc-section__tile">` in the media layer (overlay unchanged above it) with
  `--cmsc-tile-image: url("…")`, `--cmsc-tile-image-mobile` when the mobile image differs (shown
  below 768 px by the stylesheet, as the picture's mobile source), and inline `background-size`,
  `background-repeat` and `background-position` (focal keyword; `top` = `top center`). The
  decorative layer's three values are written inline on the `<section>` or the group's
  `.cmsc-section-group__paint`, only when `decorative` is on and the value valid; over a gradient
  each is the first of a two-layer list followed by the gradient's (`cover`, `no-repeat`,
  `top center`). They live with the block's `decorative` toggle, not in the brand tokens. A size in
  px or % is the same at every breakpoint (no media query rewrites it). Editor: the background
  field gains **Image size** / **Image repeat** under an image and **Backdrop size** / **Backdrop
  repeat** / **Backdrop position** under the switched-on decorative toggle (cleared with it); `cover`,
  no repeat and `top` are stored as nothing.

## R11: tab hover look and panel change (T174)

Tests: `Tabs.test.tsx` "hover look and an animated panel change (T174)", `option-parity.test.ts`
"R11 tab hover look and panel change (T174)", `fallback-parity.test.tsx` R11 (T174),
`block-dom-ids-hydration.test.tsx` (unchanged, green).

| Prop | Block | Shape | Unset |
| --- | --- | --- | --- |
| `tabStyle.hoverBackground`, `tabStyle.hoverColor` | `cms.Tabs` | `ColorValue` (brand token or hex) | no hover change, no transition (today) |
| `effect` | `cms.Tabs` | `'none' \| 'fade' \| 'slide'` (adds `slide`) | `none` (default prop) |

- **Hover**: a valid colour writes `--cmsc-tabs-hover-bg` / `--cmsc-tabs-hover-fg` and the root class
  `cmsc-pb-tabs--hover`; inside `@media (hover: hover)` a tab that is not selected takes them under
  the pointer (fallbacks: its own background and colour), and `--hover` tabs get
  `transition: background-color 200ms, color 200ms` (none under reduced motion). Boxed tabs with a
  hover colour get the active tab's 6 px top radius. Nothing set: today's classes, no transition.
- **Panel change**: `fade` and `slide` put the panels in `<div class="cmsc-pb-tabs__panels">`
  (one grid cell, each panel `display: flow-root`, `hidden` ones `display: none`); `none` keeps
  today's markup (panels directly in `.cmsc-pb-tabs`). On a change the tab model (selected tab,
  roving tab index, focus) changes at once; the outgoing panel stays shown with `inert`,
  `aria-hidden="true"` and `cmsc-pb-tabs__panel--leaving` (fade out, `pointer-events: none`), the
  incoming one gets `cmsc-pb-tabs__panel--entering` (fade in), the box gets
  `cmsc-pb-tabs__panels--switching` (`overflow: hidden`, `transition: height 300ms`) and an inline
  height from the outgoing to the incoming panel's, all removed after 300 ms (the outgoing panel is
  `hidden` again). `slide` adds a 24 px `translateX` (`--cmsc-tabs-shift`), reversed by
  `cmsc-pb-tabs__panels--back` (an earlier tab) and mirrored under `[dir='rtl']`. A second change
  during one hides the first outgoing panel at once. Reduced motion, no `matchMedia` and the server:
  no change state, the switch is instant (the stylesheet also drops the animations and the height
  transition under reduced motion). Every panel stays in the server HTML.
- **Why the T059 fade looked instant**: it was a 200 ms `ease-out` fade-in of the incoming panel
  only (`:not([hidden])` animation), with the outgoing panel removed at once and the height
  jumping; measured in Chrome on the local rebuild it ran (opacity 0.14 → 0.99 over 200 ms) but
  read as a flash. That rule is removed; the crossfade above replaces it.

## R11: carousel ends and item hover colours (T171, T172); responsive values without `base` (T170)

Tests: `carousel/CarouselShell.test.tsx` "the ends: loop and disabled arrows (T171)",
`item-hover-color.test.tsx` (T172), `responsive-without-base.test.tsx` (T170),
`page-builder-core` `types/responsive.test.ts` and `fields/scoped-field.test.ts` (T170),
`option-parity.test.ts` "R11 carousel ends and item hover look (T171, T172)",
`fallback-parity.test.tsx` R11 (T171, T172).

| Prop | Block | Shape | Unset |
| --- | --- | --- | --- |
| `loop` | `cms.ContentSlider`, `catalog.ProductSlider`, `blog.LatestPosts` (shared `CAROUSEL_TRACK_FIELDS`; hidden for a grid) | `boolean` | wrap-around at the ends (today) |
| `controls.disabledArrowLook` | same | `'dim' \| 'outline-light' \| 'color'` | `dim` |
| `controls.disabledArrowColor` | same | `ColorValue` (brand token or hex), read with `color` | — |
| `captionHoverColor` | `cms.CarouselImage` | `ColorValue` | no hover change, no transition (today) |
| `titleHoverColor`, `labelHoverColor` | `cms.LinkTile` | `ColorValue` | no hover change, no transition (today) |

- **Loop** (T171): unset or `true` keeps today's behaviour, verified before the change — the
  previous arrow on the first page goes to the last page and the next arrow on the last page back
  to the first (`goTo` wraps modulo the page count). `false` clamps navigation to the first and last
  page; the arrow at an end gets the native `disabled` attribute (named as before, so a screen
  reader announces it as unavailable; out of the tab order). The previous arrow is disabled in the
  server HTML on the first page; the next one once the track is measured; both follow the page
  computed from the scroll position. An arrow disabled while it holds focus (or after the browser
  dropped its focus to the body) passes the focus to the other arrow of its group. Autoplay stops
  on the last page. `carouselShellOptions` passes `loop: false` only, and a disabled look only when
  it is not `dim` (`color` only with a valid colour).
- **Disabled look**: root class `cmsc-pb-carousel--arrow-off-light` or `--arrow-off-color` (+
  `--pb-arrow-off-color`) only when not looping; `.cmsc-pb-carousel__arrow:disabled` is dimmed
  (`opacity: 0.4`, `cursor: default`); `light` = transparent fill, `rgba(255, 255, 255, 0.4)`
  outline and glyph; `color` = transparent fill, outline and glyph in the colour. A looping
  carousel never has a disabled arrow, so its look is unchanged.
- **Hover colours** (T172): a valid colour (`colorValueToCss`) writes `--pb-caption-hover` with
  `cmsc-pb-carousel-image--hover-caption` on the `<figure>` (only when a caption is shown), and
  `--pb-title-hover` / `--pb-label-hover` with `cmsc-pb-link-tile--hover-title` / `--hover-label`
  on the tile (title only when it has text; label only for the text-link label style). The text
  takes the colour on `:hover` and keyboard focus (`:focus-within` for the image, whose link is
  inside; `:focus-visible` for the tile, which is the link), with `transition: color 0.2s ease`,
  none under `prefers-reduced-motion: reduce`. The caption's hover colour wins over its caption
  style's inline colour (`!important`, scoped to the opted-in class). Product card names are not
  covered: the card does not share the item text parts.
- **Responsive values without `base`** (T170): `{ tablet?, desktop? }` with no other key is a
  responsive value (`isResponsiveProp`); `normalizeResponsive` gives it the caller's fallback as
  its base, so the breakpoints below the first one with a value render as unset and the rest
  inherit upwards. Every renderer and CSS-variable writer that goes through `normalizeResponsive`
  / `resolveResponsive` (Section spacing, Column span and placement, carousel slides per view,
  gaps, alignments, sizes, ratios) reads it so; the hand-rolled readers (`cms.Button` style and
  fill, block alignment, `cms.FeatureList`'s legacy check, a block's `stackOrder`, the editor's
  scoped fields and the image ratio control) were moved onto `isResponsiveProp`. The contracts'
  `responsiveSchema` still describes what the editor writes (with `base`).

No schema, migration or API change; nothing translatable added.

## R11: read-more position and reveal above, accordion look, emphasis colour (T173, T175)

Additions only; nothing is in any `defaultProps`, nothing new is translatable (option-parity case
"R11 the accordion's icon, dividers, item style and title padding (T175)"; `fallback-parity.test.tsx`
R11 (T173, T175) cases; `block-declarations.test.ts` carries the accordion look as non-prose).

| Prop / shape | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `readMore.attrs.chevronPosition` | every rich body | `'start' \| 'center' \| 'end'` (data-model §3.6) | `'start'`, today's |
| `readMore.attrs.revealAbove` | every rich body | `boolean` | `false`, today's |
| `emphasis.attrs.color` | every inline rich text and rich body | colour value (`#rrggbb` or `token:<role>`), `null` = unset (data-model §3.5) | unset = the variant's colour |
| `icon` | `cms.Accordion` | `'plus' \| 'chevron'`, General tab | unset = `'plus'` (today's `+` / `−` glyph) |
| `itemStyle` | `cms.Accordion` | `'plain' \| 'boxed'` | unset = `variant`'s (`bordered` is boxed) |
| `dividers` | `cms.Accordion` | `'none' \| 'between' \| 'all'`, offered only for plain items (`resolveFields`) | unset = the style's own line under each item |
| `titlePadding` / `titlePaddingPx` | `cms.Accordion` | `Responsive<SpaceToken \| 'custom'>` + Custom px (0–160), Responsive tab, in `responsiveFields` of the registry and the cms manifest; the px shown only with Custom | unset = today's 12 px |

- **Read-more position and reveal above** (T173): `chevronPosition` `center` / `end` adds
  `cmsc-read-more--center` / `--end`, `revealAbove: true` adds `cmsc-read-more--reveal-above`, all on
  the `<details>` beside T168's class, written identically by `generateHTML` and the DOM-free
  `tiptap-html.ts` and parsed back from the classes; the sanitiser is unchanged (`class` was
  already allowed). The summary — text (`text-align`) or chevron (`margin-inline: auto` /
  `margin-inline-start: auto`) — moves on its line. Reveal above lays the `<details>` out as a
  flex column and gives the summary `order: 1`: the summary stays the first child in the DOM and
  the one control (keyboard, accessibility tree unchanged); a browser that cannot lay out a
  `<details>` as flex keeps today's order. The editor's node view marks `data-position` and
  `data-reveal-above` (the summary aligned, an arrow before it; the content stays below, to edit);
  the toolbar's **Read more position** select and **Show the revealed text above the summary**
  toggle set them (page builder field text, en + pl).
- **Animated open and close** (T173, T175): a read-more passage animates `::details-content`'s
  `block-size` between 0 and `auto` (`interpolate-size: allow-keywords`, `content-visibility`
  transitioned `allow-discrete`), inside `@media (prefers-reduced-motion: no-preference)` and
  `@supports (interpolate-size: allow-keywords) and selector(::details-content)` — no script, and
  instant elsewhere. An accordion panel animates `height`, `padding-bottom` and `opacity` with
  `display` transitioned `allow-discrete` and `@starting-style` for the opening, under the same
  media and `@supports (interpolate-size: allow-keywords)`, and only under `[data-animate]`, which
  the component sets after hydration — so a panel open by default never animates in on page load.
  `hidden` stays the closed state: every panel is in the server HTML and a closed one is out of
  the accessibility tree. While animating the panel clips (`overflow: clip`,
  `overflow-clip-margin: 4px`).
- **Accordion look** (T175): root classes `cmsc-pb-accordion--chevron`, `--plain` / `--boxed`,
  `--dividers-<none|between|all>` (only for plain items) and `--title-pad` with
  `--cmsc-acc-pad(-md|-lg)` (`gapVars`, a token's `var(--cmsb-space-<token>, <px>)`); none when
  unset, so an accordion without them is byte-identical to before. The chevron is an empty
  `aria-hidden` span drawn in `currentColor`, turned by the trigger's `aria-expanded` (no
  transition under reduced motion), pushed to the line's end with the end position. Boxed items:
  bordered box (8 px radius, 8 px apart) with the title and panel inset 16 px. Every border reads
  `var(--cmsb-n-200, #e2e8f0)` as today's line.
- **Emphasis colour** (T175): the mark's `color` renders `data-cms-em-color="<stored value>"` and
  `style="color: <css>"` (a token as `var(--cmsb-color-<role>, <literal>)`) on the variant's span,
  in `InlineRich` (React) and through the TipTap mark (both serializers); anything outside the
  grammar renders today's span. The parse rule (priority 60) reads the colour back from the
  attribute ahead of `textStyle`, so a coloured phrase stays one mark. The sanitiser keeps
  `data-cms-em-color` on a `<span>` only with a colour value (the inline `color` declaration was
  already allowed). The stylesheet's `.cmsc-em[data-cms-em-color] { background-image: none;
  -webkit-text-fill-color: currentColor }` lets the colour replace a gradient. Translation: no
  codec change — the mark, attributes included, travels in the numbered tag
  (`tiptap-inline-codec.test.ts` guard). Editor: the inline toolbar's **Highlight colour** dialog
  (brand role swatches, a hex text box and picker, **Remove colour**; page builder field text,
  en + pl) runs `setEmphasisColor(color | null)`, which keeps the variant (`accent` where none).

## R12: animated reveal above, resting tile colours, accordion title colour, divider position and icon size (T177–T179)

Additions only; nothing is in any `defaultProps`, nothing new is translatable (option-parity case
"R12 resting tile colours, the accordion's title colour, divider position and icon size (T178,
T179)"; `fallback-parity.test.tsx` R12 (T177–T179) cases; `block-declarations.test.ts` carries the
new props as non-prose).

| Prop / shape | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `titleColor` / `labelColor` | `cms.LinkTile` | colour value (`#rrggbb` or `token:<role>`), each before its hover colour | unset = today's title and label colours |
| `titleColor` | `cms.Accordion` | colour value | unset = inherited, today's |
| `dividerPosition` | `cms.Accordion` | `'item' \| 'title'`, offered only for plain items (`resolveFields`) | unset = `'item'`, today's line under the item |
| `iconSize` / `iconSizePx` | `cms.Accordion` | `'s' \| 'm' \| 'l' \| 'custom'` (16 / 20 / 24 px) + Custom px (8–64), the px shown only with Custom | unset = the trigger's text size, today's |

- **Reveal above animates** (T177, defect B4 of the seventh rebuild): a `<details>` revealed above
  is a flex column, so its `::details-content` is a flex item whose `min-block-size: auto` held it
  at its content height — it opened in one frame and closed only after the transition. Inside the
  T173 animation block (same media and feature queries) the stylesheet sets
  `details.cmsc-read-more--reveal-above::details-content { min-block-size: 0 }`. Nothing else
  changes; outside the block the passage is as before.
- **Resting tile colours** (T178): a valid colour (`colorValueToCss`) writes `--pb-title-color` /
  `--pb-label-color` and `cmsc-pb-link-tile--title-color` / `--label-color` on the tile (the title
  only with text, the label only for the text-link style — a button label keeps the button's
  colours). The stylesheet's resting rules precede T172's hover rules, which are also more
  specific, so a hover colour still applies on hover and keyboard focus. Unset: byte-identical
  markup.
- **Accordion title colour, divider position, icon size** (T179): root classes
  `cmsc-pb-accordion--title-color` (+ `--cmsc-acc-title`; the trigger's `color`, which the icon,
  drawn in `currentColor`, follows), `--divider-title` (written only when the items have a line:
  not boxed, `dividers` not `none`, and not `flush` with `itemStyle` unset) and `--icon-size`
  (+ `--cmsc-acc-icon: <px>`; the icon's `font-size`, a chevron being 1 em square). Under the
  title, the item's bottom line moves to its trigger (`border-bottom: 1px solid
  var(--cmsb-n-200, #e2e8f0)`), `between` keeps it off the last title and drops its line above
  the next item, `all` keeps the line above the first item; the panel gets 12 px above its
  content, animated with the panel (`padding-top` 0 while closed and in `@starting-style`). An
  invalid colour, an unknown value or Custom without a positive px writes nothing: unset is
  byte-identical to before.

## R13: resting tile colours per breakpoint, accordion spacing and title weight (T181–T183)

Additions only; nothing is in any `defaultProps`, nothing new is translatable (option-parity case
"R13 resting tile colours per breakpoint, the accordion's spacing and title weight (T181–T183)";
`fallback-parity.test.tsx` R13 cases; `block-declarations.test.ts` carries the new props as
non-prose).

| Prop / shape | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `titleColor` / `labelColor` | `cms.LinkTile` | colour value **or** `Responsive<colour value>` (since T181; Responsive tab, `responsiveFields`) | unset = today's title and label colours |
| `panelGap` / `panelGapPx` | `cms.Accordion` | `Responsive<SpaceToken \| 'custom'>` + Custom px (0–160), the px shown only with Custom (Responsive tab) | unset = today's: no space above a panel, 12 px under a title line |
| `itemGap` / `itemGapPx` | `cms.Accordion` | `Responsive<SpaceToken \| 'custom'>` + Custom px (0–160), the px shown only with Custom (Responsive tab) | unset = today's: none between plain items, 8 px between boxed ones |
| `titleWeight` | `cms.Accordion` | `'default' \| 300 \| 400 \| 500 \| 600 \| 700 \| 800` (the shared `textWeightField`), after `titleColor` | unset / `default` = the trigger's semibold, today's |

- **Resting tile colours per breakpoint** (T181): the field is the new core
  `createResponsiveColorField` (responsive metadata; edits the scope the Responsive tab selects;
  a breakpoint set first is stored without `base`, a value with only its base is stored plain,
  clearing the last colour stores nothing). A single stored colour renders exactly as in T178
  (`--pb-title-color` + `cmsc-pb-link-tile--title-color`). A responsive value writes, for each
  tier with a valid colour of its own, `--pb-title-color` / `-md` / `-lg` and the class
  `cmsc-pb-link-tile--title-color` / `--title-color-md` / `--title-color-lg` (the label's the
  same); `-md` applies from 768 px up, `-lg` from 1024 px up, a tier without one keeps the colour
  below it or the tile's own look (a value without `base`, T170). An invalid tier writes nothing.
  The tier rules precede T172's hover rules, which are more specific, so a hover colour still
  wins. The editor resolves the previewed tier (its own colour, else the nearest below) into the
  base variable. A button label keeps the button's colours at every breakpoint.
- **Accordion spacing** (T182): a chosen gap writes `cmsc-pb-accordion--panel-gap` /
  `--item-gap` and `--cmsc-acc-panel-gap` / `--cmsc-acc-item-gap` with `-md` / `-lg` (`gapVars`;
  a tier left unset gets today's value as the fallback: 0 or 12 px under a title line for the
  panel, 0 or 8 px for boxed items). The panel's `padding-top` reads it (after T179's 12 px rule,
  so it wins), animated with the panel (`padding-top` 0 while closed and in `@starting-style`);
  every item but the last takes `margin-bottom` from it (the last keeps today's). Unset:
  byte-identical markup.
- **Accordion title weight** (T183): `textWeightCss` → an inline `font-weight` on every
  `.cmsc-pb-accordion__title` (beside a Custom size's own inline size; over a size token's
  weight). Default, unset or an unknown value: no style, byte-identical.

## R14: accordion title weight per breakpoint, panel bottom space and open-item gap (T185, T186)

Additions only; nothing is in any `defaultProps`, nothing new is translatable (option-parity case
"R14 the accordion's title weight per breakpoint, panel bottom space and open-item gap (T185,
T186)"; `fallback-parity.test.tsx` R14 cases; `block-declarations.test.ts` carries the new props
as non-prose).

| Prop / shape | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `titleWeight` | `cms.Accordion` | `TextWeight` **or** `Responsive<TextWeight>` (since T185; same options, Responsive tab, `responsiveFields`) | unset / `default` = the trigger's semibold, today's |
| `panelPaddingBottom` / `panelPaddingBottomPx` | `cms.Accordion` | `Responsive<SpaceToken \| 'custom'>` + Custom px (0–160), the px shown only with Custom (Responsive tab) | unset = today's 12 px below an open panel |
| `openItemGap` / `openItemGapPx` | `cms.Accordion` | `Responsive<SpaceToken \| 'custom'>` + Custom px (0–160), the px shown only with Custom (Responsive tab) | unset = the item gap (today's: none between plain items, 8 px between boxed ones) |

- **Title weight per breakpoint** (T185): the weight at each tier is `textWeightCss` of the
  resolved tier value (`resolveResponsive`; `default`, unknown or unset = none). No tier with a
  weight: nothing is written. The same weight at every tier (a plain value, one stored with only
  its `base`, or equal tiers): T183's inline `font-weight` on every title, byte-identical. Weights
  that differ: the root gets `cmsc-pb-accordion--title-weight` and
  `--cmsc-acc-title-weight` / `-md` / `-lg`, every tier written, a tier with no weight of its own
  given today's — `600` (the trigger's) or, for a sized title, its token's
  `var(--cmsb-t-<token>-w, <literal>)`; the titles carry no inline weight. The rules (title under
  the trigger, with or without a heading, child combinators so a nested accordion is not
  reached) read the variable from 768 / 1024 px up. The editor resolves the previewed tier into
  an inline weight.
- **Panel bottom space** (T186): a chosen value writes `cmsc-pb-accordion--panel-bottom` and
  `--cmsc-acc-panel-bottom` / `-md` / `-lg` (`gapVars`, today's 12 px for a tier left unset); the
  panel's `padding-bottom` reads it after the base `padding: 0 0 12px` rule. It closes and opens
  with the panel through T175's animated `padding-bottom` (0 while `[hidden]` and in
  `@starting-style`, more specific).
- **Open-item gap** (T186): a chosen value writes `cmsc-pb-accordion--open-gap` and
  `--cmsc-acc-open-gap` / `-md` / `-lg`, a tier with no value of its own given the item gap there
  (`gapCss` of `itemGap`, or today's 0 / 8 px boxed). Every item but the last whose panel is open
  (`:has(> .cmsc-pb-accordion__panel:not([hidden]))`) takes its `margin-bottom` from it, after
  and more specific than T182's item gap; once interactive (`data-animate`, no reduced motion)
  the item's `margin-bottom` transitions over the panel's 250 ms. Unset: byte-identical markup.

## R14: tile title and label weight and caption weight per breakpoint (T188)

Widening only; nothing is in any `defaultProps`, nothing new is translatable, no new label
(option-parity case "R14 the tile's title and label weight and the caption weight per breakpoint
(T188)"; `fallback-parity.test.tsx` R14 (T188); `block-declarations.test.ts` carries the three
per breakpoint as non-prose).

| Prop / shape | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `titleWeight` / `labelWeight` | `cms.LinkTile` | `TextWeight` **or** `Responsive<TextWeight>` (since T188; same options, Responsive tab, `responsiveFields`) | unset / `default` = the tile's semibold title and label, today's |
| `captionWeight` | `cms.CarouselImage` | `TextWeight` **or** `Responsive<TextWeight>` (since T188; same options, Responsive tab, `responsiveFields`) | unset / `default` = the caption's own weight, today's |

- **Item text weight per breakpoint** (T188), the T185 pattern in the shared item text
  (`ItemText`, which renders the three): the weight at each tier is `textWeightCss` of the
  resolved tier value (`default`, unknown or unset = none). No tier with a weight: nothing is
  written (no span when nothing else is chosen). The same weight at every tier: T151's inline
  `font-weight` on the text's span, byte-identical. Weights that differ: the span gets
  `cmsc-pb-item-weight` and `--pb-item-weight` / `-md` / `-lg`, every tier written, a tier with
  no weight of its own given today's — a sized text's token weight
  `var(--cmsb-t-<token>-w, <literal>)`, else `initial`, which leaves the declaration invalid at
  computed-value time so the span inherits the item's own weight (the tile's 600, the caption's
  or its caption style's), as the text did with no span; no inline weight. Each tier's rule
  reads only its own variable (from 768 / 1024 px up), after the type tokens' weights. The editor
  resolves the previewed tier into an inline weight. In the editor field list the three move to
  the responsive group (a hover colour now follows the font).

## R15: post card look, lead and header button placement (T189)

Widening only; nothing is in any `defaultProps`, nothing new is translatable (option-parity case
"R15 the post card's look and the header button's placement (T189)"; `fallback-parity.test.tsx`
R15 (T189); backend `blog/block-declarations.test.ts` carries every new prop as non-prose). Labels
en + pl in the `blog` bundle (`blocks.latestPosts.fields.*`).

| Prop / shape | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `cardBackground` | `blog.LatestPosts` | colour value (hex or `token:<role>`, `colorValueToCss`) | unset = the scheme's background (`--cmsb-bg`, `#fff`) |
| `cardRadius` | `blog.LatestPosts` | `CornerRadius` (`none` / `small` / `medium` / `large`) | unset = today's 8 px |
| `cardPadding` / `cardPaddingPx` | `blog.LatestPosts` | `Responsive<SpaceToken \| 'custom'>` + `Responsive<number>` (0–80), Responsive tab | unset = none |
| `cardTextPadding` / `cardTextPaddingPx` | `blog.LatestPosts` | as above; the space above and beside the text | unset = today's 16 px above, none beside |
| `imageRatio` | `blog.LatestPosts` | aspect token or custom `w:h` (not `auto`), `Responsive<string>`, `createAspectRatioField` | unset = 2:1 |
| `hoverZoom` | `blog.LatestPosts` | `boolean` | unset / `false` = no zoom |
| `chipStyle` | `blog.LatestPosts` | `'filled' \| 'outline' \| 'none'` | unset / `filled` = today's chip |
| `cardTitleSize` / `cardTitleSizePx` / `cardTitleWeight` | `blog.LatestPosts` | `SectionTextSize` (`default` first) + px (10–80) + `TextWeight`, each per breakpoint | unset / `default` = today's title |
| `readMoreIcon` / `readMoreAlign` / `readMoreWeight` | `blog.LatestPosts` | `'none' \| 'arrow' \| 'plus'`, `'start' \| 'end'`, `TextWeight` | unset = no icon, start, today's 600 |
| `leadSize` / `leadSizePx` / `leadColor` | `blog.LatestPosts` | `SectionTextSize` + px (10–80) per breakpoint, colour value | unset = today's lead |
| `headerButtonPlacement` | `blog.LatestPosts` | `Responsive<'below' \| 'end' \| 'after'>` | unset / `below` = under the lead, today's |
| `headerButtonFullWidth` | `blog.LatestPosts` | `Responsive<'auto' \| 'full'>` (`buttonWidthField`) | unset / `auto` = fit the label |

- **Root classes and variables** (`latestPostsLook`): `--cmsc-post-card-bg`,
  `--cmsc-post-card-radius`, `cmsc-pb-latest-posts--zoom`, `--card-pad` + `--cmsc-post-card-pad`
  (`-md` / `-lg`; `gapVars`, 0 px where a tier is unset), `--text-pad` + `--cmsc-post-text-top` /
  `--cmsc-post-text-side` (`-md` / `-lg`; today's 16 px / 0 px where a tier is unset),
  `--cmsc-post-ratio` (`-md` / `-lg`), `--chip-outline`, `--more-end`, `--lead-color` +
  `--cmsc-lp-lead-color`. The editor writes the previewed tier's values only, without suffixes.
  The stylesheet's fallbacks are today's literals (`var(--cmsc-post-card-radius, 8px)`,
  `var(--cmsc-post-card-bg, var(--cmsb-bg, #fff))`, `var(--cmsc-post-ratio, 2 / 1)`); the padding
  rules are longhands so each side reads its variable.
- **Card markup**: unchanged when unset. The title's text is wrapped by `ItemText`
  (`cmsc-pb-post-card__title-text`) only when a size or weight is chosen; an icon adds
  `cmsc-pb-post-card__more--icon` and an `aria-hidden` SVG (`cmsc-pb-post-card__more-icon`); a
  read-more weight is an inline `font-weight`; `chipStyle: 'none'` renders no chip.
- **Header button placement**: `cmsc-pb-latest-posts--action-<p>` for the narrowest width,
  `--md-action-<p>` / `--lg-action-<p>` where a breakpoint differs from the one below. `end` lays
  the header content out as two columns (heading and lead, then the button level with the lead's
  last line); `after` hides the header's button and shows a copy in
  `.cmsc-pb-actions.cmsc-pb-latest-posts__action` after the carousel (and its controls) or the
  grid, rendered only when some breakpoint uses it. `headerButtonFullWidth` adds T168's
  `cmsc-btn-list--*` classes to both button rows. The shared `carouselHeaderNode` /
  `CarouselHeaderBlock` take optional `{ lead, button, actionClassNames }`; other blocks call them
  as before.

## R17: one settings panel (T198–T220)

Owner's UX audit of the settings panel, 2026-10-27. Plan § *Extend, don't narrow* holds: every
stored page renders byte for byte as before (the local reference page's offline render, its stored
tree and the tree after `resolveAllData`, are identical with the R17 build). Nothing below is
translatable prose (links, gaps, alignment, weights, sources, colours).

| Prop / shape | Blocks | Shape | Stored before R17 reads as |
| --- | --- | --- | --- |
| `link` | `cms.Image`, `cms.Icons`, `cms.AnnouncementBar`, each `cms.LogoStrip` item | `LinkValue` (§3.1) | `href: string` (+ the image's and icon's `linkTarget`) = a link of kind `url` with that target; a logo's `href` = `{ kind: 'url', href, target: '_blank' }` (a logo always opened a new tab). The editor's `resolveData` carries it into `link` and clears `href` / `linkTarget`. |
| `markers[].link` | `cms.Map` | `string \| LinkValue` | a string = a link of kind `url` (carried by `resolveData`). The popup shows the label (or the address) as a link, built as DOM nodes. |
| `gap` / `gapPx` | `cms.Social`, `cms.LogoStrip`, `catalog.ProductGrid`, `catalog.CategoryGrid` | `Responsive<SpaceToken \| 'custom' \| number>` + `Responsive<number>`, Responsive tab | a number of px = that gap; `resolveData` stores it as `'custom'` + `gapPx` per breakpoint (`numericGapAsCustom`); `gapCss` reads both alike. |
| `align` | `cms.Icons`, `cms.Social`, `cms.LogoStrip`, `cms.FeatureList`, `cms.Stats`, `cms.Statement`, `cms.Hero`, `cms.Tabs` | the block's values, now `Responsive<…>`, Responsive tab | a plain value = every breakpoint's |
| `headingWeight`, `titleWeight` (feature list, hero), `featureTitleWeight` | every `BlockHeading` block, `cms.FeatureList`, `cms.Hero`, `cms.MediaText` | `TextWeight \| Responsive<TextWeight>`, Responsive tab, next to the size | a plain weight = every breakpoint's |
| `equalItemHeight` | `catalog.ProductGrid`, `catalog.CategoryGrid` | `boolean \| Responsive<boolean>`, Responsive tab | a boolean = every breakpoint's |
| `media.posterSource` / `media.posterUrl` | `cms.MediaText` (and each row), `cms.CarouselSplit` | `'library' \| 'url'` + string | unset = today's (the library image before a URL) |
| `defaultOpen` / `defaultTab` | `cms.Accordion` / `cms.Tabs` | unchanged (`number`; the accordion's may be a stored list) | chosen in a select of the items (`createItemIndexField`); a stored list reads as its first element in the select and is kept until changed |

- **Markup.** Unchanged for every stored value. New values only: a link of another kind renders
  its `resolveLinkHref` address (a URL too since R18, T221 — see below); weights
  that differ per breakpoint wrap the text in one span `cmsc-pb-item-weight` with
  `--pb-item-weight(-md|-lg)` (`responsiveWeightProps`, `WeightSpan`); gaps that differ go on
  `cmsc-pb-gap-tiers` with `--pb-gap(-md|-lg)` (`responsiveGapStyle`); alignments that differ add
  `data-align-md` / `data-align-lg` (the hero's content and the feature list's and stats' grid also
  `cmsc-pb-text-align`; the statement its own rules; the logo strip
  `cmsc-pb-logo-strip--align-tiers`; the tabs `cmsc-pb-tabs--align-md-*` / `--align-lg-*`).
- **Defaults of new blocks** (stored blocks keep theirs): `cms.Text` has no `color`;
  `cms.Icons.color` and `cms.Social.color` are `'currentColor'`; `cms.AnnouncementBar` takes
  `token:primary` / `token:on-primary`; `cms.Image.imageSource` is `'library'`; new gaps are
  `'custom'` with today's px.
- **Fields shown only where they apply** (`resolveFields`, cached field objects so Puck keeps
  focus): `withoutUnusedCarouselFields` (interval, arrow look, disabled-arrow look and colour,
  controls placement and alignment); caption look of `cms.CarouselImage`; `imageSide` of
  `cms.CtaCard`; `contentPosition` of `cms.Row` (with a minimum height at some breakpoint);
  `dividerPosition` of `cms.Accordion` (where items have lines); `muted` of a self-hosted video that
  autoplays; `color` of `cms.Social` with brand colours on.
- **Editor-only**: every true/false setting is a switch (`createToggleField`, `ToggleSwitch`,
  `metadata.pageBuilder.toggle`), storing the same booleans; `withHideOn` re-adds "Hide on" to a
  block's constant field set; shared fields carry `metadata.pageBuilder.sharedLabel` and are
  translated once from `core` (`pageBuilder.sharedFields.<key>`).

## R18: safe URLs in every link, an inherited colour (T221–T222)

- **Links (T221, owner decision).** `blockLinkTarget` resolves every kind through
  `resolveLinkHref`, so a URL in `cms.Image`, `cms.Icons`, `cms.AnnouncementBar`, each
  `cms.LogoStrip` item and `cms.Map` markers passes `isSafeLinkUrl` (`https:`, `http:`, `mailto:`,
  `tel:`, root-relative `/…`), stored as `href` (+ `linkTarget`) or as a `url` link alike. Anything
  else (`javascript:`, `data:`, `vbscript:`, `//host`, a scheme-less relative path, a bare
  `#fragment`) renders **no link**: the image, icon, logo, text or marker label stays unlinked. A
  safe URL renders byte for byte as before (trimmed, as every other link's). `cms.Social` keeps a
  plain `url` per item: an unsafe one is its missing URL (`href="#"`, the block's existing
  placeholder; the icon and its name stay).
- **Colour (T222).** `createColorField({ label, inherit: true })` — the empty state is
  `currentColor`; the control shows `currentColor` / `inherit` as an empty box with the
  "Inherited (text color)" placeholder, `data-pb-color-inherited` on the row and an inherited swatch
  (`data-pb-color-swatch-inherited`), and offers **Inherit** (an emptied box does the same) to
  write `currentColor` again. `cms.Icons.color` and `cms.Social.color` use it; their stored default
  stays `'currentColor'` (an unset colour still renders the `#15202b` fallback of blocks stored
  before T216, so unset cannot mean "inherit"). Other colour fields: a stored `currentColor` /
  `inherit` reads as inherited, an emptied box stores nothing as before; the `transparent`
  placeholder is translated (`pageBuilder.fieldText.color.transparent`).

## R19A: text and content options (T223–T239)

Every option is optional; unset (or `default`) writes nothing, so a stored block's markup is
byte-identical. Sizes are a type token or `custom` + `…Px`; sizes, weights, line heights, max
widths and px spaces are per breakpoint (Responsive tab, declared in `responsiveFields`).

- **Shared text style (T223, `textStyleAttrs`).** Size (font size only: the token's
  `var(--cmsb-t-<token>-size, <px>)` or the px), weight (300–800), line height (0.8–3) and colour
  on the text element: one value for every breakpoint is inline; values that differ add
  `cmsc-pb-ts-size` / `-weight` / `-leading` and `--pb-ts-<name>(-md|-lg)`, every tier written, a
  tier on Default carrying the block's own value. The rules close the stylesheet.
- **`cms.FeatureList` (T224, T225).** `bodySize`/`bodySizePx`, `bodyWeight`, `bodyLineHeight`,
  `bodyColor` on `.cmsc-pb-feature-list__body`; `titleLineHeight` on the title; `iconSpacePx` /
  `titleSpacePx` as `--cmsc-fl-icon-space` / `--cmsc-fl-title-space(-md|-lg)` on the list (today's
  8 px / 4 px as fallbacks); `iconPosition: 'beside'` writes `data-icon-position="beside"` on the
  list: each item is a two-column grid, the icon spanning the title and the text rows, baseline
  aligned, the gap `--cmsc-fl-icon-space` (12 px fallback).
- **Hanging inline icon (T226).** `InlineRich`'s `hangingIcon`: a text whose first node is an
  inline icon renders `<span class="cmsc-hang"><span class="cmsc-hang__icon">…</span><span
  class="cmsc-hang__text">…</span></span>` (the whitespace after the icon dropped; inline-flex,
  baseline, gap `--cmsc-hang-gap`, 0.35em). `cms.Heading.hangingIcon` (switch) and
  `hangingIconGapPx` (shown with it on).
- **`cms.Hero` (T227–T230).** `subheadingWeight` / `statementWeight`, `…LineHeight`,
  `…MaxWidth` / `…MaxWidthPx` (as the title's); `bodySize` (Default = today's 16 px) /
  `bodySizePx`, `bodyWeight`, `bodyLineHeight`, `bodyMaxWidth` / `bodyMaxWidthPx` on
  `.cmsc-pb-hero__body`. `gaps` offers `custom` with `gapsPx` (a Custom tier with no px reads as
  `m`, as an unknown value always did). With image or video media `above`, `mediaSpace` (spacing
  token or `custom` + `mediaSpacePx`) writes `--cmsc-hero-media-space(-md|-lg)`, read as the
  media's `margin-bottom` (0 fallback); the fields show only then. The social-proof image's 40 px
  height now out-ranks `.cmsc-picture > img` (`.cmsc-pb-hero__proof > .cmsc-pb-hero__proof-image
  > img`).
- **`cms.Statement` (T231).** Over a background image, `minHeight` (`default` = 60vh, `auto`,
  `half`, `tall`, `screen`, `custom` + `minHeightPx`) as `--cmsc-statement-min-h(-md|-lg)` on the
  root; `headingLineHeight`; `bodySize`/`bodySizePx` (Default 18 px), `bodyWeight`,
  `bodyLineHeight`, `bodyColor`.
- **`cms.Text` (T232).** `text` is the inline rich-text field (`canvas: true`); a document renders
  through `InlineRich` in the same `<p>`, a stored string as before. Translatable path `text`
  becomes `format: 'tiptap'`.
- **Rich text (T233).** Mark `textSize` (`attrs.size`): a type token →
  `<span class="cmsc-fs cmsc-fs--<token>">`, `'<8–200>px'` → `<span class="cmsc-fs"
  style="font-size: Npx">` (the sanitizer keeps `font-size` in px on a `<span>` only). Bullet list
  `listStyle`: `check` (as before), `chevron` (`›`), `none` → `cmsc-list--<marker>`. The editor's
  toolbar: **Text size** select (+ px input) and **List marker** select (core
  `pageBuilder.fieldText.textSize*` / `listMarker*`). `cms.RichContent.textSize` / `textSizePx`
  size the prose.
- **Gradient emphasis (T234).** `.cmsc-em--gradient` uses `box-decoration-break: slice`: one
  gradient across a wrapped run (a one-line run renders as before).
- **`cms.Stats` (T235).** `labelSize`/`labelSizePx`, `labelWeight`, `labelColor`; with an image,
  from 768 px: `imageSpan`, `figuresSpan`, `figuresOffset` (any set →
  `cmsc-pb-stats-block--columns`, a 12-column grid with `--cmsc-stats-media-col` /
  `--cmsc-stats-figures-col`, mirrored for `imageSide: 'end'`; unset ones: image 6, offset 0,
  figures the rest) and `figuresAlign` (`data-figures-align`: `start`, `end`, `spread` — the grid's
  rows `space-between` over the image's height; `center`/unset writes nothing).
- **`cms.LinkList` (T236).** `titleSize`/`titleSizePx`, `titleWeight` (Default 600 at the text
  size) on `.cmsc-pb-link-list__title`.
- **`cms.CtaCard` (T237).** `cardRadius` (`default` = 12 px, or `none`/`small`/`medium`/`large`)
  inline; `imageInset` (`none` = 0, `custom` + `imageInsetPx`) adds `cmsc-pb-cta-card--image-inset`
  and `--cmsc-cta-image-inset`: negative margins take the image to that distance from the card's
  edges (the card's own padding is 32/24 px, 48 px from 768 px).
- **`cms.MediaText` (T238).** `sideBySide: 'desktop'` writes `data-side-by-side="desktop"`: the rows
  stay stacked (in `mobileOrder`) between 768 and 1023 px.
- **`cms.Row` (T239).** `rowGap` already took a value per breakpoint (`--pb-row-gap(-md|-lg)`); a
  single stored number applies at every width. No code change; a test now holds it.

## R19B: carousel controls, buttons, download tiles, image cards, sign-up layout (T240–T259)

Widening only (plan § *Extend, don't narrow*): every option is optional, nothing is in any
`defaultProps`, an unset option renders today's markup byte for byte (each test file has an
"unset renders today's markup" case). Only `cms.CarouselImage.moreLabel` is translatable
(`translatable: [..., { path: 'moreLabel' }]`); every other prop below is carried as non-prose in
`cms/block-declarations.test.ts`. Labels en + pl in the declaring module's bundle (`cms`,
`catalog`, `blog`, `newsletter`).

| Prop / shape | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `controls.dotColor` / `controls.activeDotColor` | Carousel, `catalog.ProductSlider`, `blog.LatestPosts` | colour value (hex or `token:<role>`) | unset = the scheme's (`--cmsc-dot`, `--cmsc-dot-active`; the dark scheme draws light dots, the active one `--cmsb-fg`), else today's greys |
| `controls.arrowGlyphColor` | same | colour value; read by the `solid` look and a solid next arrow | unset = today's white |
| `controls.hideArrowsOn` / `controls.hideDotsOn` | same | `HideOn` (`{ mobile?, tablet?, desktop? }`, the block "Hide on" control relabelled) | unset = shown wherever on |
| `controlsPlacement` value `slide` | `cms.ContentSlider` only (`CONTENT_SLIDER_PLACEMENT_OPTIONS`) | one more `CarouselControlsPlacement`, per breakpoint | — |
| `footerButtonAlign` | `catalog.ProductSlider`, `catalog.ProductGrid` | `'start' \| 'center' \| 'end'` (Left / Center / Right) | unset / `start` = today's |
| `transparentOutline` | `cms.Button` | `boolean` (switch, shown with an outline fill) | unset = today's scheme-filled outline |
| `iconSizePx` | `cms.Button` | `number \| Responsive<number>` (24–200), Responsive tab, icon-only buttons only | unset = the size option's height |
| `borderColor` | `cms.Button` | colour value | unset = the fill's border |
| `scheme` | `cms.DownloadTile` | `'inherit' \| 'light' \| 'muted' \| 'dark'` → `data-cmsb-scheme` on the link | unset / `inherit` = the section's |
| `cardBackground` / `cardBorder` / `cornerRadius` | `cms.DownloadTile` | colour value / `boolean` (`false` = no border) / `CornerRadius` | unset = today's card |
| `paddingPx` / `titleSizePx` | `cms.DownloadTile` | `number \| Responsive<number>` (0–120 / 10–120), Responsive tab | unset = 20 px / 18 px |
| `showType` | `cms.DownloadTile` | `boolean` (`false` hides the type badge) | unset = shown |
| `hoverImageLook` | `cms.DownloadTile` | `'faint' \| 'full'` (`full`: opacity 1 under a dark gradient, white text) | unset / `faint` = today's 18 % |
| `linkLook` / `iconButtonSizePx` / `iconButtonBorderColor` | `cms.DownloadTile` | `'label' \| 'icon'` / `Responsive<number>` (24–200) / colour value | unset = today's text label |
| `moreLabel` / `moreLabelPlacement` / `moreLabelSizePx` / `moreLabelIcon` | `cms.CarouselImage` | text (translatable) / `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left'` / `Responsive<number>` (10–64) / icon catalog key | unset = no label; bottom right; 14 px |
| `captionPaddingPx` | `cms.CarouselImage` | `Responsive<number>` (0–120), replaces `captionStyle.paddingPx` inline | unset = `captionStyle.paddingPx` as today |
| `captionPlacement` | `cms.Image` | `ImageCaptionPlacement \| Responsive<…>` (was one value), Responsive tab | a stored value = every breakpoint's |
| `captionSizePx` / `captionAlign` / `captionWeight` / `captionColor` | `cms.Image` | `Responsive<number>` (8–64) / `Responsive<'start' \| 'center' \| 'end'>` / `TextWeight` / colour value | unset = today's small muted caption at the start |
| `buttonPlacement` / `fieldShape` | `newsletter.Signup` | `'beside' \| 'inside'` / `'rounded' \| 'pill'` (shown with `inside`) | unset = today's button beside the field |
| `topicsColumns` / `hideEmailLabel` | `newsletter.Signup` | `number` (1–4) / `boolean` | unset = today's wrapping row / visible label |

- **Carousel markup** (`CarouselShell`): `--pb-dot-color`, `--pb-dot-active-color`,
  `--pb-arrow-glyph` on the root; root classes `cmsc-pb-carousel--arrows-off-sm|md|lg` and
  `--dots-off-sm|md|lg` (the stylesheet hides the carousel's own arrows / dots there by child
  combinators); a row of controls (below, header, dots row, the header itself when it holds only
  the controls) left empty at a breakpoint gets `cmsc-pb-carousel__controls--off-*` there. In the
  editor a hidden previewed tier hides at every width. A header holding only the controls (no
  heading, lead or button) puts them at its end (`:first-child` rule) — before, they sat at its
  start.
- **Controls inside a split slide** (`controlsPlacement: 'slide'`): `CarouselSlides` provides each
  slide's position (`SlidePositionContext`, no markup); `CarouselSlideControls` (exported, rendered
  at the end of `cms.CarouselSplit`'s text column) draws
  `.cmsc-pb-carousel__controls.cmsc-pb-carousel__controls--slide` with the arrows, dots and pause
  button; the copies in slides other than the shown page carry `inert` and `aria-hidden`. Where
  `slide` applies the shell also renders `cmsc-pb-carousel__controls--below
  cmsc-pb-carousel__controls--slide-fallback`, removed by
  `.cmsc-pb-carousel:has(> .cmsc-pb-carousel__viewport .cmsc-pb-carousel__controls--slide)`, so a
  carousel of other items keeps its controls. The editor previews `slide` as `below`. Free-content
  `cms.Slide`s draw no controls (that would need a controls block of its own).
- **Button** (`ButtonView` `look` + `tier`): `--cmsc-btn-outline-bg: transparent`,
  `--cmsc-btn-border: <colour>` inline; an icon-only button with a size gets
  `cmsc-btn--icon-size` and `--pb-btn-size(-md|-lg)` (published; a tier set only from a breakpoint
  up falls back to the size option's `var(--cmsb-btn-h-*)`), its icon `calc(var(--cmsc-btn-h) * 0.4)`.
- **Download tile**: `--pb-dl-bg`, `--pb-dl-radius`, `--pb-dl-pad(-md|-lg)`,
  `--pb-dl-title(-md|-lg)`, `--pb-dl-btn(-md|-lg)`, `--pb-dl-btn-ring` (only what is set,
  `responsivePxVars`), classes `--no-border`, `--hover-full`, `--icon-link`; the icon look renders
  the label as `cmsc-sr-only` and an `aria-hidden` `.cmsc-pb-download-tile__icon-button` with the
  catalog's `download` icon. The tile stays one `<a download>`.
- **Carousel image**: `.cmsc-pb-carousel-image__more(--<corner>)` inside
  `.cmsc-pb-carousel-image__media` (so inside the item's link), colour from `captionStyle.color`,
  `--pb-more-size(-md|-lg)` on the figure; `captionPaddingPx` adds
  `cmsc-pb-carousel-image--caption-pad` and `--pb-caption-pad(-md|-lg)`, also the label's inset.
- **Image caption**: `data-caption` stays the base placement (the editor's previewed one);
  `data-caption-md` / `data-caption-lg` only where a breakpoint changes it; a styled caption is
  `cmsc-pb-image__caption--styled` with `--pb-img-caption(-md|-lg)`,
  `--pb-img-caption-align(-md|-lg)`, an inline `font-weight` and `color`. The figure's width rule
  follows the base placement.
- **Sign-up**: `cmsc-pb-signup--button-inside` (+ `--pill`) wraps the input and the one submit
  button in `.cmsc-pb-signup__control`; `cmsc-pb-signup__topics--columns` with
  `--pb-topic-cols`; a hidden label is `cmsc-pb-signup__label cmsc-sr-only`. The posted fields are
  unchanged. `cms.NewsletterSignup` (external endpoint) shares no code with it and is unchanged.
- **Fields shown only where they apply**: the dot colours and "Hide the dots on" with dots; "Hide
  the arrows on" with arrows; the glyph colour with a solid arrow; the footer alignment with a
  labelled footer button; the outline switch with an outline fill; the icon size with an icon-only
  button; the tile's icon-button settings with the icon look and its hover look with a hover image;
  the read-more label's look once it has text; the image caption's look with a caption; the field
  shape with the button inside and the topic columns with topics.

## R19C: section width per breakpoint, background outset, mobile art tier, panel text box (T260–T265)

- **`cms.Section.width` (T260)** is `Responsive<SectionWidth>`, on the Responsive tab; a single
  stored width is read as it is. Published: when the tiers resolve to one width the markup is
  today's (`data-width="<width>"`); when they differ, `data-width="tiered"` and, per tier
  (`''`, `-md`, `-lg`), `--cmsc-section-box-w`, `--cmsc-section-box-m` (the centring margin),
  `--cmsc-section-box-o` (the outset), `--cmsc-section-box-mh` (min height: `100svh` for
  `viewport`, else `auto`), `--cmsc-section-frame-max` and `--cmsc-section-frame-px` — the
  values the `data-width` rules give that width, `contentWidth` applied at the tiers whose width
  admits one (`full`, `viewport`, `bleed`); no `data-content-width` is written then. The editor
  canvas renders its tier's width as one value. `contentWidth`, `customMaxWidthPx` and
  `outsetPx` show when any tier's width takes them.
- **`custom` wider than the page container (T262):** the stylesheet widens a `custom` section to
  `max(100%, min(<max>, 100vw - 2 * gutter))`, centred (`--cmsc-section-w`); at or below the
  container's content width nothing changes.
- **`cms.Section.outsetPx` (T261):** `Responsive<number>` 0–400, Responsive tab, with a
  `contained` or `custom` width (ignored with `full`, `viewport`, `wide`, `bleed`). Published:
  `data-outset="1"` and `--cmsc-section-outset(-md|-lg)` when any tier is above 0; the box grows
  by `min(outset, (100vw - width) / 2)` per side and its side padding by as much. Unset or 0
  everywhere: nothing is written.
- **`cms.Column.outsetPx` (T265):** `Responsive<number>` 0–400, Responsive tab. Published:
  `data-pb-outset="1"` and `--pb-col-outset(-md|-lg)` on the cell; the box (`> *`) widens by the
  outset per side with negative side margins, its `.cmsc-pb-bg-content` padded back. Editor: the
  previewed tier's value as `--pb-col-outset`.
- **`desktopFrom` (T263)** on `ResponsiveImage` and `SectionBackground`: `'tablet'` (unset, the
  768 px switch) or `'desktop'`. `Picture` writes `(max-width: 1023.98px)` on the mobile
  `<source>` for `'desktop'`; a section background's tiled image or video pair marks
  `.cmsc-section__media[data-desktop-from="desktop"]` and `useBreakpointVideo` watches the 1024 px
  query. Admin: **Mobile image shown on** (image field) / **Mobile image or video shown on**
  (background field), shown with a mobile image or video; the default writes nothing.
- **`cms.BackgroundPanel.textBoxTransparent` (T264):** a switch after the text placement; `true`
  writes `data-text-box="transparent"` on `.cmsc-pb-panel` and the text box paints no
  background. Unset: today's markup.
- **Box margin and padding (T266):** already per breakpoint on every block that has them — the
  shared fields carry the responsive metadata; a guard test holds that every block offering them
  lists them in `responsiveFields`.

## R20E: fixes, embedded-button look, hero texts, download tile link, caption measures (T290–T309)

Widening only (plan § *Extend, don't narrow*): every option is optional, nothing is in any
`defaultProps`, an unset option renders today's markup byte for byte (each test file has an
"unset" case). Nothing below is translatable. Labels en + pl in the `cms` bundle; the button look
fields are shared fields, translated once in `core` (`pageBuilder.sharedFields.button*`).

| Prop / shape | Blocks | Shape | Default |
| --- | --- | --- | --- |
| `transparentOutline` / `iconSizePx` / `borderColor` | every `ButtonSpec` (Hero, MediaText, CtaCard, BackgroundPanel, Statement, carousel split slides, section and listing headers, listing footers, link rows) | `boolean` / `Responsive<number>` (24–200, icon-only) / colour value | unset = today's |
| `iconOnlyShape` / `iconOnlyWidthPx` | every `ButtonSpec`, and `cms.Button` (block-level, beside its R19B look) | `'circle' \| 'pill'` / `Responsive<number>` (24–400) | unset = today's circle; a pill without a width is 1.15 × its height |
| `titleLineHeight` | `cms.Hero` | `Responsive<number>` (0.8–3) | unset = the size's own |
| `eyebrowColor` / `titleColor` / `subheadingColor` / `statementColor` / `bodyColor` | `cms.Hero` | colour value, inline `color` on the element | unset = the hero's `textColor` |
| `eyebrowSizePx` / `eyebrowWeight` / `eyebrowLineHeight` / `eyebrowUppercase` | `cms.Hero` | `Responsive<number>` (10–200) / `ResponsiveTextWeight` / `Responsive<number>` / `boolean` (`false` = `cmsc-pb-hero__eyebrow--plain`) | unset = today's 14 px 600 uppercase |
| `proofCaptionPlacement` | `cms.Hero` | `Responsive<'beside' \| 'below'>` → `data-caption(-md\|-lg)` on `.cmsc-pb-hero__proof` | unset = no attribute (today's wrapping row) |
| `proofCaptionSizePx` / `proofCaptionMaxWidthPx` / `proofCaptionWeight` / `proofCaptionColor` | `cms.Hero` | `Responsive<number>` (10–200 / 40–1200) / `TextWeight` / colour value | unset = today's 14 px caption |
| `bodyListMarkerColor` | `cms.Hero` | colour value → `--cmsc-list-marker` on the body | unset = today's markers |
| `listMarkerColor` | `cms.RichContent` | colour value → `--cmsc-list-marker` on the prose | unset = today's markers |
| `linkTo` / `link` | `cms.DownloadTile` | `'file' \| 'link'` / `LinkValue` (shown with `link`; the file without it) | unset = a file |
| `minHeightPx` / `subtitleSizePx` / `subtitleColor` | `cms.DownloadTile` | `Responsive<number>` (0–1200 / 8–64) / colour value | unset = 180 px / 14 px muted |
| `moreLabelColor` / `moreLabelIconColor` / `moreLabelWeight` | `cms.CarouselImage` | colour value / colour value / `TextWeight` (shown once the label has text) | unset = the caption's colour, 600 |
| `captionMinWidthPx` / `captionMaxWidthPx` | `cms.Image` | `Responsive<number>` (0–1200 / 40–1200) → `cmsc-pb-image__caption--measure`, `--pb-img-caption-min\|max(-md\|-lg)` | unset = none |

- **One button path (T297)**: `ButtonView` merges the spec's look under the block's own
  (`cms.Button`'s block-level options win); a pill adds `cmsc-btn--icon-pill` and
  `--pb-btn-width(-md|-lg)`. `specAtTier` resolves `iconSizePx` and `iconOnlyWidthPx` to the
  previewed tier. `cms.Button`'s `button` object field omits the look (it stays block-level, as
  stored); the admin's `createButtonSpecField({ look: false })`.
- **Download tile link (T303)**: `cmsc-pb-download-tile--page-link`, the link's `href` / `target` /
  `rel`, no `download` attribute, no type badge, the icon button's `arrowRight`; a link that
  resolves to nothing renders nothing published and a `role="note"` warning in the preview.
- **Hero proof caption (T300)**: the caption below is `flex-basis: 100%` in the wrapping row;
  `cmsc-pb-hero__proof-caption--measure` with `--pb-hero-proof-max(-md|-lg)`; size and weight
  through `textStyleAttrs` (`cmsc-pb-ts-size` per breakpoint).
- **Fixes**: the download tile's `--pb-dl-title-md|lg` rules now follow the base title rule (T290;
  a stylesheet-order test guards every `-md`/`-lg` tier rule); a Column's outset is the cell's
  negative side margins (`max-width: none`) and the box keeps its own side margins, `width: auto`
  (T291); a caption on the read-more label's edge gets `cmsc-pb-carousel-image--more-clear-top|bottom`
  and is lifted by the label's inset plus line box (T292); `cms.Image` with the base caption below
  and a breakpoint beside, with a set width, becomes `cmsc-pb-image__figure--tiered`
  (`--pb-img-fig-w`, the media in `.cmsc-pb-image__media`) (T293); `isEmptyInline` treats blank
  text and hard breaks as empty, and the published `cms.Heading` writes no element for an empty
  text (T294); `MediaTextMediaFrame` passes the `<video>` key directly (T295).
- **Fields shown only where they apply**: the eyebrow's look with an eyebrow; the proof caption's
  with a caption; the pill and its width on `cms.Button` with an icon-only button (the width with
  the pill); the tile's file or link by `linkTo`; the label's colour and weight once it has text;
  the image caption's measure with a caption.

## R20F: split-slide layout, carousel controls alignment, block spacing, tier type scale (T310–T324)

Every option is optional; unset writes nothing and the stored markup is unchanged. "Per
breakpoint" values are `Responsive<…>` on the Responsive tab, each tier inheriting the one below,
resolved in the block: a tier is written as `--<name>`, `--<name>-md` or `--<name>-lg` only where
a value reaches it, and the stylesheet reads each with the block's own value at that tier as the
fallback (`tierVars`, `packages/cms-components/src/components/tier-vars.ts`).

- **`cms.CarouselSplit` (T310–T312):** `sideBySide` (`'tablet' | 'desktop'`; `desktop` writes
  `data-side-by-side="desktop"`, stacked 768–1023 px); `mediaSpan`, `textSpan` (1–11),
  `textOffset` (0–10) — any set: `.cmsc-pb-carousel-split--columns` and
  `--cmsc-split-media-col` / `--cmsc-split-text-col` (`<start> / span <n>` on a 12-column grid
  from 768 px, gap `--cmsb-gutter`; media 6 and offset 0 unless set, the text the rest; mirrored
  for `mediaSide: 'end'`); `mediaCornerRadius` (`CornerRadius`, inline `border-radius` on the
  media; unset 8 px); `titleSize` / `titleSizePx`, `titleWeight`, `titleLineHeight`, `bodySize` /
  `bodySizePx`, `bodyWeight`, `bodyLineHeight` (per breakpoint, R19A `textStyleAttrs`; the title
  keeps `cmsc-t--h4`); `titleHangingIcon` (`boolean`, R19A T226's `.cmsc-hang`) with
  `titleHangingIconGapPx` (per breakpoint, `--cmsc-hang-gap(-md|-lg)` on the title).
- **Carousel controls (T313, T314; `cms.ContentSlider`, `catalog.ProductSlider`,
  `blog.LatestPosts`):** `controlsAlign` accepts `'dots-start'` (root
  `cmsc-pb-carousel--ctl(-md|-lg)-dots-start`; the dots row `order: -1` with
  `margin-inline-end: auto`, so the arrows sit together at the end; the markup's order is
  unchanged). A set `controlsAlign` also aligns the row inside a split slide:
  `cmsc-pb-carousel__controls--al-<v>`, `--al-md-<v>`, `--al-lg-<v>`, every tier written; unset,
  that row keeps today's start. `controls.arrowsWhenFit` (`boolean`, shown with arrows): when every
  slide fits the controls stay, both arrows `disabled`, the dots `hidden` (box kept); the disabled
  look (`disabledArrowLook`) then applies on a looping carousel too. Shell prop
  `keepArrowsWhenFit`.
- **`cms.MediaText` (T315):** `headingSpacePx`, `bodySpacePx`, `stackedGapPx` (per breakpoint,
  0–200; root classes `cmsc-pb-media-text--heading-space|--body-space|--stacked-gap`, properties
  `--cmsc-mt-heading-space|body-space|stacked-gap`; fallbacks 16 px, 0, 24 px); `bodySize` /
  `bodySizePx` (per breakpoint), `bodyLineHeight` on every row's text; `rows[].verticalAlign`
  (`BlockAlign | 'inherit'`; unset or `inherit` is the block's `verticalAlign`).
- **`cms.BackgroundPanel` (T316):** `mobileLayout` (`'stack' | 'overlay'`; `overlay` writes
  `data-mobile-layout="overlay"`: below 768 px the image and the text share one grid cell, the
  image at its own height, the text at its top or, with `mobileTextPosition: 'bottom'`, its
  bottom); `textBoxMarginPx`, `textBoxPaddingPx` (per breakpoint, 0–200; classes
  `cmsc-pb-panel--box-margin|--box-padding`, `--cmsc-panel-box-m|p`; fallbacks 0 / 24 px on
  phones, 32 / 40 px from the tablet).
- **`cms.FeatureList` (T317):** `rowGapPx` (per breakpoint; `cmsc-pb-feature-list--row-gap`,
  `--cmsc-fl-row-gap`; `gap` then spaces the columns only), `titleLetterSpacing` (em, −0.1–0.2,
  inline on the titles), `listLineHeight` (per breakpoint; `--list-leading`, `--cmsc-fl-list-lh`
  on lists in the item text), `bodySpacePx` (per breakpoint; `--body-space`,
  `--cmsc-fl-body-space` between the item text's paragraphs; fallback 0.5em).
- **`cms.CtaCard` (T318):** `paddingPx` (per breakpoint, 0–160; `cmsc-pb-cta-card--padding`,
  `--cmsc-cta-pad`; the image inset measures from it) and, with an image, `imageColumns` (per
  breakpoint, 2–10 columns of 12 from the tablet up; `cmsc-pb-cta-card--image-cols`,
  `--cmsc-cta-cols-md|lg` holding the two tracks, mirrored for `imageSide: 'start'`).
- **`cms.Stats` (T319):** `labelLineHeight` (per breakpoint).
- **`cms.LinkList` (T320):** `dividerAfterLast` (`boolean`, with `divider` on;
  `cmsc-pb-link-list--divided-end` draws the rule under the last row).
- **`cms.Accordion` (T321):** `icon` accepts `'chevron-circle'` (root `--chevron` and
  `--chevron-circle`; the chevron drawn in `--cmsb-bg` on a circle 1.5 × the icon size) with
  `iconCircleColor` (colour value; `--cmsc-acc-icon-circle`; unset, the title colour).
- **Brand tokens (T322):** optional `tierScale: { tablet?: number; smallDesktop?: number }`
  (0.5–2). `brandTokensToCss` writes, for a factor other than 1,
  `@media (min-width: 768px) and (max-width: 1023.98px){:root{…}}` (before the desktop block) with
  every `--cmsb-t-<token>-size` and `--cmsb-space-<step>` = mobile px × factor, and
  `@media (min-width: 1024px) and (max-width: 1279.98px){:root{…}}` (after it) from the desktop
  px; two decimals; gutter and container unscaled. Unset or 1: byte-identical output. Sizes a
  block sets in its own px (Custom) are not scaled.

## R21G: social-proof caption fix, stacking breakpoints, column layouts, text options (T330–T338)

Every option is optional; unset writes nothing and the stored markup is unchanged (as R20F: per
breakpoint values written only where a value reaches the tier, `tierVars` / R19A
`textStyleAttrs`).

- **`cms.Hero` (T330, fix; T331):** with `proofCaptionPlacement` `'below'` at a tier, the caption
  starts a line of its own whatever its `proofCaptionMaxWidthPx`: the proof row draws a
  zero-height `::before` of `flex-basis: 100%` (`order: 1`) between the image (`order: 0`) and the
  caption (`order: 2`), the row gap becoming the caption's 12 px top margin; `'beside'` at a wider
  tier undoes it. CSS only, no markup change. `proofCaptionLineHeight` (per breakpoint) on the
  caption.
- **`cms.MediaText` (T332, T333):** `mediaSpan`, `textSpan` (1–11), `textOffset` (0–10) — any
  set: `.cmsc-pb-media-text--columns` and `--cmsc-mt-media-col`, `--cmsc-mt-text-col` (media at
  the start) and `--cmsc-mt-media-col-end`, `--cmsc-mt-text-col-end` (media at the end) on the
  root, a 12-column grid from the side-by-side tier in place of `split` (gap `--cmsb-gutter`; the
  shared `twelveColumns` helper, also `cms.CarouselSplit`'s); stacked 768–1023 px with
  `sideBySide: 'desktop'`. `listMarkerColor` (`--cmsc-list-marker` on the root), `bodyWeight` and
  `headingLineHeight` (per breakpoint).
- **`cms.CtaCard` (T334), with an image:** `mobileImagePosition` (`'above' | 'below'`; `below`
  writes `data-mobile-image="below"`: while stacked the image follows the text and an inset runs
  along the sides and the bottom); `sideBySide` (`'tablet' | 'desktop'`; `desktop` writes
  `data-side-by-side="desktop"`, stacked 768–1023 px with the tablet's padding). `imageInsetPx`
  becomes per breakpoint: one number (as stored) writes today's one `--cmsc-cta-image-inset`;
  per-tier values write `--cmsc-cta-image-inset`, `-md`, `-lg` only where set, the stylesheet
  reading the one below. `bodySize` / `bodySizePx` (the text) and `listSize` / `listSizePx` (the
  list) per breakpoint.
- **`cms.Stats` (T335):** `sideBySide` (`'tablet' | 'desktop'`, with an image;
  `data-side-by-side="desktop"` stacks image and figures 768–1023 px).
- **`cms.CarouselSplit` (T336):** `bodyIndent` (`'none' | 'title'`; offered with
  `titleHangingIcon`): `title` with a title that starts with an inline icon writes
  `cmsc-pb-carousel-split--body-indent` — the text column a two-column grid (`auto` and the rest,
  column gap `--cmsc-hang-gap(-md|-lg)`, now also written on the column), the title a subgrid whose
  items are the hanging icon and text (`.cmsc-hang` `display: contents`), the body in the second
  column. `stackedGapPx`, `titleSpacePx`, `controlsSpacePx` (per breakpoint, 0–200; root classes
  `--stacked-gap|--title-space|--controls-space`, `--cmsc-split-stacked-gap|title-space|controls-space`;
  fallbacks 24, 12, 24 px; the controls' space is the slide controls' top margin).
- **`cms.Image` (T337):** `desktopFrom` (`'tablet' | 'desktop'`, with a mobile image; R19C's
  `pictureMobileMedia`: `desktop` keeps the mobile source below 1024 px).
- **`cms.Heading` (T337):** `textMaxWidth` / `textMaxWidthPx` (per breakpoint, T134's measure:
  `cmsc-text-max` and `--cmsc-text-max(-md|-lg)`; the editor previews it inline).
- **`cms.RichContent` (T338):** `listLineHeight` (per breakpoint;
  `cmsc-pb-rich-content--list-leading`, `--cmsc-rc-list-lh` on `ul` and `ol`).
- **`cms.Accordion` (T338):** `titleLineHeight` (per breakpoint; one value inline on each title,
  values per tier as `cmsc-pb-accordion--title-leading` and `--cmsc-acc-title-lh(-md|-lg)`, every
  tier written, today's — the size token's or inherited — where none is chosen).
- **`newsletter.Signup` (T338):** `buttonHeightPx` (per breakpoint, 24–120;
  `cmsc-pb-signup--button-height`, `--cmsc-signup-btn-h`; fallbacks 44 px, 36 px inside the
  field), `buttonTextSizePx` (per breakpoint) and `buttonWeight` on the button.
- **`catalog.ProductGrid`, `catalog.ProductSlider` (T338):** `leadSize` / `leadSizePx`,
  `leadWeight` (per breakpoint) and `leadColor`: the lead's text wrapped in
  `<span class="cmsc-pb-carousel__lead-text">` through the shared header's `lead` hook
  (`listingLeadOptions`); the header itself is unchanged.
- **`cms.DownloadTile` (T338):** `titleWeight` (inline on the title).
- **Not done:** a brand bold weight (`fonts.boldWeight`) — see tasks.md T339.

## R21H: breakpoint tiers, breadcrumbs over the first section, carousel small-desktop tier (T350–T357)

Every option is optional; unset renders today's markup and today's brand CSS byte for byte.

- **Per-breakpoint type token (T350, bug):** a text sized by a different type token per tier
  (`sizedTextProps` — carousel header heading, section heading, item texts; `HeroText`;
  `cms.Heading`) adds `cmsc-pb-text-token` and `--pb-text-lh|w|ls` (`-md`, `-lg`) =
  `var(--cmsb-t-<tier token>-lh|w|ls, <built-in>)`; a Custom px tier reads the class token. The
  rule sits after `.cmsc-t--*` and before `.cmsc-pb-text-weight` / `.cmsc-pb-text-leading`, so a
  block's own weight or line height still wins. One token at every tier: nothing new. **Visible
  change** for stored texts with a mixed token (their line height / weight / tracking now follow the
  tier's token).
- **Brand tier range (T351):** `tierScale.smallDesktopUntilPx` (integer 1024–3840; unset 1279)
  ends the small-desktop block at `<value>.98px`; `tierScale.fluidDesktop` (+ `fluidUntilPx`, else
  `layout.containerMaxPx`) adds `@media (min-width: <until+1>px) and (max-width: <end-1>.98px)`
  with `clamp(<px × factor>px, <px × 100 / end>vw, <px>px)` per desktop type size and spacing step
  (only with a small-desktop factor below 1).
- **Buttons (T352):** `tierScale.buttons: true` adds `--cmsb-btn-h-s|m|l` to the tablet,
  small-desktop and fluid blocks (height × factor); icon-only and pill buttons follow (sized from
  `--cmsc-btn-h`).
- **Frame per tier (T353):** `layout.gutterTabletPx` (tablet block `--cmsb-gutter`),
  `layout.gutterSmallDesktopPx` and `layout.containerSmallDesktopPx` (small-desktop block
  `--cmsb-gutter`, `--cmsb-container`). Every consumer of the two variables follows.
- **Carousel small-desktop tier (T354):** `slidesPerViewSmallDesktop` (number 1–8, step 0.25) and
  `gapSmallDesktopPx` (number 0–160) on every carousel (`CAROUSEL_TRACK_FIELDS`: ContentSlider,
  ProductSlider, LatestPosts), layout fields after `gapPx`. **Decision:** dedicated props, not a
  fourth `Responsive<T>` key — the type has three tiers everywhere (fields, editor preview,
  manifests), and a fourth would be a global change. Published: `--pb-spv-sd` / `--pb-gap-sd` on
  the root (not for a fade carousel), read by
  `@media (min-width: 1024px) and (max-width: 1279.98px)` (`var(--pb-spv-sd, <desktop chain>)`);
  a brand with `smallDesktopUntilPx` rebinds the moved range in its own CSS
  (`:root .cmsc-pb-carousel`). The editor preview shows the desktop values.
- **Breadcrumbs over the first section (T355):** page-level `breadcrumbsOverlay` (see
  storefront-and-admin-api.md §2, data-model §1.1). Storefront: a zero-height
  `relative z-20 h-0` layer (`data-cmsb-scheme`, `data-breadcrumbs-overlay`) holding the trail
  absolutely in the brand container; no band, nothing below moves. The first section's top padding
  is the editor's (documented), not added automatically.

## R22I: 12-column gaps and anchors, row alignment, list columns and block options (T370–T382)

Every option is optional; unset writes nothing and the stored markup is unchanged, except the two
fixes marked **visible**.

- **12-column gap (T370, bug):** `.cmsc-pb-stats-block--columns`,
  `.cmsc-pb-carousel-split--columns` and `.cmsc-pb-media-text--columns .cmsc-pb-media-text__row`
  read `column-gap: var(--cmsc-grid-gap(-md|-lg), var(--cmsb-grid-gap, var(--cmsb-gutter, 24px)))`
  (768 px and 1024 px rules) instead of the bare side gutter; the Row's `.cmsc-pb-gap` fallback
  reads the same chain (a Row always writes its own gap, so it is never reached). New
  `columnGapPx` (per breakpoint, 0–200) on `cms.Stats` (with an image's columns),
  `cms.MediaText` and `cms.CarouselSplit` (with their columns of 12) writes
  `--cmsc-grid-gap`, `-md`, `-lg` (`tierVars`) beside the column variables; offered only with the
  columns of 12. **Decision:** the default is unchanged — the brand writes no `--cmsb-grid-gap`
  today, so every render keeps today's gutter. `--cmsb-grid-gap` is the hook for a brand that sets
  a per-tier gutter (`layout.gutterTabletPx`, `gutterSmallDesktopPx`, R21H) to keep the base
  tier's gutter as the grids' gap there; writing it is the brand CSS's (not done here).
- **Columns anchor (T371):** `columnsAnchor` (`'media' | 'start' | 'end'`) on `cms.MediaText` and
  `cms.CarouselSplit`, offered with the columns of 12, read by `twelveColumns`: `media` (unset,
  today's) anchors the pair at the media's side (media at the end ends at column 12); `start`
  starts it at column 1 and `end` ends it at column 12 whatever the side (e.g. 5 / 1 / 5 with
  media at the end: `start` gives text `1 / span 5`, media `7 / span 5`).
- **Card list columns (T372, bug, visible):** `@media (768–1023.98px)`
  `.cmsc-pb-cta-card[data-side-by-side='desktop'] > .cmsc-pb-cta-card__text >
  .cmsc-pb-cta-card__list[data-columns='2']` is one column: the two-column list follows the card's
  side-by-side tier (a card stacked to the desktop showed two columns from 768 px). CSS only.
- **Row alignment (T373, bug, visible):** `cms.Column` no longer carries `cmsc:self-stretch`, so
  the Row's `align-items` (`.cmsc-pb-cols-align[data-align*]`, inline in the editor) places its
  columns on published pages too; `stretch` (default) is unchanged. `rowVerticalAlign` reads a
  stored `'center'` (`cms.MediaText`'s wording) as `'middle'`, per tier, in render and editor.
- **`cms.CtaCard` (T374):** `headingSpacePx` (per breakpoint, 0–200;
  `cmsc-pb-cta-card--heading-space`, `--cmsc-cta-heading-space(-md|-lg)`, fallback 16 px),
  `bodyWeight` (per breakpoint, `textStyleAttrs` on the text), `textMaxWidth` / `textMaxWidthPx`
  (per breakpoint, T134's measure on `.cmsc-pb-cta-card__body`).
- **`cms.Stats` (T375):** `valueLineHeight` (per breakpoint) through the new `tierLeading`: one
  value inline; values per tier as `cmsc-pb-lh`, `cmsc-pb-lh-md`, `cmsc-pb-lh-lg` with
  `--pb-lh(-md|-lg)`, **each class written only for a tier a value reaches**, so a tier below the
  first set keeps the size token's line height. The rules double the class and sit last in the
  stylesheet (they beat `.cmsc-pb-text-token` and a block's own rule).
- **`cms.MediaText` (T376):** `featureBodySize` / `featureBodySizePx`, `featureBodyWeight` (per
  breakpoint) and `featureBodyColor` on `.cmsc-pb-media-text__feature-body` (`textStyleAttrs`,
  today's 15 px / 1.55).
- **`cms.RichContent` (T377):** `textWeight` (per breakpoint, on the prose wrapper) and
  `listWeight` (per breakpoint; `cmsc-pb-rich-content--list-weight`, `--cmsc-rc-list-w(-md|-lg)`
  on `ul` and `ol`, fallback `inherit`).
- **`cms.FeatureList` (T378):** `iconPosition` becomes per breakpoint: one position (stored or the
  same at every tier) is today's `data-icon-position="beside"` (or nothing); positions that differ
  write `data-icon-position`, `-md`, `-lg` (`above` | `beside`), the stylesheet placing the icon
  beside or undoing it per tier. `items[].span` (1–12): any item with one adds
  `cmsc-pb-feature-list--spans` and `--cmsc-fl-default-span` (12 ÷ desktop columns) on the list,
  `--cmsc-fl-span` on the item; from 1024 px the list has 12 tracks and each item spans its width.
  `titleWeight` was already per breakpoint (type corrected to `ResponsiveTextWeight`).
- **Carousel header (T379):** `headingLineHeight` (per breakpoint, `tierLeading` as T375) in
  `CAROUSEL_HEADER_FIELDS` — `cms.ContentSlider`, `catalog.ProductSlider`,
  `catalog.ProductGrid`, `blog.LatestPosts`. `cms.LinkList` `titleLineHeight` (per breakpoint,
  `textStyleAttrs` on the row titles). `blog.LatestPosts` `leadWeight` (per breakpoint, on the
  lead's `ItemText` span).
- **`newsletter.Signup` (T380):** `topicLabelSizePx` (per breakpoint, 10–40, offered with topics;
  `cmsc-pb-signup__topics--label-size`, `--cmsc-signup-topic-size(-md|-lg)` on the fieldset,
  fallback 0.875 rem); `buttonIcon` (an icon-catalog name): the glyph after the label
  (`svg.cmsc-pb-signup__button-icon`, `aria-hidden`), the button `cmsc-pb-signup__button--icon`
  (inline-flex, 8 px gap). The sign-up's button is not a `ButtonSpec`, so the catalog name is its
  own prop.
- **`cms.Testimonial` (T381):** `quoteSize` / `quoteSizePx` (per breakpoint, `textStyleAttrs` on
  the quote; today's 1.15 rem / 1.55).
- **`cms.DownloadTile` (T382):** `iconButtonIcon` (an icon-catalog name, offered with
  `linkLook: 'icon'`): the icon button's glyph; unset or unknown, today's (download, or an arrow
  for a link). The icon catalog gains `cloudDownload`.

## R22J: fluid frame, block px scaling, button labels, breadcrumbs (T390–T409)

Brand opt-in flags (`cms-brand.ts`, data-model §2). Unset, the brand CSS is today's byte for byte
and the page's markup is today's wherever a block sets no Custom px value.

- **Fluid container (T390):** `layout.fluidContainer: true` — in the fluid range
  (`tierScale.fluidDesktop`, a small-desktop factor below 1) `--cmsb-container` is
  `clamp(<floor>px, <containerMaxPx × 100 / until>vw, <containerMaxPx>px)`, the floor
  `containerSmallDesktopPx`, else `containerMaxPx × factor`; `--cmsb-gutter` grows the same way from
  `gutterSmallDesktopPx` to `gutterDesktopPx` when the first is narrower. Every reader of the two
  variables (the page shell, Contained sections, row inners, the breadcrumb trail) follows.
- **Block px scaling (T391–T392):** every block's own **Custom (px)** value for a size, a space, a
  gap, a padding, a minimum height or a maximum width is written by `blockPx(n)`
  (`components/block-px.ts`) as `calc(<n> * var(--cmsb-px, 1px))` (zero stays `0px`);
  `tierScale.blockPx: true` makes the brand write `--cmsb-px` per tier (`<factor>px`; fluid:
  `clamp(<factor>px, <100 / until>vw, 1px)`). **Decision:** the wrapping is unconditional — a block
  renders without knowing the brand, and a render context threaded into every helper call was
  rejected as far more invasive — so a block value that is **set** changes form in the markup
  (`24px` → `calc(24 * var(--cmsb-px, 1px))`), while its computed value is identical whenever
  `--cmsb-px` is unset (no brand, the flag off, phones, desktops past the fluid end). Unset options
  still write nothing; a caller's code default (a section default spacing, a fallback px) stays
  literal. `fallback-parity.test.tsx` holds computed values (its `resolveVars` computes the
  scaled-pixel product as a browser does). `--cmsb-px` is a length, not a factor, because the
  fluid value is a `vw` length and CSS cannot divide a length into a number portably.
  Covered: `pxCss` / `tierVars` / `pxTierOption`, `responsivePxVars`, `textStyleAttrs` (Custom px
  size), `gapCss` and the item/heading Custom sizes in `section-parts.tsx`, `cms.Heading` (Custom
  size, hanging-icon gap), `cms.Hero` (Custom sizes, min height, gaps, space after), the Section
  frame and Section group (editor `{px}` spacing, overlap, custom max width, outset), `cms.Spacer`,
  `cms.Statement` min height, `textMaxWidth` Custom px, `ButtonView` icon-only size and pill width,
  the carousel gap (`CarouselShell`), `cms.Image` custom width, `cms.Accordion` icon size,
  `CmsProductCard` max width and image height, `CarouselImage` caption padding, `LogoStrip` logo
  height, `cms.Map` height — and every block that writes through the shared helpers above.
  Not covered (literal px): `cms.Row` / `cms.Column` own gaps, max width and outset
  (`Row.tsx`, `Column.tsx`), `CtaCard`'s local `pxOrNull`, `DownloadTile`'s radius, `FeatureList`'s
  local `px`, `ItemIcon` sizes, the core
  `buildResponsiveNumberVars` / `buildResponsiveSpacingVars` / `spacingToCss` (box padding and
  margin, always written with their defaults), radii and border widths (by design), the
  editor-only `editingTypographyStyle` font size, `CategoryList` depth indent, `ContactFormEmbed`
  height, and the catalog skeletons.
- **Button labels (T393):** `tierScale.buttonLabels: true` writes `--cmsb-btn-px` per tier; the
  stylesheet sizes `.cmsc-btn` labels `calc(14 * var(--cmsb-btn-px, 1px))` (small 13, large 16);
  the icon (`1.15em`) follows. A separate flag rather than widening `tierScale.buttons`, so a brand
  stored with `buttons: true` keeps its output.
- **Breadcrumb colours (T394, bug):** on a painted trail (`muted`, `dark`; band or overlay) the
  links take `--cmsb-fg-muted` (hover `--cmsb-fg`) and the current page `--cmsb-fg`; the link colour
  is no longer used there. Light is unchanged.
- **Breadcrumb band padding (T395):** brand `layout.breadcrumbsPaddingYPx` (integer 0–64) pads the
  painted band above and below at every breakpoint (inline `padding-top` / `padding-bottom`
  replacing `pt-[24px] pb-[16px] max-md:pt-[16px]`). **Decision:** brand-level, not page-level —
  one band look per site, no migration; the light trail and the overlay are not bands and keep
  their spacing.
- **Tracking below desktop (T396):** `typeScale.<token>.trackingMobileEm` (−0.1–0.2) is the
  token's `-ls` below 1024 px; `trackingEm` then rebinds in the desktop block.

## R22K: merge follow-ups (T410–T414)

- **Brand grid gap (T410, R22I's T384):** `brandTokensToCss` writes `--cmsb-grid-gap` beside a
  per-tier gutter — tablet block with `layout.gutterTabletPx` (the phone gutter, else 24 px),
  small-desktop block with `layout.gutterSmallDesktopPx` (the desktop gutter, else the phone one,
  else 24 px), fluid block beside a growing gutter (the desktop gutter). The grids' chain
  `var(--cmsc-grid-gap…, var(--cmsb-grid-gap, var(--cmsb-gutter, 24px)))` therefore keeps the base
  gutter where the side gutter changes. No per-tier gutter: nothing written.
- **Row and Column px (T411, R22J's T400 in part):** `cms.Row` writes `--pb-gap`, `--pb-row-gap`
  and `--pb-row-max-width` (`-md`, `-lg`) through `scaledNumberVars` (`block-px.ts`): a stored value
  as `calc(N * var(--cmsb-px, 1px))`, an unstored one as today's literal default; the editor's
  inner max width the same. `cms.Column` writes `--pb-col-outset(-md|-lg)` through `blockPx` (zero
  stays `0px`). The Row's `minHeight` and the box padding and margins stay literal.

## R23: simplification of the R19–R22 options (T430–T469)

**Pixel-matching options removed per owner decision** (data-model §7 holds the full lists of added,
removed and narrowed props). The R19–R22 sections above describe what was built; where they name a
prop listed here, R23 governs. Nothing of R19–R22 was released: no migration, and readers never
crash on a removed prop — it is ignored data. Anything stored before R19 renders byte for byte as
before (`option-parity.test.ts`, `fallback-parity.test.tsx`, and an offline render of a pre-R19 tree
against the pre-R19 renderer).

- **No block px scaling (T431):** R22J's `blockPx` / `--cmsb-px` and R22K's Row/Column scaled vars
  are gone; every block writes its Custom px as a literal px, as before R22J. `buttonLabels` /
  `--cmsb-btn-px` are gone; button labels are today's 14/13/16 px.
- **Brand (T432–T433):** no `smallDesktopUntilPx` (the small-desktop tier ends at 1279 px), no
  per-tier gutter or container, no `fluidContainer`, no `breadcrumbsPaddingYPx` (the painted band
  keeps `pt-[24px] pb-[16px] max-md:pt-[16px]`), no `trackingMobileEm`; no `--cmsb-grid-gap` — the
  grids read `var(--cmsc-grid-gap…, var(--cmsb-gutter, 24px))`. The brand schema strips the keys on
  parse. Kept: `tierScale.tablet`, `smallDesktop`, `fluidDesktop`, `fluidUntilPx`, `buttons`, the
  T394 trail colours, `breadcrumbsOverlay`.
- **Carousels (T434, T448):** no small-desktop slides-per-view or gap tier (R21H T354); the dots
  take the scheme's colours only (no `dotColor` / `activeDotColor`).
- **One typography rule (T435):** `textStyleAttrs` writes a type-token size's line height, weight
  and letter spacing (`--cmsb-t-<token>-lh|-w|-ls`, built-in fallbacks) beside its size; a line
  height is written, and its field shown, only at a breakpoint whose size is Custom px
  (`customOnlyLeading`, `customLeadingAttrs`). The weights R19–R22 added are one value; a stored
  per-breakpoint weight reads as `desktop`, else `base` (`singleWeight`).
- **Colours (T436):** per-text colours fold into the block's text colour; accents stay
  (`cms.Hero.eyebrowColor`, `cms.Stats.valueColor`, the listings' `leadColor`, list marker colours).
- **Spacing steps (T437):** the per-element px spaces become one `BlockSpace` select (Default,
  None, XS–XXL) — `innerSpace`, `stackedGap`, `cardPadding`, `headingSpace` — written as
  `var(--cmsb-space-<step>, <phone px> | <desktop px>)` per tier.
- **12-column presets (T438, T440):** `layout` (`'default' | '6-6' | '7-5' | '5-7' | '8-4' | '4-8' |
  '5-1-6' | '6-1-5'`) on `cms.CarouselSplit`, `cms.Stats` and (two tracks only) `cms.CtaCard`;
  `cms.MediaText` keeps `split`. `layoutAdvanced` shows the raw numbers, which then win; a stored
  raw number without the switch and without a preset reads as on (`usesAdvancedLayout`), and
  `resolveData` stores the switch on so the editor shows them.
- **Smaller removals (T439, T441–T447, T449):** `cms.Heading.hangingIconGapPx` and
  `cms.CarouselSplit.titleHangingIconGapPx` (the indent keeps 0.35 em); `cms.Accordion`'s
  `chevron-circle` (reads as `chevron`) and `iconCircleColor`; the rich-text size mark's Custom px
  option (a stored px mark still renders and sanitises); `newsletter.Signup`'s button height, label
  size and weight and topic label size; `cms.DownloadTile`'s icon-button size and border colour and
  subtitle size and colour; `cms.CarouselImage`'s read-more label size, colours, weight and caption
  padding; `cms.Image`'s caption weight, colour and minimum width; `ButtonSpec` / `cms.Button`
  `iconSizePx` and `iconOnlyWidthPx` (a pill is 1.15 × its height); `cms.Section.outsetPx`;
  `cms.BackgroundPanel` text-box margin and padding px.
- **Added Custom size selects:** `cms.Hero.eyebrowSize`, `cms.DownloadTile.titleSize`,
  `cms.Image.captionSize` — a token or Custom px, so the existing `…SizePx` field is the Custom
  value. A stored px without a size reads as Custom (`resolveData` stores `'custom'`).
