import { describe, expect, it } from 'vitest';
import type { AssetReference, AssetReferenceDescriptor } from '@endora-commerce/contracts';
import { AssetReferenceRegistry } from './reference-registry.js';

// Issue #535 — `findReferencesMany` must attribute every reference to the
// asset it points at. Real descriptors return plain `AssetReference`s with no
// asset id on them, so these fakes do too.
function fakeDescriptor(
  ownerModuleId: string,
  table: Record<string, AssetReference[]>,
): AssetReferenceDescriptor {
  return {
    ownerModuleId,
    async findReferences(assetIds: string[]) {
      return assetIds.flatMap((id) => table[id] ?? []);
    },
  };
}

const gallery: AssetReference = { kind: 'product_gallery', entityId: 'p-1', label: 'Product "A"' };
const page: AssetReference = { kind: 'cms_body_embed', entityId: 'page-1', label: 'Page "Home"' };
const task: AssetReference = { kind: 'task_attachment', entityId: 'task-1', label: 'Task "T"' };

describe('AssetReferenceRegistry.findReferencesMany (#535)', () => {
  it('attributes each reference to the asset it points at, across descriptors', async () => {
    const registry = new AssetReferenceRegistry();
    registry.register(fakeDescriptor('catalog', { a1: [gallery] }));
    registry.register(fakeDescriptor('cms', { a2: [page], a1: [page] }));
    registry.register(fakeDescriptor('tasks', { a2: [task] }));

    const out = await registry.findReferencesMany(['a1', 'a2', 'a3']);

    expect([...out.keys()].sort()).toEqual(['a1', 'a2', 'a3']);
    expect(out.get('a1')).toEqual(expect.arrayContaining([gallery, page]));
    expect(out.get('a1')).toHaveLength(2);
    expect(out.get('a2')).toEqual(expect.arrayContaining([page, task]));
    expect(out.get('a2')).toHaveLength(2);
    expect(out.get('a3')).toEqual([]);
  });

  it('agrees with findReferences for every asset id asked for', async () => {
    const registry = new AssetReferenceRegistry();
    registry.register(fakeDescriptor('catalog', { a1: [gallery] }));
    registry.register(fakeDescriptor('cms', { a2: [page] }));

    const many = await registry.findReferencesMany(['a1', 'a2']);
    for (const id of ['a1', 'a2']) {
      expect(many.get(id)).toEqual(await registry.findReferences(id));
    }
  });

  it('returns an empty map for no ids and an entry per id with no descriptors', async () => {
    const registry = new AssetReferenceRegistry();
    expect((await registry.findReferencesMany([])).size).toBe(0);
    const out = await registry.findReferencesMany(['a1']);
    expect(out.get('a1')).toEqual([]);
  });
});

// Feature 166, research R-6 — the batched, attributed scan. A descriptor tags
// each hit with the asset it points at and is asked **once** per batch; one
// that does not (an overlay's, a package's) is asked one asset at a time, and
// only it.
function taggedDescriptor(
  ownerModuleId: string,
  table: Record<string, AssetReference[]>,
  options: { restricted?: boolean } = {},
): AssetReferenceDescriptor & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    ownerModuleId,
    calls,
    async findReferences(assetIds: string[]) {
      calls.push([...assetIds]);
      return assetIds.flatMap((assetId) => (table[assetId] ?? []).map((ref) => ({ ...ref, assetId })));
    },
    ...(options.restricted
      ? {
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
        }
      : {}),
  };
}

function untaggedDescriptor(
  ownerModuleId: string,
  table: Record<string, AssetReference[]>,
): AssetReferenceDescriptor & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    ownerModuleId,
    calls,
    async findReferences(assetIds: string[]) {
      calls.push([...assetIds]);
      return assetIds.flatMap((id) => table[id] ?? []);
    },
  };
}

