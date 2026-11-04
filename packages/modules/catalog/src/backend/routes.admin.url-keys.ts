import type { FastifyInstance } from 'fastify';
import { putProductUrlKeysRequestSchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { UrlKeyService } from './services/url-key.service.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/contracts/url-keys-and-redirects.md`
 * §1–§3) — a product's URL keys and redirects in the admin.
 *
 * - `GET /api/v1/admin/catalog/products/:id/url-keys` (`catalog:read`);
 * - `PUT /api/v1/admin/catalog/products/:id/url-keys` (`catalog:write`) — the
 *   Command `product.url_keys.update`;
 * - `DELETE /api/v1/admin/catalog/products/:id/url-redirects/:redirectId`
 *   (`catalog:write`) — the Command `product.url_redirect.delete`. Not gated on
 *   `seo`: writes never are (FR-111).
 *
 * The body is parsed inside the handler, after the gate, so an unauthenticated or
 * unauthorised caller is answered 401/403 whatever it sent.
 */
export interface CatalogUrlKeyAdminDeps {
  urlKeyService: UrlKeyService;
  requireAdmin: RequireAdminFactory;
}

export async function registerCatalogUrlKeyAdminRoutes(
  app: FastifyInstance,
  deps: CatalogUrlKeyAdminDeps,
): Promise<void> {
  const { urlKeyService, requireAdmin } = deps;

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/catalog/products/:id/url-keys',
    { preHandler: requireAdmin('catalog:read') },
    async (request) => ({ data: await urlKeyService.read(request.params.id) }),
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/catalog/products/:id/url-keys',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const body = putProductUrlKeysRequestSchema.parse(request.body);
      return { data: await urlKeyService.update(request.params.id, body) };
    },
  );

  app.delete<{ Params: { id: string; redirectId: string } }>(
    '/api/v1/admin/catalog/products/:id/url-redirects/:redirectId',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await urlKeyService.deleteRedirect(request.params.id, request.params.redirectId);
      return reply.status(204).send();
    },
  );
}
