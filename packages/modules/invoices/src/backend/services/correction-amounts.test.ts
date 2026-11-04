import { describe, expect, it } from 'vitest';
import { correctionAmounts, type CorrectionInput } from './corrective-invoice.js';

/**
 * Issue #417 — a correction's amounts in exact decimal arithmetic, under the
 * invoice's VAT method (owner ruling of 2026-10-24) and **cumulatively** over
 * the corrections of one invoice (review of PR #423): for each group of what
 * the invoice charged — a rate of an invoice issued per rate, a line of one
 * issued before — the net of everything credited so far, minus the nets earlier
 * corrections already credited. All corrections together credit exactly what
 * was invoiced, never more.
 */
type Line = CorrectionInput['lines'][number];
const line = (amount: string | number, quantity: number, rate: string, orderItemId = 'a'): Line => ({
  amount,
  quantity,
  rate,
  orderItemId,
});
/** One correction of an invoice issued per rate, with nothing credited before it. */
const first = (total: string | number, originalGross: string, lines: Line[]) =>
  correctionAmounts({ total, originalGross, perRate: true, originalLines: [], earlierLines: [], lines });

describe('correctionAmounts', () => {
  it('stores the unit net price half-up at four places, not the binary 0.0187', () => {
    // 0.15 over 8 pieces is exactly 0.01875; `(0.15 / 8).toFixed(4)` is 0.0187.
    expect(first('0.15', '100.00', [line('0.15', 8, '0')]).lines[0]?.unitNetPrice).toBe('0.0188');
  });

  it('rounds a credited amount half-up on its decimal digits, not the binary 1.00', () => {
    const r = first(1.005, '100.00', [line(1.005, 1, '0')]);
    expect([r.credited, r.lines[0]?.gross]).toEqual(['1.01', '1.01']);
  });

  it('backs the net out per rate (G1, G2; V2 7.01)', () => {
    const r = first('40.81', '1000.00', [line('36.29', 1, '0.2300', 'a'), line('4.52', 1, '0.0500', 'b')]);
    expect(r.lines.map((l) => [l.gross, l.net])).toEqual([
      ['36.29', '29.50'],
      ['4.52', '4.30'],
    ]);
    expect([r.credited, r.netTotal, r.taxTotal]).toEqual(['40.81', '33.80', '7.01']);
  });

  it('credits 9.05 × 3 at 8 % as the invoice charged it: 27.15 net, 2.17 VAT (V3)', () => {
    const r = first('29.32', '100.00', [line('29.32', 3, '0.0800')]);
    expect([r.credited, r.netTotal, r.taxTotal]).toEqual(['29.32', '27.15', '2.17']);
  });

  it('caps the credit at the original gross and shares it out in line order', () => {
    const r = first('40.00', '30.00', [line('20.00', 1, '0', 'a'), line('20.00', 2, '0', 'b')]);
    expect(r.credited).toBe('30.00');
    expect(r.lines.map((l) => l.gross)).toEqual(['20.00', '10.00']);
    expect(r.lines[1]?.unitNetPrice).toBe('5.0000');
  });

  it('never credits a negative line', () => {
    const r = first('0.00', '30.00', [line(-5, 1, '0.23')]);
    expect([r.lines[0]?.gross, r.lines[0]?.net]).toEqual(['0.00', '0.00']);
  });
});

