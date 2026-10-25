import { describe, expect, it } from 'vitest';
import { AVAILABILITY_FILTERABLE_ATTRIBUTES, pendingAvailabilitySettings } from './search-availability.js';

/**
 * Feature 163 (code review W1) — an index built before the upgrade does not know
 * the availability fields as filterable, so every query naming them would be
 * refused and fall back to Postgres until somebody reindexed. At boot each
 * existing channel index is compared with what this release needs, and only the
 * settings that are missing are pushed — a settings update re-indexes the
 * corpus it lands on, so an index already up to date is left alone.
 */
const WANTED = {
  filterable: ['categoryIds', 'categorySlugs', 'status', ...AVAILABILITY_FILTERABLE_ATTRIBUTES, 'attributes.color'],
  searchable: ['name', 'localizedNames', 'sku', 'description', 'searchableOptions'],
};

describe('pendingAvailabilitySettings', () => {
  it('asks for nothing when the index already filters on every availability field and searches localized names', () => {
    expect(pendingAvailabilitySettings({ filterable: WANTED.filterable, searchable: WANTED.searchable }, WANTED)).toEqual({});
  });

  it('pushes the filterable set when an availability field is missing (a pre-upgrade index)', () => {
    const current = { filterable: ['categoryIds', 'categorySlugs', 'status', 'visibility'], searchable: WANTED.searchable };
    expect(pendingAvailabilitySettings(current, WANTED)).toEqual({ filterable: WANTED.filterable });
  });

  it('pushes the searchable set when localized names are not searched', () => {
    const current = { filterable: WANTED.filterable, searchable: ['name', 'sku', 'description', 'searchableOptions'] };
    expect(pendingAvailabilitySettings(current, WANTED)).toEqual({ searchable: WANTED.searchable });
  });

  it("reads Meilisearch's default `*` as searching everything", () => {
    expect(pendingAvailabilitySettings({ filterable: WANTED.filterable, searchable: ['*'] }, WANTED)).toEqual({});
  });
});
