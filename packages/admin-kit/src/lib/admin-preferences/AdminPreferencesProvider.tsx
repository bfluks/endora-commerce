import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { AdminPreferences } from '@endora-commerce/contracts';
import { apiClient } from '../api-client.js';
import { AdminPreferencesStore } from './store.js';
import { carryOverLegacyPageSizes, removeUnkeyedLegacyLayout } from './legacy-carry-over.js';

/**
 * Feature 164 — the signed-in admin's preferences, provided by `AuthProvider`
 * itself (`specs/164-admin-user-preferences/contracts/admin-preferences-client.md`
 * §1). Internal: `AuthProvider` is the public seam, so a host or a test that seeds
 * a session gets a working store with nothing else to mount.
 *
 * **One store per admin.** A different admin id is a different store with
 * nothing carried over (US1 AS-7). The store is created per id rather than by
 * keying this element, so that signing in does not remount the application
 * beneath it. A newer `initial` for the **same** admin (any later
 * `refresh()` of `/admin/me`) is applied as a refetch result.
 *
 * `apiClient` is imported from `../api-client.js` directly, never from the
 * `./lib` barrel this file is a member of (see `auth.tsx` for why).
 */

/** `undefined`: no `AuthProvider` at all. `null`: inside one, nobody signed in. */
const AdminPreferencesContext = createContext<AdminPreferencesStore | null | undefined>(undefined);

export interface AdminPreferencesProviderProps {
  /** `null` while nobody is signed in: no store, and the hooks throw. */
  readonly adminUserId: string | null;
  /** The session's document; `null` puts the store in unavailable mode (FR-018). */
  readonly initial: AdminPreferences | null;
  readonly children: ReactNode;
}

export function AdminPreferencesProvider({
  adminUserId,
  initial,
  children,
}: AdminPreferencesProviderProps): ReactNode {
  const store = useMemo(
    () => (adminUserId === null ? null : new AdminPreferencesStore(initial, apiClient)),
    // A store belongs to one admin; `initial` seeds it once, and a later
    // document for the same admin is adopted below rather than rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adminUserId],
  );

  // Reconnect and foreground: retry what is unsaved, refetch what is idle.
  useEffect(() => {
    if (store === null || typeof window === 'undefined') return undefined;
    const onOnline = (): void => store.handleOnline();
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') store.handleForeground();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [store]);

  // The one-time carry-over of the browser's layout values (FR-022, FR-023):
  // the unkeyed sidebar values go at once, whatever the availability; this
  // admin's page sizes are imported as soon as the store is available — now,
  // or once a later load succeeds. Idempotent, so a double mount is harmless.
  useEffect(() => {
    if (store === null || adminUserId === null) return undefined;
    removeUnkeyedLegacyLayout();
    const run = (): void => {
      void carryOverLegacyPageSizes(store, adminUserId, apiClient);
    };
    if (store.isAvailable()) run();
    return store.onAvailable(run);
  }, [store, adminUserId]);

  // A newer `/admin/me` for the same admin.
  const seen = useRef(initial);
  useEffect(() => {
    if (store === null || initial === seen.current) return;
    seen.current = initial;
    if (initial !== null) store.adoptRemote(initial);
  }, [store, initial]);

  return (
    <AdminPreferencesContext.Provider value={store}>{children}</AdminPreferencesContext.Provider>
  );
}

/**
 * The store of the signed-in admin, or `null` while nobody is signed in (the
 * boot probe still loading, the sign-in screen). Throws outside an
 * `AuthProvider`, as `useAuth` does.
 */
export function useAdminPreferencesStore(): AdminPreferencesStore | null {
  const store = useContext(AdminPreferencesContext);
  if (store === undefined) {
    throw new Error('Admin preferences must be read inside <AuthProvider>');
  }
  return store;
}
