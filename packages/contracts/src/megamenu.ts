// Megamenu — feature 015 contract surface.
// Pages, Bindings, Items (with a discriminated-union target shape), the
// resolved storefront payload. Per Principle V these schemas are the
// source of truth for every HTTP boundary in the new `megamenu` module.

import { z } from 'zod';
import { isoDateTimeSchema, multilingualStringSchema, uuidSchema } from './common.js';

// ────────────────────────────────────────────────────────────────────
// Domain primitives
// ────────────────────────────────────────────────────────────────────

export const megamenuItemKindSchema = z.enum([
  'category-link',
  'cms-page-link',
  'external-link',
  'button',
  'asset',
  'cms-block-embed',
  // Feature 168: a heading without a link (a column of a `mega` panel), and a
  // live expansion of the catalogue's category tree.
  'group',
  'category-tree',
]);
export type MegamenuItemKind = z.infer<typeof megamenuItemKindSchema>;

/**
 * How a top-level item — a **tab** of the navigation bar — opens (feature 168):
 * a plain link, a narrow list, a full-width panel of columns, or the
 * departments → subcategories catalogue panel.
 */
export const megamenuPresentationSchema = z.enum(['link', 'dropdown', 'mega', 'catalog']);
export type MegamenuPresentation = z.infer<typeof megamenuPresentationSchema>;

/** Which end of the navigation bar a tab sits at. */
export const megamenuAlignmentSchema = z.enum(['start', 'end']);
export type MegamenuAlignment = z.infer<typeof megamenuAlignmentSchema>;

/** The kinds a tab may be (FR-002). Media, embeds and trees open under a tab, never as one. */
export const MEGAMENU_TAB_KINDS: ReadonlySet<MegamenuItemKind> = new Set<MegamenuItemKind>([
  'category-link',
  'cms-page-link',
  'external-link',
  'button',
  'group',
]);

/**
 * The kinds whose label may be empty: each points at something with a name of
 * its own in every language, which an empty label inherits (FR-015).
 */
/** The kinds a tab may be that have a link of their own to follow on click. */
export const MEGAMENU_CLICK_NAVIGATES_KINDS: ReadonlySet<MegamenuItemKind> = new Set<MegamenuItemKind>([
  'category-link',
  'cms-page-link',
  'external-link',
]);

export const MEGAMENU_LABEL_INHERITING_KINDS: ReadonlySet<MegamenuItemKind> = new Set<MegamenuItemKind>([
  'category-link',
  'cms-page-link',
  'category-tree',
]);

/**
 * Who may see an item (feature 168, FR-017). Hiding an item hides its subtree.
 * A customer-group audience matches the buyer's *effective* customer group
 * (`effectiveCustomerGroupId`), the one pricing reads.
 */
export const megamenuAudienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('everyone') }),
  z.object({ kind: z.literal('guests') }),
  z.object({ kind: z.literal('signed_in') }),
  z.object({
    kind: z.literal('customer_groups'),
    customerGroupIds: z
      .array(uuidSchema)
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'Customer groups must be unique.' }),
  }),
]);
export type MegamenuAudience = z.infer<typeof megamenuAudienceSchema>;

export const MEGAMENU_EVERYONE_AUDIENCE: MegamenuAudience = { kind: 'everyone' };

export const megamenuButtonVariantSchema = z.enum(['primary', 'secondary', 'ghost']);
export type MegamenuButtonVariant = z.infer<typeof megamenuButtonVariantSchema>;

export const megamenuIconPositionSchema = z.enum(['left', 'right']);
export type MegamenuIconPosition = z.infer<typeof megamenuIconPositionSchema>;

export const megamenuEmbedSideSchema = z.enum(['left', 'right']);
export type MegamenuEmbedSide = z.infer<typeof megamenuEmbedSideSchema>;

export const megamenuAssetKindSchema = z.enum(['image', 'video']);
export type MegamenuAssetKind = z.infer<typeof megamenuAssetKindSchema>;

const externalUrlRegex = /^(?:https?:\/\/|tel:|mailto:)/i;
const externalUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => externalUrlRegex.test(value), {
    message: 'External link must use http://, https://, tel:, or mailto: scheme.',
  });

const buttonUrlSchema = z.string().min(1).max(2048);

const optionalIconShape = {
  iconAssetId: uuidSchema.nullable().optional(),
  iconPosition: megamenuIconPositionSchema.nullable().optional(),
};

// ────────────────────────────────────────────────────────────────────
// Item-level discriminated union — the wire shape carries `kind` at
// the item level and the kind-specific fields collapsed into `target`.
// ────────────────────────────────────────────────────────────────────

