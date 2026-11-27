# Implementation Plan: Page builder for corporate marketing pages

**Branch**: `feat/163-page-builder-marketing-pages` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)
(clarified 2026-10-22, five answers)
**Input**: the spec above. Owner rulings: brand tokens editable in the admin (Q1); section
settings on every section block (Q2); an explicit parent page (Q3); "good" Core Web Vitals on
mobile without image resizing (Q4); overlapping blocks reshaped in place, with no content
migration (Q5).
**Builds on**:

- `specs/141-module-block-renderers/` (block ownership, degradation);
- `specs/151-page-builder-translate/` (translatable declarations);
- `specs/156-asset-stable-url/` (asset identity and permalinks).

All three are on `origin/master`.

## Summary

The page builder gains what a corporate marketing site needs: brand-consistent sections, a full
hero, ready-made section compositions, one carousel with item kinds, nested tabs and accordions,
dynamic news, product and newsletter blocks, breadcrumbs from a page tree, and sharing metadata.
None of it is specific to any deployment. The approach is below; evidence and rejected
alternatives are in [research.md](./research.md).

- **Brand tokens** (R-1 to R-7):
  - **Storage.** A `cms`-owned table, `cms_brand_tokens`. The global row and any per-channel
    row are each a complete set.
  - **Writes.** They go through a `cms.brand_tokens.update` Command on a new `/cms/brand` screen,
    behind the new permission `cms.brand`. The Command writes the row itself, so there is exactly
    one audit entry per change.
  - **Delivery.** The storefront server-renders them as `--cmsb-*` variables in
    `<style id="cmsb">`. The admin injects the same CSS into the Puck iframe.
  - **Fallbacks.** `cms-components.css` swaps about 100 literals for `var(--cmsb-*, <literal>)`.
    With no tokens set, nothing changes visually.
  - **Contrast.** One pure function in `contracts` gives the contrast warnings.
- **Sections** (R-8, R-9):
  - **The prop.** A shared `section` prop carries anchor, scheme, background (art direction,
    overlay, video), spacing tokens, width and reveal.
  - **Top-level detection.** A depth context in `withHideOn` decides whether the block is at the
    top level. Nested blocks ignore their section settings.
  - **Schemes** rebind CSS variables through `data-cmsb-scheme`.
  - **Anchors** are normalised, and duplicates are refused at save.
- **Typography and actions** (R-10, R-11):
  - **Headings.** Semantic level and visual size are separate, and heading texts are inline rich
    text with an `emphasis` mark (gradient, accent or muted).
  - **Links and buttons.** One `LinkValue` (URL, page, product, category, asset or anchor) and
    one `ButtonSpec` serve every block.
