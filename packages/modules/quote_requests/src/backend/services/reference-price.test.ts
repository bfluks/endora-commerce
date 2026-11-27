import { describe, expect, it, vi } from 'vitest';
import type {
  BuyerLinePriceAnswer,
  BuyerLinePricePort,
  BuyerLinePriceQuery,
} from '@endora-commerce/contracts';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import {
  assertValidSuppliedReferences,
  REFERENCE_PRICE_CHUNK_SIZE,
  resolveReferencePrices,
} from './reference-price.js';

/**
 * Feature 146, Phase 5 (T025) — the reference price captured at a customer
 * write (FR-001, FR-008; research R2, R3; threat model T6, T11).
 */

const OWNER = { customerAccountId: 'acc-1', organizationId: 'org-1' };

/** A port answering every line with `amount`, recording each query it is asked. */
function answeringPort(amount: (productId: string) => string | null = () => '120.0000') {
  const queries: BuyerLinePriceQuery[] = [];
  const port: BuyerLinePricePort = {
    resolveForBuyer: vi.fn(async (query: BuyerLinePriceQuery): Promise<BuyerLinePriceAnswer[]> => {
      queries.push(query);
      return query.lines.map((line) => {
        const value = amount(line.productId);
        return {
          key: line.key,
          price:
            value === null
              ? null
              : { amount: value, currency: 'PLN', isSale: false, priceListId: 'pl-1' },
        };
      });
    }),
  };
  return { port, queries };
}

const line = (productId: string, quantity = 1, extra: Record<string, unknown> = {}) => ({
  productId,
  quantity,
  ...extra,
});

