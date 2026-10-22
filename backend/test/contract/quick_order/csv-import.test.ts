import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buyerChannelIds,
  createMinimumProduct,
  createMinimumVariant,
  minimumFixtureRun,
  type MinimumProductFixture,
} from '../../helpers/order-minimum-fixture.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
// SKUs come from the seed-catalog fixture (EXAMPLE-SIMPLE-001 / EXAMPLE-BLUE-002).
const EXAMPLE_SIMPLE_001_SKU = 'EXAMPLE-SIMPLE-001';
const EXAMPLE_SIMPLE_002_SKU = 'EXAMPLE-BLUE-002';

/**
 * T198 — `POST /quick-order/import` returns a recognised + rejected
 * partition with line numbers preserved so the UI can highlight problem
 * rows.
 */

describe('Quick-order CSV import', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('partitions rows into recognised + rejected with line numbers', async () => {
    const csv = [
      'sku,quantity',
      `${EXAMPLE_SIMPLE_001_SKU},5`,
      'NOT-A-REAL-SKU,3',
      `${EXAMPLE_SIMPLE_002_SKU},`,
      `${EXAMPLE_SIMPLE_002_SKU},2`,
      ',7',
    ].join('\n');

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/import',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { csv },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        recognized: Array<{ line: number; sku: string; quantity: number }>;
        rejected: Array<{ line: number; reason: string }>;
      };
    };
    // Line 2 (recognized), line 5 (recognized).
    expect(body.data.recognized.map((r) => r.line)).toEqual([2, 5]);
    expect(body.data.recognized[0]?.sku).toBe(EXAMPLE_SIMPLE_001_SKU);
    expect(body.data.recognized[0]?.quantity).toBe(5);
    // Line 3 not_found, line 4 quantity_invalid, line 6 sku_missing.
    const rejectedByLine = new Map(body.data.rejected.map((r) => [r.line, r.reason]));
    expect(rejectedByLine.get(3)).toBe('product_not_found');
    expect(rejectedByLine.get(4)).toBe('quantity_invalid');
    expect(rejectedByLine.get(6)).toBe('sku_missing');
  });

  it('rejects every data row when the header is missing', async () => {
    const csv = [
      `${EXAMPLE_SIMPLE_001_SKU},5`,
      `${EXAMPLE_SIMPLE_002_SKU},2`,
    ].join('\n');
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quick-order/import',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { csv },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { recognized: unknown[]; rejected: Array<{ reason: string }> };
    };
    expect(body.data.recognized).toEqual([]);
    body.data.rejected.forEach((r) => expect(r.reason).toBe('malformed_row'));
  });

  /**
   * Feature 155, Phase 9 (T067) — the buyer's preview judges each product's
   * total across the file, every variant summed (US4 #1a, #1c; P1).
   */
  describe('155 — order minimums in the preview', () => {
    const RUN = minimumFixtureRun();
    let A: MinimumProductFixture;
    let C: MinimumProductFixture;
    const RED_SKU = `QOI-C-RED-${RUN}`;
    const BLUE_SKU = `QOI-C-BLUE-${RUN}`;

    interface ImportBody {
      data: {
        recognized: Array<{ line: number; sku: string; quantity: number; warning?: unknown }>;
        rejected: Array<{ line: number; raw: string; reason: string; minimum?: number; productTotal?: number }>;
        summary: { recognizedCount: number; rejectedCount: number; warningCount?: number };
      };
    }

    beforeAll(async () => {
      const em = h.em();
      const channels = await buyerChannelIds(em);
      A = await createMinimumProduct(em, {
        sku: `QOI-A-${RUN}`,
        nameEn: `Anchor ${RUN}`,
        namePl: `Kotwa ${RUN}`,
        minOrderQuantity: 10,
        channelIds: channels,
      });
      C = await createMinimumProduct(em, {
        sku: `QOI-C-${RUN}`,
        nameEn: `Coat ${RUN}`,
        namePl: `Plaszcz ${RUN}`,
        type: 'configurable',
        minOrderQuantity: 10,
        channelIds: channels,
      });
      await createMinimumVariant(em, C.id, RED_SKU);
      await createMinimumVariant(em, C.id, BLUE_SKU);
    }, 60_000);

    const importCsv = async (csv: string): Promise<ImportBody['data']> => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quick-order/import',
        cookies: { b2b_session: 'stub-customer-session' },
        payload: { csv },
      });
      expect(res.statusCode, res.body).toBe(200);
      return (res.json() as ImportBody).data;
    };

    it('US4 #1a — the buyer import rejects A × 5 below_minimum with the minimum, beside the existing reasons', async () => {
      const data = await importCsv(['sku,quantity', `${A.sku},5`, 'NOT-A-REAL-SKU,3'].join('\n'));
      expect(data.recognized).toEqual([]);
      expect(data.rejected).toEqual([
        { line: 3, raw: 'NOT-A-REAL-SKU,3', reason: 'product_not_found' },
        { line: 2, raw: `${A.sku},5`, reason: 'below_minimum', minimum: 10, productTotal: 5 },
      ]);
      expect(data.summary).toMatchObject({ recognizedCount: 0, rejectedCount: 2 });
      expect(data.summary.warningCount).toBeUndefined();
    });

    it('US4 #1c — C-red × 4 and C-blue × 6 are both recognised (file total 10)', async () => {
      const data = await importCsv(['sku,quantity', `${RED_SKU},4`, `${BLUE_SKU},6`].join('\n'));
      expect(data.recognized.map((r) => [r.sku, r.quantity])).toEqual([
        [RED_SKU, 4],
        [BLUE_SKU, 6],
      ]);
      expect(data.rejected).toEqual([]);
    });

    it('US4 #1c — C-red × 4 and C-blue × 3 are both rejected with the minimum and the file total 7', async () => {
      const data = await importCsv(['sku,quantity', `${RED_SKU},4`, `${BLUE_SKU},3`].join('\n'));
      expect(data.recognized).toEqual([]);
      expect(data.rejected).toEqual([
        { line: 2, raw: `${RED_SKU},4`, reason: 'below_minimum', minimum: 10, productTotal: 7 },
        { line: 3, raw: `${BLUE_SKU},3`, reason: 'below_minimum', minimum: 10, productTotal: 7 },
      ]);
      expect(data.summary).toMatchObject({ recognizedCount: 0, rejectedCount: 2 });
    });
  });
});
