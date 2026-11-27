import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `specs/156-asset-stable-url/` owner ruling S5, revised — the module is named
 * to the operator the same way everywhere, with the name master already used:
 * the sidebar entry and the command palette say "Assets library" (and its
 * Polish counterpart), and the page title says the same name (master's
 * "Assets Library", capitalised as a title).
 */

function bundle(language: string): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/assets_library/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

describe('assets_library — one operator-facing name', () => {
  it('keeps the palette entry findable by "media"', async () => {
    const { manifest } = await import('@endora-commerce/mod-assets-library');
    const keywords = manifest.actions?.find((a) => a.id === 'open-assets-library')?.keywords ?? [];
    expect(keywords).toEqual(expect.arrayContaining(['media', 'media library', 'multimedia']));
  });

  it.each([
    ['en', 'Assets library'],
    ['pl', 'Biblioteka zasobów'],
  ])('%s: sidebar, page title and palette say %s', (language, name) => {
    const b = bundle(language);
    expect(b['nav.assetsLibrary.label']).toBe(name);
    expect(b['page.title']?.toLowerCase()).toBe(name.toLowerCase());
    expect(b['actions.openLibrary.label']).toBe(name);
  });
});
