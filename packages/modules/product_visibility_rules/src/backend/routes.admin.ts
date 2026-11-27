import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  PRODUCT_VISIBILITY_PERMISSIONS,
  isUuidShape,
  productVisibilityCategoryCreateBodySchema,
  productVisibilityCategoryUpdateBodySchema,
  productVisibilityDesignationBodySchema,
  productVisibilityRoleMappingBodySchema,
  type AdminProductVisibilityScope,
  type ProductVisibilityCategory,
  type ProductVisibilityCategoryCreateBody,
  type ProductVisibilityCategoryUpdateBody,
  type ProductVisibilityDesignationBody,
  type ProductVisibilityDesignationOptionsResponse,
  type ProductVisibilityDesignationResponse,
  type ProductVisibilityMappingTarget,
  type ProductVisibilityOverviewResponse,
  type ProductVisibilityRoleMappingResponse,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/** What the configuration routes call — `VisibilityConfigService`, structurally. */
export interface ProductVisibilityConfigApi {
  overview(): Promise<ProductVisibilityOverviewResponse>;
  createCategory(body: ProductVisibilityCategoryCreateBody): Promise<ProductVisibilityCategory>;
  updateCategory(id: string, body: ProductVisibilityCategoryUpdateBody, expectedVersion: number | undefined): Promise<ProductVisibilityCategory>;
  deleteCategory(id: string, expectedVersion: number | undefined): Promise<void>;
  setRoleMapping(roleId: string, target: ProductVisibilityMappingTarget | null): Promise<ProductVisibilityRoleMappingResponse>;
  setDesignation(currencyCode: string, body: ProductVisibilityDesignationBody): Promise<ProductVisibilityDesignationResponse>;
  clearDesignation(currencyCode: string): Promise<ProductVisibilityDesignationResponse>;
  designationOptions(currencyCode: string): Promise<ProductVisibilityDesignationOptionsResponse>;
}

export interface ProductVisibilityAdminRouteDeps {
  readonly requireAdmin: RequireAdminFactory;
  readonly resolveAdminUserId: (request: FastifyRequest) => string;
  /**
   * TM-4 c — the caller's own scope kind, resolved per request. Every write answers 403
   * unless it is `unrestricted`. Unreachable end to end while FR-026 makes every holder of
   * `product_visibility:manage` unrestricted; defence in depth.
   */
  readonly callerScopeKind: (adminUserId: string) => Promise<AdminProductVisibilityScope['kind']>;
  readonly config: ProductVisibilityConfigApi;
}

const BASE = '/api/v1/admin/product-visibility';
const CURRENCY_RE = /^[A-Z]{3}$/;

/**
 * The version a client last read, from `If-Match: "<version>"`; `undefined` when it sent
 * none or `*`. A header that is there and cannot be read is 400 — taking it for "no
 * precondition" would turn a guarded write into an unguarded one.
 */
function expectedVersionOf(request: FastifyRequest): number | undefined {
  const header = request.headers['if-match'];
  if (header === undefined) return undefined;
  const value = typeof header === 'string' ? header.trim() : '';
  if (value === '*') return undefined;
  const match = /^(?:"(\d{1,9})"|(\d{1,9}))$/.exec(value);
  if (!match) {
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'If-Match must carry the version last read, as in the ETag: "3".');
  }
  return Number(match[1] ?? match[2]);
}