describe('resolveReferencePrices', () => {
  it('asks the port for the owner on the request channel and keeps the amount at its four places (§10.18)', async () => {
    const { port, queries } = answeringPort();
    const out = await resolveReferencePrices(port, {
      owner: OWNER,
      salesChannelId: 'ch-a',
      lines: [line('p-1', 3, { variantId: 'v-1' })],
    });
    expect(out).toEqual([{ amount: '120.0000', currency: 'PLN' }]);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toEqual({
      buyer: { customerAccountId: 'acc-1', organizationId: 'org-1' },
      salesChannelId: 'ch-a',
      lines: [{ key: '0', productId: 'p-1', variantId: 'v-1', quantity: 3 }],
    });
  });

  it('stores a sub-cent reference unrounded (owner ruling of 2026-10-25)', async () => {
    const { port } = answeringPort(() => '0.0125');
    const out = await resolveReferencePrices(port, { owner: OWNER, salesChannelId: null, lines: [line('p-1', 10_000)] });
    expect(out).toEqual([{ amount: '0.0125', currency: 'PLN' }]);
  });

  it('stores no reference for an amount a numeric(14,4) column cannot hold, and still answers', async () => {
    // Review fix N1 — 1e10 and above passed the finite / non-negative guard and
    // then failed the insert with a 500. The reference is informational
    // (research R2), so such a line stores none and the request goes on.
    const amounts: Record<string, string> = {
      'p-1': '10000000000',
      'p-2': '9999999999.994',
      'p-3': '1e21',
      'p-4': '9999999999.99',
    };
    const { port } = answeringPort((productId) => amounts[productId] ?? null);
    const out = await resolveReferencePrices(port, {
      owner: OWNER,
      salesChannelId: null,
      lines: [line('p-1'), line('p-2'), line('p-3'), line('p-4')],
    });
    expect(out).toEqual([null, { amount: '9999999999.9940', currency: 'PLN' }, null, {
      amount: '9999999999.9900',
      currency: 'PLN',
    }]);
  });

  it('uses supplied references verbatim and does not resolve them', async () => {
    const { port, queries } = answeringPort();
    const out = await resolveReferencePrices(port, {
      owner: OWNER,
      salesChannelId: null,
      lines: [line('p-1'), line('p-2')],
      supplied: [
        { amount: '99.50', currency: 'EUR' },
        { amount: '10.00', currency: 'PLN' },
      ],
    });
    expect(out).toEqual([
      { amount: '99.50', currency: 'EUR' },
      { amount: '10.00', currency: 'PLN' },
    ]);
    expect(port.resolveForBuyer).not.toHaveBeenCalled();
    expect(queries).toHaveLength(0);
  });

  it('resolves only the lines whose supplied entry is null, keyed by their own index', async () => {
    const { port, queries } = answeringPort(() => '7.5');
    const out = await resolveReferencePrices(port, {
      owner: OWNER,
      salesChannelId: null,
      lines: [line('p-1'), line('p-2'), line('p-1')],
      supplied: [{ amount: '1.00', currency: 'PLN' }, null, null],
    });
    expect(out).toEqual([
      { amount: '1.00', currency: 'PLN' },
      { amount: '7.5000', currency: 'PLN' },
      { amount: '7.5000', currency: 'PLN' },
    ]);
    expect(queries[0]?.lines.map((l) => l.key)).toEqual(['1', '2']);
  });

  it('a null answer is no reference for that line only', async () => {
    const { port } = answeringPort((productId) => (productId === 'p-unpriced' ? null : '5.00'));
    const out = await resolveReferencePrices(port, {
      owner: OWNER,
      salesChannelId: null,
      lines: [line('p-1'), line('p-unpriced')],
    });
    expect(out).toEqual([{ amount: '5.0000', currency: 'PLN' }, null]);
  });

  it('a thrown error means no reference for any resolved line (the write proceeds)', async () => {
    const port: BuyerLinePricePort = {
      resolveForBuyer: vi.fn(async () => {
        throw new Error('pricing read failed');
      }),
    };
    const out = await resolveReferencePrices(port, {
      owner: OWNER,
      salesChannelId: 'ch-a',
      lines: [line('p-1'), line('p-2')],
    });
    expect(out).toEqual([null, null]);
  });

  it('a failure in a later chunk drops the references of the earlier chunks too', async () => {
    let calls = 0;
    const port: BuyerLinePricePort = {
      resolveForBuyer: vi.fn(async (query: BuyerLinePriceQuery) => {
        calls += 1;
        if (calls === 2) throw new Error('second chunk failed');
        return query.lines.map((l) => ({
          key: l.key,
          price: { amount: '1.00', currency: 'PLN', isSale: false, priceListId: 'pl' },
        }));
      }),
    };
    const lines = Array.from({ length: REFERENCE_PRICE_CHUNK_SIZE + 1 }, (_, i) => line(`p-${i}`));
    const out = await resolveReferencePrices(port, { owner: OWNER, salesChannelId: null, lines });
    expect(out.every((r) => r === null)).toBe(true);
  });

  it('re-throws ModuleDisabledError rather than treating it as "no price"', async () => {
    const port: BuyerLinePricePort = {
      resolveForBuyer: vi.fn(async () => {
        throw new ModuleDisabledError('price_lists');
      }),
    };
    await expect(
      resolveReferencePrices(port, { owner: OWNER, salesChannelId: null, lines: [line('p-1')] }),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('re-throws ModuleDisabledError thrown synchronously by a lazy port forward', async () => {
    const port = {
      resolveForBuyer: () => {
        throw new ModuleDisabledError('price_lists');
      },
    } as unknown as BuyerLinePricePort;
    await expect(
      resolveReferencePrices(port, { owner: OWNER, salesChannelId: null, lines: [line('p-1')] }),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('sends the lines in bounded chunks (T11)', async () => {
    const { port, queries } = answeringPort();
    const count = REFERENCE_PRICE_CHUNK_SIZE * 2 + 5;
    const lines = Array.from({ length: count }, (_, i) => line(`p-${i}`));
    const out = await resolveReferencePrices(port, { owner: OWNER, salesChannelId: null, lines });
    expect(queries.map((q) => q.lines.length)).toEqual([
      REFERENCE_PRICE_CHUNK_SIZE,
      REFERENCE_PRICE_CHUNK_SIZE,
      5,
    ]);
    expect(out).toHaveLength(count);
    expect(out.every((r) => r?.amount === '120.0000')).toBe(true);
    // Keys stay the line's index in the request, across chunks.
    expect(queries[1]?.lines[0]?.key).toBe(String(REFERENCE_PRICE_CHUNK_SIZE));
  });

  it('asks with the line quantity and never multiplies by the packaging unit (T6)', async () => {
    const { port, queries } = answeringPort();
    await resolveReferencePrices(port, {
      owner: OWNER,
      salesChannelId: null,
      lines: [line('p-1', 200, { packagingUnitName: 'Paleta', packagingUnitBaseQuantity: 100 })],
    });
    expect(queries[0]?.lines).toEqual([{ key: '0', productId: 'p-1', variantId: null, quantity: 200 }]);
  });

  it('makes no port call for an empty request', async () => {
    const { port } = answeringPort();
    expect(
      await resolveReferencePrices(port, { owner: OWNER, salesChannelId: null, lines: [] }),
    ).toEqual([]);
    expect(port.resolveForBuyer).not.toHaveBeenCalled();
  });
});

describe('assertValidSuppliedReferences (T6)', () => {
  const ok = { amount: '120.00', currency: 'PLN' };

  it('accepts index-aligned, well-formed entries and nulls', () => {
    expect(() => assertValidSuppliedReferences([ok, null, { amount: '0', currency: 'EUR' }], 3)).not.toThrow();
    expect(() => assertValidSuppliedReferences([{ amount: '7.5', currency: 'USD' }], 1)).not.toThrow();
    // A cart line's four-place unit price, handed over on conversion (§10.18).
    expect(() => assertValidSuppliedReferences([{ amount: '0.0125', currency: 'PLN' }], 1)).not.toThrow();
  });

  it('refuses a length that is not the number of items', () => {
    expect(() => assertValidSuppliedReferences([ok], 2)).toThrow();
    expect(() => assertValidSuppliedReferences([ok, ok], 1)).toThrow();
  });

  it.each([
    ['negative', { amount: '-1.00', currency: 'PLN' }],
    ['non-finite', { amount: 'Infinity', currency: 'PLN' }],
    ['NaN', { amount: 'NaN', currency: 'PLN' }],
    ['five decimals', { amount: '1.00005', currency: 'PLN' }],
    ['not a number', { amount: 'abc', currency: 'PLN' }],
    ['empty amount', { amount: '', currency: 'PLN' }],
    ['exponent', { amount: '1e3', currency: 'PLN' }],
    ['beyond numeric(14,4)', { amount: '12345678901.00', currency: 'PLN' }],
    ['lower-case currency', { amount: '1.00', currency: 'pln' }],
    ['two-letter currency', { amount: '1.00', currency: 'PL' }],
    ['four-letter currency', { amount: '1.00', currency: 'PLNX' }],
  ])('refuses an entry that is %s', (_label, entry) => {
    expect(() => assertValidSuppliedReferences([entry], 1)).toThrow();
  });
});
