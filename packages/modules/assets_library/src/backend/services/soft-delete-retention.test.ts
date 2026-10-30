import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Setting, SettingValue } from '@endora-commerce/platform/kernel';
import { assetsLibraryModule } from '../plugin.js';
import { Asset } from '../entities/asset.entity.js';
import { AssetFolder } from '../entities/asset-folder.entity.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Exercise the production composition, including the settings reader, without
// storage or a database. The entity manager models one folder and one asset.
function fixture(options: { missing?: boolean; defaultValue?: unknown; globalValue?: unknown; override?: unknown } = {}) {
  const asset = Object.assign(new Asset(), { filename: 'retention.png' });
  const folder = Object.assign(new AssetFolder(), { name: 'Retention' });
  asset.folderId = folder.id;
  const setting = { defaultValue: options.defaultValue ?? 30, globalValue: options.globalValue };
  const flush = vi.fn(async () => undefined);
  const em = {
    findOne: vi.fn(async (entity: unknown) => {
      if (entity === Setting) return options.missing ? null : setting;
      if (entity === SettingValue) {
        return 'override' in options ? { value: options.override } : null;
      }
      if (entity === Asset) return asset;
      if (entity === AssetFolder) return folder;
      throw new Error('Unexpected entity');
    }),
    findOneOrFail: async () => asset,
    find: async (entity: unknown) => entity === Asset ? [asset] : [],
    remove: vi.fn(),
    flush,
  } as unknown as EntityManager;
  const { handle } = assetsLibraryModule({
    emFactory: () => em,
    publicApiBaseUrl: 'https://api.example.test',
    requireAdmin: () => async () => undefined,
    isModulePresent: () => true,
    permissions: () => ({ listPermissions: async () => [] }),
  });
  return { handle, asset, folder, flush, options };
}

describe('soft-delete retention setting (#322)', () => {
  const cases = [
    { name: 'global seven-day override', options: { globalValue: 7 }, days: 7 },
    { name: 'global zero-day override (held to the one-day floor)', options: { globalValue: 0 }, days: 1 },
    { name: 'channel override ahead of global override', options: { globalValue: 90, override: 7 }, days: 7 },
    { name: 'configured seven days', options: { override: 7 }, days: 7 },
    { name: 'configured ninety days', options: { override: 90 }, days: 90 },
    { name: 'zero days (held to the one-day floor)', options: { override: 0 }, days: 1 },
    { name: 'manifest default without an override', options: { defaultValue: 14 }, days: 14 },
    { name: 'missing setting', options: { missing: true }, days: 30 },
    { name: 'negative value', options: { override: -1 }, days: 30 },
    { name: 'non-finite value', options: { override: Infinity }, days: 30 },
    { name: 'unparseable value', options: { override: 'invalid' }, days: 30 },
  ];

  describe.each(cases)('$name', ({ options, days }) => {
    it('sets the single-asset deadline from the setting', async () => {
      const { handle, asset, flush } = fixture(options);
      const result = await handle.service.softDelete(asset.id);
      expect(result.purgeAfterAt.getTime() - result.deletedAt.getTime()).toBe(days * DAY_MS);
      expect(asset.purgeAfterAt).toEqual(result.purgeAfterAt);
      expect(flush).toHaveBeenCalledOnce();
    });

    it('sets the recursive-folder deadline from the same setting', async () => {
      const { handle, asset, folder, flush } = fixture(options);
      const result = await handle.folders.deleteFolder(folder.id, 'deleteRecursively');
      expect(result.softDeletedAssetIds).toEqual([asset.id]);
      expect(asset.purgeAfterAt!.getTime() - asset.deletedAt!.getTime()).toBe(days * DAY_MS);
      expect(flush).toHaveBeenCalledOnce();
    });
  });

  it('reads changes live: a repeated delete reports the current setting, the stored deadline keeps the first', async () => {
    const options = { override: 7 };
    const { handle, asset } = fixture(options);
    const first = await handle.service.softDelete(asset.id);
    const stored = asset.purgeAfterAt;
    options.override = 90;
    // specs/156-asset-stable-url/ owner ruling P1: the reported date follows
    // the setting read now, which is what the sweep uses.
    const repeated = await handle.service.softDelete(asset.id);
    expect(repeated.deletedAt).toEqual(first.deletedAt);
    expect(repeated.purgeAfterAt.getTime() - repeated.deletedAt.getTime()).toBe(90 * DAY_MS);
    expect(asset.purgeAfterAt).toEqual(stored);
    asset.deletedAt = null;
    asset.purgeAfterAt = null;
    const second = await handle.service.softDelete(asset.id);
    expect(second.purgeAfterAt.getTime() - second.deletedAt.getTime()).toBe(90 * DAY_MS);
  });
});
