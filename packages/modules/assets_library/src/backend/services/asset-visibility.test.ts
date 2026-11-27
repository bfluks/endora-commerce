import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type AssetReference, type AssetReferenceDescriptor } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { AssetReferenceRegistry } from './reference-registry.js';
import { AssetVisibility, assetNotFound, type AssetVisibilityContext } from './asset-visibility.js';

// `specs/166-asset-reference-visibility/` data-model §2, research R-3, R-4,
// R-5, R-7 — the one evaluator, over fake descriptors, a fake presence and a
// fake permission read.

const A1 = '00000000-0000-4000-8000-0000000000a1';
const A2 = '00000000-0000-4000-8000-0000000000a2';
const A3 = '00000000-0000-4000-8000-0000000000a3';
const A4 = '00000000-0000-4000-8000-0000000000a4';

interface Calls {
  findReferences: string[][];
  visibleEntityIds: string[][];
  assetIdsWithHiddenReferences: number;
  allReferencedAssetIds: number;
}

type FakeDescriptor = AssetReferenceDescriptor & { calls: Calls };

function emptyCalls(): Calls {
  return { findReferences: [], visibleEntityIds: [], assetIdsWithHiddenReferences: 0, allReferencedAssetIds: 0 };
}

/** An owner's references: asset id → the record ids pointing at it; `visible` is what the caller may see. */
function restricted(
  ownerModuleId: string,
  kind: AssetReference['kind'],
  table: Record<string, string[]>,
  visible: readonly string[],
): FakeDescriptor {
  const calls = emptyCalls();
  const visibleSet = new Set(visible);
  return {
    ownerModuleId,
    calls,
    async findReferences(assetIds: string[]) {
      calls.findReferences.push([...assetIds]);
      return assetIds.flatMap((assetId) =>
        (table[assetId] ?? []).map((entityId) => ({ kind, entityId, label: `${kind} ${entityId}`, assetId })),
      );
    },
    readerRestriction: {
      async visibleEntityIds(entityIds: readonly string[]) {
        calls.visibleEntityIds.push([...entityIds]);
        return new Set(entityIds.filter((id) => visibleSet.has(id)));
      },
      async assetIdsWithHiddenReferences() {
        calls.assetIdsWithHiddenReferences += 1;
        return Object.entries(table)
          .filter(([, entities]) => entities.some((id) => !visibleSet.has(id)))
          .map(([assetId]) => assetId);
      },
      async allReferencedAssetIds() {
        calls.allReferencedAssetIds += 1;
        return Object.keys(table);
      },
    },
  };
}

function unrestricted(ownerModuleId: string, kind: AssetReference['kind'], table: Record<string, string[]>): FakeDescriptor {
  const calls = emptyCalls();
  return {
    ownerModuleId,
    calls,
    async findReferences(assetIds: string[]) {
      calls.findReferences.push([...assetIds]);
      return assetIds.flatMap((assetId) =>
        (table[assetId] ?? []).map((entityId) => ({ kind, entityId, label: `${kind} ${entityId}`, assetId })),
      );
    },
  };
}

interface Harness {
  visibility: AssetVisibility;
  listPermissionsCalls: string[];
  setContext(context: AssetVisibilityContext | undefined): void;
  setPresent(moduleId: string, present: boolean): void;
}

const ADMIN_B = '00000000-0000-4000-8000-00000000000b';
const ADMIN_W = '00000000-0000-4000-8000-00000000000f';

function harness(
  descriptors: readonly AssetReferenceDescriptor[],
  options: { context?: AssetVisibilityContext | undefined; absent?: readonly string[] } = {},
): Harness {
  const registry = new AssetReferenceRegistry();
  for (const d of descriptors) registry.register(d);
  const absent = new Set(options.absent ?? []);
  let context: AssetVisibilityContext | undefined =
    'context' in options ? options.context : { actor: { kind: 'admin', id: ADMIN_B } };
  const listPermissionsCalls: string[] = [];
  const visibility = new AssetVisibility({
    registry,
    isPresent: (moduleId) => !absent.has(moduleId),
    permissions: () => ({
      async listPermissions(adminUserId: string) {
        listPermissionsCalls.push(adminUserId);
        return adminUserId === ADMIN_W ? ['*'] : ['assets.read', 'assets.write', 'tasks:read'];
      },
    }),
    tenantContext: () => context,
  });
  return {
    visibility,
    listPermissionsCalls,
    setContext: (next) => {
      context = next;
    },
    setPresent: (moduleId, present) => {
      if (present) absent.delete(moduleId);
      else absent.add(moduleId);
    },
  };
}

