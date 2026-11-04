import { z } from 'zod';
import {
  isoDateTimeSchema,
  multilingualStringSchema,
  productVisibilitySchema,
  uuidSchema,
  type ProductVisibility,
} from './common.js';
import { isProductVisibleTo, productStatusSchema, type ProductAudience } from './catalog.js';
import { ORDER_MINIMUM_MAX } from './order-minimums.js';
import type { ProductUrlKeyWrite, UrlKeyWriteOutcome } from './product-url-keys.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/`) — product data scopes per sales
 * channel and language: the one rule of effective availability, its admin shapes and
 * the ports other modules ask through (`contracts/product-scopes.md`,
 * `contracts/admin-scopes-api.md`, research R1–R7, R18).
 *
 * Scopes, from widest to narrowest: **global** (the `products` row), **channel**
 * (`product_channel_scopes`, one row per product × channel) and **channel × language**
 * (`product_channel_language_scopes`, status only). An override that is absent —
 * `null` on a channel row, no row at all — inherits from the scope above it.
 *
 * Import direction: this file imports from `catalog.ts`, never the reverse, so either
 * may be loaded first without meeting the other half-evaluated.
 */

// --- 1. Constants and types ----------------------------------------------------

/**
 * The scoped status values (FR-010, R3). The same set as the global product status,
 * and derived from it so there is one list. Every predicate tests `=== 'active'`
 * through {@link isOn} and never enumerates the off values, which is what keeps a
 * later change of this set (owner question Q1) a data migration rather than a rewrite.
 */
export const PRODUCT_SCOPE_STATUSES = productStatusSchema.options;
export type ProductScopeStatus = (typeof PRODUCT_SCOPE_STATUSES)[number];
export const productScopeStatusSchema = z.enum(PRODUCT_SCOPE_STATUSES);

/** A publication window — inclusive at both ends; `null` = open on that side (K4). */
export interface PublicationWindow {
  from: Date | null;
  until: Date | null;
}

/** The audience rule — mode and organization list, one value (C4). */
export interface AudienceRule {
  visibility: ProductVisibility;
  allowedOrganizationIds: string[];
}

/** A `product_channel_scopes` row. Every `null` inherits the global value. */
export interface ProductChannelScopeRecord {
  productId: string;
  channelId: string;
  /** `null` = inherit. */
  status: ProductScopeStatus | null;
  /** `null` = inherit the global pair; a non-null pair replaces it, even when both bounds are open. */
  window: PublicationWindow | null;
  /** `null` = inherit the whole global rule. */
  audience: AudienceRule | null;
  /** `null` = inherit; `1` = no minimum in this channel. */
  minOrderQuantity: number | null;
  /** `null` = inherit. */
  returnable: boolean | null;
}

/** A `product_channel_language_scopes` row. Absent = inherit. */
export interface ProductChannelLanguageScopeRecord {
  productId: string;
  channelId: string;
  languageCode: string;
  status: ProductScopeStatus;
}

/** The global values the rule reads off the product row. */
export interface ProductGlobalScopeFields {
  status: ProductScopeStatus;
  deletedAt: Date | null;
  archivedAt: Date | null;
  window: PublicationWindow;
  visibility: ProductVisibility;
  allowedOrganizationIds: string[];
  minOrderQuantity: number | null;
  returnable: boolean;
}

/** A sales channel as the rule needs it: its id and its current content languages. */
export interface ScopeChannel {
  id: string;
  languages: readonly string[];
  defaultLanguage: string;
}

/** Everything that decides a product's effective status, before or after a write. */
export interface ScopeSnapshot {
  global: ProductGlobalScopeFields;
  channelRows: readonly ProductChannelScopeRecord[];
  languageRows: readonly ProductChannelLanguageScopeRecord[];
}

// --- 2. The pure rule (one definition, FR-002) -----------------------------------

/** `status === 'active'` — the only test of a status value anywhere. */
export function isOn(status: ProductScopeStatus): boolean {
  return status === 'active';
}

/** `cl.status ?? c.status ?? global.status`. */
export function effectiveStatus(
  global: Pick<ProductGlobalScopeFields, 'status'>,
  channelRow: Pick<ProductChannelScopeRecord, 'status'> | undefined,
  clRow: Pick<ProductChannelLanguageScopeRecord, 'status'> | undefined,
): ProductScopeStatus {
  return clRow?.status ?? channelRow?.status ?? global.status;
}

