import { describe, expect, it } from 'vitest';
import { computeLocator, safeKeyExtension, siblingLocator } from './locator.js';
import { parseAssetIdFromLocator } from './local-fs-adapter.js';
import { newContentVersion } from '../content-version.js';

describe('computeLocator', () => {
  it('shards by first two and next two hex chars of the assetId', () => {
    const id = 'aabbccdd-1111-2222-3333-444455556666';
    expect(computeLocator({ assetId: id, originalFilename: 'hero.JPG' })).toBe(
      `aa/bb/${id}.JPG`,
    );
  });

  it('lowercases the assetId in the path but keeps the original extension casing', () => {
    const id = 'AABBCCDD-1111-2222-3333-444455556666';
    expect(computeLocator({ assetId: id, originalFilename: 'photo.PNG' })).toBe(
      `aa/bb/${id.toLowerCase()}.PNG`,
    );
  });

  it('falls back to the `bin` extension when the original filename has none', () => {
    const id = 'aabbccdd-1111-2222-3333-444455556666';
    expect(computeLocator({ assetId: id, originalFilename: 'no-extension' })).toBe(
      `aa/bb/${id}.bin`,
    );
  });

  it('throws on an assetId shorter than four characters', () => {
    expect(() => computeLocator({ assetId: 'abc', originalFilename: 'x.bin' })).toThrow();
  });

  it('is pure — same input always yields the same output', () => {
    const id = 'aabbccdd-1111-2222-3333-444455556666';
    const a = computeLocator({ assetId: id, originalFilename: 'hero.jpg' });
    const b = computeLocator({ assetId: id, originalFilename: 'hero.jpg' });
    expect(a).toBe(b);
  });
});

// specs/156-asset-stable-url/contracts/storage-and-retention.md §1, research R-12a and R-21.
describe('siblingLocator', () => {
  const id = 'aabbccdd-1111-2222-3333-444455556666';
  const zeros = () => '0'.repeat(32);

  it('puts a staging key beside the stable key, with the new file\'s safe extension', () => {
    expect(siblingLocator(`aa/bb/${id}.jpg`, 'stage', 'new.png', zeros)).toBe(
      `aa/bb/${id}.stage-${'0'.repeat(32)}.png`,
    );
  });

  it('puts a previous key beside the stable key likewise', () => {
    expect(siblingLocator(`aa/bb/${id}.jpg`, 'prev', 'old.PDF', zeros)).toBe(
      `aa/bb/${id}.prev-${'0'.repeat(32)}.pdf`,
    );
  });

  it('keeps a key prefix', () => {
    expect(siblingLocator(`media/aa/bb/${id}.pdf`, 'stage', 'certificate.pdf', zeros)).toBe(
      `media/aa/bb/${id}.stage-${'0'.repeat(32)}.pdf`,
    );
  });

  it('draws 32 random lower-case hex characters by default, different every call', () => {
    const pattern = new RegExp(`^aa/bb/${id}\\.prev-([0-9a-f]{32})\\.pdf$`);
    const a = siblingLocator(`aa/bb/${id}.pdf`, 'prev', 'certificate.pdf');
    const b = siblingLocator(`aa/bb/${id}.pdf`, 'prev', 'certificate.pdf');
    expect(a).toMatch(pattern);
    expect(b).toMatch(pattern);
    expect(a).not.toBe(b);
  });

  it('never derives the random part from a content version', () => {
    const cv = newContentVersion();
    const key = siblingLocator(`aa/bb/${id}.pdf`, 'stage', 'certificate.pdf');
    expect(key).not.toContain(cv);
  });

  it('keeps the asset id parseable from every result', () => {
    for (const key of [
      siblingLocator(`aa/bb/${id}.jpg`, 'stage', 'new.png'),
      siblingLocator(`aa/bb/${id}.jpg`, 'prev', 'no-extension'),
      siblingLocator(`media/aa/bb/${id}.pdf`, 'prev', 'a.tar.gz'),
    ]) {
      expect(parseAssetIdFromLocator(key)).toBe(id);
    }
  });
});

describe('safeKeyExtension', () => {
  it.each([
    ['new.PNG', 'png'],
    ['a.tar.gz', 'gz'],
    ['x.abcdefghij', 'abcdefghij'],
    ['x.abcdefghijk', 'bin'],
    ['x.p%p', 'bin'],
    ['x.p p', 'bin'],
    ['x.ph"p', 'bin'],
    ['no-extension', 'bin'],
  ])('%j → %s', (filename, ext) => {
    expect(safeKeyExtension(filename)).toBe(ext);
  });
});
