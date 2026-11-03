import { describe, expect, it, vi } from 'vitest';
import { integrationWritableField, type ProductScopedWriteCell } from '@endora-commerce/contracts';
import { createCatalogProductScopeWritePort } from './catalog-write-ports.js';
import { assertIntegrationCall, firstDuplicateCell } from './scoped-values-import.js';

/**
 * Feature 170 (T083; `contracts/pim-locale-mapping.md` §4, R13a, R21) — the pieces of the connector
 * port v2 that need no database: the allowlist, the call-level refusals (source, cap, duplicates)
 * raised before any Command runs. The writes themselves are `[PG]`:
 * `backend/test/contract/catalog/scope-write-port-v2.test.ts`.
 */
const C1 = '00000000-0000-4000-8000-0000000000c1';
const ITEM = '00000000-0000-4000-8000-0000000000a1';

describe('integrationWritableField (R13a)', () => {
  it('accepts the allowlist', () => {
    for (const field of [
      'name',
      'description',
      'urlKey',
      'status',
      'window',
      'attribute:colour',
      `gallery:${ITEM}:altText`,
      `attachment:${ITEM}:name`,
      `attachment:${ITEM}:description`,
      `packagingUnit:${ITEM}:name`,
    ]) {
      expect(integrationWritableField(field), field).toBe(true);
    }
  });

  it('refuses audience, product.*, seo:*, galleryRole:*, hidden flags, MOQ and returnable', () => {
    for (const field of [
      'audience',
      'product.sku',
      'seo:title',
      'galleryRole:base_image',
      `gallery:${ITEM}:hidden`,
      `attachment:${ITEM}:hidden`,
      'minOrderQuantity',
      'returnable',
    ]) {
      expect(integrationWritableField(field), field).toBe(false);
    }
  });
});

describe('assertIntegrationCall (R21)', () => {
  const cell = (field: string, scope: ProductScopedWriteCell['scope'] = { level: 'global' }): ProductScopedWriteCell =>
    ({ scope, field, op: { op: 'set', value: 'x' } }) as ProductScopedWriteCell;
  const registered = (id: string) => id === 'pim_connector';

  it('passes a registered source with distinct cells', () => {
    expect(() =>
      assertIntegrationCall([cell('name'), cell('name', { level: 'channel', channelId: C1 })], 'pim_connector', registered),
    ).not.toThrow();
  });

  it('refuses a source that is not a registered module id', () => {
    for (const source of ['unknown_module', 'Pim Connector', '', 'a']) {
      expect(() => assertIntegrationCall([cell('name')], source, registered)).toThrow(
        expect.objectContaining({ statusCode: 422, code: 'VALIDATION_FAILED', details: { field: 'source' } }),
      );
    }
  });

  it('refuses more than 2 000 cells and a (field, scope) twice; languages compare case-insensitively', () => {
    const many = Array.from({ length: 2001 }, (_, i) => cell(`attribute:k${i}`));
    expect(() => assertIntegrationCall(many, 'pim_connector', registered)).toThrow(
      expect.objectContaining({ statusCode: 422, details: { field: 'cells' } }),
    );
    const pl = (languageCode: string) => cell('name', { level: 'channel_language', channelId: C1, languageCode });
    expect(firstDuplicateCell([pl('pl-PL'), pl('en-US'), pl('PL-pl')])).toBe(2);
    expect(() => assertIntegrationCall([pl('pl-PL'), pl('pl-pl')], 'pim_connector', registered)).toThrow(
      expect.objectContaining({ statusCode: 422, details: { field: 'cells', index: 1 } }),
    );
  });

  it('the port refuses the call before any Command runs', async () => {
    const run = vi.fn();
    const port = createCatalogProductScopeWritePort({
      commandBus: () => ({ run }) as never,
      importDeps: () => ({}) as never,
      isRegisteredModule: registered,
    });
    await expect(port.applyScopes(ITEM, { cells: [cell('name')] }, { source: 'not_registered' })).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(run).not.toHaveBeenCalled();
  });
});
