import { describe, expect, it } from 'vitest';
import { pickLocalized } from './localized-name.js';

/**
 * Feature 155 (D3/D4) — the one picker that names a product in a language. Every
 * minimum refusal passes it the language the error sentence is written in, so the
 * name and the sentence never disagree.
 */
describe('pickLocalized', () => {
  const name = { en: 'Anchor', pl: 'Kotwa' };

  it('takes the exact language', () => {
    expect(pickLocalized(name, 'pl')).toBe('Kotwa');
    expect(pickLocalized(name, 'en')).toBe('Anchor');
  });

  it('matches a regional key by its primary language, either way round', () => {
    expect(pickLocalized({ 'en-US': 'Anchor', 'pl-PL': 'Kotwa' }, 'pl')).toBe('Kotwa');
    expect(pickLocalized(name, 'pl-PL')).toBe('Kotwa');
  });

  it('falls back to en-US, then en, then the first value, then the empty string', () => {
    expect(pickLocalized({ de: 'Anker', 'en-US': 'Anchor US', en: 'Anchor' }, 'pl')).toBe('Anchor US');
    expect(pickLocalized({ de: 'Anker', en: 'Anchor' }, 'pl')).toBe('Anchor');
    expect(pickLocalized({ de: 'Anker' }, 'pl')).toBe('Anker');
    expect(pickLocalized({}, 'pl')).toBe('');
    expect(pickLocalized(null, 'pl')).toBe('');
  });

  it('without a language walks the fallback chain', () => {
    expect(pickLocalized({ pl: 'Kotwa', en: 'Anchor' }, undefined)).toBe('Anchor');
  });

  it('skips an empty value in the asked language', () => {
    expect(pickLocalized({ pl: '', en: 'Anchor' }, 'pl')).toBe('Anchor');
  });
});
