import { describe, expect, it } from 'vitest';
import {
  matchesSearchTerms,
  searchTerms,
} from '../../../../packages/admin-shell/src/lib/palette-match';

/**
 * The ⌘K palette's matching rule, for every group it renders.
 *
 * Owner-reported: typing `kanał sprzedaży` did not find `Kanały sprzedaży`. The
 * rule was "the whole folded query is a substring of one field", so a two-word
 * query had to appear contiguously, in that exact inflection, inside a single
 * label, description or keyword — `kanal sprzedazy` is not a substring of
 * `kanaly sprzedazy`, and a keyword list is single words. The rule is now
 * per word: every word of the query must occur somewhere in the row.
 */
describe('palette matching — every query word, anywhere in the row', () => {
  it('folds case, diacritics and the stroked ł, and drops empty words', () => {
    expect(searchTerms('  Kanał   SPRZEDAŻY ')).toEqual(['kanal', 'sprzedazy']);
    expect(searchTerms('   ')).toEqual([]);
  });

  it('matches a multi-word query whose words are not contiguous in one field', () => {
    const row = ['Kanały sprzedaży', 'Kanały sklepu', 'sales', 'channel', 'channels'];
    expect(matchesSearchTerms(searchTerms('kanał sprzedaży'), row)).toBe(true);
    expect(matchesSearchTerms(searchTerms('kanal sprzedazy'), row)).toBe(true);
    // Words drawn from two different fields.
    expect(matchesSearchTerms(searchTerms('sales channels'), row)).toBe(true);
    expect(matchesSearchTerms(searchTerms('sprzedaży sklepu'), row)).toBe(true);
  });

  it('still requires every word — one unmatched word rejects the row', () => {
    const row = ['Kanały sprzedaży', 'Kanały sklepu'];
    expect(matchesSearchTerms(searchTerms('kanały faktury'), row)).toBe(false);
    expect(matchesSearchTerms(searchTerms('xyzzy'), row)).toBe(false);
  });

  it('behaves exactly as the old rule for a single word', () => {
    const row = ['Otwórz zamówienia', 'Przeglądaj i zarządzaj zamówieniami klientów'];
    expect(matchesSearchTerms(searchTerms('zamowienia'), row)).toBe(true);
    expect(matchesSearchTerms(searchTerms('zamów'), row)).toBe(true);
    expect(matchesSearchTerms(searchTerms('faktury'), row)).toBe(false);
  });

  it('matches every row for an empty query', () => {
    expect(matchesSearchTerms(searchTerms(''), ['anything'])).toBe(true);
  });
});