- **Blocks** ([contracts/blocks.md](./contracts/blocks.md)):
  - **New**: `cms.MediaText`, `cms.BackgroundPanel`, `cms.CtaCard`, `cms.Statement`,
    `cms.LinkList`, four carousel item blocks, `blog.LatestPosts` and `newsletter.Signup`.
  - **Reshaped in place**: Hero, Heading, Button, FeatureList, Stats, Testimonial, Tabs,
    Accordion, ContentSlider (now labelled "Carousel"), ProductGrid and ProductSlider.
  - **Removed**: `cms.ImageSlider`. `cms.NewsletterSignup` is removed only if the owner agrees in
    T076 (§ *Extend, don't narrow*, open point).
- **Carousel** (R-12): it stays native scroll-snap, with no dependency. Slides per view move
  from JavaScript to CSS, which fixes today's hydration shift. It gains a fade effect, peek,
  bleed, control placement and automatic hiding of controls.
- **Rich text** (R-14) gains read-more `<details>`, check lists, button links, heading anchors and
  visually hidden headings. The sanitizer gains exactly `details`, `summary` and a
  pattern-checked `id` on headings.
- **Data** (R-15 to R-18, R-20):
  - **Block data seam.** The SSR seam is generalised from catalog-only to catalog plus blog.
  - **Blog.** Posts get an image column and a `/posts?limit&categorySlug` list.
  - **Product cards** get a derived `summary`.
  - **Newsletter sign-up** posts to a storefront route handler that calls the existing subscribe
    API.
  - **Pages** get `parentPageId`, breadcrumb settings and a sharing image.
  - **Open Graph and Organization JSON-LD** are completed.
- **Motion** (R-21) is CSS-first, opt-in, off under reduced motion, and content is visible
  without JavaScript.
- **Presets** (R-22): six code-side section presets are inserted from the editor drawer.

The feature adds no runtime dependency and needs three migrations (two in `cms`, one in `blog`),
three settings,
one permission, one palette action, three minted error codes, two new public reads and one
storefront route handler.

## Owner ruling 2026-10-23: a Section container block

After reviewing the editor, the owner replaced Clarification Q2 (section settings on every section
block) with a dedicated `cms.Section` container block: the section settings live only there, with a
slot for any blocks; Section is top-level only. Consequences, implemented in the Phase R tasks of
[tasks.md](./tasks.md):

- `section` is removed from every other block (Hero, MediaText, BackgroundPanel, CtaCard,
  Statement, FeatureList, Stats, Testimonial, Tabs, Accordion, Carousel, LinkList, LatestPosts,
  ProductGrid/Slider, `newsletter.Signup`, `cms.NewsletterSignup`, LogoStrip, Video, Map,
  SimpleTable, CategoryGrid, CategoryList).
- `cms.Row` returns to its `origin/master` shape (every option it has there, unchanged).
- The top-level depth context is no longer needed to decide where section settings apply; the
  Section renderer applies them always. It stays only where another feature still reads it (the
  hero's first-block image priority looks through a top-level Section).
- Anchors: the duplicate/reserved guard reads the anchor of top-level Sections (its `anchor`
  prop since T117, when the settings became the Section's own top-level props so that the
  responsive ones reach the editor's Responsive tab).
- Presets insert a Section holding the block.
- Blocks keep their intrinsic visuals (a hero's media, a panel's background image, a card's fill).
  A full-bleed statement or panel is a Section with width `bleed` or `full`.

## Owner ruling 2026-10-26: a Section group container

After the third local rebuild the owner chose a **Section group** (`cms.SectionGroup`) to remove
the seams of the decorative layer between adjacent dark Sections. It supersedes R-8a's "per
section only": the group is a top-level container whose slot accepts only `cms.Section`; it owns
the colour scheme, background and decorative layer painted once behind all its Sections; its
Sections may be nested in it (the only place a Section may be nested). Anchors, the hero's
first-block lookup and empty-collapse look through a top-level group. Tasks: Phase R9.

## Extend, don't narrow (binding, owner ruling 2026-10-22)

The goal is a richer page builder in which a corporate marketing site, such as the reference
set, can be rebuilt **naturally, through configuration and generic blocks**. Existing blocks are
not to be turned into look-alikes of any one site. This section is binding on every phase. The contract,
the data model and the tasks are aligned with it; if any of them still disagrees, this section
wins.

### Rules

1. **Every reshaped block keeps a superset of today's options.** Each field it has on
   `origin/master` keeps the same or an equivalent control. The "In place" ruling (Clarification
   Q5) changes the shape of stored props, never the set of things an editor can do.
2. **Tokens are the default, not a cage.** Wherever a block now reads a brand token (font, size,
   weight, colour, radius, spacing), the editor can still override it with a literal value (px,
   hex, font family), as today. The override sits in an "Advanced" or "Custom" group, and choosing
   "Custom" reveals the literal field, as `customMaxWidthPx` does today.
3. **Neutral defaults.** New and reshaped blocks default to a plain look consistent with today's
   blocks:
   - no overlay unless media is set;
   - start alignment except where today's block is centred;
   - `h2`/`h3` sizes for section headings, not `display`;
   - one primary button.

   A distinctive look is something an installation configures through the brand screen and block
   options, not something a default imposes.
4. **Generic names and copy.** Block names, option labels, preset copy and docs describe the
   pattern, never a site or an industry. Nothing in labels, defaults or presets is tuned to the
   reference set: no "for architects", no reference colours or fonts as defaults.
5. **Removal only with a full equivalent.** A removed block (`cms.ImageSlider`,
   `cms.NewsletterSignup`) is removed only when its replacement covers every option it had.

### What today's blocks must keep (from the code inventory)

| Block | Option on `origin/master` | Where it lives after this feature |
| --- | --- | --- |
| `cms.Row` | `sectionLayout`: `in_flow`, `full_width`, `full_viewport`, `full_bleed` | Section `width`: `contained`, `wide`, `full`, plus `viewport` (full viewport height and width) and `bleed` (content to the edges). Nested rows keep `sectionLayout` as today |
| | `contentMaxWidth`: `none`/`narrow`/`wide`/`custom`, `customMaxWidthPx`, `contentPosition` | Section `width` gains `custom` with `customMaxWidthPx`, and a `contentPosition` option |
| | `minHeight`, `overflow`, `cornerRadius`, `shadow`, `border`, margin and padding | Kept. At top level, margin and padding map to section spacing with a "Custom (px)" choice per side; `cornerRadius`, `shadow`, `border` and `overflow` stay on the row |
| `cms.Heading` | `fontFamily` (sans/serif/mono), `fontStyle`, `color`, `fontSize`, `fontWeight`, `textAlign`, `lineHeight` | `size` token **or** `Custom` (px), `fontRole` (heading/body) **or** a `Custom` family, plus weight, style, line height and colour (token or hex) and `align` |
| `cms.Text` | The same typography fields | Unchanged, with tokens as defaults (rule 2) |
| `cms.Button` | `variant` `primary`/`secondary`/`ghost` (responsive), `backgroundColor`, `textColor`, `target`, link types | `ButtonSpec` gains `fill: 'text'` for today's `ghost`, keeps per-button `backgroundColor`/`textColor` overrides and a responsive style, and its `LinkValue` covers today's link types |
| `cms.Hero` | `heading`, `subtitle`, one button and its colour overrides, `background` (solid/gradient/image/video), `overlayOpacity`, `textColor`, `contentAlign`, `minHeightPx`, `cornerRadius`, `shadow`, box fields | Kept: `title` and `subheading` cover heading and subtitle; `buttons[]` cover the button with the same overrides. `media` gains `solid` and `gradient` kinds. `overlay` keeps a plain opacity. `textColor`, `minHeight` with `Custom (px)`, `cornerRadius` and `shadow` stay. Default: no overlay without media |
| `cms.FeatureList` | `columns`, `gap`, `iconColor`, `iconSize`, `align` | All kept. `iconColor` takes a token or hex |
| `cms.Stats` | `columns`, `gap`, `align`, `valueColor` | All kept |
| `cms.Testimonial` | `quote`, `author`, `role`, avatar (URL or library), `background`, `cornerRadius`, `shadow` | Kept. `layout: 'card'` (today's look) is the default; `image-overlay` is added |
| `cms.Tabs` / `cms.Accordion` | `variant`, `align`, `defaultTab`, `allowMultiple`, `defaultOpen`, `iconPosition` | All kept; only the panel content changes from HTML to blocks |
| `cms.ImageSlider` (removed) | Per item: image (URL or library), `title`, `titlePlacement`, title background, colour, border colour, width, radius and padding; slider options | `cms.CarouselImage` carries the same caption options (`captionPlacement` and the five caption style fields). The Carousel carries the slider options |
| `cms.NewsletterSignup` (removal pending T076) | `heading`, `description`, `placeholder`, `buttonLabel`, `actionUrl` (any form endpoint) | `newsletter.Signup` keeps every field and adds `target: 'newsletter' \| 'external'`. `external` posts to `actionUrl` as today, so an external provider still works. **Open point**: an external target cannot depend on the `newsletter` module, so this mode either stays in a `cms`-owned block or the removal is dropped; decided in T076 with the owner |
| `catalog.ProductGrid` / `ProductSlider` | `source`, `productSlugs`, `categorySlug`, `searchQuery`, `limit`, `columns`, `gap`, `view`, slider options | All kept; `header`, `cardVariant`, `ctaLabel` and `footerButton` are additions |

### How it is enforced

- **Option-parity test.** One test per reshaped or removed block maps every field the block had
  on `origin/master` to its counterpart, and fails if a field has none. The old field lists are
  recorded in the test as literals, from `git show origin/master:<file>`. The test lives in
  `packages/cms-components/src/components/option-parity.test.ts` and is written in the phase that
  reshapes the block, before the reshape (RED).
- **Default-look check.** The fallback-parity test (T024) extends to the reshaped blocks'
  defaults. With no brand tokens set, a reshaped block's default render matches today's default
  colours, alignment and sizes.
- **Review question for every block PR**: "What can an editor do on `origin/master` that they
  cannot do here?" The answer must be "nothing".
- **Where it lands**: [contracts/blocks.md](./contracts/blocks.md), [data-model.md](./data-model.md)
  §3.2 and §3.4, and [tasks.md](./tasks.md). The tasks are standing rule 14 and the parity cases in
  T034, T038, T042, T048, T053 and T076, with the default-look cases in T024.

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM.

**Primary Dependencies**:

- **Backend**: Fastify, MikroORM (PostgreSQL), Zod.
- **Admin and storefront**: React 19.
- **Editor**: `@puckeditor/core` 0.23 and TipTap 3.31, both existing.
- **Storefront**: Next.js 15.
- **No new runtime or dev dependency.**

**Storage**: PostgreSQL.

- `cms_pages`: four columns.
- `blog_posts`: one column.
- `cms_brand_tokens`: a new table, one row per scope (global or channel).
- Settings values for the default sharing image, the shop logo and social profiles.
- Page-builder content JSON shapes ([data-model.md](./data-model.md) §3–4).

**Testing**: Vitest.

- Co-located unit tests in `contracts`, `page-builder-core`, `cms-components` and the modules.
- Backend contract and integration tests: brand-token routes, page parent and anchors, the blog
  list, off states and channel scoping.
- `storefront/test/ssr/*` for the SSR floor of every block.
- `admin/test/modules/cms/*` for the brand screen, section-field visibility and presets.
- Every admin render runs in `<StrictMode>`.

**Target Platform**: Linux server, the evergreen-browser admin SPA, and the Next.js storefront.

**Project Type**: web application monorepo (`backend/`, `admin/`, `storefront/`, `packages/`).

**Performance Goals**:

- SC-005a: LCP ≤ 2.5 s, CLS ≤ 0.1 and INP < 200 ms on a mid-range phone over 4G (Principle VII).
- The brand tokens cost one cached read per storefront request: a Next.js tag cache with
  `revalidate: 300`, backed by one indexed query on `cms_brand_tokens`.
- No query per block.
- The blog list is one query with a `limit`.

**Constraints**:

- Content is readable without JavaScript (SC-005).
- No horizontal scroll at 320 px.
- No setting change requires a rebuild (FR-006a).
- Off modules' blocks are absent (XVII).
- Code, docs and examples stay generic (FR-040).
- The demo seed renders (FR-041).

**Scale/Scope**:

- About 31 blocks touched: 11 new, 12 reshaped, 6 more that gain only `section`, and 2 removed.
- Shared prop types: 5.
- Field factories: 6, namely section, inline rich text, link, button list, responsive image and
  colour token.
- Routes: 4 new and 3 extended.
- About 150 i18n keys × 2 languages.
- Documentation: 4 module pages × 2 languages.
- **14 phases, 108 tasks** ([tasks.md](./tasks.md)).

## Constitution Check

*GATE: passed before Phase 0. Re-checked after Phase 1 design with the same verdict.*

| Principle | Verdict | How the design meets it |
| --- | --- | --- |
| **I. Modular architecture (NN)** | Pass | `cms` owns tokens, sections, the cms blocks, the page columns and the brand screen. `blog` owns its column, its list route and the `blog.LatestPosts` declaration. `newsletter` owns `newsletter.Signup`'s declaration. `catalog` owns its reshaped blocks. `settings` owns the shop fields. Shared React code stays in `cms-components`, as the catalog blocks' code already does (R-15). No module imports another's internals: the storefront reaches every module through its HTTP API and the closed block-data union. |
| **II. API-first** | Pass | `cms-brand.ts`, the `LinkValue`/`ButtonSpec`/`SectionSettings` schemas, the resolved-page additions, the blog list and the shop-info additions are written as Zod schemas with tests before any consumer ([contracts/](./contracts/)). Every wire change is additive. |
| **III. TDD (NN)** | Pass | Every phase opens with its failing tests (see Phasing). Each FR and SC maps to a test in tasks.md § *Requirement → test*. |
| **IV. YAGNI, minimal dependencies** | Pass | No Swiper, no GSAP, no colour library. Contrast is the WCAG formula. No per-token inheritance, no continuous backdrop (R-8a), no template seeding, no image pipeline, no form builder. |
| **V. TypeScript everywhere** | Pass | Zod at every boundary: routes, the setting validator, the route handler. Prop types are inferred from the schemas. |
| **VI. Naming (NN)** | Pass | Columns are snake_case: `parent_page_id`, `share_image_asset_id`, `main_image_asset_id`. JSON is camelCase. Paths are kebab-case: `/brand-tokens`. Block names are namespaced: `cms.MediaText`, `blog.LatestPosts`. The Command action is `cms.brand_tokens.update`. The permission is `cms.brand`, the module's existing `cms.<verb>` style. |
| **VII. SEO, performance** | Pass | All content is server-rendered, including tab and accordion panels, carousel items and words in a reveal. Open Graph, absolute BreadcrumbList and Organization JSON-LD are covered. CWV targets: R-23 and SC-005a. Language alternates use `og:locale` per ruling Q1 (R-19). |
| **VIII. English (NN)** | Pass | Comments and docs are in English; Polish appears only in bundles and in the Polish docs tree. |
| **IX. UI reuse** | Pass, with one stated addition | The brand screen composes admin-kit `PageHeader`, `Card`, `Section`, `RouteTabs`, `ColorPicker`, `Select`, `Input`, `Alert`, `SaveButtonGroup`, `sales-channel-picker` and `asset-picker`. Blocks reuse `BoxStyled`, `CarouselShell`, the icon catalog and the asset and link pickers. **Net-new primitive**: the `LinkValue` field. It generalises the existing `ButtonLinkFields` (page, product and category only) by adding asset and anchor, and replaces it rather than adding a second link picker. **Section presets panel**: it extends the existing `RowLayoutPicker` pattern in the block drawer with one more list; no new interaction pattern. |
| **X. Queue consumers** | N/A | Nothing asynchronous is added. |
| **XI. Tenant isolation (NN)** | N/A, with a check | No tenant-scoped entity is added: CMS pages, blog posts and settings are platform content. The newsletter handler uses the existing subscribe path, which already carries organisation linkage. |
| **XII. Sales-channel scoping (NN)** | Pass | Brand tokens, the breadcrumb trail, the blog list and the default sharing image resolve for `getResolvedChannel(request)`, which always resolves and falls back to the system default. The trail reads `cms_page_sales_channels`, which `cms` owns, not a `sales_channel_*` bridge. Cross-channel tests cover a channel token override not leaking, an out-of-channel parent rendering as text, and an out-of-channel blog post absent. |
| **XIII. Command Bus auditing (NN)** | Pass | Brand-token writes are the new `cms.brand_tokens.update` Command. Page-column writes extend the existing `cms_page.update` snapshot, and the blog image extends the blog post Command. The brand-token Command writes its own `cms_brand_tokens` row, so each change has exactly one audit entry; nothing goes through the settings write path, which audits outside a transaction (R-1, R-2). |
| **XIV. Entity-agnostic extensibility** | N/A | No "add a field" requirement. |
| **XV. Untouched core / overlay** | Pass | Everything is generic core capability (FR-040). Any deployment's branding is data in the brand screen, not code. |
| **XVI. Command palette** | Pass | `open-cms-brand` is declared in the `cms` manifest, its permission matches the route gate, and its labels are in `en` and `pl`. |
| **XVII. Operator-toggleable modules (NN)** | Pass | `blog.*`, `newsletter.*` and `catalog.*` blocks are filtered by the existing presence filter. The block-data resolver skips absent owners. The storefront newsletter handler answers 404 when `newsletter` is off. With `cms` off, the brand route is absent and the storefront omits `<style id="cmsb">`. Off-state tests are extended for `blog` and `newsletter` (block absent; route 404) and for `cms` (no style tag). |

**Admin permission manifest**: one new code, `cms.brand`, with
`check:action-route-permissions` and the permission-inventory contract test updated.
**Settings module**: three settings in `cms` and `settings`. Brand tokens are not a setting (R-1).
**Cache**: one storefront tag (`cms:brand`) and one `CACHE_NAMESPACES` entry.
**i18n**: every new string in `en` and `pl` (`specs/conventions/module-i18n.md`).

## Owner questions (answered 2026-10-22; every recommendation accepted; spec.md § Clarifications, planning session)

| # | Question | Ruling |
| --- | --- | --- |
| Q1 | FR-034 "announce each language alternate", while one storefront URL serves every language (R-19) | FR-034 amended: `og:locale` / `og:locale:alternate` plus the document language. `hreflang` is deferred to a feature that adds language-prefixed URLs |
| Q2 | FR-005's continuous decorative backdrop across adjacent dark sections (R-8a) | FR-005 amended: the decorative layer is painted per dark section. Adjacent dark sections still touch with no gap |
| Q3 | The product card's short description (FR-027, R-16) | Derived from the product description. The fallback is an editor subtitle for manually picked products |

## Project Structure

### Documentation (this feature)

```text
specs/163-page-builder-marketing-pages/
├── spec.md
├── plan.md                         # this file
├── research.md                     # R-0 … R-25
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── blocks.md                   # every new and reshaped block: props, defaults, translatable
│   └── storefront-and-admin-api.md # routes, handler, permission, palette, cache
├── checklists/requirements.md
└── tasks.md                        # /speckit.tasks
```

### Source code: every area this feature touches (for overlap judgement)

```text
packages/contracts/src/
├── cms-brand.ts (+ .test.ts)                 # NEW — BrandTokens, defaults, assessBrandContrast
├── page-builder-props.ts (+ .test.ts)        # NEW — LinkValue, ButtonSpec, ResponsiveImage, SectionSettings, InlineRichText
├── cms.ts                                    # page fields, resolved page additions, descriptor.brandTokens
├── blog.ts                                   # post mainImageAssetId, posts list query/response
├── settings.ts                               # ShopInfo logoUrl, socialProfiles
├── errors.ts                                 # CMS_DUPLICATE_ANCHOR, CMS_RESERVED_ANCHOR, CMS_PAGE_PARENT_CYCLE
└── index.ts

packages/page-builder-core/src/
├── fields/{section-field,inline-rich-text-field,link-field-core,button-list-field,responsive-image-field,color-field}.tsx
├── types/{background,section,responsive}.ts
├── visibility/with-hide-on.tsx               # BlockDepthContext, useSectionContext
└── editor/puck-action-guards.ts              # ImageSlider references removed

packages/cms-components/
├── styles/cms-components.css                 # --cmsb-* variables, schemes, section, carousel CSS per view, reveal, sr-only, details
├── src/brand/brand-css.ts (+ .test.ts)       # NEW
├── src/components/{Section,Picture,ButtonView,LinkView,InlineRich}.tsx                    # NEW shared renderers
├── src/components/{MediaText,BackgroundPanel,CtaCard,Statement,LinkList,CarouselImage,CarouselSplit,LinkTile,DownloadTile,LatestPosts,NewsletterSignupForm}.tsx   # NEW
├── src/components/{Hero,Heading,Button,FeatureList,Stats,Testimonial,Tabs,Accordion,ContentSlider,Row,ProductGrid,ProductSlider,CmsProductCard,RichContent*,LogoStrip,Video,Map,SimpleTable,CategoryGrid,CategoryList}.tsx  # reshaped / + section
├── src/components/ImageSlider.tsx, image-slider-*.ts                                       # REMOVED
├── src/components/NewsletterSignup.tsx                           # removed or reshaped, per T076
├── src/components/carousel/CarouselShell.tsx                    # CSS per-view, fade, bleed, auto-hide, a11y
├── src/components/rich-content-shared.ts, src/utils/sanitize-html.ts   # R-14
├── src/utils/{block-data,link-href,reveal}.ts                    # block-data generalised from catalog-block-data
├── src/editor/section-presets.ts                                 # NEW
├── src/schema/component-types.ts, src/index.ts
└── package.json                                                  # exports unchanged

packages/page-builder-admin/src/chrome/{LinkField,AssetPickers,ColorPalette*}.tsx

packages/modules/cms/
├── src/manifest.ts                           # blocks, settings, permission cms.brand, action, errorCodes
├── src/migrations/<stamp>_cms_page_tree_and_share.ts             # NEW
├── src/migrations/<stamp>_cms_brand_tokens.ts                    # NEW
├── src/backend/entities/cms-brand-tokens.entity.ts               # NEW
├── src/backend/entities/cms-page.entity.ts
├── src/backend/services/{cms-page-service,storefront-resolver,cms-page-read-port,asset-references,page-builder-registry}.ts
├── src/backend/services/anchor-guard.ts (+ .test.ts)             # NEW — duplicate/reserved anchors over a tree
├── src/backend/services/brand-tokens-service.ts (+ .test.ts)     # NEW — read, Command, revalidate
├── src/backend/services/translation/block-declarations.test.ts   # fixtures for every new/reshaped block
├── src/backend/routes.admin.ts, routes.storefront.ts, index.ts
├── src/admin/pages/BrandPage.tsx (+ components)                  # NEW
├── src/admin/components/{PageBuilderEditor,page-builder-i18n,PageBuilderActionBar,SliderPreviewActionBarExtras,SectionPresetsPanel}.tsx
├── src/admin/editors/PageEditor.tsx                              # parent, breadcrumbs, share image
├── src/admin/index.ts                                            # route + nav
├── i18n/{en,pl}.json
└── docs/cms/{index,extending-page-builder,brand}.md              # brand.md NEW

packages/modules/blog/
├── src/manifest.ts                           # blog.LatestPosts declaration
├── src/migrations/<stamp>_blog_post_main_image.ts                # NEW
├── src/backend/{entities/blog-post.entity.ts,services/blog-storefront-resolver.ts,services/blog-asset-references.ts,routes.storefront.ts}
├── src/admin/… post editor image field
├── i18n/{en,pl}.json, docs/blog/index.md

packages/modules/newsletter/{src/manifest.ts, i18n/{en,pl}.json, docs/newsletter.md}
packages/modules/catalog/{src/manifest.ts, src/backend/… product summary, i18n, docs}
packages/modules/settings/{src/manifest.ts, src/backend/routes.storefront.ts (shop-info), i18n, docs}

storefront/
├── lib/api/{brand,blog}.ts, lib/server-context.ts, lib/theme/StorefrontDocument.tsx
├── lib/page-builder/{block-data,catalog-block-data}.ts             # generalised
├── components/{BlockData (was CatalogBlockData),CmsPageRenderer,Hook,Breadcrumbs,seo/OrganizationJsonLd}.tsx
├── app/(content)/[...slug]/page.tsx, app/page.tsx
├── app/newsletter/subscribe/route.ts                               # NEW
├── app/reserved-anchors.ts                                         # NEW (ids the layout renders)
└── test/ssr/{blocks,block-ssr-floor,module-blocks}.test.tsx

backend/
├── scripts/conformance/seed-storefront-fixtures.ts                 # cms.Heading new shape
├── src/db/migrations-registry.generated.ts                         # regenerated
├── test/fixtures/error-code-routing/reference-ledgers.ts           # three codes
├── test/contract/cms/{brand-tokens,page-tree,anchors,storefront-page-by-slug}.contract.test.ts
├── test/contract/blog/posts-list.contract.test.ts                  # NEW
├── test/integration/cms/{seeded-content-renders,brand-tokens-channel}.test.ts   # NEW
├── test/integration/{newsletter,cms}/off-state.test.ts            # extended
├── test/integration/blog/off-state.test.ts                         # NEW
└── test/unit/scripts/{check-block-names,check-inventory}.test.ts   # fixture names if they cite removed blocks

admin/test/modules/cms/{brand-page,section-settings-visibility,section-presets,page-builder-i18n,block-contributions}.test.tsx

docs/i18n/pl/…/modules/{cms,blog,newsletter}/*.md, docs/translation-cache/pl/*.json
.changeset/163-*.md                                                 # one per published package meaning
```

**Not touched**: `orders`, `carts`, `quote_requests`, `crm`, `megamenu`, the storefront header,
footer and theme packages, `packages/admin-kit`, and `packages/platform` beyond reading
`StorefrontRevalidator`.

**Structure Decision**: the existing layout. Shared renderers stay in `cms-components`, and block
declarations stay with their owning module.

### Blast radius of the two removals (R-12, R-17)

These files reference `cms.ImageSlider` / `cms.NewsletterSignup` outside `cms-components`; each
is updated in T055 (ImageSlider) or T076 (NewsletterSignup):

- `cms/src/manifest.ts`;
- `PageBuilderEditor.tsx` (field overrides), `PageBuilderActionBar.tsx` and
  `SliderPreviewActionBarExtras.tsx`;
- `translation/block-declarations.test.ts`;
- `backend/test/contract/cms/page-builder-translation.contract.test.ts`.

`page-builder-core/src/migration/frozen-block-renames.ts` is **frozen** and stays untouched: its
entries map legacy names for already-run migrations.

## Migrations

Three, scaffolded with `migration:new`, never numbered by hand:

| Module | Scaffold | Content |
| --- | --- | --- |
| `cms` | `pnpm --filter backend run migration:new -- --module cms --name page_tree_and_share` | the four `cms_pages` columns, the check constraint, the index. `down` drops them |
| `cms` | `pnpm --filter backend run migration:new -- --module cms --name brand_tokens` | the `cms_brand_tokens` table (data-model §1.3). `down` drops it |
| `blog` | `pnpm --filter backend run migration:new -- --module blog --name post_main_image` | `blog_posts.main_image_asset_id uuid null`. `down` drops it |

Each lands with `composer:generate` and the regenerated registry in the same commit.

## Phasing

Phases, tasks and their order are in [tasks.md](./tasks.md):

- Setup and Foundational;
- one phase per user story, with US1 split into 3a–3f;
- Polish and Gate.

That is 14 phases and 108 tasks. Each sub-phase is one builder spawn of at most 10 tasks and can
be committed on its own. Phases marked **[UI]** may go to `endora-commerce-designer`.

## Risks

| Risk | Mitigation |
| --- | --- |
| `--cmsb-*` fallbacks diverge from today's look and an existing page shifts visually | `DEFAULT_BRAND_TOKENS` mirrors today's literals (data-model §2). T024 adds a render test asserting computed defaults against the old values, including in the e-mail editor, which shares the stylesheet |
| The depth context misreads embeds or slot-in-array panels | T009 covers a block at root, in a column, in a tab panel, in a carousel slide, inside `InsertBlock` at root and inside `InsertBlock` in a column |
| Cross-origin font or icon mask is blocked by CORS | Quickstart §1 checks the header. The docs state that `CORS_ALLOWED_ORIGINS` must include the storefront origin and that bucket CORS is needed for cloud storage |
| Product `summary` costs a query per product (R-16) | T004 measures it. The fallback is the editor subtitle (Q3) |
| A reshaped block silently loses an option an installation relies on | § *Extend, don't narrow*: an option-parity test per reshaped or removed block, written RED before the reshape, and a default-look check in T024 |
| Hydrating the whole tree pushes INP past 200 ms | Interactive behaviour (carousel controls, tabs, reveal, sign-up) attaches in effects only, and no block does work on hydration beyond reading props. The Gate (T105) requires INP < 200 ms. If it fails, islands for static blocks are decided before merge |
| Reshaped stored content on existing installations falls to placeholders | Accepted by ruling Q5. FR-041a's placeholder test; the changeset and docs say which blocks changed shape |
| A seeder or test fixture still writes a removed or reshaped block | `check-block-names` flags tree literals. T103 greps `backend/test/**` and the seeders for every removed name and old prop (AGENTS.md trap 2) |
| Derived artefacts go stale: migrations registry, manifest index, error-code ledger, permission inventory, docs cache, read-size ledger | Regenerated in the task that changes the input. T102 confirms a clean `git status` after `composer:generate` / `manifests:generate`, and does not re-record read sizes inside the band |
| Contract and integration suites do not run on merge requests (D-198) | Each phase runs its `[PG]` files locally. T107 runs every server-bound file on the fork's service-backed CI |
| A reference deployment's name or content leaks into the tree (FR-040, C2) | Reference pages are built by scripts under `local/` (excluded locally, quickstart §0). T103 greps the diff for the reference domain and brand words |

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A `cms`-owned table for brand tokens instead of a setting | One Command must own the write and its single audit entry (XIII) | A hidden setting written under a Command audits twice, because settings audit by hand outside the transaction. A Command-only settings write in the kernel changes `packages/platform` (R-1) |
| A server-rendered `<style>` with `--cmsb-*` variables | Admin-editable tokens without a rebuild (FR-006a), with no flash | Build-time CSS contradicts the ruling. Client injection flashes and shifts (R-3) |
| A React depth context in `withHideOn` | Section settings apply only at top level (FR-000), and the storefront never runs `resolveData` | A persisted flag goes stale. Puck's internal depth is not public API (R-8) |
| Generalising the catalog block-data seam to include blog | SSR content for `blog.LatestPosts` (Principle VII) | A module-owned server-data hook is a platform contract change worth its own spec (R-15) |
| Sanitizer additions (`details`, `summary`, `id` on headings) | Read-more and heading anchors without JavaScript (FR-025) | A script-toggled `div` would allow `div` and hide content from crawlers (R-14) |

No runtime dependency is added.

## Constitution Check: post-design

Re-evaluated after research, data model and contracts: **PASS**. No principle is violated, and
five complexity entries are justified above. The three owner questions (Q1–Q3) are answered.
Their rulings narrow FR-005 and FR-034 and confirm the FR-027 fallback, without changing the
architecture.

## Handoff to `endora-commerce-dev`

- **Start condition**: none outstanding. Q1–Q3 are answered and the spec is amended.
- **Branch**: work in a `git worktree` off `origin/master`. Run `scripts/setup-worktree.sh`;
  never symlink `node_modules`.
- **Commits**: commit each phase on its own with `git commit -s`, conventional English messages,
  and no AI trailer.
- **Read first**:
  - [research.md](./research.md) R-1, R-3, R-8, R-12, R-15;
  - [contracts/blocks.md](./contracts/blocks.md);
  - [contracts/storefront-and-admin-api.md](./contracts/storefront-and-admin-api.md);
  - `packages/modules/cms/docs/cms/extending-page-builder.md`.
- **Binding**:
  - Every `--cmsb-*` use has today's literal as its fallback.
  - Section settings render only at top level.
  - No block content may be readable only after JavaScript.
  - No new dependency.
  - No reference-site name, copy or asset in tracked files.
  - The reference pages and the scripts that build them stay under `local/`.
  - **Extend, don't narrow**: every reshaped block keeps a superset of today's options, tokens
    can always be overridden with literal values, and defaults stay neutral (see the section of
    that name).
- **Rebuild**: after editing a package, rebuild it before running a test that imports it
  (`AGENTS.md` § *Building the packages*).
- **Verification per phase**: each phase verifies only its own new or changed tests plus its
  `[PG]` files, locally. The heavy suites run on the fork's CI in the Gate phase (T107).
