// Feature 163 — the brand tokens (`specs/163-page-builder-marketing-pages/`
// data-model §2), authored once as Zod schemas in `@endora-commerce/contracts`.
//
// The main barrel re-exports the **types** only, so no schema reaches a client
// bundle through it; this subpath (`@endora-commerce/page-builder-core/brand-tokens`)
// also hands over the built-in set and the token lists, for the code and the
// tests that need the values.

export {
  BRAND_MEDIA_URL_RE,
  BRAND_SCHEMES,
  BRAND_SPACE_TOKENS,
  BRAND_TYPE_TOKENS,
  DEFAULT_BRAND_TOKENS,
  type BrandFontSource,
  type BrandScheme,
  type BrandSchemeColors,
  type BrandSpaceToken,
  type BrandTypeStyle,
  type BrandTypeToken,
  type CmsBrandTokens,
} from '@endora-commerce/contracts/cms-brand';
