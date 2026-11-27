import { describe, expect, it } from 'vitest';
import { createMemoryStorage, installMemoryStorage } from '../helpers/memory-storage';

/**
 * Issue #442 — the suite's `localStorage` and `sessionStorage` are the setup
 * file's in-memory `Storage`, whatever Node is running the workers.
 *
 * From Node 25 the runtime has its own Web Storage globals. Vitest's jsdom
 * environment copies a window key onto the global only when the global does not
 * already have it, so Node's `localStorage` won: on Node 26 it is `undefined`
 * without `--localstorage-file`, and every test that called
 * `window.localStorage.clear()` died before its first assertion.
 */
describe('the suite-wide Web Storage (admin/test/setup.ts)', () => {
  it.each(['localStorage', 'sessionStorage'] as const)('gives every test a working, empty %s', (name) => {
    const storage = window[name];
    expect(storage).toBeDefined();
    expect(storage.length).toBe(0);

    storage.setItem('k', 'v');
    expect(storage.getItem('k')).toBe('v');
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe('k');
    // Left behind on purpose: the next test proves it does not survive.
    storage.setItem('leak', '1');
  });

  it.each(['localStorage', 'sessionStorage'] as const)('does not carry %s over from the previous test', (name) => {
    expect(window[name].getItem('leak')).toBeNull();
    expect(window[name].length).toBe(0);
  });

  it('is the same object through window and globalThis', () => {
    expect(globalThis.localStorage).toBe(window.localStorage);
    expect(globalThis.sessionStorage).toBe(window.sessionStorage);
  });
});

describe('installMemoryStorage', () => {
  it('replaces a storage global that a runtime shadowed with undefined', () => {
    // The Node 26 shape: an accessor on the global that answers `undefined`.
    const target = {} as { localStorage?: Storage };
    Object.defineProperty(target, 'localStorage', { get: () => undefined, configurable: true });

    const installed = installMemoryStorage(target, 'localStorage');

    expect(target.localStorage).toBe(installed);
    target.localStorage?.setItem('a', '1');
    expect(target.localStorage?.getItem('a')).toBe('1');
  });

  it('replaces a storage global whose methods are missing', () => {
    // The Node 25 shape: an object is there, but it is not a usable Storage.
    const target = { localStorage: {} as Storage };

    installMemoryStorage(target, 'localStorage');

    target.localStorage.setItem('a', '1');
    expect(target.localStorage.getItem('a')).toBe('1');
  });
});

describe('createMemoryStorage', () => {
  it('implements the Storage contract', () => {
    const storage = createMemoryStorage();
    expect(storage.getItem('missing')).toBeNull();
    expect(storage.key(0)).toBeNull();

    storage.setItem('n', 42 as unknown as string);
    expect(storage.getItem('n')).toBe('42');

    storage.setItem('n', 'again');
    expect(storage.length).toBe(1);

    storage.removeItem('n');
    expect(storage.getItem('n')).toBeNull();

    storage.setItem('a', '1');
    storage.setItem('b', '2');
    storage.clear();
    expect(storage.length).toBe(0);
  });
});
