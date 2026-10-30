import { describe, expect, it, vi } from 'vitest';
import { ADMIN_PREFERENCES_DEFAULTS, ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  assemblePreferences,
  assertListPageSizesBound,
  assertListViewModesBound,
  importListPageSizes,
  mergeListPageSizes,
  mergeListViewModes,
  readStoredListPageSizes,
  readStoredListViewModes,
} from './admin-preference-document.js';

/**
 * Feature 164 — the pure half of `AdminPreferenceService`: building the document
 * from the admin's rows (tolerant read, FR-015) and the two page-size merges
 * (`PATCH` per list, carry-over server-wins, FR-022), with the 128-list bound
 * checked on the merged result.
 */

const ADMIN = '00000000-0000-4000-8000-000000000164';

function logger() {
  return { warn: vi.fn() };
}

describe('assemblePreferences', () => {
  it('fills every absent key with its default', () => {
    const log = logger();
    expect(assemblePreferences([], { log, adminUserId: ADMIN })).toEqual(
      ADMIN_PREFERENCES_DEFAULTS,
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('returns stored values, keeping retired tokens as stored', () => {
    const log = logger();
    const document = assemblePreferences(
      [
        { preferenceKey: 'sidebarPins', value: ['/orders', '/retired'] },
        { preferenceKey: 'sidebarCollapsedGroups', value: ['oldGroup', 'pinned'] },
        { preferenceKey: 'sidebarRailMode', value: true },
        { preferenceKey: 'listPageSizes', value: { orders: 50, returns: 7 } },
      ],
      { log, adminUserId: ADMIN },
    );
    expect(document).toEqual({
      sidebarPins: ['/orders', '/retired'],
      sidebarCollapsedGroups: ['oldGroup', 'pinned'],
      sidebarRailMode: true,
      listPageSizes: { orders: 50, returns: 7 },
      // `specs/165-task-management/` R-14: a key with no row reads as its default.
      listViewModes: {},
    });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('serves a row of the wrong JSON type as the default and logs it once (FR-015)', () => {
    const log = logger();
    const rows = [
      { preferenceKey: 'sidebarPins', value: '/orders' },
      { preferenceKey: 'sidebarRailMode', value: true },
    ];
    const before = JSON.stringify(rows);
    const document = assemblePreferences(rows, { log, adminUserId: ADMIN });
    expect(document.sidebarPins).toEqual([]);
    expect(document.sidebarRailMode).toBe(true);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![0]).toMatchObject({
      adminUserId: ADMIN,
      preferenceKey: 'sidebarPins',
    });
    // Not rewritten: the rows handed in are untouched.
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('ignores a row whose key the release does not know', () => {
    const log = logger();
    expect(
      assemblePreferences([{ preferenceKey: 'theme', value: 'dark' }], { log, adminUserId: ADMIN }),
    ).toEqual(ADMIN_PREFERENCES_DEFAULTS);
  });
});

describe('readStoredListPageSizes', () => {
  it('reads a stored map and treats anything else as empty', () => {
    expect(readStoredListPageSizes({ orders: 50 })).toEqual({ orders: 50 });
    expect(readStoredListPageSizes(null)).toEqual({});
    expect(readStoredListPageSizes(['orders'])).toEqual({});
    expect(readStoredListPageSizes({ orders: 'fifty' })).toEqual({});
  });
});

describe('mergeListPageSizes (PATCH)', () => {
  it('sets present entries, removes null entries and keeps the others', () => {
    expect(
      mergeListPageSizes({ orders: 50, returns: 10, invoices: 100 }, { orders: 20, returns: null }),
    ).toEqual({ orders: 20, invoices: 100 });
  });

  it('removing a list that is not stored is a no-op', () => {
    expect(mergeListPageSizes({ orders: 50 }, { returns: null })).toEqual({ orders: 50 });
  });
});

describe('importListPageSizes (carry-over)', () => {
  it('lets the stored value win and adds the absent lists (FR-022, US3 AS-5)', () => {
    expect(importListPageSizes({ orders: 100 }, { orders: 10, returns: 50 })).toEqual({
      orders: 100,
      returns: 50,
    });
  });

  it('is idempotent', () => {
    const once = importListPageSizes({}, { orders: 10 });
    expect(importListPageSizes(once, { orders: 10 })).toEqual(once);
  });
});

describe('assertListPageSizesBound', () => {
  const lists = (n: number): Record<string, number> =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`list-${i}`, 20]));

  it('accepts 128 lists after a merge', () => {
    expect(() => assertListPageSizesBound(mergeListPageSizes(lists(127), { extra: 20 }))).not.toThrow();
  });

  it('refuses a 129th list after a PATCH merge with 400 VALIDATION_FAILED', () => {
    let caught: unknown;
    try {
      assertListPageSizesBound(mergeListPageSizes(lists(128), { extra: 20 }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).statusCode).toBe(400);
    expect((caught as HttpError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect((caught as HttpError).details).toEqual([
      { path: 'listPageSizes', issue: expect.any(String) },
    ]);
  });

  it('refuses a 129th list after an import merge', () => {
    expect(() =>
      assertListPageSizesBound(importListPageSizes(lists(128), { extra: 20 })),
    ).toThrow(HttpError);
  });
});

// `specs/165-task-management/` R-14 — the list/board choice merges per list as page sizes do.
describe('listViewModes (PATCH per list)', () => {
  it('reads a stored map and treats anything else as empty', () => {
    expect(readStoredListViewModes({ tasks: 'board' })).toEqual({ tasks: 'board' });
    expect(readStoredListViewModes(['tasks'])).toEqual({});
    expect(readStoredListViewModes(null)).toEqual({});
  });

  it('sets present entries, removes null entries and keeps the others', () => {
    expect(mergeListViewModes({ tasks: 'board', 'tasks-mine': 'list' }, { tasks: null, crm: 'board' })).toEqual({
      'tasks-mine': 'list',
      crm: 'board',
    });
  });

  it('refuses a 129th list after the merge with 400 VALIDATION_FAILED', () => {
    const lists = Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`l${i}`, 'list']));
    expect(() => assertListViewModesBound(lists)).toThrow(HttpError);
    try {
      assertListViewModesBound(lists);
    } catch (error) {
      expect((error as HttpError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
    expect(() => assertListViewModesBound({ tasks: 'list' })).not.toThrow();
  });
});