/** The channel's window when it overrides one, else the global window — as a pair (R4). */
export function effectiveWindow(
  global: Pick<ProductGlobalScopeFields, 'window'>,
  channelRow: Pick<ProductChannelScopeRecord, 'window'> | undefined,
): PublicationWindow {
  return channelRow?.window ?? global.window;
}

/** `from ≤ now ≤ until`, to the millisecond; a `null` bound is open (K4). */
export function isInsideWindow(window: PublicationWindow, now: Date): boolean {
  const at = now.getTime();
  if (window.from !== null && window.from.getTime() > at) return false;
  if (window.until !== null && at > window.until.getTime()) return false;
  return true;
}

/** The channel's rule when it overrides one, else the global rule — replaced whole, never merged (C4). */
export function effectiveAudience(
  global: Pick<ProductGlobalScopeFields, 'visibility' | 'allowedOrganizationIds'>,
  channelRow: Pick<ProductChannelScopeRecord, 'audience'> | undefined,
): AudienceRule {
  return (
    channelRow?.audience ?? {
      visibility: global.visibility,
      allowedOrganizationIds: global.allowedOrganizationIds,
    }
  );
}

/** Minimum order quantity and the returnable flag in a channel (FR-100). */
export function effectiveOrderRules(
  global: Pick<ProductGlobalScopeFields, 'minOrderQuantity' | 'returnable'>,
  channelRow: Pick<ProductChannelScopeRecord, 'minOrderQuantity' | 'returnable'> | undefined,
): { minOrderQuantity: number | null; returnable: boolean } {
  return {
    minOrderQuantity: channelRow?.minOrderQuantity ?? global.minOrderQuantity,
    returnable: channelRow?.returnable ?? global.returnable,
  };
}

/**
 * FR-100, research R26 — `records` with the channel's effective minimum order quantity
 * and returnable flag (`rules`, from `catalogProductAvailabilityPort.effectiveOrderRules`)
 * in place of the global ones, for a seam that judges a basket, an order or a quote
 * line in that channel: the order-minimum rule and the returnable stamp. A record the
 * rules do not name is returned as it is; the input is never mutated. The port's own
 * records keep meaning "global".
 */
export function withChannelOrderRules<T extends { id: string; minOrderQuantity: number | null; returnable: boolean }>(
  records: readonly T[],
  rules: ReadonlyMap<string, { minOrderQuantity: number | null; returnable: boolean }>,
): T[] {
  return records.map((record) => {
    const rule = rules.get(record.id);
    return rule === undefined ? record : { ...record, minOrderQuantity: rule.minOrderQuantity, returnable: rule.returnable };
  });
}

export interface ProductAvailabilityInput {
  global: ProductGlobalScopeFields;
  channelRow?: ProductChannelScopeRecord | undefined;
  clRow?: ProductChannelLanguageScopeRecord | undefined;
  /** Membership of the product in `channel`, read through the kernel accessor. */
  isMember: boolean;
  channel: ScopeChannel;
  /** Already resolved by {@link resolveScopeLanguage}. */
  languageCode: string;
  audience: ProductAudience;
  now: Date;
}

/**
 * FR-001 — is the product effectively available at (channel, language) to this
 * audience, now? Not deleted, not archived, a member of the channel, the language
 * offered by the channel, effectively on there, inside its effective window, and
 * admitted by its effective audience rule.
 *
 * Membership and the channel's languages are tested **before** any override is read,
 * which is how orphaned overrides are ignored (FR-015). A row naming another channel
 * or another language is ignored too.
 *
 * Its SQL restatement is `availabilityCondition` in catalog's
 * `product-availability.sql.ts`; a parity test holds the two equal.
 */
export function isProductEffectivelyAvailable(input: ProductAvailabilityInput): boolean {
  const { global, channel, languageCode } = input;
  if (global.deletedAt !== null || global.archivedAt !== null) return false;
  if (!input.isMember) return false;
  if (!channel.languages.includes(languageCode)) return false;
  const channelRow = input.channelRow?.channelId === channel.id ? input.channelRow : undefined;
  const clRow =
    input.clRow?.channelId === channel.id && input.clRow.languageCode === languageCode ? input.clRow : undefined;
  if (!isOn(effectiveStatus(global, channelRow, clRow))) return false;
  if (!isInsideWindow(effectiveWindow(global, channelRow), input.now)) return false;
  return isProductVisibleTo(effectiveAudience(global, channelRow), input.audience);
}