describe('AssetReferenceRegistry attribution (feature 166, R-6)', () => {
  it('attributes tagged hits by assetId, asking each tagged descriptor once for the batch', async () => {
    const registry = new AssetReferenceRegistry();
    const catalog = taggedDescriptor('catalog', { x: [gallery] });
    const tasks = taggedDescriptor('tasks', { x: [task], y: [task] }, { restricted: true });
    registry.register(catalog);
    registry.register(tasks);

    const out = await registry.findReferencesMany(['x', 'y']);

    expect(catalog.calls).toEqual([['x', 'y']]);
    expect(tasks.calls).toEqual([['x', 'y']]);
    expect(out.get('x')).toHaveLength(2);
    expect(out.get('x')).toEqual(
      expect.arrayContaining([expect.objectContaining(gallery), expect.objectContaining(task)]),
    );
    expect(out.get('y')).toEqual([expect.objectContaining(task)]);
  });

  it('asks a descriptor that returned an untagged hit once per asset, and only that descriptor', async () => {
    const registry = new AssetReferenceRegistry();
    const tagged = taggedDescriptor('catalog', { x: [gallery] });
    const untagged = untaggedDescriptor('overlay', { y: [page] });
    registry.register(tagged);
    registry.register(untagged);

    const out = await registry.findReferencesMany(['x', 'y']);

    expect(tagged.calls).toEqual([['x', 'y']]);
    expect(untagged.calls).toEqual([['x', 'y'], ['x'], ['y']]);
    expect(out.get('x')).toEqual([expect.objectContaining(gallery)]);
    expect(out.get('y')).toEqual([page]);
  });

  it('attributes an untagged hit in a batch of one asset without a second call', async () => {
    const registry = new AssetReferenceRegistry();
    const untagged = untaggedDescriptor('overlay', { x: [page] });
    registry.register(untagged);

    const out = await registry.findReferencesMany(['x']);

    expect(untagged.calls).toEqual([['x']]);
    expect(out.get('x')).toEqual([page]);
  });

  it('asks a descriptor with no hit once, whatever the batch size', async () => {
    const registry = new AssetReferenceRegistry();
    const untagged = untaggedDescriptor('overlay', {});
    registry.register(untagged);

    await registry.findReferencesMany(['x', 'y', 'z']);

    expect(untagged.calls).toEqual([['x', 'y', 'z']]);
  });

  it('findReferences still asks every descriptor, restricted or not (F-9, FR-008, FR-011)', async () => {
    const registry = new AssetReferenceRegistry();
    const catalog = taggedDescriptor('catalog', { x: [gallery] });
    const tasks = taggedDescriptor('tasks', { x: [task] }, { restricted: true });
    registry.register(catalog);
    registry.register(tasks);

    const refs = await registry.findReferences('x');

    expect(catalog.calls).toEqual([['x']]);
    expect(tasks.calls).toEqual([['x']]);
    expect(refs).toHaveLength(2);
  });

  it('exposes the descriptors partitioned into restricted and unrestricted', () => {
    const registry = new AssetReferenceRegistry();
    const catalog = taggedDescriptor('catalog', {});
    const tasks = taggedDescriptor('tasks', {}, { restricted: true });
    const cms = untaggedDescriptor('cms', {});
    registry.register(catalog);
    registry.register(tasks);
    registry.register(cms);

    const { restricted, unrestricted } = registry.partition();

    expect(restricted).toEqual([tasks]);
    expect(unrestricted).toEqual([catalog, cms]);
    // The detail lists references in this order, whoever reads it (feature 166, US3).
    expect(registry.inRegistrationOrder()).toEqual([catalog, tasks, cms]);
  });

  it('attributes one descriptor\'s batch on its own (the evaluator\'s per-descriptor question)', async () => {
    const registry = new AssetReferenceRegistry();
    const untagged = untaggedDescriptor('overlay', { x: [page], y: [page] });
    const tagged = taggedDescriptor('catalog', { y: [gallery] });

    const fromUntagged = await registry.referencesOf(untagged, ['x', 'y']);
    const fromTagged = await registry.referencesOf(tagged, ['x', 'y']);

    expect(fromUntagged.get('x')).toEqual([page]);
    expect(fromUntagged.get('y')).toEqual([page]);
    expect(fromTagged.get('x')).toEqual([]);
    expect(fromTagged.get('y')).toEqual([expect.objectContaining(gallery)]);
    expect(tagged.calls).toEqual([['x', 'y']]);
  });
});
