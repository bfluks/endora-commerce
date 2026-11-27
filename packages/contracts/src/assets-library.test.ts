import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  type AssetReadPort,
  type AssetReference,
  type AssetReferenceDescriptor,
  type AssetReferenceHit,
  type AssetReferenceReaderRestriction,
  ASSET_PERMALINK_MAX_LENGTH,
  assetPreviousVersionSchema,
  isAssetIdShaped,
  restorePreviousAssetVersionRequestSchema,
  setAssetPermalinkRequestSchema,
  validateAssetPermalink,
} from './assets-library.js';

// `specs/156-asset-stable-url/contracts/admin-api.md` §1 — the permalink rule
// shared by the server and the admin form, and the request shapes written
// first (Principle II).

const UUID_LOWER = '0b8f3c1e-2d4a-4b6c-8e9f-1a2b3c4d5e6f';
const UUID_UPPER = UUID_LOWER.toUpperCase();

describe('validateAssetPermalink', () => {
  it('declares a 200-character ceiling', () => {
    expect(ASSET_PERMALINK_MAX_LENGTH).toBe(200);
  });

  it.each(['certificate.pdf', 'docs/iso-9001.pdf', 'A_b-c.1', 'a'.repeat(200), `${UUID_LOWER}.pdf`])(
    'accepts %s',
    (value) => {
      expect(validateAssetPermalink(value)).toEqual({ ok: true });
    },
  );

  it.each([
    ['', 'empty'],
    ['a'.repeat(201), 'too_long'],
    ['a b', 'invalid_characters'],
    ['a?b', 'invalid_characters'],
    ['a%20b', 'invalid_characters'],
    ['café', 'invalid_characters'],
    ['/a', 'invalid_segment'],
    ['a/', 'invalid_segment'],
    ['a//b', 'invalid_segment'],
    ['.', 'invalid_segment'],
    ['..', 'invalid_segment'],
    ['a/./b', 'invalid_segment'],
    ['a/../b', 'invalid_segment'],
    [UUID_LOWER, 'uuid_shaped'],
    [UUID_UPPER, 'uuid_shaped'],
  ] as const)('refuses %j as %s', (value, reason) => {
    expect(validateAssetPermalink(value)).toEqual({ ok: false, reason });
  });
});

describe('isAssetIdShaped', () => {
  it.each([UUID_LOWER, UUID_UPPER])('is true for %s', (value) => {
    expect(isAssetIdShaped(value)).toBe(true);
  });

  it.each(['certificate.pdf', UUID_LOWER.slice(0, 35)])('is false for %s', (value) => {
    expect(isAssetIdShaped(value)).toBe(false);
  });
});

describe('setAssetPermalinkRequestSchema', () => {
  it('requires a string permalink', () => {
    expect(setAssetPermalinkRequestSchema.safeParse({}).success).toBe(false);
    expect(setAssetPermalinkRequestSchema.safeParse({ permalink: 42 }).success).toBe(false);
    expect(setAssetPermalinkRequestSchema.safeParse({ permalink: 'certificate.pdf' }).success).toBe(true);
  });

  it('accepts confirmReuse: true and its absence, refuses a non-boolean', () => {
    expect(
      setAssetPermalinkRequestSchema.safeParse({ permalink: 'certificate.pdf', confirmReuse: true }).success,
    ).toBe(true);
    expect(
      setAssetPermalinkRequestSchema.safeParse({ permalink: 'certificate.pdf', confirmReuse: 'yes' }).success,
    ).toBe(false);
  });
});