/**
 * The (channel, language) pairs an edit turns on — the completeness gate's subject
 * (R18, N3).
 *
 * **Status only (owner decision M3 → A, 2026-10-22; FR-060).** A pair is returned
 * when the product's effective status there goes from off to on; the window, the
 * audience and archiving are not compared. `channels` is the product's member
 * channels with their languages *after* the write and serves both snapshots, so
 * neither a membership change nor a channel gaining a language produces a pair on
 * its own. Archiving is not a status (spec Session 2026-10-25): setting an archived
 * product `active` turns its pairs on, and a Restore — `archivedAt` alone moving —
 * turns nothing on.
 */
export function pairsTurningOn(
  before: ScopeSnapshot,
  after: ScopeSnapshot,
  channels: readonly ScopeChannel[],
): Array<{ channelId: string; languageCode: string }> {
  const pairs: Array<{ channelId: string; languageCode: string }> = [];
  for (const channel of channels) {
    for (const languageCode of channel.languages) {
      if (!statusOnAt(before, channel.id, languageCode) && statusOnAt(after, channel.id, languageCode)) {
        pairs.push({ channelId: channel.id, languageCode });
      }
    }
  }
  return pairs;
}

function statusOnAt(snapshot: ScopeSnapshot, channelId: string, languageCode: string): boolean {
  const { global } = snapshot;
  if (global.deletedAt !== null) return false;
  const channelRow = snapshot.channelRows.find((row) => row.channelId === channelId);
  const clRow = snapshot.languageRows.find(
    (row) => row.channelId === channelId && row.languageCode === languageCode,
  );
  return isOn(effectiveStatus(global, channelRow, clRow));
}

/**
 * Which content language "L" a request is in (R7, A-3): the channel's language
 * matching the requested tag case-insensitively, else the first channel language
 * sharing its base language (`pl` ↔ `pl-PL`), else the channel's default. The answer
 * is always spelled as the channel spells it.
 *
 * Not the platform's prose-language resolver: channel content languages are free
 * BCP-47 codes, while the prose resolver normalises to the platform's UI languages.
 */
export function resolveScopeLanguage(channel: ScopeChannel, requestedTag: string | null | undefined): string {
  // An `Accept-Language` pick may carry its quality parameter (`de;q=0.9`).
  const tag = requestedTag?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (tag === '') return channel.defaultLanguage;
  const exact = channel.languages.find((language) => language.toLowerCase() === tag);
  if (exact !== undefined) return exact;
  const base = baseLanguage(tag);
  const sameBase = channel.languages.find((language) => baseLanguage(language.toLowerCase()) === base);
  return sameBase ?? channel.defaultLanguage;
}

export {
  applyTranslationPatch,
  effectivePackagingUnitName,
  sameLanguage,
  translationAt,
  translationMapPatchSchema,
  TRANSLATION_MAP_MAX_LANGUAGES,
  type TranslationMap,
} from './scoped-translations.js';

/**
 * A channel record as the scope rule reads it. The default language is always
 * one of the languages: a channel whose list is empty, or omits its own
 * default, still offers that default — the language every request on it falls
 * back to. The one home of that normalisation (catalog's availability service
 * and every consumer seam read it from here).
 */
export function toScopeChannel(channel: {
  id: string;
  languages?: readonly string[] | undefined;
  defaultLanguage: string;
}): ScopeChannel {
  const languages = [...(channel.languages ?? [])];
  if (!languages.includes(channel.defaultLanguage)) languages.unshift(channel.defaultLanguage);
  return { id: channel.id, languages, defaultLanguage: channel.defaultLanguage };
}

/**
 * {@link resolveScopeLanguage} over a channel record as a resolver holds it —
 * the scope language L of a buyer request on `channel` that asked in
 * `requestedTag` (the first `Accept-Language` tag, see {@link firstLanguageTag}).
 */
export function scopeLanguageOf(
  channel: { id: string; languages?: readonly string[] | undefined; defaultLanguage: string },
  requestedTag: string | null | undefined,
): string {
  return resolveScopeLanguage(toScopeChannel(channel), requestedTag);
}

/**
 * The first tag of an `Accept-Language` header, without its quality parameter,
 * or `undefined` when the header is absent or empty.
 */
export function firstLanguageTag(header: string | readonly string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return undefined;
  const first = value.split(',')[0]?.split(';')[0]?.trim();
  return first ? first : undefined;
}

