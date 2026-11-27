/**
 * The element ids this storefront's document renders on every page
 * (`specs/163-page-builder-marketing-pages/` R-8, data-model §6): the skip
 * link's `main-content`, the brand-token `<style id="cmsb">` and
 * `cmsb-header-offset` (`lib/theme/StorefrontDocument.tsx`), the header's
 * language and currency fields, and the analytics scripts' ids.
 *
 * A Page Builder anchor equal to one of them would make an in-page link jump to
 * the layout's element, so the `cms` module refuses it at save with
 * `CMS_RESERVED_ANCHOR`. The list is the contract constant, re-exported here so
 * the storefront side names it where its ids are rendered: an id added to the
 * layout belongs in `RESERVED_ANCHORS` in `@endora-commerce/contracts`.
 */
export { RESERVED_ANCHORS, type ReservedAnchor } from '@endora-commerce/contracts';
