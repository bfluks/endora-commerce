import { describe, expect, it } from 'vitest';
import {
  applyAmountAdjustment,
  applySignedPercent,
  compareDecimal,
  decimalText,
  formatUnits,
  grossAmountHalfUp,
  normaliseAmount,
  parseSignedPercentHundredths,
  parseSignedUnits,
  parseUnits,
  roundAmountHalfUp,
} from '../src/index.js';

/**
 * Feature 161, G17 (`specs/161-price-book-editor/contracts/backend-gaps.md`) —
 * the integer decimal arithmetic the server prices with, in the contracts so
 * the admin's labelled previews (FR-030) round exactly as the resolver does.
 *
 * Amounts are `numeric(14,4)` and percentages two places; both are carried as
 * integers so a computed price is exact to the four digits a typed row is
 * stored at and never drifts through a float. The `parseUnits` / `formatUnits`
 * and `compareDecimal` cases moved here from `price_lists`'
 * `matrix-decimal.test.ts` with the functions (feature 148); the signed cases
 * state feature 160's percentages and adjustments (FR-019, FR-008).
 */
describe('parseUnits / formatUnits', () => {
  it('parses a decimal string to integer ten-thousandths', () => {
    expect(parseUnits('100')).toBe(1_000_000n);
    expect(parseUnits('100.0000')).toBe(1_000_000n);
    expect(parseUnits('0.0525')).toBe(525n);
    expect(parseUnits('12.5')).toBe(125_000n);
    expect(parseUnits('0')).toBe(0n);
  });

  it('refuses what is not a non-negative decimal with up to four fractional digits', () => {
    expect(() => parseUnits('1.00001')).toThrow();
    expect(() => parseUnits('-1')).toThrow();
    expect(() => parseUnits('abc')).toThrow();
    expect(() => parseUnits('')).toThrow();
  });

  it('formats ten-thousandths with exactly four fractional digits', () => {
    expect(formatUnits(880_000n)).toBe('88.0000');
    expect(formatUnits(350n)).toBe('0.0350');
    expect(formatUnits(0n)).toBe('0.0000');
    expect(formatUnits(-12_345n)).toBe('-1.2345');
  });
});

describe('compareDecimal', () => {
  it('orders decimal strings numerically regardless of scale', () => {
    expect(compareDecimal('88', '88.0000')).toBe(0);
    expect(compareDecimal('9.5', '10')).toBe(-1);
    expect(compareDecimal('100.0001', '100')).toBe(1);
  });
});

describe('parseSignedUnits / parseSignedPercentHundredths', () => {
  it('parses signed amounts to ten-thousandths', () => {
    expect(parseSignedUnits('-2.5')).toBe(-25_000n);
    expect(parseSignedUnits('10')).toBe(100_000n);
    expect(parseSignedUnits('-0.0001')).toBe(-1n);
    expect(() => parseSignedUnits('1.00001')).toThrow();
    expect(() => parseSignedUnits('+1')).toThrow();
  });

  it('parses signed percentages to hundredths', () => {
    expect(parseSignedPercentHundredths('-10')).toBe(-1000n);
    expect(parseSignedPercentHundredths('12.5')).toBe(1250n);
    expect(parseSignedPercentHundredths('1000')).toBe(100_000n);
    expect(() => parseSignedPercentHundredths('1.234')).toThrow();
  });
});