export const megamenuItemBaseFields = {
  id: uuidSchema.optional(),
  parentId: uuidSchema.nullable().optional(),
  position: z.number().int().nonnegative(),
  labels: multilingualStringSchema,
  descriptions: multilingualStringSchema.nullable().optional(),
  /** Tabs only, and required there (FR-001) — the server refuses either mistake. */
  presentation: megamenuPresentationSchema.optional(),
  /** Tabs only; `start` when a tab omits it. */
  alignment: megamenuAlignmentSchema.optional(),
  /** `everyone` when omitted. */
  audience: megamenuAudienceSchema.optional(),
  /**
   * Tabs with a link of their own and a panel only: a click follows the tab's
   * link, and the panel opens on hover and from its own toggle. Off by default,
   * when a click opens the panel.
   */
  clickNavigates: z.boolean().optional(),
} as const;

export const categoryLinkTargetSchema = z.object({
  categoryId: uuidSchema,
  ...optionalIconShape,
});
export type CategoryLinkTarget = z.infer<typeof categoryLinkTargetSchema>;

export const cmsPageLinkTargetSchema = z.object({
  pageId: uuidSchema,
  ...optionalIconShape,
});
export type CmsPageLinkTarget = z.infer<typeof cmsPageLinkTargetSchema>;

export const externalLinkTargetSchema = z.object({
  url: externalUrlSchema,
  ...optionalIconShape,
});
export type ExternalLinkTarget = z.infer<typeof externalLinkTargetSchema>;

export const buttonTargetSchema = z.object({
  url: buttonUrlSchema,
  variant: megamenuButtonVariantSchema,
});
export type ButtonTarget = z.infer<typeof buttonTargetSchema>;

export const assetTargetSchema = z.union([
  z.object({
    assetId: uuidSchema,
    kind: megamenuAssetKindSchema,
  }),
  z.object({
    /** Free URL — replaced with assetId at save time via Assets Library import. */
    url: z.string().url(),
    kind: megamenuAssetKindSchema,
  }),
]);
export type AssetTarget = z.infer<typeof assetTargetSchema>;

export const cmsBlockEmbedTargetSchema = z.object({
  blockId: uuidSchema,
  embedSide: megamenuEmbedSideSchema,
});
export type CmsBlockEmbedTarget = z.infer<typeof cmsBlockEmbedTargetSchema>;

/** A group points at nothing: it is a heading. */
export const groupTargetSchema = z.object({});
export type GroupTarget = z.infer<typeof groupTargetSchema>;

/**
 * A live expansion of the catalogue: the root's live descendants to `depth`
 * levels, or the whole catalogue's from its top level when the root is `null`.
 */
export const categoryTreeTargetSchema = z.object({
  rootCategoryId: uuidSchema.nullable(),
  depth: z.number().int().min(1).max(3),
});
export type CategoryTreeTarget = z.infer<typeof categoryTreeTargetSchema>;

export const megamenuItemSchema = z.discriminatedUnion('kind', [
  z.object({ ...megamenuItemBaseFields, kind: z.literal('category-link'), target: categoryLinkTargetSchema }),
  z.object({ ...megamenuItemBaseFields, kind: z.literal('cms-page-link'), target: cmsPageLinkTargetSchema }),
  z.object({ ...megamenuItemBaseFields, kind: z.literal('external-link'), target: externalLinkTargetSchema }),
  z.object({ ...megamenuItemBaseFields, kind: z.literal('button'), target: buttonTargetSchema }),
  z.object({ ...megamenuItemBaseFields, kind: z.literal('asset'), target: assetTargetSchema }),
  z.object({ ...megamenuItemBaseFields, kind: z.literal('cms-block-embed'), target: cmsBlockEmbedTargetSchema }),
  z.object({ ...megamenuItemBaseFields, kind: z.literal('group'), target: groupTargetSchema }),
  z.object({ ...megamenuItemBaseFields, kind: z.literal('category-tree'), target: categoryTreeTargetSchema }),
]);
export type MegamenuItem = z.infer<typeof megamenuItemSchema>;

// ────────────────────────────────────────────────────────────────────
// Megamenu (configuration row)
// ────────────────────────────────────────────────────────────────────

export const megamenuBindingSchema = z.object({
  salesChannelId: uuidSchema,
  language: z.string().min(2).max(8),
  active: z.boolean(),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MegamenuBinding = z.infer<typeof megamenuBindingSchema>;

export const megamenuSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  version: z.number().int(),
  bindings: z.array(megamenuBindingSchema),
  activeIn: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type MegamenuSummary = z.infer<typeof megamenuSummarySchema>;

export const megamenuDetailSchema = megamenuSummarySchema.extend({
  items: z.array(megamenuItemSchema),
});
export type MegamenuDetail = z.infer<typeof megamenuDetailSchema>;

export const createMegamenuRequestSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
});
export type CreateMegamenuRequest = z.infer<typeof createMegamenuRequestSchema>;

