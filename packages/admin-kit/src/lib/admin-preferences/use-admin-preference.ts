import { useCallback, useSyncExternalStore } from 'react';
import { ADMIN_PREFERENCES_DEFAULTS, type AdminPreferences } from '@endora-commerce/contracts';
import { useAdminPreferencesStore } from './AdminPreferencesProvider.js';
import type { AdminPreferencesStore, Availability, PreferencesSnapshot } from './store.js';

/** What a signed-out tree reads: the defaults, nothing saved. */
const SIGNED_OUT: PreferencesSnapshot = {
  values: ADMIN_PREFERENCES_DEFAULTS,
  availability: 'unavailable',
  unsavedNotice: false,
};
const noSubscription = (): (() => void) => () => undefined;
const signedOutSnapshot = (): PreferencesSnapshot => SIGNED_OUT;

/** The snapshot of the signed-in admin's store, or the inert signed-out one. */
export function usePreferencesSnapshot(): {
  store: AdminPreferencesStore | null;
  snapshot: PreferencesSnapshot;
} {
  const store = useAdminPreferencesStore();
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    store?.getSnapshot ?? signedOutSnapshot,
    store?.getSnapshot ?? signedOutSnapshot,
  );
  return { store, snapshot };
}

/** The three sidebar preferences; page sizes go through `usePageSizePreference`. */
export type SidebarPreferenceKey = 'sidebarPins' | 'sidebarCollapsedGroups' | 'sidebarRailMode';

/**
 * Feature 164 — one of the signed-in admin's sidebar preferences, and its setter.
 *
 * The setter applies the value at once and saves it in the background (FR-017):
 * the server is told the newest value, in order, however fast it changes; a
 * failed save keeps the value on screen and raises the notice
 * `useAdminPreferencesStatus` reports. Throws outside an `AuthProvider`; while
 * nobody is signed in it reads the defaults and the setter does nothing.
 */
export function useAdminPreference<K extends SidebarPreferenceKey>(
  key: K,
): readonly [AdminPreferences[K], (next: AdminPreferences[K]) => void] {
  const { store, snapshot } = usePreferencesSnapshot();
  const set = useCallback((next: AdminPreferences[K]) => store?.set(key, next), [store, key]);
  return [snapshot.values[key], set] as const;
}

export interface AdminPreferencesStatus {
  /** `unavailable` — nothing loaded; defaults are shown and nothing is saved (FR-018). */
  availability: Availability;
  /** A save failed and has not succeeded since: render the notice once (FR-017). */
  unsavedNotice: boolean;
  dismissNotice(): void;
}

const noop = (): void => undefined;

/** Whether preferences are loaded, and whether a failed save should be announced. */
export function useAdminPreferencesStatus(): AdminPreferencesStatus {
  const { store, snapshot } = usePreferencesSnapshot();
  return {
    availability: snapshot.availability,
    unsavedNotice: snapshot.unsavedNotice,
    dismissNotice: store?.dismissNotice ?? noop,
  };
}
