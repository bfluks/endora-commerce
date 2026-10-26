import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/`) — product URL keys per language and
 * per sales channel × language, their redirects, and the one helper that composes a
 * product URL (`contracts/url-keys-and-redirects.md`, research R11, R12, R17, R28).
 *
 * Kept apart from `product-scopes.ts` so the URL-key work edits its own file. This
 * module is a leaf: it imports nothing from the catalogue contracts.
 */

// --- Key grammar ---------------------------------------------------------------

/**
 * A product URL key: the grammar of `products.slug` (lower-case kebab case, at most
 * 160 characters — the column width). Global, language and channel × language keys
 * all share it.
 */
export const productSlugSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case');
export type ProductSlug = z.infer<typeof productSlugSchema>;

const languageCodeSchema = z.string().min(1).max(16);

// --- The one URL seam (D7, Q-B → C) --------------------------------------------

export interface ProductPathInput {
  /** The effective key at (channel, language). */
  key: string;
  /** The content language the URL is for — already resolved against the channel. */
  languageCode: string;
  /** The channel's default content language. */
  channelDefaultLanguage: string;
}

/**
 * The storefront path of a product page: `/p/<key>`, plus `?lang=<L>` when L is not
 * the channel's default language.
 *
 * **This is the only place a product URL is composed.** Every URL the platform
 * emits for a product — the admin's preview link, the resolve answer's redirect
 * target, the PDP's canonical and alternates, the sitemap — is built here by the
 * backend, so a later language path prefix changes this one function. A key is
 * valid only in its own language (K1), which is why a non-default language has to
 * travel with the link.
 */
export function productPath(input: ProductPathInput): string {
  const base = `/p/${encodeURIComponent(input.key)}`;
  if (input.languageCode === input.channelDefaultLanguage) return base;
  return `${base}?lang=${encodeURIComponent(input.languageCode)}`;
}

// --- Admin read — GET /api/v1/admin/catalog/products/:id/url-keys (§1) -----------

export const productUrlKeySourceSchema = z.enum(['channel_language', 'language', 'global']);
export type ProductUrlKeySource = z.infer<typeof productUrlKeySourceSchema>;

export const productUrlRedirectSchema = z.object({
  id: uuidSchema,
  /** `null` = a former global key, redirecting in every language (H1). */
  languageCode: languageCodeSchema.nullable(),
  key: z.string(),
  createdAt: isoDateTimeSchema,
});
export type ProductUrlRedirect = z.infer<typeof productUrlRedirectSchema>;

export const productUrlKeysResponseSchema = z.object({
  data: z.object({
    /** `products.slug`. */
    globalKey: z.string(),
    languageKeys: z.array(z.object({ languageCode: languageCodeSchema, key: z.string() })),
    channelKeys: z.array(
      z.object({ channelId: uuidSchema, languageCode: languageCodeSchema, key: z.string(), orphaned: z.boolean() }),
    ),
    effective: z.array(
      z.object({
        channelId: uuidSchema,
        languageCode: languageCodeSchema,
        key: z.string(),
        source: productUrlKeySourceSchema,
        /** {@link productPath} for this (channel, language). */
        url: z.string(),
      }),
    ),
    /** Omitted when `seo` is not effectively present (Q-C, Constitution XVII). */
    redirects: z.array(productUrlRedirectSchema).optional(),
  }),
});
export type ProductUrlKeysResponse = z.infer<typeof productUrlKeysResponseSchema>;

// --- Admin write — PUT /api/v1/admin/catalog/products/:id/url-keys (§2) ----------

/** The most entries one list of a URL-keys PUT carries (Phase 16 review; the scopes PATCH's bound). */
const URL_KEY_LIST_MAX = 64;

export const putProductUrlKeysRequestSchema = z.object({
  globalKey: productSlugSchema.optional(),
  /** `key: null` = use inherited (deletes the language key). */
  languageKeys: z
    .array(z.object({ languageCode: languageCodeSchema, key: productSlugSchema.nullable() }))
    .max(URL_KEY_LIST_MAX)
    .optional(),
  /** `key: null` = use inherited (deletes the channel × language key). */
  channelKeys: z
    .array(z.object({ channelId: uuidSchema, languageCode: languageCodeSchema, key: productSlugSchema.nullable() }))
    .max(URL_KEY_LIST_MAX)
    .optional(),
  /** The operator's confirmation of taking over another product's redirect (FR-072). */
  confirmTakeover: z
    .array(z.object({ languageCode: languageCodeSchema.nullable(), key: productSlugSchema }))
    .max(URL_KEY_LIST_MAX)
    .optional(),
});
export type PutProductUrlKeysRequest = z.infer<typeof putProductUrlKeysRequestSchema>;

/** `409 URL_KEY_TAKEN` details. */
export const urlKeyTakenDetailsSchema = z.object({
  conflicts: z.array(
    z.object({
      languageCode: languageCodeSchema.nullable(),
      key: z.string(),
      heldByProductId: uuidSchema,
      heldByProductName: z.string(),
    }),
  ),
});
export type UrlKeyTakenDetails = z.infer<typeof urlKeyTakenDetailsSchema>;

/** `409 URL_KEY_REDIRECT_TAKEOVER_REQUIRED` details. */
export const urlKeyRedirectTakeoverRequiredDetailsSchema = z.object({
  takeovers: z.array(
    z.object({
      languageCode: languageCodeSchema.nullable(),
      key: z.string(),
      losingProductId: uuidSchema,
      losingProductName: z.string(),
    }),
  ),
});
export type UrlKeyRedirectTakeoverRequiredDetails = z.infer<typeof urlKeyRedirectTakeoverRequiredDetailsSchema>;

/** `404 URL_REDIRECT_NOT_FOUND` details. */
export const urlRedirectNotFoundDetailsSchema = z.object({ redirectId: uuidSchema });
export type UrlRedirectNotFoundDetails = z.infer<typeof urlRedirectNotFoundDetailsSchema>;

// --- Public resolve — GET /api/v1/catalog/products/resolve/:key (§4) ------------

export const productKeyResolutionSchema = z.discriminatedUnion('kind', [
  /** `key` is the effective key at (channel, language). */
  z.object({ kind: z.literal('product'), productId: uuidSchema, key: z.string() }),
  /** `path` = {@link productPath} built by catalog; the storefront answers a permanent redirect to it. */
  z.object({ kind: z.literal('redirect'), key: z.string(), languageCode: languageCodeSchema, path: z.string() }),
]);
export type ProductKeyResolution = z.infer<typeof productKeyResolutionSchema>;

// --- Storefront product page — the PDP response's `paths` (§6) -----------------

/**
 * The product page's own URLs, ready-made by catalog with {@link productPath}: the
 * canonical for the request's (channel, language), and one alternate per channel
 * language where the product is available to the **anonymous** audience (FR-074 —
 * `hreflang` advertises only what a crawler may open). The storefront renders them
 * verbatim: it does not know the channel's default language, so it composes no
 * product URL of its own.
 */
export const productPagePathsSchema = z.object({
  canonical: z.string(),
  alternates: z.array(z.object({ languageCode: languageCodeSchema, path: z.string() })),
});
export type ProductPagePaths = z.infer<typeof productPagePathsSchema>;

// --- Connectors and import (§5) ------------------------------------------------

/**
 * Per key written through `catalogProductScopeWritePort.applyScopes`: written, or
 * not written with the reason. A connector never takes over a redirect and is never
 * asked to confirm one; the product keeps its previous key at that scope (FR-093).
 */
export const urlKeyWriteOutcomeSchema = z.union([
  z.object({ written: z.literal(true) }),
  z.object({
    written: z.literal(false),
    issue: z.object({
      languageCode: languageCodeSchema,
      channelId: uuidSchema.nullable(),
      key: z.string(),
      heldByProductId: uuidSchema,
      kind: z.enum(['current', 'redirect']),
    }),
  }),
]);
export type UrlKeyWriteOutcome = z.infer<typeof urlKeyWriteOutcomeSchema>;

/** A URL key written by an integration: `channelId: null` = the language key. */
export interface ProductUrlKeyWrite {
  languageCode: string;
  channelId: string | null;
  /** `null` = use inherited. */
  key: string | null;
}

// --- Port — catalogProductUrlKeyReadPort (owner `catalog`, R28) ------------------

/**
 * Container name: `catalogProductUrlKeyReadPort`. Owner: `catalog`.
 *
 * URL keys for whole-channel readers such as `seo`'s sitemap generator (R28).
 * `catalog` is non-deactivatable, so the port is always present.
 */
export interface CatalogProductUrlKeyReadPort {
  /**
   * The effective key per channel language for each product: the product's
   * channel × language key, else its language key, else its global key. Products the
   * channel does not carry are absent.
   *
   * **Applies no availability beyond membership** (checkpoint C security review, I8):
   * a member product switched off, outside its window or outside its audience still
   * has keys here. A buyer-facing caller narrows the ids with
   * `catalogProductAvailabilityPort.filterAvailable` first and links only what is left.
   */
  effectiveKeys(productIds: readonly string[], channelId: string): Promise<Map<string, Map<string, string>>>;
}
