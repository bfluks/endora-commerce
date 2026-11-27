import { describe, expect, it } from 'vitest';
import { adminAttributeResponseSchema } from './catalog.js';

/**
 * Feature 163, checkpoint F (B-6) — the admin attribute route answers `numericKind: null`
 * for an attribute that is not a slider (`serializeAdminAttribute` in catalog's
 * `routes.admin.ts`); the response schema must accept the shape the route sends.
 */
const attribute = {
  id: '00000000-0000-4000-8000-000000000001',
  key: 'colour',
  label: { 'en-US': 'Colour' },
  labelDefault: 'Colour',
  type: 'input',
  valueType: 'string',
  enumValues: null,
  isSearchable: false,
  isFilterable: false,
  isVariantAxis: false,
  displayAsSlider: false,
  isComparable: false,
  isRequired: false,
  isPromoRule: false,
  isPriceRule: false,
  filterPosition: 0,
  isVisibleOnProductPage: true,
  massEditable: false,
  quickSearchable: false,
  customFieldDefinitionId: '00000000-0000-4000-8000-000000000002',
  channelScoped: false,
  languageScoped: true,
  createdAt: '2026-10-26T00:00:00.000Z',
  updatedAt: '2026-10-26T00:00:00.000Z',
};

describe('adminAttributeResponseSchema — numericKind (163 B-6)', () => {
  it('accepts numericKind: null, as the route answers for a non-slider attribute', () => {
    expect(adminAttributeResponseSchema.safeParse({ ...attribute, numericKind: null }).success).toBe(true);
  });

  it('still accepts it absent, and a slider kind', () => {
    expect(adminAttributeResponseSchema.safeParse(attribute).success).toBe(true);
    expect(
      adminAttributeResponseSchema.safeParse({ ...attribute, type: 'slider', numericKind: 'price' }).success,
    ).toBe(true);
  });
});
