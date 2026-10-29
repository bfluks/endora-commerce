import { describe, expect, it } from 'vitest';
import type { QuoteRequestSourceRefusal } from './quote-request-source.js';
import { quoteSourceHonoursExemptions } from './quote-source-exemption.js';

/**
 * Feature 155 (FR-036; research R19 step 3; threat F2) — a basket's quote-seeded lines
 * are exempt from the minimums only while the quote source is vouched **now**: the judge
 * accepts it and the quote's validity has not lapsed.
 */
describe('quoteSourceHonoursExemptions', () => {
  const NOW = new Date('2026-10-16T12:00:00.000Z');
  const accepted = { accepted: true } as const;

  it('honours an accepted source with no expiry', () => {
    expect(quoteSourceHonoursExemptions(accepted, { expiresAt: null }, NOW)).toBe(true);
  });

  it('honours an accepted source that expires later', () => {
    expect(
      quoteSourceHonoursExemptions(accepted, { expiresAt: new Date('2026-10-17T00:00:00.000Z') }, NOW),
    ).toBe(true);
  });

  it('does not honour an accepted source whose validity has lapsed', () => {
    expect(
      quoteSourceHonoursExemptions(accepted, { expiresAt: new Date('2026-10-15T00:00:00.000Z') }, NOW),
    ).toBe(false);
  });

  it('does not honour a source expiring at this very moment (validity is `expiresAt > now`)', () => {
    expect(quoteSourceHonoursExemptions(accepted, { expiresAt: new Date(NOW) }, NOW)).toBe(false);
  });

  it('does not honour an accepted judgement without the request it judged', () => {
    expect(quoteSourceHonoursExemptions(accepted, null, NOW)).toBe(false);
  });

  it.each<QuoteRequestSourceRefusal>([
    'not-found',
    'other-organization',
    'not-convertible',
    'already-ordered',
    'no-agreed-line',
  ])('does not honour a source the judge refused as %s, whatever its expiry', (reason) => {
    const refused = { accepted: false, reason } as const;
    expect(quoteSourceHonoursExemptions(refused, { expiresAt: null }, NOW)).toBe(false);
    expect(
      quoteSourceHonoursExemptions(refused, { expiresAt: new Date('2027-01-01T00:00:00.000Z') }, NOW),
    ).toBe(false);
  });
});