describe('restorePreviousAssetVersionRequestSchema', () => {
  const both = { expectedContentVersion: 'a1b2c3d4e5f6', expectedPreviousContentVersion: '0f1e2d3c4b5a' };

  it('accepts both versions', () => {
    expect(restorePreviousAssetVersionRequestSchema.safeParse(both).success).toBe(true);
  });

  it.each([
    ['nothing', {}],
    ['only the current version', { expectedContentVersion: both.expectedContentVersion }],
    ['only the previous version', { expectedPreviousContentVersion: both.expectedPreviousContentVersion }],
    ['an empty current version', { ...both, expectedContentVersion: '' }],
    ['an empty previous version', { ...both, expectedPreviousContentVersion: '' }],
  ])('refuses %s', (_label, body) => {
    expect(restorePreviousAssetVersionRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('assetPreviousVersionSchema', () => {
  const complete = {
    filename: 'certificate.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    contentVersion: 'a1b2c3d4e5f6',
    replacedAt: '2026-10-18T10:00:00.000Z',
    replacedBy: { id: UUID_LOWER, displayName: 'Operator' },
    restorableUntil: '2026-11-17T10:00:00.000Z',
  };

  it('accepts a complete value and replacedBy: null', () => {
    expect(assetPreviousVersionSchema.safeParse(complete).success).toBe(true);
    expect(assetPreviousVersionSchema.safeParse({ ...complete, replacedBy: null }).success).toBe(true);
  });

  it.each(Object.keys(complete))('requires %s', (key) => {
    const partial: Record<string, unknown> = { ...complete };
    delete partial[key];
    expect(assetPreviousVersionSchema.safeParse(partial).success).toBe(false);
  });
});

// `specs/166-asset-reference-visibility/contracts/ports.md` §1 — the
// descriptor's additive reader restriction. Type-level: a failure is a
// type-check error, not a red assertion.
describe('AssetReferenceDescriptor (feature 166)', () => {
  const reference: AssetReference = { kind: 'task_attachment', entityId: UUID_LOWER, label: 'Task T-1' };

  it('still accepts a descriptor that returns plain references (compatibility)', () => {
    const plain = {
      ownerModuleId: 'overlay',
      async findReferences(_assetIds: string[]): Promise<AssetReference[]> {
        return [reference];
      },
    };
    expectTypeOf(plain).toExtend<AssetReferenceDescriptor>();
  });

  it('accepts hits tagged with the asset they point at', () => {
    const tagged: AssetReferenceDescriptor = {
      ownerModuleId: 'catalog',
      async findReferences(assetIds: string[]): Promise<AssetReferenceHit[]> {
        return assetIds.map((assetId) => ({ ...reference, assetId }));
      },
    };
    expectTypeOf<AssetReferenceHit>().toExtend<AssetReference>();
    expectTypeOf<AssetReferenceHit['assetId']>().toEqualTypeOf<string | undefined>();
    expect(tagged.readerRestriction).toBeUndefined();
  });

  it('declares the restriction as an optional, readonly data property with three methods', () => {
    expectTypeOf<AssetReferenceDescriptor['readerRestriction']>().toEqualTypeOf<
      AssetReferenceReaderRestriction | undefined
    >();
    expectTypeOf<AssetReferenceReaderRestriction['visibleEntityIds']>().toEqualTypeOf<
      (entityIds: readonly string[]) => Promise<ReadonlySet<string>>
    >();
    expectTypeOf<AssetReferenceReaderRestriction['assetIdsWithHiddenReferences']>().toEqualTypeOf<
      () => Promise<readonly string[]>
    >();
    expectTypeOf<AssetReferenceReaderRestriction['allReferencedAssetIds']>().toEqualTypeOf<
      () => Promise<readonly string[]>
    >();
    const restricted: AssetReferenceDescriptor = {
      ownerModuleId: 'tasks',
      async findReferences() {
        return [];
      },
      readerRestriction: {
        async visibleEntityIds() {
          return new Set<string>();
        },
        async assetIdsWithHiddenReferences() {
          return [];
        },
        async allReferencedAssetIds() {
          return [];
        },
      },
    };
    // @ts-expect-error -- `readerRestriction` is readonly.
    restricted.readerRestriction = undefined;
  });
});

describe('AssetReadPort.visibleToCaller (feature 166)', () => {
  it('is a required method answering a set of the visible ids', () => {
    expectTypeOf<AssetReadPort['visibleToCaller']>().toEqualTypeOf<
      (assetIds: readonly string[]) => Promise<ReadonlySet<string>>
    >();
    expectTypeOf<undefined>().not.toExtend<AssetReadPort['visibleToCaller']>();
  });
});
