import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogProductScopeWritePort, FieldPath } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupCatalogVisibilityFixture, type CatalogVisibilityFixture } from '../../helpers/catalog-visibility-fixture.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';
import { attachRuleBySql, clearWebsiteRules } from './website-rule-fixtures.js';

/**
 * Spec 193 T070 (FR-093, R-11) QA addition — a RESTRICTED caller reading a value pending admission on
 * a governed channel. The builders' suite (`pending-admission-values.test.ts`) only reads as the
 * platform administrator. Decided read side: an unrestricted caller sees the pending value; for a
 * restricted caller the product is first subject to FR-033 (a hidden product answers as a product
 * that does not exist), and a visible one reads like any other.
 */
describe('values pending admission read by a restricted caller (spec 193, T070, FR-033, FR-082)', () => {
  let h: BackendServerHandle;
  let cv: CatalogVisibilityFixture;
  let sv: ScopedValuesFixture;
  let governed: string;
  const PL = 'pl-PL';
  const port = () => (h.container.cradle as unknown as { catalogProductScopeWritePort: CatalogProductScopeWritePort }).catalogProductScopeWritePort;
  const restricted = () => ({ cookies: cv.restricted.cookies });
  const scope = () => ({ channelId: governed, languageCode: PL });
  const secret = `PENDING-SECRET-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    cv = await setupCatalogVisibilityFixture(h);
    await clearWebsiteRules(h);
    sv = scopedValuesFixture(() => h);
    const colour = await sv.attribute({ key: 'pavr_colour', valueType: 'select', options: ['red', 'blue'] });
    governed = await sv.channel([PL]);
    await attachRuleBySql(h, [governed], `PendingRestricted ${sv.run}`, {
      match: 'all',
      conditions: [{ kind: 'attribute_choice', attributeKey: colour, optionKeys: ['red'] }],
    });
    for (const productId of [cv.visible.id, cv.hidden.id]) {
      const r = await port().applyScopes(
        productId,
        { cells: [{ scope: { level: 'channel_language', channelId: governed, languageCode: PL }, field: 'name' as FieldPath, op: { op: 'set', value: secret } }] },
        { source: 'pim_connector' },
      );
      expect(r.refused, JSON.stringify(r)).toEqual([]);
    }
  }, 5 * 60_000);

  afterAll(async () => {
    await clearWebsiteRules(h);
    await sv?.cleanup();
    await cv?.teardown();
    await teardownBackendServer(h);
  });

  it('a hidden product answers a pending scope exactly as a product that does not exist, and leaks nothing', async () => {
    const hidden = await sv.readRaw(cv.hidden.id, scope(), restricted());
    const missing = await sv.readRaw(randomUUID(), scope(), restricted());
    expect(hidden.statusCode).toBe(missing.statusCode);
    expect(hidden.statusCode).toBe(404);
    expect(hidden.body).not.toContain(secret);
    expect(hidden.body).not.toContain(cv.hidden.sku);
  });

  it('a visible product reads its pending value at the governed scope, like the unrestricted admin', async () => {
    const res = await sv.readRaw(cv.visible.id, scope(), restricted());
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { fields: { name: { value: string } } } }).data.fields.name.value).toBe(secret);
  });

  it('a hidden product cannot be written at the pending scope by a restricted caller (answers as missing)', async () => {
    const hidden = await sv.put(cv.hidden.id, scope(), { description: 'x' }, { version: '1', who: restricted() });
    const missing = await sv.put(randomUUID(), scope(), { description: 'x' }, { version: '1', who: restricted() });
    expect(hidden.statusCode).toBe(missing.statusCode);
    expect(hidden.body).not.toContain(secret);
  });
});