function baseLanguage(tag: string): string {
  const dash = tag.indexOf('-');
  return dash === -1 ? tag : tag.slice(0, dash);
}

// --- 3. Ports --------------------------------------------------------------------

/** Where an availability question is asked. */
export interface ProductAvailabilityScope {
  channelId: string;
  /**
   * Already resolved by {@link resolveScopeLanguage} against this channel, or
   * `null` for the channel's default language — an operator acting for a
   * customer (N2), or a seam that knows no request language.
   */
  languageCode: string | null;
  audience: ProductAudience;
  /** Default: the time of the call. */
  now?: Date;
}

/** A product's availability across one channel, for whole-channel projections. */
export interface ChannelAvailability {
  /** Channel languages where the effective status is on (member, not archived or deleted). */
  liveLanguages: string[];
  window: PublicationWindow;
  audience: AudienceRule;
}

/**
 * Container name: `catalogProductAvailabilityPort`. Owner: `catalog`.
 *
 * The one way another module asks whether a product is available (FR-002). `catalog`
 * is non-deactivatable, so the port is always present. Never asked for an unresolved
 * channel (FR-007): a caller with no channel does not call it.
 */
export interface CatalogProductAvailabilityPort {
  /** FR-001 for each id; an id not returned is unavailable for any reason — callers answer one not-found. */
  filterAvailable(productIds: readonly string[], scope: ProductAvailabilityScope): Promise<Set<string>>;
  /** Projection for whole-channel consumers (search documents, sitemap, feeds). Non-members are absent. */
  describeChannelAvailability(
    productIds: readonly string[],
    channelId: string,
  ): Promise<Map<string, ChannelAvailability>>;
  /**
   * FR-017 — the effective name per id at (channel, language): #384's walk over
   * the channel's overrides, else the storefront's baseline pick. `languageCode`
   * `null` = the channel's default language (an operator, N2).
   */
  effectiveNames(
    productIds: readonly string[],
    scope: { channelId: string; languageCode: string | null },
  ): Promise<Map<string, string>>;
  /**
   * FR-100 — the effective minimum order quantity and returnable flag in the channel.
   *
   * **Applies no availability** (checkpoint C security review, I8): it answers for
   * every id it is given, whether or not the product is available — or even visible —
   * to anyone in the channel. A buyer-facing caller narrows the ids with
   * {@link filterAvailable} first and never discloses a rule for an id it dropped.
   */
  effectiveOrderRules(
    productIds: readonly string[],
    channelId: string,
  ): Promise<Map<string, { minOrderQuantity: number | null; returnable: boolean }>>;
}

/** What an integration writes through {@link CatalogProductScopeWritePort}; only named scopes are touched. */
export interface ProductScopeWriteInput {
  /** `languageCode: null` = the channel row; `value: null` = use inherited. */
  status?: Array<{ channelId: string; languageCode: string | null; value: ProductScopeStatus | null }>;
  /** `channelId: null` = the global window; `value: null` on a channel = use inherited. */
  window?: Array<{ channelId: string | null; value: PublicationWindow | null }>;
  /** `value: null` = use inherited. */
  audience?: Array<{ channelId: string; value: AudienceRule | null }>;
  /** Each field: absent = untouched, `null` = use inherited. */
  orderRules?: Array<{ channelId: string; minOrderQuantity?: number | null; returnable?: boolean | null }>;
  urlKeys?: ProductUrlKeyWrite[];
}

export interface ProductScopeWriteResult {
  /** One outcome per entry of `urlKeys`, in order. */
  urlKeys: UrlKeyWriteOutcome[];
}

/**
 * Container name: `catalogProductScopeWritePort`. Owner: `catalog` (R17).
 *
 * Scoped writes for imports and connectors. Writes only the scopes named, so writing
 * global values removes no operator override (FR-091); never runs the completeness
 * gate (A-6); never takes over a redirect (FR-093).
 */
export interface CatalogProductScopeWritePort {
  applyScopes(
    productId: string,
    input: ProductScopeWriteInput,
    options: { source: string },
  ): Promise<ProductScopeWriteResult>;
}

// --- 4. Admin shapes (admin-scopes-api.md) -----------------------------------------

/**
 * A channel content language as a request names it: the BCP-47 shape the dictionary
 * and i18n contracts use (`pl`, `pl-PL`), matched case-insensitively because the
 * write resolves it to the channel's own spelling (`de-de` → `de-DE`).
 */
const languageCodeSchema = z
  .string()
  .max(16)
  .regex(/^[a-z]{2,3}(-[a-z]{2})?$/i, 'BCP-47 language tag');

