import { describe, expect, it } from 'vitest';
import {
  cloudContentDisposition,
  contentDispositionHeader,
  permalinkUrl,
  versionedAssetUrl,
} from './asset-urls.js';
import { newContentVersion } from './content-version.js';

// specs/156-asset-stable-url/contracts/file-serving.md §3–§4, research R-12a.

describe('versionedAssetUrl', () => {
  it.each(['local', 's3', 'gcs'] as const)('appends ?v=<cv> for %s', (backend) => {
    expect(versionedAssetUrl('https://cdn.example.com/assets/file/abc', 'a1b2c3d4e5f6', backend)).toBe(
      'https://cdn.example.com/assets/file/abc?v=a1b2c3d4e5f6',
    );
  });

  it('leaves a legacy row unchanged', () => {
    expect(versionedAssetUrl('https://old.example.com/a.jpg', 'a1b2c3d4e5f6', 'legacy')).toBe(
      'https://old.example.com/a.jpg',
    );
  });

  it('leaves a data: URL unchanged', () => {
    expect(versionedAssetUrl('data:image/png;base64,AAAA', 'a1b2c3d4e5f6', 'local')).toBe(
      'data:image/png;base64,AAAA',
    );
  });

  it('leaves a URL that already carries a query (a signed URL) unchanged', () => {
    const signed = 'https://api.example.com/assets/file/abc?token=t&exp=1';
    expect(versionedAssetUrl(signed, 'a1b2c3d4e5f6', 'local')).toBe(signed);
  });
});

describe('permalinkUrl', () => {
  it('joins the base and the permalink with exactly one slash', () => {
    expect(permalinkUrl('https://api.example.com', 'docs/certificate.pdf')).toBe(
      'https://api.example.com/assets/file/docs/certificate.pdf',
    );
    expect(permalinkUrl('https://api.example.com/', 'docs/certificate.pdf')).toBe(
      'https://api.example.com/assets/file/docs/certificate.pdf',
    );
  });
});

describe('newContentVersion', () => {
  it('is 12 lower-case hex characters and differs between calls', () => {
    const a = newContentVersion();
    const b = newContentVersion();
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(b).toMatch(/^[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

function parseDisposition(value: string) {
  const match = /^(inline|attachment); filename="([^"]*)"; filename\*=UTF-8''(.+)$/.exec(value);
  expect(match, value).not.toBeNull();
  return { mode: match![1]!, fallback: match![2]!, encoded: match![3]! };
}

describe('contentDispositionHeader', () => {
  it.each([
    ['a"b.pdf', 'a_b.pdf'],
    ['a;b.pdf', 'a_b.pdf'],
    ['a\r\nb.pdf', 'a__b.pdf'],
    ['a%41.pdf', 'a_41.pdf'],
    ['a\\b.pdf', 'a_b.pdf'],
    ['café.pdf', 'caf_.pdf'],
    ['报告.pdf', '__.pdf'],
  ])('builds a safe value for %j', (name, fallback) => {
    for (const mode of ['inline', 'attachment'] as const) {
      const value = contentDispositionHeader(mode, name);
      expect(value).not.toMatch(/[\r\n]/);
      expect(value).toMatch(/^[\x20-\x7e]*$/);
      const parsed = parseDisposition(value);
      expect(parsed.mode).toBe(mode);
      expect(parsed.fallback).toBe(fallback);
      expect(decodeURIComponent(parsed.encoded)).toBe(name);
    }
  });

  it('percent-encodes the RFC 5987 extras', () => {
    const parsed = parseDisposition(contentDispositionHeader('inline', "it's (1)*.pdf"));
    expect(parsed.encoded).toBe('it%27s%20%281%29%2A.pdf');
  });
});

describe('cloudContentDisposition', () => {
  it.each(['image/png', 'image/jpeg', 'video/mp4', 'application/pdf', 'text/plain'])(
    'is inline for %s',
    (mime) => {
      expect(cloudContentDisposition(mime, 'certificate.bin')).toMatch(/^inline; /);
    },
  );

  it.each(['image/svg+xml', 'text/html', 'application/xml', 'application/zip', 'application/octet-stream'])(
    'is attachment for %s',
    (mime) => {
      expect(cloudContentDisposition(mime, 'certificate.bin')).toMatch(/^attachment; /);
    },
  );

  it('is attachment for an SVG named as one whatever its declared type', () => {
    expect(cloudContentDisposition('image/png', 'logo.svg')).toMatch(/^attachment; /);
  });
});
