import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import type {
  AssetReference,
  AssetReferenceDescriptor,
  AssetReferenceRegistryPort,
  CmsExternalReferenceScanner,
} from '@endora-commerce/contracts';
import { registerMegamenuAssetReferences } from './asset-references.js';
import { registerMegamenuCmsReferences } from './cms-references.js';
import type { MegamenuReferenceRegistry } from './megamenu-reference-registry.js';

/**
 * Feature 075, Phase C — what `megamenu` contributes to the two reference
 * registries, described by the `@endora-commerce/contracts` shapes rather than by the
 * classes `assets_library` and `cms` own.
 *
 * The seam is deliberately an ungated registration on both sides (D-39): a
 * scanner is inert until a delete asks it something, and both owners honour a
 * switched-off contributor's edges on purpose, because the menu items still
 * hold the reference and deleting the asset or page would be the destructive
 * outcome Principle XVII promises deactivation is not. Publishing the types
 * must not change that, so what this test pins is the contributor's identity
 * and the label an operator's 409 renders — the two things the registries read.
 */

const MENU_ID = '11111111-0000-4000-8000-000000000001';
const PAGE_ID = '22222222-0000-4000-8000-000000000002';
const BLOCK_ID = '33333333-0000-4000-8000-000000000003';

describe('megamenu contributes to the asset reference registry', () => {
  it('registers one descriptor owned by megamenu', () => {
    const registered: AssetReferenceDescriptor[] = [];
    const registry: AssetReferenceRegistryPort = {
      register: (descriptor) => {
        registered.push(descriptor);
      },
      owners: () => registered.map((d) => d.ownerModuleId),
      findReferences: async (): Promise<AssetReference[]> => [],
      findReferencesMany: async () => new Map(),
    };

    registerMegamenuAssetReferences(registry, () => {
      throw new Error('the descriptor must not touch the database until it is asked');
    });

    expect(registry.owners()).toEqual(['megamenu']);
  });
});

// Feature 166, research R-6 — a batch is answered in one statement, each hit
// tagged with the asset it points at (the item's `assetId` or its
// `iconAssetId`), so the library can attribute it.
describe('megamenu attributes a two-asset batch', () => {
  const ASSET_ITEM = '44444444-0000-4000-8000-000000000004';
  const ASSET_ICON = '55555555-0000-4000-8000-000000000005';

  it('tags each hit with the asset it matched, in one statement', async () => {
    const statements: string[] = [];
    const em = {
      async execute(sql: string) {
        statements.push(sql);
        return [
          { item_id: 'item-1', menu_name: 'Main menu', asset_id: ASSET_ITEM },
          { item_id: 'item-2', menu_name: 'Footer', asset_id: ASSET_ICON },
        ];
      },
    } as unknown as EntityManager;
    const registered: AssetReferenceDescriptor[] = [];
    registerMegamenuAssetReferences(
      {
        register: (d) => {
          registered.push(d);
        },
        owners: () => [],
        findReferences: async () => [],
        findReferencesMany: async () => new Map(),
      },
      () => em,
    );

    const hits = await registered[0]!.findReferences([ASSET_ITEM, ASSET_ICON]);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/as asset_id/);
    expect(hits).toEqual([
      { kind: 'megamenu_item_target', entityId: 'item-1', label: 'Megamenu "Main menu"', assetId: ASSET_ITEM },
      { kind: 'megamenu_item_target', entityId: 'item-2', label: 'Megamenu "Footer"', assetId: ASSET_ICON },
    ]);
  });
});

describe('megamenu contributes to the CMS reference registry', () => {
  const scanners: CmsExternalReferenceScanner[] = [];
  const registry = {
    register: (scanner: CmsExternalReferenceScanner): void => {
      scanners.push(scanner);
    },
  };

  const megamenuRegistry = {
    findCmsPageReferences: async () => [
      { menuId: MENU_ID, menuName: 'Main menu', itemId: 'item-1' },
    ],
    findCmsBlockReferences: async () => [
      { menuId: MENU_ID, menuName: 'Main menu', itemId: 'item-2' },
    ],
  } as unknown as MegamenuReferenceRegistry;

  it('names megamenu as the owner and labels the holding menu', async () => {
    registerMegamenuCmsReferences(registry, megamenuRegistry);

    expect(scanners.map((s) => s.ownerModuleId)).toEqual(['megamenu']);
    const scanner = scanners[0]!;
    await expect(scanner.findPageReferences!(PAGE_ID)).resolves.toEqual([
      { kind: 'megamenu', entityId: MENU_ID, label: 'Megamenu "Main menu"' },
    ]);
    await expect(scanner.findBlockReferences!(BLOCK_ID, 'block-code')).resolves.toEqual([
      { kind: 'megamenu', entityId: MENU_ID, label: 'Megamenu "Main menu"' },
    ]);
  });
});
