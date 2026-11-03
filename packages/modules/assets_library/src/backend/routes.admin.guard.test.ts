import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { isVisibleAssetGuard, registerAssetsLibraryAdminRoutes, type AdminRoutesDeps } from './routes.admin.js';
import type { AssetVisibility } from './services/asset-visibility.js';

// `specs/166-asset-reference-visibility/` research R-7, contracts/admin-api.md
// §1 — every admin route with an `:id` asset parameter carries
// `requireVisibleAsset`, placed **after** its permission gate, so a hidden
// asset answers as a missing one before anything is read or parsed. A later
// route cannot forget it: this enumerates what the module registers.

interface RecordedRoute {
  method: string;
  url: string;
  preHandler: unknown;
}

const GATE = Symbol('permission gate');

function isGate(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as unknown as Record<symbol, unknown>)[GATE] === true;
}

async function recordRoutes(visibility: Partial<AssetVisibility> = {}): Promise<RecordedRoute[]> {
  const routes: RecordedRoute[] = [];
  const record =
    (method: string) =>
    (url: string, options: { preHandler?: unknown }): void => {
      routes.push({ method, url, preHandler: options?.preHandler });
    };
  const app = {
    get: record('GET'),
    post: record('POST'),
    put: record('PUT'),
    patch: record('PATCH'),
    delete: record('DELETE'),
  } as unknown as FastifyInstance;
  const requireAdmin: RequireAdminFactory = () => {
    const gate = async (): Promise<void> => undefined;
    (gate as unknown as Record<symbol, unknown>)[GATE] = true;
    return gate;
  };
  const deps = {
    service: {},
    folders: {},
    adapters: {},
    emFactory: () => {
      throw new Error('not used while registering');
    },
    requireAdmin,
    visibility: visibility as AssetVisibility,
  } as unknown as AdminRoutesDeps;
  await registerAssetsLibraryAdminRoutes(app, deps);
  return routes;
}

/** Whether a route names an asset by `:id` — folder routes say `:folderId`. */
function takesAssetId(route: RecordedRoute): boolean {
  return /\/:id(\/|$)/.test(route.url);
}

/** The `:id` routes whose pre-handlers are not exactly "the gate, then the guard". */
function unguardedAssetIdRoutes(routes: readonly RecordedRoute[]): string[] {
  return routes
    .filter(takesAssetId)
    .filter((route) => {
      const chain = Array.isArray(route.preHandler) ? route.preHandler : [route.preHandler];
      const gateAt = chain.findIndex(isGate);
      const guardAt = chain.findIndex(isVisibleAssetGuard);
      return gateAt === -1 || guardAt === -1 || guardAt < gateAt;
    })
    .map((route) => `${route.method} ${route.url}`);
}

describe('requireVisibleAsset on every :id route (R-7)', () => {
  it('guards each of the ten admin routes that take an asset id, after the permission gate', async () => {
    const routes = await recordRoutes();
    const idRoutes = routes.filter(takesAssetId).map((r) => `${r.method} ${r.url}`);

    expect(idRoutes.sort()).toEqual(
      [
        'POST /api/v1/admin/assets/:id/replace',
        'POST /api/v1/admin/assets/:id/previous-version/restore',
        'PUT /api/v1/admin/assets/:id/permalink',
        'DELETE /api/v1/admin/assets/:id/permalink',
        'GET /api/v1/admin/assets/:id',
        'GET /api/v1/admin/assets/:id/url',
        'DELETE /api/v1/admin/assets/:id',
        'POST /api/v1/admin/assets/:id/restore',
        'POST /api/v1/admin/assets/:id/move',
        'PATCH /api/v1/admin/assets/:id',
      ].sort(),
    );
    expect(unguardedAssetIdRoutes(routes)).toEqual([]);
  });

  it('guards no route without an asset id (the list, upload, move-many, storage, folders)', async () => {
    const routes = await recordRoutes();
    const others = routes.filter((r) => !takesAssetId(r));
    expect(others.length).toBeGreaterThan(0);
    for (const route of others) {
      const chain = Array.isArray(route.preHandler) ? route.preHandler : [route.preHandler];
      expect(chain.some(isVisibleAssetGuard), `${route.method} ${route.url}`).toBe(false);
    }
  });

  describe('the check itself, over a fixture route list', () => {
    const gate = Object.assign(async () => undefined, { [GATE]: true });
    const guardOf = async (): Promise<RecordedRoute[]> => {
      const routes = await recordRoutes();
      const guarded = routes.find((r) => r.url === '/api/v1/admin/assets/:id' && r.method === 'GET');
      return guarded ? [guarded] : [];
    };

    it('fails a newly added :id route that lacks the guard', async () => {
      const fixture: RecordedRoute[] = [
        ...(await guardOf()),
        { method: 'POST', url: '/api/v1/admin/assets/:id/duplicate', preHandler: gate },
      ];
      expect(unguardedAssetIdRoutes(fixture)).toEqual(['POST /api/v1/admin/assets/:id/duplicate']);
    });

    it('fails a guard placed before the permission gate', async () => {
      const [real] = await guardOf();
      const chain = real!.preHandler as unknown[];
      const reversed = [...chain].reverse();
      expect(
        unguardedAssetIdRoutes([{ method: 'GET', url: '/api/v1/admin/assets/:id', preHandler: reversed }]),
      ).toEqual(['GET /api/v1/admin/assets/:id']);
    });

    it('fails a guard with no permission gate at all', async () => {
      const [real] = await guardOf();
      const guard = (real!.preHandler as unknown[]).find(isVisibleAssetGuard);
      expect(
        unguardedAssetIdRoutes([{ method: 'GET', url: '/api/v1/admin/assets/:id/url', preHandler: [guard] }]),
      ).toEqual(['GET /api/v1/admin/assets/:id/url']);
    });

    it('ignores a folder route', () => {
      expect(
        unguardedAssetIdRoutes([{ method: 'DELETE', url: '/api/v1/admin/assets/folders/:folderId', preHandler: gate }]),
      ).toEqual([]);
    });
  });

  // Review T055, F-1: the handler must never see the spelling the caller sent.
  describe('the guard hands the handler the id it checked', () => {
    async function guardOver(visibility: Partial<AssetVisibility>): Promise<(req: unknown) => Promise<void>> {
      const routes = await recordRoutes(visibility);
      const route = routes.find((r) => r.url === '/api/v1/admin/assets/:id' && r.method === 'GET')!;
      return (route.preHandler as unknown[]).find(isVisibleAssetGuard) as (req: unknown) => Promise<void>;
    }

    it('replaces the parameter with the canonical id assertVisible answers', async () => {
      const asked: string[] = [];
      const guard = await guardOver({
        assertVisible: async (id: string) => {
          asked.push(id);
          return id.toLowerCase();
        },
      });
      const req = { params: { id: 'AAAAAAAA-0000-4000-8000-0000000000A1' } };
      await guard(req);
      expect(asked).toEqual(['AAAAAAAA-0000-4000-8000-0000000000A1']);
      expect(req.params.id).toBe('aaaaaaaa-0000-4000-8000-0000000000a1');
    });

    it('lets a refusal through untouched, leaving the parameter as sent', async () => {
      const refusal = new Error('not found');
      const guard = await guardOver({
        assertVisible: async () => {
          throw refusal;
        },
      });
      const req = { params: { id: 'aaaaaaaa00004000800000000000000a1' } };
      await expect(guard(req)).rejects.toBe(refusal);
      expect(req.params.id).toBe('aaaaaaaa00004000800000000000000a1');
    });
  });
});