const asAdmin = (): AssetVisibilityContext => ({ actor: { kind: 'admin', id: ADMIN_B } });
const asWildcard = (): AssetVisibilityContext => ({ actor: { kind: 'admin', id: ADMIN_W } });
const asSystem = (): AssetVisibilityContext => ({ actor: { kind: 'system' } });

function totalOwnerCalls(d: FakeDescriptor): number {
  return d.calls.visibleEntityIds.length + d.calls.assetIdsWithHiddenReferences + d.calls.allReferencedAssetIds;
}

describe('AssetVisibility.caller (R-3)', () => {
  it('classifies the system actor as unrestricted', async () => {
    const h = harness([], { context: asSystem() });
    expect(await h.visibility.caller()).toEqual({ kind: 'unrestricted', why: 'system' });
    expect(h.listPermissionsCalls).toEqual([]);
  });

  it('classifies a holder of the platform wildcard as unrestricted', async () => {
    const h = harness([], { context: asWildcard() });
    expect(await h.visibility.caller()).toEqual({ kind: 'unrestricted', why: 'wildcard' });
  });

  it('classifies any other administrator as a restricted admin', async () => {
    const h = harness([]);
    expect(await h.visibility.caller()).toEqual({ kind: 'admin', adminUserId: ADMIN_B });
  });

  it.each([
    ['no tenant context', undefined],
    ['a customer', { actor: { kind: 'customer', id: ADMIN_B } }],
    ['an API key', { actor: { kind: 'api_key', id: ADMIN_B } }],
    ['an admin actor without an id', { actor: { kind: 'admin' } }],
  ] as const)('classifies %s as nobody', async (_label, context) => {
    const h = harness([], { context });
    expect(await h.visibility.caller()).toEqual({ kind: 'nobody' });
    expect(h.listPermissionsCalls).toEqual([]);
  });

  it('asks listPermissions at most once per request (tenant context)', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, []);
    const h = harness([tasks]);
    await h.visibility.caller();
    await h.visibility.hiddenAmong([A1]);
    await h.visibility.visibleReferences(A1);
    await h.visibility.exclusionFor(async (c) => c);
    expect(h.listPermissionsCalls).toEqual([ADMIN_B]);

    h.setContext(asAdmin());
    await h.visibility.caller();
    expect(h.listPermissionsCalls).toEqual([ADMIN_B, ADMIN_B]);
  });
});

