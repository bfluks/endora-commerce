import { z } from 'zod';
import { AdminNavDeclarationSchema } from './admin-contributions.js';

/**
 * Feature 164 — per-admin Admin UI preferences, held by `admin_users`
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-api.md` §1).
 *
 * Strict on write: an unknown preference, a wrong shape, a duplicate or a value
 * beyond a bound is refused (FR-012). Tolerant on read: a value valid when it was
 * written may stop being understood later (a retired section or route, a removed
 * page-size option), so the read shape accepts any string list / boolean /
 * integer map and the Admin UI ignores what it does not understand (FR-015).
 *
 * Browser-safe: no `Buffer`, no Node API — the Admin UI imports this file.
 */

/** The closed set of preferences (FR-012). Adding one is a contract change. */
export const ADMIN_PREFERENCE_KEYS = [
  'sidebarPins',
  'sidebarCollapsedGroups',
  'sidebarRailMode',
  'listPageSizes',
] as const;
export const adminPreferenceKeySchema = z.enum(ADMIN_PREFERENCE_KEYS);
export type AdminPreferenceKey = z.infer<typeof adminPreferenceKeySchema>;

/**
 * Technical bounds — abuse protection, not product limits (FR-008, owner ruling
 * (c)). The Admin UI never refuses a pin and never shows a count.
 */
/** 2.5 × the 80 sidebar entries the platform can contribute today. */
export const ADMIN_SIDEBAR_PINS_MAX = 200;
/** 13 sidebar sections plus `pinned`, with room. */
export const ADMIN_SIDEBAR_COLLAPSED_GROUPS_MAX = 32;
/** Lists that remember a page size; eight today. */
export const ADMIN_LIST_PAGE_SIZES_MAX = 128;

/**
 * The page sizes a list offers. Declared here rather than in the Admin UI kit so
 * the server validates against the same array; the kit re-exports it as
 * `PAGE_SIZE_OPTIONS`.
 */
export const ADMIN_LIST_PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100, 500] as const;
export type AdminListPageSize = (typeof ADMIN_LIST_PAGE_SIZE_OPTIONS)[number];
export const ADMIN_LIST_PAGE_SIZE_DEFAULT: AdminListPageSize = 20;

/**
 * The collapse key of the sidebar's Pinned section. Deliberately **not** in
 * `AdminNavSectionNameSchema`: a module may not contribute an entry into it.
 */
export const ADMIN_PINNED_GROUP_KEY = 'pinned';

/** A sidebar destination — the rule a nav entry's `to` obeys, by reference. */
export const adminSidebarDestinationSchema = AdminNavDeclarationSchema.shape.to;
/** A sidebar group's collapse key: a section name or `pinned`. */
export const adminSidebarGroupKeySchema = z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/);
/** The id a list remembers its page size under (`orders`, `catalog-products`). */
export const adminListIdSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
/** One of {@link ADMIN_LIST_PAGE_SIZE_OPTIONS}. */
export const adminListPageSizeSchema = z.literal(ADMIN_LIST_PAGE_SIZE_OPTIONS);

const unique = (xs: readonly string[]): boolean => new Set(xs).size === xs.length;

// ---- write side: strict ---------------------------------------------------------

export const adminSidebarPinsSchema = z
  .array(adminSidebarDestinationSchema)
  .max(ADMIN_SIDEBAR_PINS_MAX)
  .refine(unique, { message: 'A destination may be pinned once.' });

export const adminSidebarCollapsedGroupsSchema = z
  .array(adminSidebarGroupKeySchema)
  .max(ADMIN_SIDEBAR_COLLAPSED_GROUPS_MAX)
  .refine(unique, { message: 'A group may be listed once.' });

const withinListBound = (record: Record<string, unknown>): boolean =>
  Object.keys(record).length <= ADMIN_LIST_PAGE_SIZES_MAX;

/** `PATCH /api/v1/admin/me/preferences`. `.strict()` refuses an unknown preference. */
export const adminPreferencesPatchSchema = z
  .object({
    sidebarPins: adminSidebarPinsSchema.optional(),
    sidebarCollapsedGroups: adminSidebarCollapsedGroupsSchema.optional(),
    sidebarRailMode: z.boolean().optional(),
    /** Per-list merge; `null` forgets the list (it returns to the default). */
    listPageSizes: z
      .record(adminListIdSchema, adminListPageSizeSchema.nullable())
      .refine(withinListBound, { message: `At most ${ADMIN_LIST_PAGE_SIZES_MAX} lists.` })
      .optional(),
  })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Name at least one preference.' });
export type AdminPreferencesPatch = z.infer<typeof adminPreferencesPatchSchema>;

/**
 * `POST /api/v1/admin/me/preferences/legacy-import` — page sizes carried over once
 * from the browser (FR-022). Insert-if-absent per list: a stored value wins.
 */
export const adminPreferencesLegacyImportSchema = z
  .object({
    listPageSizes: z
      .record(adminListIdSchema, adminListPageSizeSchema)
      .refine(
        (record) => {
          const n = Object.keys(record).length;
          return n >= 1 && n <= ADMIN_LIST_PAGE_SIZES_MAX;
        },
        { message: `Between 1 and ${ADMIN_LIST_PAGE_SIZES_MAX} lists.` },
      ),
  })
  .strict();
export type AdminPreferencesLegacyImport = z.infer<typeof adminPreferencesLegacyImportSchema>;

// ---- read side: tolerant (FR-015) -----------------------------------------------

/** What the server returns: every key present, defaults filled, inner tokens not re-judged. */
export const adminPreferencesSchema = z.object({
  sidebarPins: z.array(z.string()),
  sidebarCollapsedGroups: z.array(z.string()),
  sidebarRailMode: z.boolean(),
  listPageSizes: z.record(z.string(), z.number().int()),
});
export type AdminPreferences = z.infer<typeof adminPreferencesSchema>;

export const ADMIN_PREFERENCES_DEFAULTS: AdminPreferences = {
  sidebarPins: [],
  sidebarCollapsedGroups: [],
  sidebarRailMode: false,
  listPageSizes: {},
};

export const adminPreferencesResponseSchema = z.object({ data: adminPreferencesSchema });
