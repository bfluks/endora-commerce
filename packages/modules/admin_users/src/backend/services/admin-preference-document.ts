import {
  ADMIN_LIST_PAGE_SIZES_MAX,
  ADMIN_PREFERENCE_KEYS,
  ADMIN_PREFERENCES_DEFAULTS,
  ERROR_CODES,
  adminPreferencesSchema,
  type AdminListPageSize,
  type AdminPreferenceKey,
  type AdminPreferences,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Feature 164 — the pure half of `AdminPreferenceService`
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-api.md` §2.2, §3).
 *
 * Nothing here reads or writes the database: the service hands rows in and takes
 * documents and merged values out, so every rule below is unit-tested beside it.
 */

/** One stored row of `admin_user_preferences`, as the service reads it. */
export interface StoredPreferenceRow {
  preferenceKey: string;
  value: unknown;
}

/** The slice of the module logger a malformed row is reported on. */
export interface PreferenceDocumentLog {
  warn(object: Record<string, unknown>, message: string): void;
}

const KNOWN_KEYS: ReadonlySet<string> = new Set(ADMIN_PREFERENCE_KEYS);

/**
 * The admin's preferences document from their rows: every key present, an absent
 * key at its default.
 *
 * Tolerant (FR-015): a value whose inner tokens the current release no longer
 * understands (a retired route, an old group, a removed page size) is returned as
 * stored. A value that does not even have its key's JSON type is served as the
 * default and logged at `warn` — and left in place: reading never writes.
 * A row whose key this release does not know is ignored.
 */
export function assemblePreferences(
  rows: readonly StoredPreferenceRow[],
  context: { log: PreferenceDocumentLog; adminUserId: string },
): AdminPreferences {
  const document: AdminPreferences = structuredClone(ADMIN_PREFERENCES_DEFAULTS);
  for (const row of rows) {
    if (!KNOWN_KEYS.has(row.preferenceKey)) continue;
    const key = row.preferenceKey as AdminPreferenceKey;
    const parsed = adminPreferencesSchema.shape[key].safeParse(row.value);
    if (!parsed.success) {
      context.log.warn(
        { adminUserId: context.adminUserId, preferenceKey: key },
        'stored admin preference has the wrong shape; serving the default',
      );
      continue;
    }
    (document as Record<AdminPreferenceKey, unknown>)[key] = parsed.data;
  }
  return document;
}

/** The stored `listPageSizes` map, or `{}` when the row holds anything else. */
export function readStoredListPageSizes(value: unknown): Record<string, number> {
  const parsed = adminPreferencesSchema.shape.listPageSizes.safeParse(value);
  return parsed.success ? parsed.data : {};
}

/**
 * `PATCH` semantics for `listPageSizes`: present entries set, `null` entries
 * removed, every other stored list untouched.
 */
export function mergeListPageSizes(
  stored: Readonly<Record<string, number>>,
  patch: Readonly<Record<string, AdminListPageSize | null>>,
): Record<string, number> {
  const merged: Record<string, number> = { ...stored };
  for (const [list, size] of Object.entries(patch)) {
    if (size === null) delete merged[list];
    else merged[list] = size;
  }
  return merged;
}

/**
 * Carry-over semantics (FR-022, FR-023): insert-if-absent per list — a value the
 * server already holds wins, so a repeat or a concurrent import converges.
 */
export function importListPageSizes(
  stored: Readonly<Record<string, number>>,
  imported: Readonly<Record<string, AdminListPageSize>>,
): Record<string, number> {
  return { ...imported, ...stored };
}

/**
 * The 128-list bound, judged on the merged value — the request alone cannot know
 * how many lists are already stored. Refused as the platform's own validation
 * failure, so nothing is written.
 */
export function assertListPageSizesBound(merged: Readonly<Record<string, number>>): void {
  if (Object.keys(merged).length <= ADMIN_LIST_PAGE_SIZES_MAX) return;
  throw new HttpError(
    400,
    ERROR_CODES.VALIDATION_FAILED,
    `At most ${ADMIN_LIST_PAGE_SIZES_MAX} lists may remember a page size.`,
    [{ path: 'listPageSizes', issue: `more than ${ADMIN_LIST_PAGE_SIZES_MAX} lists` }],
  );
}