describe('AssetVisibility.hiddenAmong — the rule (FR-001)', () => {
  it('FR-001 a: an asset with no reference, or only unrestricted ones, is visible', async () => {
    const tasks = restricted('tasks', 'task_attachment', {}, []);
    const catalog = unrestricted('catalog', 'product_gallery', { [A2]: ['p1'] });
    const h = harness([tasks, catalog]);
    expect([...(await h.visibility.hiddenAmong([A1, A2]))]).toEqual([]);
  });

  it('FR-001 b: one visible restricted reference among hidden ones keeps the asset visible', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t-hidden', 't-visible'] }, ['t-visible']);
    const h = harness([tasks]);
    expect([...(await h.visibility.hiddenAmong([A1]))]).toEqual([]);
  });

  it('a restricted reference across owners: visible through the other owner', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, []);
    const projects = restricted('projects', 'project_attachment', { [A1]: ['p1'] }, ['p1']);
    const h = harness([tasks, projects]);
    expect([...(await h.visibility.hiddenAmong([A1]))]).toEqual([]);
  });

  it('FR-001 b: a hidden restricted reference plus an unrestricted one is visible (rescue)', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'], [A2]: ['t2'] }, []);
    const catalog = unrestricted('catalog', 'product_gallery', { [A1]: ['p1'] });
    const h = harness([tasks, catalog]);
    expect([...(await h.visibility.hiddenAmong([A1, A2]))]).toEqual([A2]);
  });

  it('hides an asset whose only references are restricted and hidden', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, []);
    const h = harness([tasks]);
    expect([...(await h.visibility.hiddenAmong([A1]))]).toEqual([A1]);
  });

  it('asks each restricted descriptor once, each present owner once, and the unrestricted ones only for the pending ids (FR-014)', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'], [A2]: ['t2'], [A3]: ['t3'] }, ['t3']);
    const crm = restricted('crm', 'crm_opportunity_attachment', { [A2]: ['o2'] }, []);
    const catalog = unrestricted('catalog', 'product_gallery', { [A1]: ['p1'] });
    const cms = unrestricted('cms', 'cms_body_embed', {});
    const h = harness([tasks, crm, catalog, cms]);

    const hidden = await h.visibility.hiddenAmong([A1, A2, A3, A4]);

    expect([...hidden].sort()).toEqual([A2]);
    expect(tasks.calls.findReferences).toEqual([[A1, A2, A3, A4]]);
    expect(crm.calls.findReferences).toEqual([[A1, A2, A3, A4]]);
    expect(tasks.calls.visibleEntityIds).toHaveLength(1);
    expect([...tasks.calls.visibleEntityIds[0]!].sort()).toEqual(['t1', 't2', 't3']);
    expect(crm.calls.visibleEntityIds).toEqual([['o2']]);
    expect(catalog.calls.findReferences).toHaveLength(1);
    expect([...catalog.calls.findReferences[0]!].sort()).toEqual([A1, A2]);
    expect(cms.calls.findReferences).toHaveLength(1);
    expect([...cms.calls.findReferences[0]!].sort()).toEqual([A1, A2]);
  });

  it('asks no unrestricted descriptor when nothing is pending', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, ['t1']);
    const catalog = unrestricted('catalog', 'product_gallery', {});
    const h = harness([tasks, catalog]);
    await h.visibility.hiddenAmong([A1, A2]);
    expect(catalog.calls.findReferences).toEqual([]);
  });

  it('asks an owner with no hit nothing about visibility', async () => {
    const tasks = restricted('tasks', 'task_attachment', {}, []);
    const h = harness([tasks]);
    await h.visibility.hiddenAmong([A1]);
    expect(tasks.calls.visibleEntityIds).toEqual([]);
  });
});

describe('AssetVisibility — owner switched off (R-4, FR-009)', () => {
  const build = () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'], [A2]: ['t2'] }, ['t1', 't2']);
    const cms = unrestricted('cms', 'cms_body_embed', { [A2]: ['page'] });
    return { tasks, cms };
  };

  it('hides its references from an admin, and never asks its visibility code', async () => {
    const { tasks, cms } = build();
    const h = harness([tasks, cms], { absent: ['tasks'] });
    expect([...(await h.visibility.hiddenAmong([A1, A2]))]).toEqual([A1]);
    expect(tasks.calls.visibleEntityIds).toEqual([]);
    expect(tasks.calls.assetIdsWithHiddenReferences).toBe(0);
  });

  it('hides its references from nobody too', async () => {
    const { tasks, cms } = build();
    const h = harness([tasks, cms], { absent: ['tasks'], context: undefined });
    expect([...(await h.visibility.hiddenAmong([A1, A2]))]).toEqual([A1]);
    expect(totalOwnerCalls(tasks) - tasks.calls.allReferencedAssetIds).toBe(0);
  });

  it('exclusionFor uses allReferencedAssetIds while the owner is off', async () => {
    const { tasks, cms } = build();
    const h = harness([tasks, cms], { absent: ['tasks'] });
    expect(await h.visibility.exclusionFor(async (c) => c)).toEqual([A1]);
    expect(tasks.calls.allReferencedAssetIds).toBe(1);
    expect(tasks.calls.assetIdsWithHiddenReferences).toBe(0);
    expect(tasks.calls.visibleEntityIds).toEqual([]);
  });

  it('the wildcard still sees the asset', async () => {
    const { tasks, cms } = build();
    const h = harness([tasks, cms], { absent: ['tasks'], context: asWildcard() });
    expect([...(await h.visibility.hiddenAmong([A1, A2]))]).toEqual([]);
    await h.visibility.assertVisible(A1);
  });

  it('reads presence per evaluation: back on, the answer is the one before', async () => {
    const { tasks, cms } = build();
    const h = harness([tasks, cms]);
    const before = [...(await h.visibility.hiddenAmong([A1, A2]))];
    h.setPresent('tasks', false);
    expect([...(await h.visibility.hiddenAmong([A1, A2]))]).toEqual([A1]);
    h.setPresent('tasks', true);
    expect([...(await h.visibility.hiddenAmong([A1, A2]))]).toEqual(before);
  });
});