describe('applySignedPercent', () => {
  it('applies a discount and a surcharge off the reference (worked examples E2, E3, U2.1)', () => {
    expect(applySignedPercent('100.0000', '-10')).toBe('90.0000');
    expect(applySignedPercent('100', '-5')).toBe('95.0000');
    expect(applySignedPercent('50.0000', '-15')).toBe('42.5000');
    expect(applySignedPercent('100', '10')).toBe('110.0000');
    expect(applySignedPercent('120', '-20')).toBe('96.0000');
  });

  it('rounds half-up at the fifth fractional digit', () => {
    // 0.0001 × 0.5 = 0.00005 → 0.0001
    expect(applySignedPercent('0.0001', '-50')).toBe('0.0001');
    // 0.0003 × 0.5 = 0.00015 → 0.0002
    expect(applySignedPercent('0.0003', '-50')).toBe('0.0002');
    // 9.9999 × 0.875 = 8.7499125 → 8.7499
    expect(applySignedPercent('9.9999', '-12.5')).toBe('8.7499');
    // 19.99 × 0.95 = 18.9905 exactly
    expect(applySignedPercent('19.99', '-5')).toBe('18.9905');
  });

  it('yields zero at −100 % and an elevenfold price at +1000 %', () => {
    expect(applySignedPercent('123.4567', '-100')).toBe('0.0000');
    expect(applySignedPercent('2', '1000')).toBe('22.0000');
  });

  it('does not drift on amounts a float cannot hold exactly', () => {
    expect(applySignedPercent('9999999999.9999', '-1')).toBe('9899999999.9999');
    expect(applySignedPercent('1234567890.1234', '-0.01')).toBe('1234444433.3344');
  });
});

describe('applyAmountAdjustment', () => {
  it('adds a signed amount; zero is a price, below zero is none', () => {
    expect(applyAmountAdjustment('80', '-5.5')).toBe('74.5000');
    expect(applyAmountAdjustment('80', '2')).toBe('82.0000');
    expect(applyAmountAdjustment('5', '-5')).toBe('0.0000');
    expect(applyAmountAdjustment('5', '-5.0001')).toBeNull();
  });
});

describe('normaliseAmount', () => {
  it('normalises to four fractional digits', () => {
    expect(normaliseAmount('12.5')).toBe('12.5000');
    expect(normaliseAmount('0')).toBe('0.0000');
    expect(() => normaliseAmount('-1')).toThrow();
  });
});

/**
 * Review finding 2 (release 0.108.0) — a price shown or stored at two places
 * is the four-place resolver amount rounded half-up **on its decimal digits**.
 * `Number(amount).toFixed(2)` rounds the binary double instead, so 9.0450
 * became 9.04 (the double is 9.04499…) while the card, formatted through
 * `Intl.NumberFormat`, showed 9,05; and 1.0050 was charged 1.00 but shown 1,01.
 */
describe('roundAmountHalfUp — two places, half-up on the decimal digits', () => {
  it.each([
    ['9.0450', '9.05'],
    ['1.0050', '1.01'],
    ['0.0050', '0.01'],
    ['9.0449', '9.04'],
    ['10.0050', '10.01'],
    ['2.6750', '2.68'],
    ['17.9910', '17.99'],
    ['100', '100.00'],
    ['0', '0.00'],
    ['12.5', '12.50'],
    ['99999999.9950', '100000000.00'],
  ])('%s → %s', (amount, expected) => {
    expect(roundAmountHalfUp(amount)).toBe(expected);
  });

  it('agrees with the binary-free reading of a number (the shortest decimal that round-trips)', () => {
    expect(roundAmountHalfUp(9.045)).toBe('9.05');
    expect(roundAmountHalfUp(1.005)).toBe('1.01');
    expect(roundAmountHalfUp(Number('2.6750'))).toBe('2.68');
    expect(roundAmountHalfUp(1e21)).toBe('1000000000000000000000.00');
    expect(roundAmountHalfUp(1e-7)).toBe('0.00');
  });

  it('rounds a negative amount half away from zero', () => {
    expect(roundAmountHalfUp('-1.005')).toBe('-1.01');
    expect(roundAmountHalfUp('-0.004')).toBe('0.00');
  });

  it('agrees with what the storefront shows through Intl.NumberFormat', () => {
    const shown = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
    for (const amount of ['9.0450', '1.0050', '0.0050', '2.6750', '10.0050', '123.4550', '0.1250']) {
      expect(roundAmountHalfUp(amount), amount).toBe(shown.format(Number(amount)));
    }
  });

  it('refuses what is not a decimal amount', () => {
    expect(() => roundAmountHalfUp('1e3')).toThrow();
    expect(() => roundAmountHalfUp('abc')).toThrow();
    expect(() => roundAmountHalfUp(Number.NaN)).toThrow();
  });
});

