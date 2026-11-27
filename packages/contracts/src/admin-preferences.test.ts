import { describe, expect, it } from 'vitest';
import { AdminNavSectionNameSchema } from './admin-contributions.js';
import {
  ADMIN_LIST_PAGE_SIZE_DEFAULT,
  ADMIN_LIST_PAGE_SIZE_OPTIONS,
  ADMIN_PINNED_GROUP_KEY,
  ADMIN_PREFERENCE_KEYS,
  ADMIN_PREFERENCES_DEFAULTS,
  adminPreferencesLegacyImportSchema,
  adminPreferencesPatchSchema,
  adminPreferencesSchema,
} from './admin-preferences.js';

/**
 * Feature 164 — the closed set of per-admin Admin UI preferences
 * (`specs/164-admin-user-preferences/contracts/admin-preferences-api.md` §1).
 * Strict on write (FR-012), tolerant on read (FR-015).
 */

const pins = (n: number): string[] => Array.from({ length: n }, (_, i) => `/p${i}`);
const groups = (n: number): string[] => Array.from({ length: n }, (_, i) => `g${i}`);
const lists = (n: number, size: number | null = 20): Record<string, number | null> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`list-${i}`, size]));

describe('ADMIN_PREFERENCE_KEYS', () => {
  it('is exactly the five preferences', () => {
    expect([...ADMIN_PREFERENCE_KEYS]).toEqual([
      'sidebarPins',
      'sidebarCollapsedGroups',
      'sidebarRailMode',
      'listPageSizes',
      'listViewModes',
    ]);
  });
});

describe('adminPreferencesPatchSchema (FR-012)', () => {
  it.each([
    ['an unknown key', { theme: 'dark' }],
    ['an empty object', {}],
    ['rail mode that is not a boolean', { sidebarRailMode: 'yes' }],
    ['pins that are not an array', { sidebarPins: '/orders' }],
    ['a page size that is not an option', { listPageSizes: { orders: 7 } }],
  ])('refuses %s', (_label, body) => {
    expect(adminPreferencesPatchSchema.safeParse(body).success).toBe(false);
  });

  it('accepts one known key', () => {
    expect(adminPreferencesPatchSchema.safeParse({ sidebarRailMode: true }).success).toBe(true);
  });

  it('refuses a destination pinned twice (FR-007)', () => {
    expect(
      adminPreferencesPatchSchema.safeParse({ sidebarPins: ['/orders', '/orders'] }).success,
    ).toBe(false);
  });

  it('accepts 200 pins and refuses 201 (FR-008)', () => {
    expect(adminPreferencesPatchSchema.safeParse({ sidebarPins: pins(200) }).success).toBe(true);
    expect(adminPreferencesPatchSchema.safeParse({ sidebarPins: pins(201) }).success).toBe(false);
  });

  it.each([
    ['without a leading slash', 'orders'],
    ['with a query string', '/orders?status=open'],
    ['of 256 characters', `/${'a'.repeat(255)}`],
  ])('refuses a destination %s', (_label, destination) => {
    expect(adminPreferencesPatchSchema.safeParse({ sidebarPins: [destination] }).success).toBe(
      false,
    );
  });

  it('accepts a destination of 255 characters', () => {
    expect(
      adminPreferencesPatchSchema.safeParse({ sidebarPins: [`/${'a'.repeat(254)}`] }).success,
    ).toBe(true);
  });

  it('accepts 32 folded groups and refuses 33', () => {
    expect(
      adminPreferencesPatchSchema.safeParse({ sidebarCollapsedGroups: groups(32) }).success,
    ).toBe(true);
    expect(
      adminPreferencesPatchSchema.safeParse({ sidebarCollapsedGroups: groups(33) }).success,
    ).toBe(false);
  });

  it.each(['Pinned', '1x'])('refuses the group key %s', (key) => {
    expect(adminPreferencesPatchSchema.safeParse({ sidebarCollapsedGroups: [key] }).success).toBe(
      false,
    );
  });

  it('accepts the Pinned section group key `pinned`', () => {
    expect(
      adminPreferencesPatchSchema.safeParse({ sidebarCollapsedGroups: [ADMIN_PINNED_GROUP_KEY] })
        .success,
    ).toBe(true);
    expect(ADMIN_PINNED_GROUP_KEY).toBe('pinned');
  });

  it('refuses a folded group listed twice', () => {
    expect(
      adminPreferencesPatchSchema.safeParse({ sidebarCollapsedGroups: ['sales', 'sales'] })
        .success,
    ).toBe(false);
  });

  it('accepts `null` for a list (forget it)', () => {
    expect(
      adminPreferencesPatchSchema.safeParse({ listPageSizes: { orders: null } }).success,
    ).toBe(true);
  });

  it('accepts 128 lists and refuses 129', () => {
    expect(adminPreferencesPatchSchema.safeParse({ listPageSizes: lists(128) }).success).toBe(true);
    expect(adminPreferencesPatchSchema.safeParse({ listPageSizes: lists(129) }).success).toBe(
      false,
    );
  });

  it.each([
    ['upper case', 'Orders'],
    ['a double hyphen', 'a--b'],
    ['65 characters', 'a'.repeat(65)],
  ])('refuses a list id with %s', (_label, id) => {
    expect(adminPreferencesPatchSchema.safeParse({ listPageSizes: { [id]: 20 } }).success).toBe(
      false,
    );
  });
});