describe('AssetVisibility — nobody and the unrestricted callers', () => {
  it('nobody sees no restricted record and asks no owner its visible ids', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, ['t1']);
    const catalog = unrestricted('catalog', 'product_gallery', { [A2]: ['p1'] });
    const h = harness([tasks, catalog], { context: { actor: { kind: 'customer', id: 'c' } } });
    expect([...(await h.visibility.hiddenAmong([A1, A2]))]).toEqual([A1]);
    expect(tasks.calls.visibleEntityIds).toEqual([]);
    expect(await h.visibility.exclusionFor(async (c) => c)).toEqual([A1]);
    expect(tasks.calls.assetIdsWithHiddenReferences).toBe(0);
    expect(tasks.calls.allReferencedAssetIds).toBe(1);
  });

  it.each([
    ['the system actor', asSystem()],
    ['the wildcard holder', asWildcard()],
  ])('%s skips every owner call', async (_label, context) => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, []);
    const catalog = unrestricted('catalog', 'product_gallery', { [A1]: ['p1'] });
    const h = harness([tasks, catalog], { context });
    expect([...(await h.visibility.hiddenAmong([A1]))]).toEqual([]);
    expect(await h.visibility.exclusionFor(async (c) => c)).toEqual([]);
    await h.visibility.assertVisible(A1);
    expect(tasks.calls).toEqual(emptyCalls());
    expect(catalog.calls).toEqual(emptyCalls());
  });
});

describe('AssetVisibility.exclusionFor (R-5)', () => {
  it('asks each restricted descriptor exactly once and returns the hidden among the scoped candidates', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'], [A2]: ['t2'], [A3]: ['t3'] }, ['t3']);
    const projects = restricted('projects', 'project_attachment', { [A3]: ['p3'] }, []);
    const catalog = unrestricted('catalog', 'product_gallery', { [A2]: ['g'] });
    const h = harness([tasks, projects, catalog]);
    const scoped: string[][] = [];

    const out = await h.visibility.exclusionFor(async (candidates) => {
      scoped.push([...candidates].sort());
      return candidates.filter((id) => id !== A3);
    });

    expect(out).toEqual([A1]);
    expect(scoped).toEqual([[A1, A2, A3]]);
    expect(tasks.calls.assetIdsWithHiddenReferences).toBe(1);
    expect(projects.calls.assetIdsWithHiddenReferences).toBe(1);
    expect(tasks.calls.findReferences).toHaveLength(1);
    expect([...tasks.calls.findReferences[0]!].sort()).toEqual([A1, A2]);
  });

  it('asks each unrestricted descriptor once, for every scoped candidate, while the owners are still answering (T049)', async () => {
    // Every candidate has a hidden restricted reference by construction, so the
    // rescue question does not wait for the owners' answer (R-5, SC-004).
    let rescueAsked!: () => void;
    const rescueStarted = new Promise<void>((resolve) => (rescueAsked = resolve));
    let ownerSawRescueFirst = false;
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'], [A2]: ['t2'], [A3]: ['t3', 't4'] }, ['t4']);
    const answer = tasks.readerRestriction!.visibleEntityIds.bind(tasks.readerRestriction);
    (tasks.readerRestriction as { visibleEntityIds: typeof answer }).visibleEntityIds = async (entityIds) => {
      ownerSawRescueFirst = await Promise.race([
        rescueStarted.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 200)),
      ]);
      return answer(entityIds);
    };
    const catalog = unrestricted('catalog', 'product_gallery', { [A2]: ['g'] });
    const find = catalog.findReferences.bind(catalog);
    catalog.findReferences = async (assetIds) => {
      rescueAsked();
      return find(assetIds);
    };
    const h = harness([tasks, catalog]);

    const out = await h.visibility.exclusionFor(async (candidates) => candidates);

    expect(out).toEqual([A1]);
    expect(ownerSawRescueFirst).toBe(true);
    expect(catalog.calls.findReferences).toHaveLength(1);
    expect([...catalog.calls.findReferences[0]!].sort()).toEqual([A1, A2, A3]);
    expect(tasks.calls.findReferences).toHaveLength(1);
    expect(tasks.calls.visibleEntityIds).toHaveLength(1);
  });

  it('returns nothing, and scopes nothing, without a candidate', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, ['t1']);
    const h = harness([tasks]);
    let scopedCalls = 0;
    const out = await h.visibility.exclusionFor(async (c) => {
      scopedCalls += 1;
      return c;
    });
    expect(out).toEqual([]);
    expect(scopedCalls).toBe(0);
    expect(tasks.calls.findReferences).toEqual([]);
  });

  it('evaluates nothing when the list\'s own filter scopes every candidate out', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, []);
    const h = harness([tasks]);
    expect(await h.visibility.exclusionFor(async () => [])).toEqual([]);
    expect(tasks.calls.findReferences).toEqual([]);
  });
});

