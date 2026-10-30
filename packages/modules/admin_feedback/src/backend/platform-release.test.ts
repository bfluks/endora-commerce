import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readPlatformRelease } from './platform-release.js';

function manifestWith(content: string): URL {
  const dir = mkdtempSync(join(tmpdir(), 'admin-feedback-release-'));
  const file = join(dir, 'package.json');
  writeFileSync(file, content);
  return pathToFileURL(file);
}

describe('readPlatformRelease', () => {
  it("reads this package's own release number by default", () => {
    // Lockstep: every package of a release carries the release's number.
    expect(readPlatformRelease()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it.each([
    ['a release', '{"version":"0.107.0"}', '0.107.0'],
    ['a pre-release', '{"version":"0.108.0-next.1"}', '0.108.0-next.1'],
    ['the unreleased placeholder', '{"version":"0.0.0"}', null],
    ['no version', '{"name":"x"}', null],
    ['a version that is not a release number', '{"version":"workspace"}', null],
    ['unreadable JSON', '{', null],
  ])('answers %s', (_, content, expected) => {
    expect(readPlatformRelease(manifestWith(content))).toBe(expected);
  });

  it('answers null when the manifest is missing', () => {
    expect(readPlatformRelease(new URL('file:///nonexistent/admin-feedback/package.json'))).toBeNull();
  });
});
