import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  bulkAddPriceListProductsRequestSchema,
  createPriceListEngineRequestSchema,
  patchPriceListEngineRequestSchema,
  replaceBracketsRequestSchema,
  replaceProductsRequestSchema,
  priceListIdParamsSchema,
  priceMatrixEntryInputSchema,
  priceMatrixEntryPatchSchema,
  priceMatrixListQuerySchema,
  ERROR_CODES,
} from '@endora-commerce/contracts';
import { z } from 'zod';
import { HttpError } from '@endora-commerce/platform/http';
import { orgConstraintFor, ruleVisibleForScope } from '@endora-commerce/platform/tenancy';
import type { PriceListStatusWorker } from './services/price-list-status-worker.js';
import type { PriceListService } from './services/price-list-service.js';
import { extractRuleOrgTargets } from './services/rule-org-targets.js';
import type { PriceList } from './entities/price-list.entity.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { BuyerLinePriceService } from './services/buyer-line-price-service.js';
import type {
  Actor,
  SalesRepAssignmentPort,
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  CustomerGroupReadPort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { PRICE_LIST_PERMISSIONS } from '../manifest.js';

export interface PricingRoutesDeps {
  priceListService: PriceListService;
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /**
   * Feature 075 Phase C — the neighbour reads these admin screens make. The
   * rule-target pickers list organisations and categories; the product pricing
   * panel and the resolved-price probe resolve a product. All three used to be
   * `em.find` against tables this module does not own; each fails closed at the
   * seam now, which is the right answer for an admin screen that would
   * otherwise offer targets the platform cannot serve.
   */
  catalogProductRead: CatalogProductReadPort;
  catalogCategoryRead: CatalogCategoryReadPort;
  organizationDetails: OrganizationDetailsPort;
  /**
   * Feature 076 (D-79) — the last two neighbour reads this module made by
   * importing another module's entity, both of them into `customer_accounts`.
   * The rule-target picker lists customer groups; the admin resolved-price
   * probe reads the customer behind the price it is asked to explain. Both fail
   * closed at the seam, which is the right answer for a probe that would
   * otherwise price for a customer the platform will not identify.
   */
  customerGroupRead: CustomerGroupReadPort;
  customerAccountRead: CustomerAccountReadPort;
  /**
   * Feature 146 — the resolved-price probe's body, shared with
   * `buyerLinePricePort` (research R2).
   */
  buyerLinePriceService: BuyerLinePriceService;
  /**
   * Feature 146 (threat model T8, D-3M) — which organizations a non-platform
   * admin may ask the probe about. Owned by `organizations`.
   */
  salesRepScope: SalesRepAssignmentPort;
  /**
   * The module's status worker — the same instance the timer drives, so the
   * test-only sweep route invalidates the pricing cache exactly as a tick does
   * (D-287 P0).
   */
  statusWorker: Pick<PriceListStatusWorker, 'sweep'>;
  /** Feature 024 — resolves admin actor identity for audit entries. */
  resolveAdminAuditContext?: (req: FastifyRequest) => {
    actorAdminUserId: string;
    impersonatedCustomerAccountId?: string | null;
  };
}

function buildAuditCtx(
  request: FastifyRequest,
  resolver:
    | ((req: FastifyRequest) => { actorAdminUserId: string; impersonatedCustomerAccountId?: string | null })
    | undefined,
) {
  const base = resolver?.(request);
  if (!base) return undefined;
  return {
    actorAdminUserId: base.actorAdminUserId,
    impersonatedCustomerAccountId: base.impersonatedCustomerAccountId ?? null,
    ipAddress: request.ip ?? null,
    userAgent:
      typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : null,
    requestId: request.id,
  };
}

export async function registerPricingRoutes(
  app: FastifyInstance,
  deps: PricingRoutesDeps,
): Promise<void> {
  const {
    priceListService,
    emFactory,
    requireAdmin,
    catalogProductRead,
    catalogCategoryRead,
    organizationDetails,
    customerGroupRead,
    customerAccountRead,
    buyerLinePriceService,
    salesRepScope,
  } = deps;

  /**
   * Issue #219 — this module's own gates. Every route below used to name
   * `catalog:write`, which bought the ability to change what customers pay with
   * a permission granted for content work. The split is by what the route does:
   * a listing or a picker is `price_lists:read`, anything that persists is
   * `price_lists:write`.
   *
   * No compatibility shim: `catalog:write` is refused here now, so a role that
   * needs pricing is granted a pricing code deliberately. See the first-
   * deployment checklist item D3.
   */
  const readGate = requireAdmin(PRICE_LIST_PERMISSIONS.READ);
  const writeGate = requireAdmin(PRICE_LIST_PERMISSIONS.WRITE);

  // ---- Engine routes (feature 011) -----------------------------------

  app.get<{
    Querystring: {
      status?: string | string[];
      type?: string | string[];
      search?: string;
    };
  }>(
    '/api/v1/admin/price-lists-engine',
    { preHandler: readGate },
    async (request) => {
      const status = toArray(request.query.status).filter((s): s is 'draft' | 'active' | 'scheduled' | 'expired' =>
        s === 'draft' || s === 'active' || s === 'scheduled' || s === 'expired',
      );
      const type = toArray(request.query.type).filter((t): t is 'base' | 'sale' => t === 'base' || t === 'sale');
      const filter: Parameters<PriceListService['listEngine']>[0] = {};
      if (status.length > 0) filter.status = status;
      if (type.length > 0) filter.type = type;
      if (typeof request.query.search === 'string' && request.query.search.trim().length > 0) {
        filter.search = request.query.search.trim();
      }
      const rows = await priceListService.listEngine(filter);
      // Feature 050 — hide price lists that target only orgs outside the scope.
      const scoped = rows.filter((r) => ruleVisibleForScope(extractRuleOrgTargets(r.applicationRule)));
      return { data: { items: scoped.map(serializePriceListEngine) } };
    },
  );

  app.post(
    '/api/v1/admin/price-lists-engine',
    {
      preHandler: writeGate,
      schema: { body: createPriceListEngineRequestSchema },
    },
    async (request, reply) => {
      const body = createPriceListEngineRequestSchema.parse(request.body);
      const row = await priceListService.create(
        {
          name: body.name,
          type: body.type,
          startsAt: body.startsAt ? new Date(body.startsAt) : null,
          endsAt: body.endsAt ? new Date(body.endsAt) : null,
          ...(body.applicationRule !== undefined ? { applicationRule: body.applicationRule } : {}),
        },
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      reply.status(201);
      return { data: serializePriceListEngine(row) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id',
    {
      preHandler: writeGate,
      schema: { body: patchPriceListEngineRequestSchema },
    },
    async (request) => {
      const body = patchPriceListEngineRequestSchema.parse(request.body);
      const patch: Parameters<PriceListService['patch']>[1] = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.type !== undefined) patch.type = body.type;
      if (body.startsAt !== undefined) patch.startsAt = body.startsAt ? new Date(body.startsAt) : null;
      if (body.endsAt !== undefined) patch.endsAt = body.endsAt ? new Date(body.endsAt) : null;
      if (body.applicationRule !== undefined) patch.applicationRule = body.applicationRule;
      const row = await priceListService.patch(
        request.params.id,
        patch,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: serializePriceListEngine(row) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id',
    { preHandler: readGate },
    async (request) => {
      const row = await priceListService.getById(request.params.id);
      if (!ruleVisibleForScope(extractRuleOrgTargets(row.applicationRule))) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, `Price list ${request.params.id} not found.`);
      }
      return { data: serializePriceListEngine(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/activate',
    { preHandler: writeGate },
    async (request) => {
      const row = await priceListService.activate(
        request.params.id,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: serializePriceListEngine(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/draftify',
    { preHandler: writeGate },
    async (request) => {
      const row = await priceListService.draftify(
        request.params.id,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: serializePriceListEngine(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/duplicate',
    { preHandler: writeGate },
    async (request, reply) => {
      const dup = await priceListService.duplicate(
        request.params.id,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      reply.status(201);
      return { data: serializePriceListEngine(dup) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id',
    { preHandler: writeGate },
    async (request, reply) => {
      await priceListService.remove(request.params.id);
      return reply.status(204).send();
    },
  );

  // ---- Engine: product roster + bracket pricing (US3) ----------------

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products',
    { preHandler: readGate },
    async (request) => {
      const items = await priceListService.listProducts(request.params.id);
      return { data: { items } };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products',
    {
      preHandler: writeGate,
      schema: { body: replaceProductsRequestSchema },
    },
    async (request) => {
      const body = replaceProductsRequestSchema.parse(request.body);
      const result = await priceListService.replaceProducts(
        request.params.id,
        body.productIds,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: result };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products',
    {
      preHandler: writeGate,
      schema: { body: z.object({ productId: z.string().uuid() }) },
    },
    async (request, reply) => {
      const body = z.object({ productId: z.string().uuid() }).parse(request.body);
      await priceListService.addProduct(request.params.id, body.productId);
      reply.status(201);
      return { data: { priceListId: request.params.id, productId: body.productId } };
    },
  );

  // Feature 145 / US4 — many products in one request, one Command, one audit
  // entry (contracts/price-list-bulk-add.md). Append-only: unlike the PUT
  // above it never removes a product.
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/bulk-add',
    {
      preHandler: writeGate,
      schema: { params: priceListIdParamsSchema, body: bulkAddPriceListProductsRequestSchema },
    },
    async (request) => {
      const body = bulkAddPriceListProductsRequestSchema.parse(request.body);
      const result = await priceListService.addProducts(
        request.params.id,
        body.productIds,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: result };
    },
  );

  app.delete<{ Params: { id: string; productId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/:productId',
    { preHandler: writeGate },
    async (request, reply) => {
      await priceListService.removeProduct(request.params.id, request.params.productId);
      return reply.status(204).send();
    },
  );

  app.get<{ Params: { id: string; productId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/:productId/brackets',
    { preHandler: readGate },
    async (request) => {
      const list = await priceListService.listProducts(request.params.id);
      const entry = list.find((e) => e.productId === request.params.productId);
      if (!entry) {
        return { data: { bracketsByCurrency: {} } };
      }
      return { data: { bracketsByCurrency: entry.bracketsByCurrency } };
    },
  );

  app.put<{ Params: { id: string; productId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/:productId/brackets',
    {
      preHandler: writeGate,
      schema: { body: replaceBracketsRequestSchema },
    },
    async (request) => {
      const body = replaceBracketsRequestSchema.parse(request.body);
      const out = await priceListService.replaceBrackets(
        request.params.id,
        request.params.productId,
        body.bracketsByCurrency,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: { bracketsByCurrency: out } };
    },
  );

  app.post<{ Params: { id: string; productId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/:productId/brackets/copy',
    {
      preHandler: writeGate,
      schema: {
        body: z.object({
          fromCurrency: z.string().regex(/^[A-Z]{3}$/),
          toCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1),
        }),
      },
    },
    async (request) => {
      const body = z
        .object({
          fromCurrency: z.string().regex(/^[A-Z]{3}$/),
          toCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1),
        })
        .parse(request.body);
      const result = await priceListService.copyCurrencyBrackets(
        request.params.id,
        request.params.productId,
        body.fromCurrency,
        body.toCurrencies,
      );
      return { data: result };
    },
  );

  // ---- Price matrix (feature 148) -------------------------------------
  //
  // `specs/148-price-list-matrix-rules/contracts/admin-price-matrix-api.md`.
  // Reads behind `price_lists:read`, writes behind `price_lists:write`, every
  // write through the module's one audited Command Bus path. `lang` is the
  // admin UI's language, used only to pick display labels.

  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    '/api/v1/admin/price-lists-engine/:id/matrix',
    { preHandler: readGate, schema: { params: priceListIdParamsSchema } },
    async (request) => {
      const query = priceMatrixListQuerySchema.parse(request.query);
      const data = await priceListService.matrix.list(
        request.params.id,
        query,
        labelLanguage(request.query['lang']),
      );
      return { data };
    },
  );

  app.get<{ Params: { id: string; entryId: string }; Querystring: { lang?: string } }>(
    '/api/v1/admin/price-lists-engine/:id/matrix/:entryId',
    { preHandler: readGate },
    async (request) => ({
      data: await priceListService.matrix.get(
        request.params.id,
        request.params.entryId,
        labelLanguage(request.query.lang),
      ),
    }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/matrix',
    {
      preHandler: writeGate,
      schema: { params: priceListIdParamsSchema, body: priceMatrixEntryInputSchema },
    },
    async (request, reply) => {
      const body = priceMatrixEntryInputSchema.parse(request.body);
      const entry = await priceListService.createMatrixEntry(
        request.params.id,
        body,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      reply.status(201);
      return { data: entry };
    },
  );

  app.patch<{ Params: { id: string; entryId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/matrix/:entryId',
    { preHandler: writeGate, schema: { body: priceMatrixEntryPatchSchema } },
    async (request) => {
      const body = priceMatrixEntryPatchSchema.parse(request.body);
      const entry = await priceListService.patchMatrixEntry(
        request.params.id,
        request.params.entryId,
        body,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: entry };
    },
  );

  app.delete<{ Params: { id: string; entryId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/matrix/:entryId',
    { preHandler: writeGate },
    async (request, reply) => {
      await priceListService.removeMatrixEntry(
        request.params.id,
        request.params.entryId,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return reply.status(204).send();
    },
  );

  // ---- Rule-builder pickers (US4) -----------------------------------

  /**
   * Feature 148 — the attributes a price matrix entry may select on: flagged
   * *Price list rules*, a choice or yes/no value, neither per-language nor
   * per-channel. A sibling of the pickers below so a pricing role needs no
   * catalogue permission to build an entry (the issue #180 pattern).
   */
  app.get<{ Querystring: { lang?: string } }>(
    '/api/v1/admin/pricing/rule-targets/attributes',
    { preHandler: readGate },
    async (request) => ({
      data: { items: await priceListService.matrix.attributeTargets(labelLanguage(request.query.lang)) },
    }),
  );

  app.get(
    '/api/v1/admin/pricing/rule-targets/sales-channels',
    { preHandler: readGate },
    async () => {
      const em = emFactory();
      const rows = await em.find(SalesChannel, {}, { orderBy: { code: 'asc' } });
      return {
        data: {
          items: rows.map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
          })),
        },
      };
    },
  );

  /**
   * Issue #180 removed `catalog:write` from the canonical customer-group
   * endpoints and missed this copy — a pricing rule-target picker, not a
   * catalogue surface. The `promotions` and `pwa` twins have always answered
   * behind their own module's read code; so does this one now.
   */
  app.get(
    '/api/v1/admin/pricing/rule-targets/customer-groups',
    { preHandler: readGate },
    async () => {
      // Already ordered by code on the owner's side.
      const rows = await customerGroupRead.listAll();
      return {
        data: {
          items: rows.map((r) => ({ id: r.id, code: r.code, name: r.name })),
        },
      };
    },
  );

  app.get<{ Querystring: { search?: string; limit?: string } }>(
    '/api/v1/admin/pricing/rule-targets/organizations',
    { preHandler: readGate },
    async (request) => {
      const limit = Math.min(200, Math.max(1, Number(request.query.limit ?? '50')));
      const search = (request.query.search ?? '').trim();
      // `searchByName` matches the diacritic-folded `nameSearch` column, where
      // this picker used to `$ilike` on `name` — so a search for "lodz" now
      // finds "Łódź" here as it already did on the order list.
      const rows = await organizationDetails.searchByName(search, limit);
      return {
        data: {
          items: rows.map((r) => ({ id: r.id, name: r.name, taxId: r.taxId })),
          nextCursor: null,
        },
      };
    },
  );

  app.get(
    '/api/v1/admin/pricing/rule-targets/categories',
    { preHandler: readGate },
    async () => {
      // The port's `listAll` is already ordered by sort order then slug.
      const rows = await catalogCategoryRead.listAll();
      return {
        data: {
          items: rows.map((r) => ({
            id: r.id,
            slug: r.slug,
            name: r.name,
            parentCategoryId: r.parentCategoryId ?? null,
            sortOrder: r.sortOrder,
          })),
        },
      };
    },
  );

  app.get(
    '/api/v1/admin/pricing/rule-targets/currencies',
    { preHandler: readGate },
    async () => {
      const em = emFactory();
      const channels = await em.find(SalesChannel, {});
      const exposed = new Map<string, string[]>();
      for (const ch of channels) {
        for (const cur of ch.currencies ?? []) {
          if (typeof cur !== 'string' || cur.length !== 3) continue;
          const key = cur.toUpperCase();
          const list = exposed.get(key) ?? [];
          list.push(ch.code);
          exposed.set(key, list);
        }
      }
      const items = [...exposed.entries()]
        .map(([code, exposedByChannels]) => ({ code, exposedByChannels }))
        .sort((a, b) => a.code.localeCompare(b.code));
      return { data: { items } };
    },
  );

  // ---- Linked price-lists panel for the product editor (US8) -------

  app.get<{ Params: { productId: string } }>(
    '/api/v1/admin/products/:productId/price-lists',
    { preHandler: readGate },
    async (request, reply) => {
      const product = await catalogProductRead.findById(request.params.productId);
      if (!product) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }
      const items = await priceListService.summarizeBracketsForProduct(
        request.params.productId,
      );
      return {
        data: {
          items: items.map((it) => ({
            list: {
              id: it.list.id,
              name: it.list.name,
              type: it.list.type,
              status: it.list.status,
              modifiedAt: it.list.modifiedAt.toISOString(),
            },
            summary: it.summary,
            deepLinkPath: it.deepLinkPath,
          })),
        },
      };
    },
  );

  // ---- Display-mode overrides (US7) ----------------------------------

  app.get<{ Querystring: { scope?: 'organization' | 'category' | 'product' } }>(
    '/api/v1/admin/pricing/display-mode-overrides',
    { preHandler: readGate },
    async (request) => {
      const items = await priceListService.listDisplayModeOverrides(request.query.scope);
      return {
        data: {
          items: items.map((o) => ({
            scope: o.scope,
            targetId: o.targetId,
            mode: o.mode,
            updatedAt: o.updatedAt.toISOString(),
          })),
        },
      };
    },
  );

  app.get<{
    Params: { scope: 'organization' | 'category' | 'product'; targetId: string };
  }>(
    '/api/v1/admin/pricing/display-mode-overrides/:scope/:targetId',
    { preHandler: readGate },
    async (request, reply) => {
      const row = await priceListService.getDisplayModeOverride(
        request.params.scope,
        request.params.targetId,
      );
      if (!row) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Override not found.' } };
      }
      return {
        data: {
          scope: row.scope,
          targetId: row.targetId,
          mode: row.mode,
          updatedAt: row.updatedAt.toISOString(),
        },
      };
    },
  );

  app.put<{
    Params: { scope: 'organization' | 'category' | 'product'; targetId: string };
  }>(
    '/api/v1/admin/pricing/display-mode-overrides/:scope/:targetId',
    {
      preHandler: writeGate,
      schema: {
        body: z.object({
          mode: z.enum(['gross_only', 'net_only', 'both', 'none', 'inherit']),
        }),
      },
    },
    async (request, reply) => {
      const body = z
        .object({ mode: z.enum(['gross_only', 'net_only', 'both', 'none', 'inherit']) })
        .parse(request.body);
      const row = await priceListService.upsertDisplayModeOverride(
        request.params.scope,
        request.params.targetId,
        body.mode,
      );
      if (!row) {
        return reply.status(204).send();
      }
      return {
        data: {
          scope: row.scope,
          targetId: row.targetId,
          mode: row.mode,
          updatedAt: row.updatedAt.toISOString(),
        },
      };
    },
  );

  // Storefront-public routes live in `routes.storefront.ts` and are mounted
  // separately from `plugin.ts` so the admin and storefront surfaces stay
  // independently auditable. See T025/T026.

  // Test-only sweeper hook — the production code path runs the worker on the
  // BullMQ queue every 5 min. This endpoint lets integration tests advance
  // the state machine without waiting for the queue tick.
  app.post(
    '/api/v1/admin/price-lists-engine/internal/sweep',
    { preHandler: writeGate },
    async () => {
      // The module's own worker, so a route-driven sweep tells the pricing
      // cache what a timer-driven one tells it (D-287 P0).
      const result = await deps.statusWorker.sweep();
      return { data: result };
    },
  );

  // ---- Admin price resolution for a specific customer -----------------
  // Resolves the effective unit price for a (product, customer/organization)
  // pair so admin-side flows (notably "create quote request on behalf of a
  // customer") can pre-fill the agreed unit price from the customer's price
  // lists instead of leaving the field blank. Mirrors the storefront resolver
  // but threads the customer's organization + group context.
  //
  // D-173 — it is gated on this module's own read code, not on `rfqs:handle`.
  // The caller is the RFQ create screen, but what the endpoint serves is a
  // price-list resolution, and `price_lists` declares itself
  // `nonDeactivatable` while `quote_requests` is switchable: `rfqs:handle`
  // leaves `/admin-roles` the moment an operator switches quote requests off,
  // and this route, which cannot be switched off with it, went on enforcing a
  // code nobody could be granted. That is the consequence D-166 wrote down for
  // the sales-rep endpoints and did not generalise.
  //
  // The label test decides which repair applies: *"Handle quote requests"* is
  // not a sentence about a price-resolution endpoint, so the code does not
  // become shared — the consumer gates on a code it owns. Issue #219 already
  // ruled that a pricing read sits behind `price_lists:read`; a role that
  // handles RFQs and prefills agreed prices holds both, which is why
  // `sales_representative` gains the read code in the dev seed.
  //
  // Feature 146 (`specs/146-quote-request-pricing-history/`) — the body is now
  // `BuyerLinePriceService`, the same implementation `buyerLinePricePort`
  // serves, and the probe resolves on `salesChannelId` (absent = the system
  // default). Because it now backs a screen every sales representative uses, it
  // answers only about organizations the caller may see (threat model T8,
  // decision D-3M) — see `authorizeBuyer` below.
  app.get<{
    Params: { id: string };
    Querystring: {
      organizationId?: string;
      customerAccountId?: string;
      quantity?: string;
      currency?: string;
      variantId?: string;
      salesChannelId?: string;
    };
  }>(
    '/api/v1/admin/products/:id/resolved-price',
    { preHandler: readGate },
    async (request, reply) => {
      const buyer = await authorizeBuyer(request, {
        organizationId: request.query.organizationId ?? null,
        customerAccountId: request.query.customerAccountId ?? null,
      });

      const [answer] = await buyerLinePriceService.resolveDetailed({
        buyer,
        salesChannelId: request.query.salesChannelId ?? null,
        ...(request.query.currency ? { currencyCode: request.query.currency } : {}),
        lines: [
          {
            key: request.params.id,
            productId: request.params.id,
            variantId: request.query.variantId ?? null,
            quantity: Math.max(1, Number(request.query.quantity ?? '1') || 1),
          },
        ],
      });
      if (!answer?.productFound) {
        return reply
          .status(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Product not found.' } });
      }

      // Feature 148 / FR-020 — the probe names the matrix entry that priced the
      // line (additive; `null` for a stored bracket).
      return {
        data: {
          resolvedPrice: answer.price ? { ...answer.price, matrixEntryId: answer.matrixEntryId } : null,
        },
      };
    },
  );

  /**
   * The probe's authority step (feature 146, threat model T8, decision D-3M),
   * run before any price is resolved.
   *
   * The organization asked about is `organizationId`, else the account's own.
   * Every way of naming an organization the caller may not see — an id that
   * does not exist, one outside a representative's scope, a customer account
   * that does not exist or belongs to such an organization — answers the same
   * 404 and body, so the probe tells nobody what exists (Constitution XI, C1).
   * Only once both sides are visible is a membership mismatch a 400.
   *
   * A platform administrator — an ambient tenant context that reaches every
   * organization, derived from the admin's role and never from the request —
   * skips the representative check only; existence and membership still hold.
   * A request naming neither an organization nor an account is the anonymous
   * price, unchanged.
   */
  async function authorizeBuyer(
    request: FastifyRequest,
    asked: { organizationId: string | null; customerAccountId: string | null },
  ): Promise<{ organizationId: string | null; customerAccountId: string | null }> {
    if (!asked.organizationId && !asked.customerAccountId) {
      return { organizationId: null, customerAccountId: null };
    }
    const notFound = (): HttpError =>
      new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
    const isPlatformAdmin = orgConstraintFor().kind === 'all';
    const actor = request.actor as Actor | undefined;
    const canSee = async (organizationId: string): Promise<boolean> => {
      if (isPlatformAdmin) return true;
      if (actor?.kind !== 'admin') return false;
      return salesRepScope.canSeeOrganization(actor.adminUserId, organizationId);
    };

    let accountOrganizationId: string | null = null;
    if (asked.customerAccountId) {
      const account = isUuid(asked.customerAccountId)
        ? await customerAccountRead.findById(asked.customerAccountId)
        : null;
      if (!account || !(await canSee(account.organizationId))) throw notFound();
      accountOrganizationId = account.organizationId;
    }

    const organizationId = asked.organizationId ?? accountOrganizationId;
    if (!organizationId || !isUuid(organizationId)) throw notFound();
    if (asked.organizationId) {
      if (!(await canSee(organizationId))) throw notFound();
      if (!(await organizationDetails.findById(organizationId))) throw notFound();
    }
    if (accountOrganizationId !== null && accountOrganizationId !== organizationId) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'The customer account is not a member of the organization.',
      );
    }
    return { organizationId, customerAccountId: asked.customerAccountId };
  }
}

/** A short language tag the admin UI sends to choose display labels, or `null`. */
function labelLanguage(value: string | undefined): string | null {
  return typeof value === 'string' && /^[a-z]{2}(-[A-Za-z]{2})?$/.test(value) ? value : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id names nothing, and must not reach Postgres as a failed `uuid` cast. */
function isUuid(value: string): boolean {
  return UUID.test(value);
}

function toArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function serializePriceListEngine(row: PriceList): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    applicationRule: row.applicationRule,
    isSystem: row.isSystem,
    modifiedAt: row.modifiedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