describe('AssetVisibility.visibleReferences (FR-007)', () => {
  const build = () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t-hidden', 't-visible'] }, ['t-visible']);
    const crm = restricted('crm', 'crm_opportunity_attachment', { [A1]: ['o-hidden'] }, []);
    const catalog = unrestricted('catalog', 'product_gallery', { [A1]: ['p1'] });
    return [tasks, crm, catalog];
  };

  it('returns every unrestricted reference plus the visible restricted ones, without assetId', async () => {
    const h = harness(build());
    const refs = await h.visibility.visibleReferences(A1);
    expect(refs.map((r) => r.entityId).sort()).toEqual(['p1', 't-visible']);
    for (const ref of refs) expect(Object.keys(ref).sort()).toEqual(['entityId', 'kind', 'label']);
  });

  it('returns all of them, without assetId, for an unrestricted caller', async () => {
    const h = harness(build(), { context: asWildcard() });
    const refs = await h.visibility.visibleReferences(A1);
    expect(refs.map((r) => r.entityId).sort()).toEqual(['o-hidden', 'p1', 't-hidden', 't-visible']);
    for (const ref of refs) expect(ref).not.toHaveProperty('assetId');
  });

  it('keeps the registry’s order, restricted and unrestricted interleaved — today’s detail order', async () => {
    const before = unrestricted('cms', 'cms_body_embed', { [A1]: ['page'] });
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t-visible'] }, ['t-visible']);
    const after = unrestricted('catalog', 'product_gallery', { [A1]: ['p1'] });
    for (const context of [asAdmin(), asWildcard()]) {
      const h = harness([before, tasks, after], { context });
      expect((await h.visibility.visibleReferences(A1)).map((r) => r.entityId)).toEqual(['page', 't-visible', 'p1']);
    }
  });

  it('names no restricted reference of a switched-off owner to an admin', async () => {
    const h = harness(build(), { absent: ['tasks'] });
    const refs = await h.visibility.visibleReferences(A1);
    expect(refs.map((r) => r.entityId)).toEqual(['p1']);
  });
});

