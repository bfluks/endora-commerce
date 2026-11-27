import { describe, expect, it } from 'vitest';
import { URL_LANGUAGE_PREFIX_PATTERN } from '@endora-commerce/contracts';
import { LANGUAGE_NEUTRAL_SEGMENTS, RESERVED_TOP_LEVEL_SEGMENTS } from '../../app/reserved-segments';

/**
 * Feature 167 (FR-042, research R-11 §3) — no storefront route may be mistaken for a
 * language prefix. A reserved top-level segment is either language-neutral (the
 * middleware sets it aside before parsing a prefix) or does not match the prefix
 * grammar at all; adding a route like `/faq` fails here and forces a decision.
 */
describe('reserved segments and the language prefix grammar', () => {
  it('every language-neutral segment is a reserved segment', () => {
    for (const segment of LANGUAGE_NEUTRAL_SEGMENTS) expect(RESERVED_TOP_LEVEL_SEGMENTS).toContain(segment);
  });

  it('every reserved segment that is not neutral fails the prefix grammar', () => {
    const neutral = new Set(LANGUAGE_NEUTRAL_SEGMENTS);
    const lookLikePrefixes = RESERVED_TOP_LEVEL_SEGMENTS.filter(
      (segment) => !neutral.has(segment) && URL_LANGUAGE_PREFIX_PATTERN.test(segment),
    );
    expect(lookLikePrefixes).toEqual([]);
  });
});
