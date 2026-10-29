import {
  ADMIN_LIST_PAGE_SIZE_OPTIONS,
  adminListIdSchema,
  type AdminListPageSize,
  type AdminPreferences,
} from '@endora-commerce/contracts';
import type { AdminPreferencesStore } from './store.js';

/**
 * Feature 164 — carrying the browser's layout values over, once
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-client.md` §4;
 * FR-022, FR-023; owner ruling (d)).
 *
 * **This is the only source file that may name the legacy `localStorage` keys**
 * (SC-004, `admin/test/kit/no-legacy-layout-storage.test.ts`):
 *
 * - `b2b-admin.nav.collapsed-groups` and `b2b-admin.nav.rail-mode` were not
 *   keyed by admin, so on a shared browser they say nothing about who set them.
 *   They are removed and never imported: everyone opens in the default sidebar
 *   layout.
 * - `b2b-admin.page-size.<scope>.<adminId>` was keyed. The signed-in admin's
 *   are imported insert-if-absent (a value already on the server wins) and
 *   removed only once the server confirmed; another admin's — and the hook's
 *   historical `anon` — are neither read nor removed. An unreadable value, a
 *   size that is not an option, or a scope that is not a list id is removed
 *   and not sent.
 *
 * The import is idempotent on the server, so a retry, a reload mid-import or
 * two tabs at once converge on one value per list. Every storage access is
 * guarded: a browser with storage disabled simply has nothing to carry over.
 */

const UNKEYED_LAYOUT_KEYS = ['b2b-admin.nav.collapsed-groups', 'b2b-admin.nav.rail-mode'];
const PAGE_SIZE_PREFIX = 'b2b-admin.page-size.';
export const LEGACY_IMPORT_URL = '/api/v1/admin/me/preferences/legacy-import';

export interface LegacyImportTransport {
  post<T>(path: string, body: unknown): Promise<T>;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : (window.localStorage ?? null);
  } catch {
    return null;
  }
}

function removeKey(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Storage refused the write; nothing else to do.
  }
}

/** Step 1 — remove the two unkeyed sidebar values (also when preferences are unavailable). */
export function removeUnkeyedLegacyLayout(): void {
  const storage = browserStorage();
  if (storage === null) return;
  for (const key of UNKEYED_LAYOUT_KEYS) removeKey(storage, key);
}

function asPageSize(raw: string | null): AdminListPageSize | null {
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const size = Number(raw.trim());
  return (ADMIN_LIST_PAGE_SIZE_OPTIONS as readonly number[]).includes(size)
    ? (size as AdminListPageSize)
    : null;
}

/** Steps 3–4 — this admin's valid page sizes; invalid ones are removed on the way. */
function collectOwnPageSizes(
  storage: Storage,
  adminUserId: string,
): { sizes: Record<string, AdminListPageSize>; keys: string[] } {
  const suffix = `.${adminUserId}`;
  const own: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== null && key.startsWith(PAGE_SIZE_PREFIX) && key.endsWith(suffix)) own.push(key);
    }
  } catch {
    return { sizes: {}, keys: [] };
  }
  const sizes: Record<string, AdminListPageSize> = {};
  const keys: string[] = [];
  for (const key of own) {
    const scope = key.slice(PAGE_SIZE_PREFIX.length, key.length - suffix.length);
    let raw: string | null = null;
    try {
      raw = storage.getItem(key);
    } catch {
      continue;
    }
    const size = asPageSize(raw);
    if (size === null || !adminListIdSchema.safeParse(scope).success) {
      removeKey(storage, key);
      continue;
    }
    sizes[scope] = size;
    keys.push(key);
  }
  return { sizes, keys };
}

/**
 * Steps 3–6 — import this admin's page sizes and, once the server confirmed,
 * remove them and adopt what the server holds. A failure keeps the keys for the
 * next load.
 */
export async function carryOverLegacyPageSizes(
  store: AdminPreferencesStore,
  adminUserId: string,
  transport: LegacyImportTransport,
): Promise<void> {
  const storage = browserStorage();
  if (storage === null) return;
  const { sizes, keys } = collectOwnPageSizes(storage, adminUserId);
  if (keys.length === 0) return;
  let response: { data: AdminPreferences };
  try {
    response = await transport.post<{ data: AdminPreferences }>(LEGACY_IMPORT_URL, {
      listPageSizes: sizes,
    });
  } catch {
    return;
  }
  for (const key of keys) removeKey(storage, key);
  const remote = response?.data?.listPageSizes;
  if (typeof remote === 'object' && remote !== null) store.adoptListPageSizes(remote);
}