/** The most organizations one channel audience override names (security review, 163 Block A). */
const SCOPE_AUDIENCE_ORGANIZATIONS_MAX = 1000;
/** The most language statuses one channel entry of a scopes PATCH carries. */
const SCOPE_LANGUAGE_STATUSES_MAX = 64;

/**
 * What the completeness gate reports missing at a (channel, language) — one
 * vocabulary for the save warning, the `SCOPE_INCOMPLETE` refusal and the scope
 * overview's cells, so they cannot disagree (FR-041, FR-060).
 */
export const scopeMissingValueSchema = z.union([
  z.literal('name'),
  z.literal('urlKey'),
  z.templateLiteral(['attribute:', z.string().min(1)]),
]);
export type ScopeMissingValue = z.infer<typeof scopeMissingValueSchema>;

/**
 * A channel audience override. Capped: the only writer is the scopes PATCH, so the
 * read shape carries the same bound. The global rule in §1 is deliberately not capped:
 * the product update writes it without a bound (`catalog.ts`), so a cap on the read
 * shape would describe products the platform already holds as invalid.
 */
const audienceRuleSchema = z.object({
  visibility: productVisibilitySchema,
  allowedOrganizationIds: z.array(uuidSchema).max(SCOPE_AUDIENCE_ORGANIZATIONS_MAX),
});

const orderMinimumSchema = z.number().int().min(1).max(ORDER_MINIMUM_MAX);

/** §1 — `GET /api/v1/admin/catalog/products/:id/scopes`. */
export const productScopesSchema = z.object({
  global: z.object({
    status: productScopeStatusSchema,
    publishFrom: isoDateTimeSchema.nullable(),
    publishUntil: isoDateTimeSchema.nullable(),
    visibility: productVisibilitySchema,
    allowedOrganizationIds: z.array(uuidSchema),
    minOrderQuantity: z.number().int().nullable(),
    returnable: z.boolean(),
  }),
  channels: z.array(
    z.object({
      channelId: uuidSchema,
      isMember: z.boolean(),
      /** The channel's current content languages. */
      languages: z.array(z.string()),
      status: productScopeStatusSchema.nullable(),
      window: z.object({ from: isoDateTimeSchema.nullable(), until: isoDateTimeSchema.nullable() }).nullable(),
      audience: audienceRuleSchema
        .extend({
          /** Organizations the override names that are not members of the channel (C4 warning). */
          nonMemberOrganizationIds: z.array(uuidSchema),
        })
        .nullable(),
      minOrderQuantity: z.number().int().nullable(),
      returnable: z.boolean().nullable(),
      languageStatuses: z.array(
        z.object({ languageCode: z.string(), status: productScopeStatusSchema, orphaned: z.boolean() }),
      ),
      /** The product is not a member of this channel any more (FR-015). */
      orphaned: z.boolean(),
    }),
  ),
  /**
   * Owner decision U1 — the names of the organizations the channel audience rules name
   * (non-members included), resolved by the server so an operator without
   * `customers:read` can read them. The global rule's are not named: it is uncapped. An organization that cannot be read (deleted,
   * or `organizations` not answering) is absent: the consumer shows its id.
   */
  organizations: z.array(z.object({ id: uuidSchema, name: z.string() })),
});
export type ProductScopes = z.infer<typeof productScopesSchema>;

export const productScopesResponseSchema = z.object({ data: productScopesSchema });
export type ProductScopesResponse = z.infer<typeof productScopesResponseSchema>;

/**
 * §2 — `PATCH /api/v1/admin/catalog/products/:id/scopes`. An absent key leaves the
 * value untouched; `null` = use inherited (deletes the override, FR-012). A window
 * whose `from` is not before its `until` passes the schema and is refused by the
 * service with `VALIDATION_FAILED`, `details.field = 'window'`.
 */
export const patchProductScopesRequestSchema = z.object({
  channels: z
    .array(
      z.object({
        channelId: uuidSchema,
        status: productScopeStatusSchema.nullable().optional(),
        window: z
          .object({ from: isoDateTimeSchema.nullable(), until: isoDateTimeSchema.nullable() })
          .nullable()
          .optional(),
        audience: audienceRuleSchema.nullable().optional(),
        minOrderQuantity: orderMinimumSchema.nullable().optional(),
        returnable: z.boolean().nullable().optional(),
        languageStatuses: z
          .array(z.object({ languageCode: languageCodeSchema, status: productScopeStatusSchema.nullable() }))
          .max(SCOPE_LANGUAGE_STATUSES_MAX)
          .optional(),
      }),
    )
    .max(64),
  global: z
    .object({ publishFrom: isoDateTimeSchema.nullable(), publishUntil: isoDateTimeSchema.nullable() })
    .partial()
    .optional(),
});
export type PatchProductScopesRequest = z.infer<typeof patchProductScopesRequestSchema>;

