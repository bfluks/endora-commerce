import { describe, expect, it } from 'vitest';
import {
  bulkUpdateProductsRequestSchema,
  createPackagingUnitRequestSchema,
  createProductRequestSchema,
  packagingUnitSchema,
  productDetailSchema,
  productSummarySchema,
  updatePackagingUnitRequestSchema,
  updateProductRequestSchema,
} from './catalog.js';

/**
 * Feature 148 (FR-001, FR-002, FR-016; threat F5) — the catalogue request and DTO shapes
 * gain the pieces minimum, the packaging-unit minimum and the returnable flag, bounded
 * 1…1 000 000 (`contracts/catalog-api.md` §0–§4).
 */

const OUT_OF_RANGE = [0, -1, 1.5, 1_000_001];
const PRODUCT_ID = '00000000-0000-4000-8000-000000000001';
const UNIT_ID = '00000000-0000-4000-8000-000000000002';

describe('updateProductRequestSchema', () => {
  it.each([1, 10, 1_000_000, null])('accepts minOrderQuantity %s', (value) => {
    const parsed = updateProductRequestSchema.parse({ minOrderQuantity: value });
    expect(parsed.minOrderQuantity).toBe(value);
  });

  it.each(OUT_OF_RANGE)('refuses minOrderQuantity %s', (value) => {
    expect(updateProductRequestSchema.safeParse({ minOrderQuantity: value }).success).toBe(false);
  });

  it.each([true, false])('accepts returnable %s', (value) => {
    expect(updateProductRequestSchema.parse({ returnable: value }).returnable).toBe(value);
  });

  it('refuses a non-boolean returnable', () => {
    expect(updateProductRequestSchema.safeParse({ returnable: 'yes' }).success).toBe(false);
  });

  it('still parses a body without either key', () => {
    const parsed = updateProductRequestSchema.parse({ visibility: 'public' });
    expect(parsed).not.toHaveProperty('minOrderQuantity');
    expect(parsed).not.toHaveProperty('returnable');
  });
});

describe('createProductRequestSchema', () => {
  const base = {
    sku: 'SKU-1',
    type: 'simple',
    name: { en: 'Bolt' },
    description: { en: '' },
    categoryIds: [],
    attributeValues: {},
    visibility: 'public',
  };

  it('accepts both keys on create', () => {
    const parsed = createProductRequestSchema.parse({ ...base, minOrderQuantity: 10, returnable: false });
    expect(parsed.minOrderQuantity).toBe(10);
    expect(parsed.returnable).toBe(false);
  });

  it('refuses minOrderQuantity 1 000 001 on create', () => {
    expect(createProductRequestSchema.safeParse({ ...base, minOrderQuantity: 1_000_001 }).success).toBe(
      false,
    );
  });
});

describe('bulkUpdateProductsRequestSchema', () => {
  it('accepts returnable as the only field', () => {
    const parsed = bulkUpdateProductsRequestSchema.parse({
      productIds: [PRODUCT_ID],
      fields: { returnable: false },
    });
    expect(parsed.fields.returnable).toBe(false);
  });

  it('still refuses an empty field set', () => {
    expect(
      bulkUpdateProductsRequestSchema.safeParse({ productIds: [PRODUCT_ID], fields: {} }).success,
    ).toBe(false);
  });
});

describe('packaging-unit requests', () => {
  it.each([1, 3, 1_000_000, null])('create accepts minOrderUnits %s', (value) => {
    const parsed = createPackagingUnitRequestSchema.parse({
      name: 'Pallet',
      baseQuantity: 64,
      minOrderUnits: value,
    });
    expect(parsed.minOrderUnits).toBe(value);
  });

  it.each(OUT_OF_RANGE)('create refuses minOrderUnits %s', (value) => {
    expect(
      createPackagingUnitRequestSchema.safeParse({ name: 'Pallet', baseQuantity: 64, minOrderUnits: value })
        .success,
    ).toBe(false);
  });

  it.each([1, 1_000_000, null])('update accepts minOrderUnits %s', (value) => {
    expect(updatePackagingUnitRequestSchema.parse({ minOrderUnits: value }).minOrderUnits).toBe(value);
  });

  it.each(OUT_OF_RANGE)('update refuses minOrderUnits %s', (value) => {
    expect(updatePackagingUnitRequestSchema.safeParse({ minOrderUnits: value }).success).toBe(false);
  });

  it('both still refuse an unknown key (strict)', () => {
    expect(
      createPackagingUnitRequestSchema.safeParse({ name: 'Pallet', baseQuantity: 64, minOrderQty: 2 }).success,
    ).toBe(false);
    expect(updatePackagingUnitRequestSchema.safeParse({ minOrderQty: 2 }).success).toBe(false);
  });
});

describe('packaging-unit and product DTOs', () => {
  const unitDto = {
    id: UNIT_ID,
    productId: PRODUCT_ID,
    name: 'Pallet',
    baseQuantity: 64,
    position: 0,
    isDefault: false,
    createdAt: '2026-10-16T00:00:00.000Z',
    updatedAt: '2026-10-16T00:00:00.000Z',
  };

  it('packagingUnitSchema parses with and without minOrderUnits', () => {
    expect(packagingUnitSchema.parse(unitDto)).not.toHaveProperty('minOrderUnits');
    expect(packagingUnitSchema.parse({ ...unitDto, minOrderUnits: 2 }).minOrderUnits).toBe(2);
    expect(packagingUnitSchema.parse({ ...unitDto, minOrderUnits: null }).minOrderUnits).toBeNull();
  });

  const summary = {
    id: PRODUCT_ID,
    sku: 'SKU-1',
    type: 'simple',
    name: 'Bolt',
    slug: 'bolt',
    categorySlugs: [],
    primaryAssetUrl: null,
    price: null,
    stockIndicator: null,
    stockLevel: null,
  };

  it('productSummarySchema parses with and without minOrderQuantity', () => {
    expect(productSummarySchema.parse(summary)).not.toHaveProperty('minOrderQuantity');
    expect(productSummarySchema.parse({ ...summary, minOrderQuantity: 10 }).minOrderQuantity).toBe(10);
    expect(productSummarySchema.parse({ ...summary, minOrderQuantity: null }).minOrderQuantity).toBeNull();
  });

  const detail = {
    ...summary,
    description: '',
    attributeValues: {},
    assets: [],
    variants: [],
    categories: [],
    seo: {
      metaTitle: 'Bolt',
      metaDescription: '',
      openGraph: { title: 'Bolt', description: '', imageUrl: null },
    },
    structuredDataJsonLd: {},
  };

  it('productDetailSchema parses with and without the new keys, incl. packagingUnits[].minOrderUnits', () => {
    const before = productDetailSchema.safeParse(detail);
    expect(before.success, JSON.stringify(before.error?.issues)).toBe(true);

    const pdpUnit = { id: UNIT_ID, name: 'Pallet', baseQuantity: 64, position: 0, isDefault: true };
    const parsed = productDetailSchema.parse({
      ...detail,
      minOrderQuantity: 10,
      packagingUnits: [
        { ...pdpUnit, minOrderUnits: 2 },
        { ...pdpUnit, id: PRODUCT_ID, minOrderUnits: null },
        { ...pdpUnit, id: '00000000-0000-4000-8000-000000000003' },
      ],
    });
    expect(parsed.minOrderQuantity).toBe(10);
    expect(parsed.packagingUnits?.map((u) => u.minOrderUnits)).toEqual([2, null, undefined]);
  });
});
