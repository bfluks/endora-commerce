import Fastify, { type FastifyInstance } from 'fastify';
import { validatorCompiler } from '@fastify/type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import type { AdminProductVisibilityScope } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { registerProductVisibilityAdminRoutes, type ProductVisibilityConfigApi } from './routes.admin.js';

/**
 * Every configuration **write** answers
 * `403 FORBIDDEN` unless the caller's own scope is `unrestricted`, and writes nothing. FR-026
 * makes every `product_visibility:manage` holder unrestricted, so this cannot be reached end to
 * end; it is defence in depth, held here with a stubbed scope. Reads are not affected.
 */
const CATEGORY = '11111111-1111-4111-8111-111111111111';
const ROLE = '22222222-2222-4222-8222-222222222222';
const BOOK = '33333333-3333-4333-8333-333333333333';
const CHANNEL = '44444444-4444-4444-8444-444444444444';

const WRITES: Array<{ method: 'POST' | 'PATCH' | 'DELETE' | 'PUT'; url: string; payload?: unknown }> = [
  {
    method: 'POST',
    url: '/api/v1/admin/product-visibility/categories',
    payload: { name: 'Wholesale', conditions: [{ currencyCode: 'PLN', threshold: 'gt_zero' }] },
  },
  { method: 'PATCH', url: `/api/v1/admin/product-visibility/categories/${CATEGORY}`, payload: { name: 'B' } },
  { method: 'DELETE', url: `/api/v1/admin/product-visibility/categories/${CATEGORY}` },
  { method: 'PUT', url: `/api/v1/admin/product-visibility/role-mappings/${ROLE}`, payload: { target: { kind: 'unrestricted' } } },
  { method: 'PUT', url: '/api/v1/admin/product-visibility/designations/PLN', payload: { priceListId: BOOK, salesChannelId: CHANNEL } },
  { method: 'DELETE', url: '/api/v1/admin/product-visibility/designations/PLN' },
];

let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function appWith(scope: AdminProductVisibilityScope['kind']): Promise<{ app: FastifyInstance; calls: string[] }> {
  const calls: string[] = [];
  const record =
    (name: string, answer: unknown = {}) =>
    async () => {
      calls.push(name);
      return answer as never;
    };
  const config: ProductVisibilityConfigApi = {
    overview: record('overview', { currencies: [], categories: [], roles: [], productRules: [], websiteRuleAttachments: [] }),
    createCategory: record('createCategory', { id: CATEGORY, name: 'Wholesale', version: 1, conditions: [], mappedRoleIds: [] }),
    updateCategory: record('updateCategory', { id: CATEGORY, name: 'B', version: 2, conditions: [], mappedRoleIds: [] }),
    deleteCategory: record('deleteCategory'),
    setRoleMapping: record('setRoleMapping', { roleId: ROLE, target: { kind: 'unrestricted' } }),
    setDesignation: record('setDesignation', { currencyCode: 'PLN', designation: null, designationStatus: null }),
    clearDesignation: record('clearDesignation', { currencyCode: 'PLN', designation: null, designationStatus: null }),
    designationOptions: record('designationOptions', { items: [] }),
  };
  const instance = Fastify();
  instance.setValidatorCompiler(validatorCompiler);
  await registerProductVisibilityAdminRoutes(instance, {
    requireAdmin: (() => async () => undefined) as unknown as RequireAdminFactory,
    resolveAdminUserId: () => '55555555-5555-4555-8555-555555555555',
    callerScopeKind: async () => scope,
    config,
  });
  app = instance;
  return { app: instance, calls };
}

describe('product visibility configuration — writes need an unrestricted caller (TM-4 c)', () => {
  for (const scope of ['restricted', 'no_category'] as const) {
    it(`a ${scope} holder of manage is refused every write, and nothing is written`, async () => {
      const { app: server, calls } = await appWith(scope);
      for (const write of WRITES) {
        const res = await server.inject({ method: write.method, url: write.url, ...(write.payload ? { payload: write.payload } : {}) });
        expect(res.statusCode, `${write.method} ${write.url}`).toBe(403);
        expect(res.json().code ?? res.json().error?.code, `${write.method} ${write.url}`).toBe('FORBIDDEN');
      }
      expect(calls).toEqual([]);
    });
  }

  it('an unrestricted caller reaches every write', async () => {
    const { app: server, calls } = await appWith('unrestricted');
    for (const write of WRITES) {
      const res = await server.inject({ method: write.method, url: write.url, ...(write.payload ? { payload: write.payload } : {}) });
      expect(res.statusCode, `${write.method} ${write.url} ${res.body}`).toBeLessThan(300);
    }
    expect(calls).toEqual([
      'createCategory',
      'updateCategory',
      'deleteCategory',
      'setRoleMapping',
      'setDesignation',
      'clearDesignation',
    ]);
  });

  it('reads are not narrowed by the caller’s scope', async () => {
    const { app: server, calls } = await appWith('no_category');
    expect((await server.inject({ method: 'GET', url: '/api/v1/admin/product-visibility/overview' })).statusCode).toBe(200);
    expect((await server.inject({ method: 'GET', url: '/api/v1/admin/product-visibility/designations/PLN/options' })).statusCode).toBe(200);
    expect(calls).toEqual(['overview', 'designationOptions']);
  });
});
