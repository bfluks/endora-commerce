import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { priceWalkCorpus } from '../../helpers/price-walk-corpus.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Review 3 of release 0.108.0, B3 — a price range selects the same products
 * whatever the sort. The price-sorted path compared four-place decimals with
 * the bounds `toFixed(4)` had rounded, the range walk under any other sort
 * compared `Number(amount)` with the bounds as typed, so `minPrice=9.04504`
 * kept a product at 9.0450 on one and dropped it on the other.
 *
 * Every path now reads the bounds through one conversion — the exact bound,
 * a minimum rounded up and a maximum rounded down to the four places an
 * amount has — and compares decimals, so the answer is also the exact one.
 */
describe('a price range selects the same products under every sort', () => {
  let h: BackendServerHandle;
  let w: ReturnType<typeof priceWalkCorpus>;

  beforeAll(async () => {
    h = await setupBackendServer();
    w = priceWalkCorpus(h);
    await w.init();
    await w.seed([
      { key: 'BELOW', price: '9.0449', age: 1 },
      { key: 'AT', price: '9.0450', age: 2 },
      { key: 'ABOVE', price: '9.0451', age: 3 },
    ]);
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it.each([
    ['minPrice=9.04504', ['ABOVE']],
    ['maxPrice=9.04504', ['AT', 'BELOW']],
    ['minPrice=9.045', ['AT', 'ABOVE']],
    ['maxPrice=9.045', ['AT', 'BELOW']],
    ['minPrice=9.04504&maxPrice=9.04504', []],
    ['minPrice=9.0449&maxPrice=9.04509', ['AT', 'BELOW']],
  ])('%s', async (range, expected) => {
    const want = expected.map(w.skuOf).sort();
    for (const sort of ['', '&sort=price', '&sort=-price', '&sort=name']) {
      const { skus } = await w.walk({ limit: 10, query: `&${range}${sort}` });
      expect([...skus].sort(), `${range}${sort}`).toEqual(want);
    }
  });
});
