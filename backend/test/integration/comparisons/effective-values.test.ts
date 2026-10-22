import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides, setNameOverride } from '../../helpers/product-scope-fixture.js';

/**
 * Feature 163, Phase 8 (T059, FR-017 c) — a comparison column carries the Name
 * the storefront shows at the reader's (channel, language).
 */

const BUYER = { b2b_session: 'stub-customer-session' };
const CHANNEL = { 'x-sales-channel': 'pl_retail' };

describe('163 — comparisons show effective names [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let product: MinimumProductFixture;
  let language = '';

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const channel = await em.findOneOrFail(SalesChannel, { code: 'pl_retail' });
    language = channel.defaultLanguage;
    product = await createMinimumProduct(em, { sku: `S163-CMPN-${RUN}`, nameEn: 'Plain', namePl: 'Plain', channelIds: [channel.id] });
    await setNameOverride(em, product.id, channel.id, null, `Compared ${RUN}`);
  }, 60_000);

  afterAll(async () => {
    if (!h) return;
    await clearValueOverrides(h.em(), [product.id]);
    await teardownBackendServer(h);
  });

  it('names the column with the channel override in the reader’s language', async () => {
    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/comparisons/me/products',
      cookies: BUYER,
      headers: { ...CHANNEL, 'accept-language': language, 'content-type': 'application/json' },
      payload: { productId: product.id },
    });
    expect(add.statusCode, add.body).toBe(200);
    const column = (add.json() as { data: { products: Array<{ id: string; name: Record<string, string> }> } }).data.products.find(
      (p) => p.id === product.id,
    );
    expect(column?.name[language]).toBe(`Compared ${RUN}`);
  });
});