export const patchMegamenuRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    version: z.number().int().optional(),
  })
  .refine((x) => Object.keys(x).length > 0, { message: 'At least one field required.' });
export type PatchMegamenuRequest = z.infer<typeof patchMegamenuRequestSchema>;

export const putItemsRequestSchema = z.object({
  items: z.array(megamenuItemSchema),
  version: z.number().int(),
});
export type PutItemsRequest = z.infer<typeof putItemsRequestSchema>;

export const addBindingRequestSchema = z.object({
  salesChannelId: uuidSchema,
  language: z.string().min(2).max(8),
});
export type AddBindingRequest = z.infer<typeof addBindingRequestSchema>;

export const activateBindingRequestSchema = addBindingRequestSchema;
export type ActivateBindingRequest = z.infer<typeof activateBindingRequestSchema>;

// ────────────────────────────────────────────────────────────────────
// Storefront resolved payload (recursive)
// ────────────────────────────────────────────────────────────────────

export const megamenuResolvedIconSchema = z.object({
  assetId: uuidSchema,
  url: z.string(),
  position: megamenuIconPositionSchema,
});
export type MegamenuResolvedIcon = z.infer<typeof megamenuResolvedIconSchema>;

export const megamenuResolvedAssetSchema = z.object({
  id: uuidSchema,
  kind: megamenuAssetKindSchema,
  url: z.string(),
  label: z.string().nullable(),
});
export type MegamenuResolvedAsset = z.infer<typeof megamenuResolvedAssetSchema>;

export const megamenuResolvedBlockSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  language: z.string(),
  content: z.object({ schemaVersion: z.number().int(), data: z.unknown() }),
});
export type MegamenuResolvedBlock = z.infer<typeof megamenuResolvedBlockSchema>;

/**
 * The kinds a resolved tree carries: every stored kind but `category-tree`,
 * which the resolver replaces by the categories it expands to (feature 168).
 */
export const megamenuResolvedItemKindSchema = megamenuItemKindSchema.exclude(['category-tree']);
export type MegamenuResolvedItemKind = z.infer<typeof megamenuResolvedItemKindSchema>;

const resolvedMenuItemBase = z.object({
  /**
   * A stored item's uuid, or `<tree item id>:<category id>` for a category a
   * `category-tree` expanded to — those have no row of their own.
   */
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  kind: megamenuResolvedItemKindSchema,
  label: z.string(),
  /** Tabs only. */
  presentation: megamenuPresentationSchema.optional(),
  /** Tabs only. */
  alignment: megamenuAlignmentSchema.optional(),
  /** Tabs only, and only when `true`: a click follows `url`; the panel opens on hover or its toggle. */
  clickNavigates: z.boolean().optional(),
  description: z.string().nullable().optional(),
  url: z.string().optional(),
  icon: megamenuResolvedIconSchema.nullable().optional(),
  variant: megamenuButtonVariantSchema.optional(),
  asset: megamenuResolvedAssetSchema.optional(),
  block: megamenuResolvedBlockSchema.optional(),
  embedSide: megamenuEmbedSideSchema.optional(),
});

export type ResolvedMenuItem = z.infer<typeof resolvedMenuItemBase> & {
  children: ResolvedMenuItem[];
};

export const resolvedMenuItemSchema: z.ZodType<ResolvedMenuItem> = z.lazy(() =>
  resolvedMenuItemBase.extend({ children: z.array(resolvedMenuItemSchema) }),
);

export const resolvedMegamenuSchema = z.object({
  megamenuId: uuidSchema,
  name: z.string(),
  language: z.string(),
  items: z.array(resolvedMenuItemSchema),
});
export type ResolvedMegamenu = z.infer<typeof resolvedMegamenuSchema>;

// ────────────────────────────────────────────────────────────────────
// Activate response — surfaces the previously-active menu so the admin
// can render a "switched from <name>" confirmation.
// ────────────────────────────────────────────────────────────────────

export const activateBindingResponseSchema = z.object({
  activated: z.object({
    megamenuId: uuidSchema,
    salesChannelId: uuidSchema,
    language: z.string(),
  }),
  previouslyActive: z
    .object({
      megamenuId: uuidSchema,
      name: z.string(),
    })
    .nullable(),
});
export type ActivateBindingResponse = z.infer<typeof activateBindingResponseSchema>;
