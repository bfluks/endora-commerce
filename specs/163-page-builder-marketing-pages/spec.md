# Feature Specification: Page builder for corporate marketing pages

**Feature Branch**: `feat/163-page-builder-marketing-pages`
**Created**: 2026-10-22
**Status**: Draft
**Input**: User description: "Extend the page builder far enough that a merchant can reproduce,
as faithfully as possible, the corporate marketing pages of an existing B2B manufacturer's
website — a home page, four audience landing pages (architects, installers, designers,
distributors), About us, Careers, Production technology, Global presence and a training-academy
page — on Endora Commerce. Every change must be generic product capability; no reference to any
particular website. Backward compatibility of stored page content is not required, but the demo
seed must keep working."

## Context

The reference set is ten pages of a typical manufacturer's corporate site, built on a
section-per-block CMS. An analysis of their structure found about twenty recurring section
patterns, listed below with the number of pages that use each:

- Hero: 10 of 10.
- Breadcrumbs: 9.
- Media-and-text split in several layouts: 8.
- Heading-and-carousel: 5.
- Statement or quote: 5.
- Download tiles: 4.
- Icon feature grid: 4.
- Link-tile carousel: 3.
- Free content columns: 3.
- Audience tabs, product carousel, news carousel, boxed call-to-action card and image-card-with-form: 2 each.
- Category showcase, filterable reference gallery, key figures, job-offer list and newsletter box: 1 each.

The pages also share cross-cutting traits:

- Dark and light sections, sometimes merged into one dark canvas.
- Every section addressable by an anchor.
- Separate mobile and desktop images (art direction).
- A brand font and colour palette, pill-shaped buttons in eight styles, and gradient or muted
  highlight phrases inside headings.
- Heading tags chosen independently of their visual size.
- Carousels with a fade or slide effect and per-breakpoint slide counts.
- Collapsible "read more" text and accordions.
- Self-hosted background videos.
- Forms with consent checkboxes.
- Rich sharing metadata.

The current page builder already provides:

- Rows and columns.
- A single-button hero.
- A feature list.
- Stats, tabs, an accordion, a video, sliders, a logo strip, a testimonial and rich text.
- Background, corner and shadow options on five blocks only.
- A named colour palette.

It lacks:

- Per-section anchors.
- Colour schemes.
- Art direction.
- Theme-aware typography and buttons.
- Nested content inside tabs and accordions.
- Multiple calls to action.
- Download, link-tile and news blocks.
- Forms that deliver anywhere.

The stories below are ordered so that each one makes a further class of the reference sections
reproducible without hand-written HTML.

## Clarifications

### Session 2026-10-22

- Q: Where are the brand tokens defined? → A: Editable in the admin. They are set globally and
  can be overridden per sales channel. They are not defined in a theme package in code.
- Q: How are section settings modelled? → A: ~~As a shared settings group on every section block.~~
  **Superseded 2026-10-23 by the owner after reviewing the editor:** a dedicated **Section**
  container block (`cms.Section`) holds every section setting and a slot for any blocks. Other
  blocks no longer carry section settings, and Row returns to its pre-feature shape.
- Q: How does a page get its breadcrumb parent? → A: Through an explicit "parent page" field
  chosen by the editor. The parent affects only the breadcrumb trail. The page's URL stays
  independent of it.
- Q: What performance target applies to rebuilt pages? → A: "Good" Core Web Vitals on mobile:
  largest content visible within 2.5 s and layout shift of 0.1 or less, on a mid-range phone
  over 4G. Server-side image resizing stays out of scope.
