import { describe, expect, it } from 'vitest';
import {
  GALLERY_ALT_TEXT_MAX,
  putGalleryChannelRolesRequestSchema,
  updateGalleryItemRequestSchema,
} from './catalog.js';

/** Feature 163 (FR-076, FR-077; `contracts/seo-media-attachments.md` §2) — the gallery write shapes. */
const C = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';

describe('updateGalleryItemRequestSchema', () => {
  it('accepts per-language alt text and the hidden channel set', () => {
    expect(
      updateGalleryItemRequestSchema.safeParse({ altText: { 'pl-PL': 'Paleta', 'en-US': '' }, hiddenInChannels: [C] })
        .success,
    ).toBe(true);
  });

  it('refuses an alt text over the limit and a channel that is not a uuid', () => {
    expect(
      updateGalleryItemRequestSchema.safeParse({ altText: { 'pl-PL': 'x'.repeat(GALLERY_ALT_TEXT_MAX + 1) } }).success,
    ).toBe(false);
    expect(updateGalleryItemRequestSchema.safeParse({ hiddenInChannels: ['b2b'] }).success).toBe(false);
  });
});

describe('putGalleryChannelRolesRequestSchema', () => {
  it('accepts an item per role, null for "use inherited", and absent roles', () => {
    expect(
      putGalleryChannelRolesRequestSchema.safeParse({ channelId: C, roles: { baseImage: I, thumbnail: null } }).success,
    ).toBe(true);
  });

  it('refuses an unknown role and a missing channel', () => {
    expect(putGalleryChannelRolesRequestSchema.safeParse({ channelId: C, roles: { hero: I } }).success).toBe(false);
    // The stored label spelling is a value, never a key of the API shape (Principle VI).
    expect(putGalleryChannelRolesRequestSchema.safeParse({ channelId: C, roles: { base_image: I } }).success).toBe(
      false,
    );
    expect(putGalleryChannelRolesRequestSchema.safeParse({ roles: {} }).success).toBe(false);
  });
});