describe('adminPreferencesLegacyImportSchema (FR-022)', () => {
  it('accepts page sizes', () => {
    expect(
      adminPreferencesLegacyImportSchema.safeParse({ listPageSizes: { orders: 10 } }).success,
    ).toBe(true);
  });

  it.each([
    ['an empty map', { listPageSizes: {} }],
    ['a null value', { listPageSizes: { orders: null } }],
    ['129 entries', { listPageSizes: lists(129) }],
    ['an extra key', { listPageSizes: { orders: 10 }, sidebarRailMode: true }],
  ])('refuses %s', (_label, body) => {
    expect(adminPreferencesLegacyImportSchema.safeParse(body).success).toBe(false);
  });
});

describe('page-size options (FR-014)', () => {
  it('are the six options with 20 the default', () => {
    expect([...ADMIN_LIST_PAGE_SIZE_OPTIONS]).toEqual([5, 10, 20, 50, 100, 500]);
    expect(ADMIN_LIST_PAGE_SIZE_DEFAULT).toBe(20);
  });
});

describe('adminPreferencesSchema — the read side (FR-015)', () => {
  it('accepts values the current release no longer understands', () => {
    expect(
      adminPreferencesSchema.safeParse({
        sidebarPins: ['/retired'],
        sidebarCollapsedGroups: ['oldGroup'],
        sidebarRailMode: false,
        listPageSizes: { orders: 7 },
        listViewModes: { tasks: 'timeline' },
      }).success,
    ).toBe(true);
  });

  it('parses the defaults', () => {
    expect(adminPreferencesSchema.parse(ADMIN_PREFERENCES_DEFAULTS)).toEqual({
      sidebarPins: [],
      sidebarCollapsedGroups: [],
      sidebarRailMode: false,
      listPageSizes: {},
      listViewModes: {},
    });
  });
});

describe('listViewModes (165 R-14, FR-018)', () => {
  it('accepts list or board per kebab-case list id', () => {
    expect(
      adminPreferencesPatchSchema.safeParse({ listViewModes: { tasks: 'board', 'tasks-mine': 'list' } })
        .success,
    ).toBe(true);
  });

  it('accepts `null` for a list (forget it, back to the default)', () => {
    expect(adminPreferencesPatchSchema.safeParse({ listViewModes: { tasks: null } }).success).toBe(true);
  });

  it.each([
    ['a mode that is neither list nor board', { listViewModes: { tasks: 'timeline' } }],
    ['an upper-case list id', { listViewModes: { Tasks: 'board' } }],
    ['a snake_case list id', { listViewModes: { tasks_mine: 'board' } }],
    ['a list id of 65 characters', { listViewModes: { ['a'.repeat(65)]: 'board' } }],
    ['129 lists', { listViewModes: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`l-${i}`, 'list'])) }],
  ])('refuses %s', (_label, body) => {
    expect(adminPreferencesPatchSchema.safeParse(body).success).toBe(false);
  });

  it('the tolerant read falls back to {} when the stored value is missing or unreadable', () => {
    const base = { sidebarPins: [], sidebarCollapsedGroups: [], sidebarRailMode: false, listPageSizes: {} };
    expect(adminPreferencesSchema.parse(base).listViewModes).toEqual({});
    expect(adminPreferencesSchema.parse({ ...base, listViewModes: 'board' }).listViewModes).toEqual({});
    expect(adminPreferencesSchema.parse({ ...base, listViewModes: { tasks: 'board' } }).listViewModes).toEqual({
      tasks: 'board',
    });
  });
});

describe('the Pinned group key', () => {
  it('is not a section a module may contribute into', () => {
    expect(AdminNavSectionNameSchema.safeParse(ADMIN_PINNED_GROUP_KEY).success).toBe(false);
  });
});