export const scopeWarningSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('completeness'),
    channelId: uuidSchema,
    languageCode: z.string(),
    missing: z.array(scopeMissingValueSchema),
  }),
  z.object({ kind: z.literal('audience_non_members'), channelId: uuidSchema, organizationIds: z.array(uuidSchema) }),
]);
export type ScopeWarning = z.infer<typeof scopeWarningSchema>;

export const patchProductScopesResponseSchema = z.object({
  data: productScopesSchema,
  warnings: z.array(scopeWarningSchema),
});
export type PatchProductScopesResponse = z.infer<typeof patchProductScopesResponseSchema>;

/** `422 SCOPE_INVALID` details (FR-014). */
export const scopeInvalidDetailsSchema = z.object({
  channelId: uuidSchema,
  languageCode: z.string().optional(),
  reason: z.enum(['not_a_member', 'language_not_offered']),
});
export type ScopeInvalidDetails = z.infer<typeof scopeInvalidDetailsSchema>;

/** `422 SCOPE_INCOMPLETE` details (FR-060). */
export const scopeIncompleteDetailsSchema = z.object({
  pairs: z.array(
    z.object({ channelId: uuidSchema, languageCode: z.string(), missing: z.array(scopeMissingValueSchema) }),
  ),
});
export type ScopeIncompleteDetails = z.infer<typeof scopeIncompleteDetailsSchema>;

export const scopeLevelSchema = z.enum(['channel_language', 'channel', 'language']);

/** §3 — `GET /api/v1/admin/catalog/products/:id/scope-overview`. */
export const scopeOverviewResponseSchema = z.object({
  data: z.object({
    channels: z.array(
      z.object({
        channelId: uuidSchema,
        name: multilingualStringSchema,
        isMember: z.boolean(),
        languages: z.array(z.string()),
      }),
    ),
    /** The union of the channels' languages, or every active platform language when there is no channel. */
    languages: z.array(z.string()),
    cells: z.array(
      z.object({
        channelId: uuidSchema,
        languageCode: z.string(),
        /** Member, language offered, on and inside the window now; audience is shown as the rule, not evaluated. */
        available: z.boolean(),
        effectiveStatus: productScopeStatusSchema,
        statusSource: z.enum(['channel_language', 'channel', 'global']),
        overriddenFields: z.array(z.object({ field: z.string(), level: scopeLevelSchema })),
        /** FR-041 — what the gate would report here; `[]` = complete; absent = not evaluable. */
        missing: z.array(scopeMissingValueSchema).optional(),
      }),
    ),
    channelRows: z.array(z.object({ channelId: uuidSchema, overriddenFields: z.array(z.string()) })),
    languageColumns: z.array(z.object({ languageCode: z.string(), overriddenFields: z.array(z.string()) })),
    orphans: z.array(
      z.object({
        field: z.string(),
        channelId: uuidSchema.nullable(),
        languageCode: z.string().nullable(),
        reason: z.enum(['not_a_member', 'language_not_offered', 'attribute_scope_changed']),
      }),
    ),
  }),
});
export type ScopeOverviewResponse = z.infer<typeof scopeOverviewResponseSchema>;

/** §6 — `GET /api/v1/admin/catalog/attributes/:idOrKey/scope-change-preview`. */
export const attributeScopeChangePreviewResponseSchema = z.object({
  data: z.object({
    orphanedOverrides: z.number().int().nonnegative(),
    byChannel: z.array(z.object({ channelId: uuidSchema, count: z.number().int().nonnegative() })),
  }),
});
export type AttributeScopeChangePreviewResponse = z.infer<typeof attributeScopeChangePreviewResponseSchema>;

/** §5 — the completeness gate's mode (`catalog.scope_completeness_gate`). */
export const SCOPE_COMPLETENESS_GATE_MODES = ['warn', 'refuse'] as const;
export type ScopeCompletenessGateMode = (typeof SCOPE_COMPLETENESS_GATE_MODES)[number];
