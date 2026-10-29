import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_DESCRIPTION_TRANSLATION_MAX,
  adminAttributeResponseSchema,
  createAttachmentRequestSchema,
  createPackagingUnitRequestSchema,
  packagingUnitSchema,
  productAttachmentSchema,
  updateAttachmentRequestSchema,
  updatePackagingUnitRequestSchema,
} from './catalog.js';

/**
 * Feature 163 (FR-078, FR-079; `contracts/seo-media-attachments.md` §3–§4) — the
 * attachment and packaging-unit write and read shapes, and the attribute scope flags
 * the admin response carries (T095b).
 */
const C = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-10-26T10:00:00.000Z';

describe('attachment shapes', () => {
  it('create and update accept name and description per language and the hidden channel set', () => {
    const scoped = {
      nameTranslations: { 'pl-PL': 'Karta katalogowa', 'en-US': '' },
      descriptionTranslations: { de: 'Datenblatt' },
      hiddenInChannels: [C],
    };
    expect(
      createAttachmentRequestSchema.safeParse({ assetId: ID, attachmentTypeId: ID, name: 'Data sheet', ...scoped })
        .success,
    ).toBe(true);
    expect(updateAttachmentRequestSchema.safeParse(scoped).success).toBe(true);
  });

  it('refuses a name over 160 characters, a description over the limit and a channel that is not a uuid', () => {
    expect(updateAttachmentRequestSchema.safeParse({ nameTranslations: { pl: 'x'.repeat(161) } }).success).toBe(false);
    expect(
      updateAttachmentRequestSchema.safeParse({
        descriptionTranslations: { pl: 'x'.repeat(ATTACHMENT_DESCRIPTION_TRANSLATION_MAX + 1) },
      }).success,
    ).toBe(false);
    expect(updateAttachmentRequestSchema.safeParse({ hiddenInChannels: ['b2c'] }).success).toBe(false);
    expect(updateAttachmentRequestSchema.safeParse({ nameTranslations: { 'not a tag': 'x' } }).success).toBe(false);
  });

  it('the admin DTO carries the translations and the hidden channels', () => {
    const dto = {
      id: ID,
      productId: ID,
      assetId: ID,
      attachmentTypeId: ID,
      name: 'Data sheet',
      description: null,
      position: 0,
      nameTranslations: { pl: 'Karta katalogowa' },
      descriptionTranslations: {},
      hiddenInChannels: [C],
      createdAt: NOW,
      updatedAt: NOW,
    };
    const parsed = productAttachmentSchema.parse(dto);
    expect(parsed.nameTranslations).toEqual({ pl: 'Karta katalogowa' });
    expect(parsed.hiddenInChannels).toEqual([C]);
  });
});

describe('packaging-unit shapes', () => {
  it('create and update accept name translations and stay strict', () => {
    expect(
      createPackagingUnitRequestSchema.safeParse({
        name: 'Carton',
        baseQuantity: 12,
        nameTranslations: { pl: 'Karton' },
      }).success,
    ).toBe(true);
    expect(updatePackagingUnitRequestSchema.safeParse({ nameTranslations: { pl: '' } }).success).toBe(true);
    expect(updatePackagingUnitRequestSchema.safeParse({ hiddenInChannels: [C] }).success).toBe(false);
    expect(updatePackagingUnitRequestSchema.safeParse({ nameTranslations: { pl: 'x'.repeat(161) } }).success).toBe(
      false,
    );
  });

  it('the admin DTO carries the name translations', () => {
    const parsed = packagingUnitSchema.parse({
      id: ID,
      productId: ID,
      name: 'Carton',
      nameTranslations: { pl: 'Karton' },
      baseQuantity: 12,
      position: 0,
      isDefault: false,
      minOrderUnits: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(parsed.nameTranslations).toEqual({ pl: 'Karton' });
  });
});

describe('adminAttributeResponseSchema', () => {
  it('declares the attribute scope flags (T095b)', () => {
    const shape = adminAttributeResponseSchema.shape;
    expect(shape).toHaveProperty('channelScoped');
    expect(shape).toHaveProperty('languageScoped');
    expect(shape.channelScoped.safeParse(true).success).toBe(true);
    expect(shape.languageScoped.safeParse(false).success).toBe(true);
  });
});