/**
 * Review 2, finding 2 (release 0.108.0) — a gross price is `net × (1 + rate)`,
 * rounded to two places half-up on the **exact** decimal product. A gross feed
 * computed `Math.round(net * (1 + rate / 100) * 100) / 100` on doubles, and
 * 29.50 × 1.23 is the double 36.28499…, so it published 36.28.
 * `specs/pricing/worked-examples.md` §10.16 G1–G4.
 */
describe('grossAmountHalfUp — net at a rate, two places, half-up on the decimal digits', () => {
  it.each([
    ['29.50', '23', '36.29'],
    ['4.30', '5', '4.52'],
    ['31.50', '23', '38.75'],
    ['16.50', '23', '20.30'],
    ['9.0450', '23', '11.13'],
    ['0', '23', '0.00'],
    ['100', '0', '100.00'],
    ['10', '8.5', '10.85'],
    ['0.01', '23', '0.01'],
    ['99999999.9999', '23', '123000000.00'],
  ])('%s at %s %% is %s', (net, rate, gross) => {
    expect(grossAmountHalfUp(net, rate)).toBe(gross);
  });

  it('reads a number as the shortest decimal that round-trips it', () => {
    expect(grossAmountHalfUp(29.5, 23)).toBe('36.29');
    expect(grossAmountHalfUp(4.3, 5)).toBe('4.52');
    expect(grossAmountHalfUp(31.5, 23)).toBe('38.75');
    expect(grossAmountHalfUp(10, 8.5)).toBe('10.85');
  });

  it('refuses what is not a non-negative decimal', () => {
    expect(() => grossAmountHalfUp('-1', '23')).toThrow();
    expect(() => grossAmountHalfUp('1', '-5')).toThrow();
    expect(() => grossAmountHalfUp('abc', '23')).toThrow();
    expect(() => grossAmountHalfUp(Number.NaN, 23)).toThrow();
  });
});

/**
 * Review 3 of release 0.108.0, D1 — one reading of a number as decimal text,
 * shared by the rounding helpers and the storefront's gross, instead of a copy
 * in each and a hand-shifted decimal point for a fractional rate.
 */
describe('decimalText — a number as the shortest decimal that round-trips it', () => {
  it.each([
    [9.045, '9.045'],
    [0.23, '0.23'],
    [100, '100'],
    [1e21, '1000000000000000000000'],
    [1e-7, '0.000000100000'],
    [-2.5, '-2.5'],
  ])('%s is %s', (value, text) => {
    expect(decimalText(value)).toBe(text);
  });

  it('trims a string and leaves it otherwise as written', () => {
    expect(decimalText(' 9.0450 ')).toBe('9.0450');
  });

  it('refuses a number that is not finite', () => {
    expect(() => decimalText(Number.NaN)).toThrow();
    expect(() => decimalText(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('grossAmountHalfUp — a fractional rate', () => {
  it.each([
    [29.5, 0.23, '36.29'],
    [4.3, 0.05, '4.52'],
    [16.5, 0.23, '20.30'],
    [10, 0.085, '10.85'],
    [10, 0, '10.00'],
    [0, 0.23, '0.00'],
  ])('%s at %s is %s', (net, rate, gross) => {
    expect(grossAmountHalfUp(net, rate, 'fraction')).toBe(gross);
  });

  it('answers what the same rate in percent answers', () => {
    for (const [net, fraction, percent] of [
      ['29.50', '0.23', '23'],
      ['9.0450', '0.235', '23.5'],
      ['99999999.9999', '0.23', '23'],
    ] as const) {
      expect(grossAmountHalfUp(net, fraction, 'fraction')).toBe(grossAmountHalfUp(net, percent));
    }
  });
});
