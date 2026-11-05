/**
 * An in-memory Web Storage for the admin suite (issue #442).
 *
 * `admin/test/setup.ts` installs one as `localStorage` and one as
 * `sessionStorage` before every test, so a test always starts from empty
 * storage and never depends on which Node major runs the workers. Node 25 added
 * its own Web Storage globals, and vitest's jsdom environment only copies a
 * window key onto the global when the global does not already have it — so
 * jsdom's storage lost to Node's, which is `undefined` on Node 26 without
 * `--localstorage-file`.
 *
 * It implements the `Storage` methods and `length`. It does not implement
 * named-property access (`localStorage.foo`) or `storage` events; nothing under
 * test uses either.
 */
export function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length(): number {
      return store.size;
    },
    clear: (): void => store.clear(),
    getItem: (key: string): string | null => store.get(String(key)) ?? null,
    key: (index: number): string | null => [...store.keys()][index] ?? null,
    removeItem: (key: string): void => {
      store.delete(String(key));
    },
    setItem: (key: string, value: string): void => {
      store.set(String(key), String(value));
    },
  };
}

export type StorageName = 'localStorage' | 'sessionStorage';

/**
 * Defines a fresh in-memory storage as `target[name]` and returns it.
 *
 * Unconditional on purpose: whatever was there before — jsdom's storage, Node's
 * accessor answering `undefined`, or a test's own replacement from the previous
 * test — the property is redefined as a plain value.
 */
export function installMemoryStorage(target: object, name: StorageName): Storage {
  const storage = createMemoryStorage();
  Object.defineProperty(target, name, { value: storage, configurable: true, enumerable: true });
  return storage;
}
