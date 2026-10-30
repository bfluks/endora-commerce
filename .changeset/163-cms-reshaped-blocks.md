---
'@endora-commerce/cms-components': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/page-builder-admin': minor
---

`cms.Heading`, `cms.Button`, `cms.Hero`, `cms.FeatureList`, `cms.Stats` and `cms.Testimonial` are reshaped onto the shared block props and brand tokens. Every option they had is kept; the new ones are added beside it.

**Stored content keeps rendering as before.** Each reshaped block maps a document saved in its old shape at render time and again, once, when the editor opens it: `headingFromLegacy`, `buttonFromLegacy`, `heroFromLegacy`, `featureListFromLegacy`, `statsFromLegacy` and `testimonialFromLegacy` are exported from `@endora-commerce/cms-components`. No migration rewrites stored pages, and the translation declarations keep the old paths, so an unopened page stays translatable.

- `cms.Heading`: `text` is `InlineRichText` (a stored string is read as text), `level` h1–h6 or `p`, a `size` from the brand type scale or a custom size per breakpoint, `align`, a colour token, and an advanced group for font, weight, style and line height. Text is edited on the canvas again, through `INLINE_RICH_TEXT_FIELD_TRANSFORMS` (`@endora-commerce/cms-components/editor/inline-rich-text-canvas`), which the host passes to Puck's `fieldTransforms`.
- `cms.Button`: one `button: ButtonSpec` (style, fill and size per breakpoint, icon) plus `align`.
- `cms.Hero`: eyebrow, rich title, subheading, statement and body, up to six buttons, image or video media (background or above the content, per breakpoint), overlay, minimum height, gaps and social proof. Only the hero that leads the page — its first top-level block, or the first block of a first top-level `cms.Section` — loads its image eagerly with high fetch priority.
- `cms.FeatureList`, `cms.Stats`, `cms.Testimonial`: rich item bodies, custom gap and size values, an avatar as a `ResponsiveImage`; columns are CSS custom properties per breakpoint instead of a client-side breakpoint switch.
- `@endora-commerce/page-builder-admin`: `createButtonListField({ responsive })` stores per-breakpoint style and fill.

Behaviour changes to note:

- A stored video hero no longer autoplays unconditionally: videos start only when on screen, never under reduced motion, and use `preload="none"` with the poster.
- A stored heading's `fontWeight` and `lineHeight` now apply even without a custom `fontSize` (they were ignored before).
- A stored URL button whose URL is unsafe (`javascript:` or protocol-relative) renders without a link.
- The exported props types `HeadingProps`, `ButtonProps`, `HeroProps`, `FeatureListProps`, `StatsProps` and `TestimonialProps` changed shape. Fields of the old shape remain as optional members (marked `@deprecated` where a new field replaces them); code that reads them may need a change — for example `HeadingProps.text` is now `InlineRichText | string`, read it with `inlineRichTextToPlain(text)`.