function categoryId(raw: string): string {
  if (!isUuidShape(raw)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Visibility category not found.');
  return raw;
}

function roleId(raw: string): string {
  if (!isUuidShape(raw)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Admin role not found.');
  return raw;
}

function currency(raw: string): string {
  const code = raw.toUpperCase();
  if (!CURRENCY_RE.test(code)) {
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Not a currency code.', [{ path: 'currencyCode', issue: 'ISO 4217 code' }]);
  }
  return code;
}

/** A category answers with its version as the ETag, for the next `If-Match`. */
function withEtag(reply: FastifyReply, category: ProductVisibilityCategory): { data: ProductVisibilityCategory } {
  void reply.header('etag', `"${category.version}"`);
  return { data: category };
}

/**
 * The configuration API of `product_visibility_rules` (`specs/193-product-visibility-rules/`
 * contracts/admin-api.md §1, the configuration rows). Mounted through `ctx.routes`, so the
 * module's effective presence gates every route (FR-073, FR-077: nothing answers while off).
 * Reads need `product_visibility:read`; writes need `product_visibility:manage` **and** an
 * unrestricted caller (TM-4 c). Every write is one audited Command (FR-070).
 */
export async function registerProductVisibilityAdminRoutes(
  app: FastifyInstance,
  deps: ProductVisibilityAdminRouteDeps,
): Promise<void> {
  const { requireAdmin, config } = deps;
  const READ = requireAdmin(PRODUCT_VISIBILITY_PERMISSIONS.READ);
  const MANAGE = requireAdmin(PRODUCT_VISIBILITY_PERMISSIONS.MANAGE);

  /** TM-4 c — runs after the permission gate, before any body is acted on. */
  async function unrestrictedCaller(request: FastifyRequest): Promise<void> {
    const kind = await deps.callerScopeKind(deps.resolveAdminUserId(request));
    if (kind !== 'unrestricted') {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only an administrator who sees every product may change product visibility.');
    }
  }

  app.get(`${BASE}/overview`, { preHandler: READ }, async () => ({ data: await config.overview() }));

  app.post(
    `${BASE}/categories`,
    { preHandler: [MANAGE, unrestrictedCaller], schema: { body: productVisibilityCategoryCreateBodySchema } },
    async (request, reply) => {
      const body = productVisibilityCategoryCreateBodySchema.parse(request.body);
      const created = await config.createCategory(body);
      reply.status(201);
      return withEtag(reply, created);
    },
  );

  app.patch<{ Params: { id: string } }>(
    `${BASE}/categories/:id`,
    { preHandler: [MANAGE, unrestrictedCaller], schema: { body: productVisibilityCategoryUpdateBodySchema } },
    async (request, reply) => {
      const body = productVisibilityCategoryUpdateBodySchema.parse(request.body);
      const updated = await config.updateCategory(categoryId(request.params.id), body, expectedVersionOf(request));
      return withEtag(reply, updated);
    },
  );

  app.delete<{ Params: { id: string } }>(`${BASE}/categories/:id`, { preHandler: [MANAGE, unrestrictedCaller] }, async (request, reply) => {
    await config.deleteCategory(categoryId(request.params.id), expectedVersionOf(request));
    reply.status(204);
    return null;
  });

  app.put<{ Params: { roleId: string } }>(
    `${BASE}/role-mappings/:roleId`,
    { preHandler: [MANAGE, unrestrictedCaller], schema: { body: productVisibilityRoleMappingBodySchema } },
    async (request) => {
      const body = productVisibilityRoleMappingBodySchema.parse(request.body);
      return { data: await config.setRoleMapping(roleId(request.params.roleId), body.target) };
    },
  );

  app.put<{ Params: { currencyCode: string } }>(
    `${BASE}/designations/:currencyCode`,
    { preHandler: [MANAGE, unrestrictedCaller], schema: { body: productVisibilityDesignationBodySchema } },
    async (request) => {
      const body = productVisibilityDesignationBodySchema.parse(request.body);
      return { data: await config.setDesignation(currency(request.params.currencyCode), body) };
    },
  );

  app.delete<{ Params: { currencyCode: string } }>(`${BASE}/designations/:currencyCode`, { preHandler: [MANAGE, unrestrictedCaller] }, async (request) => ({
    data: await config.clearDesignation(currency(request.params.currencyCode)),
  }));

  app.get<{ Params: { currencyCode: string } }>(
    `${BASE}/designations/:currencyCode/options`,
    { preHandler: READ },
    async (request) => ({ data: await config.designationOptions(currency(request.params.currencyCode)) }),
  );
}
