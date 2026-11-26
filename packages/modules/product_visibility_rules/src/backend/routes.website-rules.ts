import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  PRODUCT_VISIBILITY_PERMISSIONS,
  isUuidShape,
  productRuleCreateBodySchema,
  productRuleUpdateBodySchema,
  websiteRulePreviewCreateBodySchema,
  type AdminProductVisibilityScope,
  type ProductRuleView,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { WebsiteRuleService } from './services/website-rule.service.js';

/**
 * The product-rule and website-rule routes of `product_visibility_rules` — spec 193 T057, T058
 * (contracts/admin-api.md §1, the rule rows). Mounted through `ctx.routes`, so the module's
 * presence gates every route (FR-073, FR-077). Reads need `product_visibility:read`; writes need
 * `product_visibility:manage` **and** an unrestricted caller (TM-4 c). Bodies are bounded by
 * their Zod schemas (TM-11) under the route body limit.
 */
export interface WebsiteRuleRouteDeps {
  readonly requireAdmin: RequireAdminFactory;
  readonly resolveAdminUserId: (request: FastifyRequest) => string;
  readonly callerScopeKind: (adminUserId: string) => Promise<AdminProductVisibilityScope['kind']>;
  readonly websiteRules: Pick<
    WebsiteRuleService,
    'listAttributes' | 'createRule' | 'updateRule' | 'deleteRule' | 'createPreview' | 'getPreview' | 'confirmPreview' | 'detach'
  >;
}

const BASE = '/api/v1/admin/product-visibility';

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

function ruleId(raw: string): string {
  if (!isUuidShape(raw)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product rule not found.');
  return raw;
}

function withEtag(reply: FastifyReply, rule: ProductRuleView): { data: ProductRuleView } {
  void reply.header('etag', `"${rule.version}"`);
  return { data: rule };
}

export async function registerWebsiteRuleAdminRoutes(app: FastifyInstance, deps: WebsiteRuleRouteDeps): Promise<void> {
  const { requireAdmin, websiteRules } = deps;
  const READ = requireAdmin(PRODUCT_VISIBILITY_PERMISSIONS.READ);
  const MANAGE = requireAdmin(PRODUCT_VISIBILITY_PERMISSIONS.MANAGE);

  async function unrestrictedCaller(request: FastifyRequest): Promise<void> {
    const kind = await deps.callerScopeKind(deps.resolveAdminUserId(request));
    if (kind !== 'unrestricted') {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Only an administrator who sees every product may change product visibility.');
    }
  }

  app.get(`${BASE}/attributes`, { preHandler: READ }, async () => ({ data: await websiteRules.listAttributes() }));

  app.post(
    `${BASE}/product-rules`,
    { preHandler: [MANAGE, unrestrictedCaller], schema: { body: productRuleCreateBodySchema } },
    async (request, reply) => {
      const created = await websiteRules.createRule(productRuleCreateBodySchema.parse(request.body));
      reply.status(201);
      return withEtag(reply, created);
    },
  );

  app.patch<{ Params: { id: string } }>(
    `${BASE}/product-rules/:id`,
    { preHandler: [MANAGE, unrestrictedCaller], schema: { body: productRuleUpdateBodySchema } },
    async (request, reply) => {
      const body = productRuleUpdateBodySchema.parse(request.body);
      return withEtag(reply, await websiteRules.updateRule(ruleId(request.params.id), body, expectedVersionOf(request)));
    },
  );

  app.delete<{ Params: { id: string } }>(`${BASE}/product-rules/:id`, { preHandler: [MANAGE, unrestrictedCaller] }, async (request, reply) => {
    await websiteRules.deleteRule(ruleId(request.params.id), expectedVersionOf(request));
    reply.status(204);
    return null;
  });

  app.post(
    `${BASE}/website-rules/previews`,
    { preHandler: [MANAGE, unrestrictedCaller], schema: { body: websiteRulePreviewCreateBodySchema } },
    async (request, reply) => {
      const body = websiteRulePreviewCreateBodySchema.parse(request.body);
      reply.status(202);
      return { data: await websiteRules.createPreview(deps.resolveAdminUserId(request), body) };
    },
  );

  app.get<{ Params: { id: string } }>(`${BASE}/website-rules/previews/:id`, { preHandler: [MANAGE, unrestrictedCaller] }, async (request) => ({
    data: await websiteRules.getPreview(deps.resolveAdminUserId(request), request.params.id),
  }));

  app.post<{ Params: { id: string } }>(
    `${BASE}/website-rules/previews/:id/confirm`,
    { preHandler: [MANAGE, unrestrictedCaller] },
    async (request, reply) => {
      const confirmed = await websiteRules.confirmPreview(deps.resolveAdminUserId(request), request.params.id);
      reply.status(202);
      return { data: { ...confirmed, status: 'applied' as const } };
    },
  );

  app.delete<{ Params: { salesChannelId: string } }>(
    `${BASE}/website-rules/attachments/:salesChannelId`,
    { preHandler: [MANAGE, unrestrictedCaller] },
    async (request, reply) => {
      await websiteRules.detach(request.params.salesChannelId);
      reply.status(204);
      return null;
    },
  );
}
