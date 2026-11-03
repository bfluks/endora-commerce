import { installMemoryStorage } from './memory-storage';

/**
 * Installs a fresh in-memory `localStorage` on `window` and returns it.
 *
 * `admin/test/setup.ts` already gives every test an empty one (issue #442), so
 * this is only needed by a test that wants a handle on the store, or a new empty
 * store part-way through a test.
 */
export function withLocalStorage(): Storage {
  return installMemoryStorage(window, 'localStorage');
}