describe('correctionAmounts — cumulative over an invoice’s corrections (review of PR #423)', () => {
  it('two corrections of 1 × 0.03 at 23 % credit 0.06 net and 0.01 VAT together — what was invoiced', () => {
    // Invoiced: 0.06 net, 0.01 VAT, 0.07 gross. The returns refund 0.04, then 0.03.
    const a = first('0.04', '0.07', [line('0.04', 1, '0.2300')]);
    const b = correctionAmounts({
      total: '0.03',
      originalGross: '0.07',
      perRate: true,
      originalLines: [],
      earlierLines: [{ orderItemId: 'a', rate: '0.2300', net: a.lines[0]!.net, gross: a.lines[0]!.gross }],
      lines: [line('0.03', 1, '0.2300')],
    });
    // Each on its own: 0.03 + 0.02 net, 0.01 + 0.01 VAT — 0.05 and 0.02, not what was invoiced.
    expect([a.netTotal, a.taxTotal]).toEqual(['0.03', '0.01']);
    expect([b.netTotal, b.taxTotal]).toEqual(['0.03', '0.00']);
  });

  it('credits a line of an invoice issued before 0.108.0 in proportion to that line, as it was invoiced', () => {
    // Issued before the per-rate method: the line was 2 × 0.03 at 23 %, net 0.06, gross 0.07.
    const original = [{ orderItemId: 'a', rate: '0.2300', net: '0.06', gross: '0.07' }];
    const a = correctionAmounts({ total: '0.04', originalGross: '0.07', perRate: false, originalLines: original, earlierLines: [], lines: [line('0.04', 1, '0.2300')] });
    const b = correctionAmounts({
      total: '0.03',
      originalGross: '0.07',
      perRate: false,
      originalLines: original,
      earlierLines: [{ orderItemId: 'a', rate: '0.2300', net: a.lines[0]!.net, gross: a.lines[0]!.gross }],
      lines: [line('0.03', 1, '0.2300')],
    });
    expect(Number(a.lines[0]!.net) + Number(b.lines[0]!.net)).toBeCloseTo(0.06, 10);
    expect(Number(a.taxTotal) + Number(b.taxTotal)).toBeCloseTo(0.01, 10);
  });

  it('never credits more than remains of the invoice after earlier corrections', () => {
    const r = correctionAmounts({
      total: '20.00',
      originalGross: '30.00',
      creditedBefore: '25.00',
      perRate: true,
      originalLines: [],
      earlierLines: [{ orderItemId: 'a', rate: '0', net: '25.00', gross: '25.00' }],
      lines: [line('20.00', 1, '0')],
    });
    expect(r.credited).toBe('5.00');
  });

  it('refuses a total above the sum of its lines rather than book the excess as net without VAT', () => {
    expect(() => first('50.00', '100.00', [line('20.00', 1, '0.23')])).toThrow(/exceeds/);
  });
});

describe('correctionAmounts — an order-level discount (review of PR #423)', () => {
  it('credits the goods as invoiced and the discount back on its own 0 % line, totalling the refund', () => {
    // Invoiced: 100.00 net at 23 % (123.00) and a 0 % discount line of −50.00. A full return refunds 73.00.
    const r = correctionAmounts({
      total: '73.00',
      originalGross: '83.00',
      perRate: true,
      originalLines: [],
      earlierLines: [],
      lines: [{ amount: '73.00', discount: '50.00', quantity: 1, rate: '0.2300', orderItemId: 'a' }],
    });
    expect(r.lines.map((l) => [l.gross, l.net])).toEqual([['123.00', '100.00']]);
    expect(r.discountCredit).toBe('-50.00');
    expect([r.credited, r.netTotal, r.taxTotal]).toEqual(['73.00', '50.00', '23.00']);
    expect(r.vatSummary).toEqual([
      { taxRate: '0.0000', netTotal: '-50.00', vatAmount: '0.00', grossTotal: '-50.00' },
      { taxRate: '0.2300', netTotal: '100.00', vatAmount: '23.00', grossTotal: '123.00' },
    ]);
  });

  // Review of PR #423 (B1): 2 × 100.00 net at 23 % and a 20.00 order discount,
  // each line carrying 10.00 of it and refunding 113.00. A total below what the
  // lines add up to must not credit every line at amount + discount.
  const discounted = (total: string) =>
    correctionAmounts({
      total,
      originalGross: '226.00',
      perRate: true,
      originalLines: [],
      earlierLines: [],
      lines: [
        { amount: '113.00', discount: '10.00', quantity: 1, rate: '0.2300', orderItemId: 'a' },
        { amount: '113.00', discount: '10.00', quantity: 1, rate: '0.2300', orderItemId: 'b' },
      ],
    });

  it('credits a total below its lines as goods only, never more VAT than the total carries', () => {
    const r = discounted('113.00');
    expect(r.lines.map((l) => l.gross)).toEqual(['113.00', '0.00']);
    expect(r.discountCredit).toBe('0.00');
    expect([r.credited, r.netTotal, r.taxTotal]).toEqual(['113.00', '91.87', '21.13']);
    expect(r.vatSummary).toEqual([{ taxRate: '0.2300', netTotal: '91.87', vatAmount: '21.13', grossTotal: '113.00' }]);
  });

  it('credits nothing — no goods, no VAT, no discount — for a total of zero', () => {
    const r = discounted('0.00');
    expect(r.lines.map((l) => [l.gross, l.net])).toEqual([
      ['0.00', '0.00'],
      ['0.00', '0.00'],
    ]);
    expect([r.credited, r.netTotal, r.taxTotal, r.discountCredit]).toEqual(['0.00', '0.00', '0.00', '0.00']);
  });

  it('still credits the goods and the discount separately when the total is what the lines add up to', () => {
    const r = discounted('226.00');
    expect(r.lines.map((l) => [l.gross, l.net])).toEqual([
      ['123.00', '100.00'],
      ['123.00', '100.00'],
    ]);
    expect([r.credited, r.netTotal, r.taxTotal, r.discountCredit]).toEqual(['226.00', '180.00', '46.00', '-20.00']);
  });
});