describe('invariant I-1 — a visible asset with references has a visible reference', () => {
  const scenarios: Array<[string, () => AssetReferenceDescriptor[], readonly string[]]> = [
    ['only unrestricted', () => [unrestricted('catalog', 'product_gallery', { [A1]: ['p1'] })], []],
    [
      'rescued by an unrestricted reference',
      () => [
        restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, []),
        unrestricted('cms', 'cms_body_embed', { [A1]: ['page'] }),
      ],
      [],
    ],
    ['one visible restricted reference', () => [restricted('tasks', 'task_attachment', { [A1]: ['t1', 't2'] }, ['t2'])], []],
    [
      'owner off, rescued',
      () => [
        restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, ['t1']),
        unrestricted('cms', 'cms_body_embed', { [A1]: ['page'] }),
      ],
      ['tasks'],
    ],
  ];

  it.each(scenarios)('%s', async (_label, descriptors, absent) => {
    const h = harness(descriptors(), { absent });
    expect((await h.visibility.hiddenAmong([A1])).has(A1)).toBe(false);
    expect((await h.visibility.visibleReferences(A1)).length).toBeGreaterThan(0);
  });
});

describe('AssetVisibility.assertVisible (R-7, FR-012)', () => {
  it('throws the error a missing row gets, byte for byte', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, []);
    const h = harness([tasks]);
    const missing = new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${A1} not found.`);

    const thrown = await h.visibility.assertVisible(A1).then(
      () => null,
      (err: unknown) => err,
    );

    expect(thrown).toBeInstanceOf(HttpError);
    const err = thrown as HttpError;
    expect([err.statusCode, err.code, err.message, err.details]).toEqual([
      missing.statusCode,
      missing.code,
      missing.message,
      missing.details,
    ]);
    const helper = assetNotFound(A1);
    expect([helper.statusCode, helper.code, helper.message, helper.details]).toEqual([
      missing.statusCode,
      missing.code,
      missing.message,
      missing.details,
    ]);
  });

  it('passes a visible asset and asks the owners whether or not the row exists', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, ['t1']);
    const h = harness([tasks]);
    await h.visibility.assertVisible(A1);
    await h.visibility.assertVisible(A2);
    expect(tasks.calls.findReferences).toEqual([[A1], [A2]]);
  });

  // T055 F-1: Postgres also parses a uuid without hyphens, in braces or
  // grouped otherwise, so "not canonical" does not mean "names no asset". Every
  // such spelling answers as a missing asset, for every caller, asking nobody.
  const SPELLINGS: Array<[string, string]> = [
    ['not a uuid', 'not-a-uuid'],
    ['without hyphens', A1.replaceAll('-', '')],
    ['in braces', `{${A1}}`],
    ['grouped otherwise', `${A1.replaceAll('-', '').slice(0, 4)}-${A1.replaceAll('-', '').slice(4)}`],
    ['with a trailing space', `${A1} `],
  ];

  it.each(SPELLINGS)('answers an id %s exactly as a missing asset, asking nobody', async (_label, spelled) => {
    for (const context of [asAdmin(), asWildcard(), asSystem()]) {
      const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, ['t1']);
      const h = harness([tasks], { context });
      const thrown = await h.visibility.assertVisible(spelled).then(
        () => null,
        (err: unknown) => err,
      );
      const missing = assetNotFound(spelled);
      expect(thrown).toBeInstanceOf(HttpError);
      const err = thrown as HttpError;
      expect([err.statusCode, err.code, err.message, err.details]).toEqual([
        missing.statusCode,
        missing.code,
        missing.message,
        missing.details,
      ]);
      expect(tasks.calls.findReferences).toEqual([]);
    }
  });

  it('answers the canonical id in lower case, and checks an upper-case spelling as that id', async () => {
    const tasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, ['t1']);
    const h = harness([tasks]);
    expect(await h.visibility.assertVisible(A1)).toBe(A1);
    expect(await h.visibility.assertVisible(A1.toUpperCase())).toBe(A1);
    expect(tasks.calls.findReferences).toEqual([[A1], [A1]]);

    const hiddenTasks = restricted('tasks', 'task_attachment', { [A1]: ['t1'] }, []);
    const hidden = harness([hiddenTasks]);
    // Refused as the lower-case id, which is what the service names for a missing row.
    await expect(hidden.visibility.assertVisible(A1.toUpperCase())).rejects.toMatchObject({
      statusCode: 404,
      code: ERROR_CODES.ASSET_NOT_FOUND,
      message: assetNotFound(A1).message,
    });
  });
});
