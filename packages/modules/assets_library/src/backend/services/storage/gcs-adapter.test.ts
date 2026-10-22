import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable, Writable } from 'node:stream';

// specs/156-asset-stable-url/contracts/storage-and-retention.md §1 and
// contracts/file-serving.md §4 — what the GCS adapter asks of the client library.

interface RecordedFile {
  name: string;
  writeOptions?: Record<string, unknown>;
  copies: Array<{ dest: RecordedFile; options: Record<string, unknown> }>;
}

const files = new Map<string, RecordedFile>();
let failCopy = false;

function fileNamed(name: string) {
  const record = files.get(name) ?? { name, copies: [] };
  files.set(name, record);
  return {
    record,
    createWriteStream(options: Record<string, unknown>) {
      record.writeOptions = options;
      return new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
    },
    async copy(dest: { record: RecordedFile }, options: Record<string, unknown>) {
      if (failCopy) throw Object.assign(new Error('Forbidden'), { code: 403 });
      record.copies.push({ dest: dest.record, options });
      return [dest];
    },
  };
}

vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket() {
      return { file: (name: string) => fileNamed(name) };
    }
  },
}));

const { GcsStorageAdapter } = await import('./gcs-adapter.js');
const { BackendUnavailableError } = await import('./errors.js');

const ID = 'aabbccdd-1111-2222-3333-444455556666';

function adapter() {
  return new GcsStorageAdapter({
    bucket: 'media-bucket',
    publicApiBaseUrl: 'https://api.example.test',
    privateUrlTtlSec: 300,
  });
}

beforeEach(() => {
  files.clear();
  failCopy = false;
});

describe('GcsStorageAdapter.put — object metadata', () => {
  it('carries cacheControl and contentDisposition when given', async () => {
    await adapter().put({
      locator: `aa/bb/${ID}.pdf`,
      mimeType: 'application/pdf',
      visibility: 'public',
      stream: Readable.from(['x']),
      sizeBytes: 1,
      cacheControl: 'no-cache',
      contentDisposition: 'inline; filename="certificate.pdf"',
    });
    expect(files.get(`aa/bb/${ID}.pdf`)!.writeOptions).toMatchObject({
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'no-cache',
        contentDisposition: 'inline; filename="certificate.pdf"',
      },
      predefinedAcl: 'publicRead',
    });
  });

  it('omits them otherwise', async () => {
    await adapter().put({
      locator: `aa/bb/${ID}.pdf`,
      mimeType: 'application/pdf',
      visibility: 'private',
      stream: Readable.from(['x']),
      sizeBytes: 1,
    });
    expect(files.get(`aa/bb/${ID}.pdf`)!.writeOptions!.metadata).toEqual({
      contentType: 'application/pdf',
    });
  });
});

describe('GcsStorageAdapter.copy', () => {
  const from = `aa/bb/${ID}.stage-${'0'.repeat(32)}.pdf`;
  const to = `aa/bb/${ID}.pdf`;

  it.each([
    ['public', 'publicRead'],
    ['private', 'private'],
  ] as const)('copies with an explicit ACL, %s → %s, and the replaced metadata', async (visibility, acl) => {
    await adapter().copy({
      from,
      to,
      visibility,
      mimeType: 'application/pdf',
      cacheControl: 'no-cache',
      contentDisposition: 'inline; filename="certificate.pdf"',
    });
    const copies = files.get(from)!.copies;
    expect(copies).toHaveLength(1);
    expect(copies[0]!.dest.name).toBe(to);
    expect(copies[0]!.options).toEqual({
      predefinedAcl: acl,
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'no-cache',
        contentDisposition: 'inline; filename="certificate.pdf"',
      },
    });
  });

  it('sends the ACL even without the optional metadata', async () => {
    await adapter().copy({ from, to, visibility: 'private', mimeType: 'application/pdf' });
    expect(files.get(from)!.copies[0]!.options).toEqual({
      predefinedAcl: 'private',
      metadata: { contentType: 'application/pdf' },
    });
  });

  it('turns a rejected copy into BackendUnavailableError', async () => {
    failCopy = true;
    await expect(
      adapter().copy({ from, to, visibility: 'public', mimeType: 'application/pdf' }),
    ).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});
