import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { CatalogProductReadService } from './catalog-product-read.service.js';

/**
 * Issue #416, review 2 of #424 — `findPricingRefsByIds` is asked for a price
 * surface build's candidate set, which can be the whole catalogue. Its
 * statement binds the set as **one** array parameter, whatever its size: one
 * parameter per id grows the statement with the set (a 70 000-id `in (…)` list
 * to plan) and, on any driver that binds server-side, stops at 65 535.
 */
describe('CatalogProductReadService.findPricingRefsByIds — the statement', () => {
  function service() {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const em = {
      execute: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return [{ id: 'a', attribute_values: { color: 'red' } }, { id: 'b', attribute_values: null }];
      },
    } as unknown as EntityManager;
    return { read: new CatalogProductReadService(() => em), calls };
  }

  it('binds the ids as one array parameter, however many there are', async () => {
    const { read, calls } = service();
    const ids = Array.from({ length: 70_000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    await read.findPricingRefsByIds([...ids, ids[0]!]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/"id" = any\(\?::uuid\[\]\)/);
    expect(calls[0]!.params).toHaveLength(1);
    // Each id once, as a Postgres array literal.
    expect(String(calls[0]!.params[0]).split(',')).toHaveLength(70_000);
  });

  it('answers the attribute values, an absent one as empty', async () => {
    const { read } = service();
    expect(await read.findPricingRefsByIds(['a', 'b'])).toEqual([
      { id: 'a', attributeValues: { color: 'red' } },
      { id: 'b', attributeValues: {} },
    ]);
  });

  it('asks nothing for no ids', async () => {
    const { read, calls } = service();
    expect(await read.findPricingRefsByIds([])).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