- Q: What happens to existing blocks that overlap the new capabilities? → A: They are reshaped
  in place, one block per concept. The two existing sliders merge into one carousel. Stored
  content is not migrated automatically; seeders and fixtures are updated in the same change.
  (Refined during implementation: a reshaped block reads its earlier stored shape and renders it
  as before; only a removed block's content shows the placeholder.)

### Session 2026-10-22 (planning)

- Q: How are language alternates announced, given that one storefront URL serves every language?
  → A: Through `og:locale` and `og:locale:alternate` plus a correct document language.
  `hreflang` is deferred until language-prefixed URLs exist, as a separate feature.
- Q: Must one decorative backdrop span a group of adjacent dark sections? → A: No. Each dark
  section paints the decorative layer itself, and adjacent dark sections still touch with no gap.
  **Superseded 2026-10-26 by the owner:** a Section group container paints one continuous
  background and decorative layer behind the Sections it holds (FR-005 amended).
- Q: Where does the product card's short description come from? → A: It is derived from the
  product's description. If that costs a query per product, the fallback is an editor-entered
  subtitle for manually picked products, with no description for dynamic sources.
- Q: Does the performance target include responsiveness? → A: Yes. Interaction to next paint
  must stay below 200 ms, as Principle VII requires.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Brand-consistent sections with anchors and colour schemes (Priority: P1)

A content editor builds a page as a stack of section blocks, such as a row, a hero or a media-
and-text block. Each section block at the top level of the page has a common "section settings"
panel:

- An anchor name, so that buttons and menus can link to `#anchor`.
- A colour scheme: light, muted (light grey) or dark. It switches text, link and button colours
  together.
- A background: none, solid, gradient, image or video. An image can have a separate mobile
  image and an optional darkening gradient overlay.
- Top and bottom spacing chosen per breakpoint from a spacing scale.
- A content width: contained, wide or full bleed.

All text, headings and buttons use the brand's fonts, colour palette, type scale and button
styles. An administrator sets these once in the admin, globally and optionally per sales
channel, rather than per block.

**Why this priority**: every reference page relies on alternating dark and light sections,
in-page anchors and brand typography. Without these, nothing else looks right, however many
blocks exist.

**Independent Test**: build a page with three sections: dark with an anchor, muted, and light
with a full-bleed background image that has a different mobile image. Add a button that links
to the anchor. Check:

- The colours switch per section.
- The anchor link scrolls to the right section.
- The mobile image appears below the mobile breakpoint.
- Changing the brand font or primary colour in the admin restyles every block without editing
  the page.

**Acceptance Scenarios**:

1. **Given** a section with the dark scheme, **When** it holds a heading, rich text and a primary
   and an outline button, **Then** all of them render in the scheme's light-on-dark colours
   without per-block colour overrides.
2. **Given** a section with anchor `contact-us`, **When** a visitor follows a link to
   `#contact-us`, **Then** the page scrolls so the section top sits below any fixed header.
3. **Given** two adjacent dark sections, **When** the page renders, **Then** no light gap appears
   between them. If the tokens define a decorative dark layer, each of the two sections paints
   it.
4. **Given** a heading set to semantic level 2 and visual size "display 1", **When** rendered,
   **Then** the document outline shows an H2 while the text uses the display-1 size of the type
   scale, with separate mobile and desktop sizes.
5. **Given** a heading containing a phrase marked "highlight", **When** rendered, **Then** that
   phrase uses the chosen highlight style (accent gradient, accent colour or muted colour).
6. **Given** two anchors on one page with the same name, **When** the editor saves, **Then** the
   editor is warned and the duplicate is not saved silently.

---

### User Story 2 - A full hero for landing pages (Priority: P1)

The editor opens every landing page with a hero. The hero has:

- Full-bleed media: an image or a muted looping video, each with an optional mobile
  alternative.
- An optional small eyebrow label.
- The page title.
- A subheading and a statement, each with a tag and size chosen independently.
- Optional rich text.
- Any number of buttons, each with its own style. One style is an icon-only round "scroll to
  next section" button.
- An optional "social proof" line: a small image such as an avatar group, with a caption.

**Why this priority**: all ten reference pages start with this hero. Today's hero has one button,
no mobile media and no secondary texts.

**Independent Test**: build a hero with a desktop and a mobile video, three buttons in three
styles, a scroll-down button pointing at the next section's anchor, and a social-proof caption.
Check it at mobile and desktop widths.

**Acceptance Scenarios**:

1. **Given** a hero with a desktop video and a mobile video, **When** viewed below the mobile
   breakpoint, **Then** only the mobile video loads, muted and inline, and a poster image shows
   until it can play.
2. **Given** a visitor who prefers reduced motion, **When** the hero has a background video,
   **Then** the poster image is shown instead of autoplaying.
3. **Given** a hero with three buttons, **When** rendered, **Then** they keep their individual
   styles and wrap on narrow screens without overlapping.

---

### User Story 3 - Media-and-text and call-to-action compositions (Priority: P1)

The editor composes the explanatory sections of the reference pages from ready-made section
blocks rather than hand-built rows. The blocks are:

- **Media and text split**: image or video on the left or right, with rich text, a button list,
  an optional list of icon + title + text items and an optional footnote. It can be set to
  alternate sides automatically over several rows.
- **Background-image panel**: a full-bleed image with text placed in one half and a stacked
  mobile layout.
- **Boxed call-to-action card**: a card with a muted or dark fill, holding a heading, text or a
  two-column icon list, buttons and an image.
- **Statement**: a large heading with an optional muted continuation and supporting text,
  optionally over a full-bleed image with the text at the bottom.
- **Icon feature grid**: a heading and N items of icon, title and rich text in 1–4 columns, with
  an optional image below.
- **Key figures**: big values with captions, next to an optional image.

**Why this priority**: these patterns make up most of the body of eight of the ten pages.

**Independent Test**: build an "about us" page with only these blocks plus the hero, and compare
it side by side with the reference at 375, 768 and 1440 px widths.

**Acceptance Scenarios**:

1. **Given** a media-and-text block with media on the right on desktop, **When** viewed on
   mobile, **Then** the media stacks above the text, or below it if the editor chose so.
2. **Given** a feature item whose icon is an uploaded SVG from the asset library, **When**
   rendered, **Then** the icon inherits the section's text colour.
3. **Given** a key-figures block with six values, **When** viewed on desktop, **Then** they lay
   out in the chosen grid (for example 2 × 3).

---

### User Story 4 - One carousel, many item kinds (Priority: P2)

The editor adds carousels whose items are:

- Wide images, with a mobile variant.
- Split slides: media plus icon, title and text.
- Gallery photos.
- Link tiles: an image, a title and a "more" link.
- Download tiles: a title, a subtitle, a file picked from the asset library and an optional image
  revealed on hover.

Every carousel offers:

- Slides per view for each breakpoint, including fractional values that show the next item
  peeking in.
- A slide or fade transition.
- Arrows and dots placed in the header or under the slides.
- Controls hidden automatically when all items already fit.
- An option to let the track bleed past the content edge.

**Why this priority**: carousels appear on half the pages, but a page without them still reads
correctly when items are shown as a grid.

**Independent Test**: build a downloads carousel with three files (PDF, ZIP, image) and a gallery
of 12 photos. Check that file tiles download the files, that peeking works at each breakpoint and
that arrows vanish when only two items are present on a three-per-view desktop.

**Acceptance Scenarios**:

1. **Given** a download tile linked to an asset, **When** the asset is replaced in the asset
   library, **Then** the tile serves the new version without editing the page.
2. **Given** a carousel, **When** used with keyboard only, **Then** arrows are focusable buttons
   with accessible names, and every link in a slide is reachable.
3. **Given** a carousel without client-side scripting, **When** the page is server-rendered,
   **Then** every item's content is present in the HTML, so it can be crawled.

---

### User Story 5 - Tabs, accordions and expandable text with nested content (Priority: P2)

The editor builds an "audience switcher" with:

- A pill-style tab bar.
- Panels that hold any blocks, for example a title, an image, text and a button.
- An optional fade between panels.

The editor also builds accordions whose panels hold any blocks. In rich text, the editor can:

- Mark a passage as "read more" collapsed text.
- Style a list as a check-mark list.
- Insert a button-styled link.
- Give a heading an anchor.
- Add a heading that screen readers and search engines see but the eye does not.

**Why this priority**: today tabs and accordions accept only raw HTML. That forces editors into
markup and breaks translation.

**Independent Test**: build a four-tab audience switcher whose panels each contain an image and
a button, and a three-item accordion with a bullet list in one panel. Translate the page with
the existing translate action and check that the nested texts are translated.

**Acceptance Scenarios**:

1. **Given** tabs with nested blocks, **When** a visitor uses arrow keys on the tab bar, **Then**
   focus and the visible panel follow the accessible tabs pattern.
2. **Given** an accordion item, **When** rendered on the server, **Then** the panel content is
   present in the HTML even while collapsed.

---

### User Story 6 - Dynamic listings: news, products, link lists (Priority: P2)

The editor adds:

- A "latest news" carousel fed from blog posts (latest N, optionally from one category), with a
  header button to the blog index.
- A product carousel showing picked products as cards: image on a neutral backdrop, name, short
  description and a "more" link.
- A simple link-row list, for example job offers that each point to an external posting with a
  button.

**Why this priority**: four pages use these. Blog and catalog data already exist, so editors
should not copy content by hand.

**Independent Test**: publish two blog posts, add a news carousel limited to three posts and
check the newest appear first. Unpublish one and check it disappears without editing the page.

**Acceptance Scenarios**:

1. **Given** the blog module is turned off, **When** a page contains a news carousel, **Then**
   customers see nothing in its place, and the editor sees a note that the block's module is off.
2. **Given** a product carousel, **When** a picked product is deactivated, **Then** it is
   omitted, and the carousel still renders with the remaining products.

---

### User Story 7 - Newsletter sign-up that actually subscribes (Priority: P3)

The editor places a newsletter sign-up in a section, either as a boxed call to action or inline.
It offers:

- An e-mail field.
- An optional group of topics the visitor can choose.
- A required consent whose label contains a link to the privacy policy.

Submitting subscribes the visitor through the existing newsletter capability. Other forms on the
reference pages, such as a job application or a training sign-up, stay as embedded third-party
forms through the existing contact-form embed block. A general form builder with stored
submissions is a separate, later feature.

**Why this priority**: the sign-up is one section on one page, but today the block posts to a
free-text address and subscribes nobody.

**Independent Test**: place the sign-up on a page, subscribe with one topic chosen, and find the
subscription, with its topic and consent, in the newsletter module.

**Acceptance Scenarios**:

1. **Given** the consent left unchecked, **When** the visitor submits, **Then** the sign-up
   refuses with a message next to the consent and keeps the typed address.
2. **Given** the newsletter module is turned off, **When** a page contains the sign-up, **Then**
   customers see nothing in its place.

---

### User Story 8 - Breadcrumbs that follow the page tree (Priority: P3)

The editor controls the breadcrumb trail per page: shown or hidden, its colour scheme, and the
page's parent page, so that an audience page shows *Home › Client zone › Page*. The header,
footer and mega menu are out of scope for this feature.

**Why this priority**: nine of the ten reference pages show the trail. Today the trail cannot
express a parent and cannot be hidden.

**Independent Test**: give two audience pages a "client zone" parent and check their breadcrumb
trails. Hide breadcrumbs on a third page and check that it shows none.

**Acceptance Scenarios**:

1. **Given** a page with a parent page, **When** rendered, **Then** the breadcrumb trail and the
   breadcrumb structured data list the parent between Home and the page.
2. **Given** a parent chain that would loop back to the page itself, **When** the editor saves,
   **Then** the save is refused with an explanation.

---

### User Story 9 - Sharing and search metadata (Priority: P3)

The editor sets a sharing image per page, with a deployment-wide default. Translated pages
announce their other languages in their sharing metadata. The deployment can publish its organisation details (name,
logo, address, contact, social profiles) as structured data.

**Why this priority**: invisible on the page, but expected of every corporate site the reference
represents.

**Independent Test**: inspect a published page's head: it carries the page's sharing image,
a locale alternate for each translation, and the organisation data.

**Acceptance Scenarios**:

1. **Given** a page without its own sharing image, **When** shared, **Then** the default image is
   used.

---

### User Story 10 - Restrained motion (Priority: P3)

The editor can turn on, per section or block:

- An entrance reveal: fade-and-rise, or word by word for a statement.
- A gentle zoom on image hover.
- An animated decorative backdrop on dark sections.

**Why this priority**: it adds polish but does not change content.

**Independent Test**: enable a word reveal on a statement and check that it plays once on scroll,
on desktop only if so configured, and never for visitors who prefer reduced motion.

**Acceptance Scenarios**:

1. **Given** reduced-motion preference, **When** any animated section renders, **Then** its
   content is shown in its final state immediately.

---

### Edge Cases

- **Content saved by earlier block versions.** Backward compatibility is not required, and stored
  content is not migrated (FR-041a). The demo seed and every built-in seeder must produce pages
  that render without errors. A reshaped block reads content stored in its earlier shape and
  renders it as before; only content of a removed block degrades to the missing-block
  placeholder, rather than crashing the page.
- **Art direction with only one image.** A section with a mobile image but no desktop image, or
  the reverse, uses the one provided at every width.
- **Anchor values.** Anchor names that collide with reserved storefront fragments, or that
  contain spaces or non-ASCII characters, are normalised to a safe form, and the editor sees the
  result.
- **Missing assets.** A download tile whose asset was deleted is hidden from customers and
  flagged in the editor preview.
- **Very long headings in narrow columns.** Words wrap or hyphenate rather than overflowing the
  viewport. No horizontal page scroll appears at 320 px.
- **Dark scheme with a light-only brand asset.** A logo or icon image that would be invisible on
  the dark scheme is the editor's responsibility. Inline icons follow the scheme's text colour.
- **Translation.** Every new text field, including texts nested in tabs, accordions, carousel
  items and form labels, is declared translatable and is changed by the existing translate
  action. Anchors, links, files and layout choices are not translated.
- **Module off.** Blocks owned by a module that is switched off (blog, catalog,
  newsletter) behave as if the module were never installed (Principle XVII).

## Requirements *(mandatory)*

### Functional Requirements

**Sections and brand (US1)**

- **FR-000**: The page builder MUST provide a **Section** container block (`cms.Section`). It
  holds one group of section settings (anchor, colour scheme, background, spacing, content width
  and entrance reveal) and a slot that accepts any other blocks. A Section MAY be placed only at
  the top level of a page; it cannot be nested inside another block. No other block carries
  section settings. Blocks outside a Section keep their own options and render as they do
  without one.
- **FR-001**: The Section block MUST offer an anchor name, unique within the
  page. Buttons, rich-text links and menu items MUST be able to target it.
- **FR-002**: The Section block MUST offer a colour scheme of light, muted or dark. The
  scheme MUST set text, heading, link, border and button colours for all blocks inside it, unless
  a block overrides them.
- **FR-003**: The Section block MUST offer a background of none, solid, gradient, image or
  video. An image or video MUST accept an optional mobile alternative and an optional gradient
  overlay with direction and strength.
- **FR-004**: The Section block MUST offer top and bottom spacing chosen per breakpoint
  from a named spacing scale, and a content width of contained, wide or full bleed.
- **FR-005**: Adjacent sections with the dark scheme MUST render as one continuous dark area,
  with no gap between them. A dark section MAY paint the decorative layer defined in the brand
  tokens. **Amended 2026-10-26 (owner):** the page builder MUST also offer a **Section group**
  container (`cms.SectionGroup`, top-level only) that holds Sections and paints one background
  and one decorative layer continuously behind all of them, so the layer has no seams at the
  Section boundaries.
- **FR-006**: An administrator MUST be able to edit the brand tokens on an admin screen. The
  tokens are:
  - font families (heading and body);
  - the type scale, with separate mobile and desktop sizes;
  - primary, secondary and neutral colours;
  - accent gradient;
  - button shapes and styles;
  - spacing scale.

  The tokens are set once globally. A sales channel MAY override any of them. All page-builder
  blocks MUST use the effective tokens of the page's channel instead of fixed values.
- **FR-006a**: Changing the brand tokens MUST require a dedicated admin permission. Saved
  changes MUST take effect on the storefront without a rebuild or redeploy.
- **FR-006b**: The brand-token screen MUST warn when a text and background colour pair used by a
  colour scheme falls below the WCAG 2.2 AA contrast ratio. The pair can still be saved after the
  warning.
- **FR-006c**: Brand fonts MUST be selectable from fonts uploaded to the asset library or from a
  configured font service. A font that fails to load MUST fall back to a system font of the same
  kind.
- **FR-007**: Headings MUST let the editor choose the semantic level (H1–H6 or paragraph) and the
  visual size from the type scale independently.
- **FR-008**: Heading text MUST support marking one or more phrases with a highlight style:
  accent gradient, accent colour or muted.
- **FR-009**: Buttons MUST offer the brand's styles, in filled and outline forms, for the primary,
  secondary, light and dark colours. They MUST also offer sizes (small, medium, large), an
  icon-only round form, and an optional leading or trailing icon. They MUST link to a URL, a
  catalog item, a CMS page, an asset file or an in-page anchor.
- **FR-010**: Any block that shows an image MUST accept an optional separate mobile image and a
  per-breakpoint aspect ratio.

**Hero (US2)**

- **FR-011**: The hero MUST offer:
  - full-bleed image or video media, each with an optional mobile alternative and a poster image;
  - an eyebrow;
  - a title, a subheading and a statement, each with independent level and size;
  - rich text;
  - an ordered list of buttons, of any length;
  - an optional social-proof image with caption;
  - alignment and spacing between items.
- **FR-012**: Background and hero videos MUST play muted, inline and looped, MUST load only for
  the breakpoint that shows them, and MUST NOT autoplay for visitors who prefer reduced motion.

**Section blocks (US3)**

- **FR-013**: The page builder MUST provide a media-and-text block with:
  - media side (left or right) and mobile stacking order;
  - rich text;
  - button list;
  - optional icon-item list;
  - optional footnote;
  - vertical alignment;
  - an "alternate sides" option over repeated rows.
- **FR-014**: The page builder MUST provide a background-image panel block, with text placed in
  one half on desktop and stacked on mobile.
- **FR-015**: The page builder MUST provide a boxed call-to-action card with:
  - a muted or dark fill;
  - a heading, text and an optional two-column icon list;
  - buttons;
  - an image.
- **FR-016**: The page builder MUST provide a statement block with an optional muted
  continuation, supporting text and an optional full-bleed background image with the text
  anchored at the bottom.
- **FR-017**: The feature grid MUST support 1–4 columns per breakpoint, rich-text item bodies,
  icons from the built-in set or from uploaded SVG assets, and an optional image below the grid.
- **FR-018**: The key-figures block MUST support a heading, an optional image beside the figures,
  and a configurable grid per breakpoint.

**Carousels (US4)**

- **FR-019**: All carousels MUST share one set of behaviour options:
  - slides per view per breakpoint, fractional values allowed;
  - gap;
  - slide or fade transition;
  - arrows, dots or both, and where they are placed;
  - optional autoplay, off by default;
  - bleeding past the content edge;
  - automatic hiding of controls when every item is visible.
- **FR-020**: Carousels MUST support these item kinds: wide image, split media slide, gallery
  photo, link tile and download tile. Wide image and gallery photo MAY be one item kind with
  two presentations.
- **FR-021**: A download tile MUST reference a file in the asset library by identity, so that
  replacing the asset updates the tile. Following the tile MUST download or open that file.
- **FR-022**: Carousels MUST be operable by keyboard and screen reader. All item content MUST be
  present in the server-rendered page.

**Nested interactive content (US5)**

- **FR-023**: Tab panels and accordion panels MUST hold any page-builder blocks instead of raw
  HTML.
- **FR-024**: Tabs MUST offer a pill style and an optional fade between panels, and MUST follow
  the accessible tabs keyboard pattern.
- **FR-025**: Rich text MUST support:
  - a collapsible "read more" passage;
  - check-mark list styling;
  - button-styled links;
  - anchors on headings;
  - visually hidden headings.

**Dynamic listings (US6)**

- **FR-026**: The blog module MUST contribute a latest-posts block. Its options are a count, an
  optional category, a carousel or grid layout, and a header button. Each card shows the image,
  category, title and a read-more link.
- **FR-027**: The product carousel and grid MUST offer a card style with the image on a neutral
  backdrop, the product name, a short description and a "more" link. The short description is
  derived from the product's description. If deriving it costs a query per product, the fallback
  is an editor-entered subtitle for manually picked products, and dynamic sources show no
  description.
- **FR-028**: The page builder MUST provide a link-row list in which each row has a title, an
  optional description and a button that links anywhere.

**Newsletter sign-up (US7)**

- **FR-029**: The newsletter sign-up block MUST subscribe through the newsletter module instead
  of a free-text form action. It MUST offer an optional topic choice and a required consent with
  a linked label, and it MUST record the consent with the subscription.

**Breadcrumbs (US8)**

- **FR-030**: A page MUST be able to name a parent page. The breadcrumb trail and its structured
  data MUST follow the parent chain. The page's URL MUST NOT be derived from the parent.
- **FR-030a**: If a page in the chain is not published in the visiting channel, its crumb MUST
  show as plain text without a link. Deleting a parent MUST clear the parent field on its
  children.
- **FR-031**: A page MUST be able to hide breadcrumbs and to set the breadcrumb colour scheme.
- **FR-032**: Saving a parent chain that loops back to the page MUST be refused.

**Metadata (US9)**

- **FR-033**: A page MUST be able to set a sharing image. The deployment MUST be able to set a
  default sharing image.
- **FR-034**: A page published in several languages MUST announce its served language and its
  other languages through `og:locale` and `og:locale:alternate`, and MUST set the document
  language. `hreflang` alternates are out of scope until the storefront has per-language URLs.
- **FR-035**: The deployment MUST be able to publish organisation structured data: name, logo,
  address, contact details and social profiles.

**Motion (US10)**

- **FR-036**: Sections and blocks MUST offer optional entrance reveals (fade-and-rise, word by
  word), restrictable to desktop. Image blocks and tiles MUST offer an optional hover zoom.
- **FR-036a**: Images and videos below the first screen MUST load only when they approach the
  viewport. Interactive behaviour of carousels, tabs and reveals MUST load only for pages that
  contain those blocks. Media MUST reserve its space before loading, so the layout does not
  shift.
- **FR-037**: All motion MUST be disabled for visitors who prefer reduced motion, and content
  MUST be readable before any script runs.

**Cross-cutting**

- **FR-038**: Every new or changed block MUST:
  - render the same in the admin preview and on the storefront;
  - declare its translatable texts;
  - carry translated palette labels in every admin language;
  - degrade to the existing placeholder when its renderer is missing.
- **FR-039**: Field labels of the new and changed blocks MUST be translatable in the admin.
- **FR-040**: Product code, documentation and examples MUST stay generic. They MUST NOT name,
  depict or embed content from any particular customer's website.
- **FR-041**: After the platform setup and the demo seed, every seeded CMS page, block, template and
  hook attachment MUST render without errors. Every seeder that writes page-builder content MUST
  be updated in the same change as any block it uses.
- **FR-041a**: Where an existing block covers the same concept as a new capability, the
  existing block MUST be reshaped in place rather than duplicated. This applies to the hero,
  the feature list, stats, tabs, the accordion and the testimonial. The palette MUST NOT offer
  two blocks for one concept, and the image slider and the content slider MUST become the single
  carousel of FR-019 and FR-020. Stored content is not migrated in the database; a reshaped block
  MUST read content stored in its earlier shape and render it as before (plan § *Extend, don't
  narrow*). Only content of a **removed** block degrades to the existing missing-block
  placeholder, and it MUST NOT break the rest of the page. The external-endpoint newsletter form
  (`cms.NewsletterSignup`) and the module-backed sign-up (`newsletter.Signup`) are different
  concepts and both stay (owner decision 2026-10-23, T076); their palette labels MUST tell them
  apart.
- **FR-042**: The admin MUST ship a small set of section presets assembled from the new blocks:
  - hero;
  - media and text;
  - call-to-action card;
  - downloads;
  - feature grid;
  - statement.

  An editor can insert a preset and then edit it.

### Key Entities *(include if feature involves data)*

- **Section settings**: anchor, colour scheme, background (with mobile alternative and overlay),
  spacing per breakpoint, content width, motion. A shared group carried by every section block
  and in effect only when that block sits at the top level of the page.
- **Brand tokens**: font families, type scale, palette, accent gradient, button styles, spacing
  scale. Edited in the admin, set globally and optionally overridden per sales channel. Each
  channel resolves its effective token set from the global values plus its own overrides.
- **Carousel item**: one of wide image, split slide, gallery photo, link tile or download tile.
  Each carries its own fields and references assets by identity.
- **Page**: gains an optional parent page (breadcrumbs only, independent of its URL), a breadcrumb visibility and scheme, and a sharing image.
- **Newsletter subscription**: uses the newsletter module's existing tags for the topics chosen
  and its existing consent timestamp for the consent given. The source `cms-block` tells this
  sign-up apart from the others.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All ten reference page types can be rebuilt using only page-builder blocks, with
  no raw HTML or script blocks:
  - home;
  - four audience landing pages;
  - about;
  - careers;
  - technology;
  - global presence;
  - academy.

  Sections holding a job-application or training sign-up form count when the form is an
  embedded third-party form.
- **SC-002**: In a side-by-side review at 375, 768 and 1440 px widths, at least 90% of the
  reference sections are judged to match in layout, hierarchy and colour scheme. The remaining
  10% deviate only in motion or decorative detail.
- **SC-003**: An editor familiar with the builder can rebuild one audience landing page of eight
  sections in under 45 minutes, using presets.
- **SC-004**: Changing the brand's primary colour or font in one place restyles 100% of the
  page-builder blocks on every page, with no page edited.
- **SC-005**: Every rebuilt page shows its full text content with scripts disabled, and has no
  horizontal scroll at 320 px.
- **SC-005a**: Every rebuilt page reaches "good" Core Web Vitals on mobile in a lab measurement
  on a mid-range phone profile over 4G: largest contentful paint of 2.5 s or less, cumulative
  layout shift of 0.1 or less, and interaction to next paint below 200 ms. The page is measured
  with its real media and its interactive blocks: carousels, tabs, accordions and the sign-up
  form.
- **SC-006**: Every rebuilt page passes an automated WCAG 2.2 AA check with zero serious
  violations in both colour schemes.
- **SC-007**: The demo setup completes, and every seeded CMS page and block renders, on a fresh
  database.

## Assumptions

- **Scope.** The goal is page reproduction, not reproduction of the reference's data model.
  Things that already have a home in the platform are fed from those modules instead of from
  page content:
  - product data from the catalog;
  - news from the blog;
  - files from the asset library;
  - languages from the existing language support.
- **Existing content.** Backward compatibility of stored page content is not required. Existing
  blocks are reshaped in place (FR-041a), and the demo seed, the built-in seeders and the
  conformance fixtures are updated alongside.
- **Channel brand overrides.** A sales channel's override is a complete copy of the brand
  settings. A later change to the global settings does not flow into a channel that has an
  override. The brand screen says so and offers "Reset to global".
- **Fonts.** Brand fonts are uploaded to the asset library or loaded from a configured font
  service. Font licensing is the deployment's responsibility.
- **Video.** Video is self-hosted through the asset library. Embedded third-party players stay
  available through the existing video block.
- **Out of scope.** These are not part of this feature:
  - a filterable reference gallery with a taxonomy;
  - the category showcase with oversized words;
  - search overlay styling;
  - the header, footer, mega menu, language switcher and floating contact shortcut;
  - a general form builder with stored submissions (planned as a separate feature);
  - third-party cookie, tag-manager and anti-spam vendors (existing modules cover analytics and
    consent).

  The category showcase can be approximated with the new blocks.
- **Responsive images.** Image resizing and format conversion at serve time are out of scope.
  The performance target (SC-005a) is met through art direction (FR-010), deferred loading and
  reserved media space (FR-036a), and editors uploading images in suitable sizes.
- **Preview pages.** Pages built during development to compare against the reference are working
  material. They are kept outside the committed tree and are not part of the product.
