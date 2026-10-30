import type { FastifyInstance } from 'fastify';
import type { OpenAPIV3_1 } from 'openapi-types';

import { createApiDescriptionGate, renderApiReferencePage } from '../http/api-description.js';
import type { RequireAdminFactory } from '../kernel/ports/require-admin.js';

/**
 * The three routes that serve the API description — who may read it is
 * `../http/api-description.ts`.
 *
 * Mounted by this module (`backend.ts`) because the gate is `auth`'s
 * `requireAdmin` port, which only a composed module can resolve, and because
 * the document describes every module's routes, so no other module owns it.
 */

export interface ApiDescriptionRouteDeps {
  readonly requireAdmin: RequireAdminFactory;
  /** The document, as `buildServer` provides it (`../http/openapi.ts`). */
  readonly document: () => OpenAPIV3_1.Document;
}

/**
 * An answer given to one authorised caller is not to be kept by a shared cache
 * and handed to the next one.
 */
const PRIVATE = 'private, no-store';

export function registerApiDescriptionRoutes(
  app: FastifyInstance,
  deps: ApiDescriptionRouteDeps,
): void {
  // The code is written as a literal so the permission inventory reads it.
  const adminGate = deps.requireAdmin('platform.api_description.read');
  const describerGate = createApiDescriptionGate(adminGate);

  app.get(
    '/api/v1/_openapi.json',
    { preHandler: describerGate, config: { salesChannelAccess: 'open' } },
    async (_request, reply) => {
      // Return the payload rather than calling `reply.send()` and then
      // resolving the async handler with `undefined` — Fastify 5 treats the
      // latter as a second send and raises ERR_HTTP_HEADERS_SENT.
      reply.header('Content-Type', 'application/json').header('Cache-Control', PRIVATE);
      return deps.document();
    },
  );

  app.get(
    '/api/v1/_docs',
    { preHandler: describerGate, config: { salesChannelAccess: 'open' } },
    async (_request, reply) => {
      reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', PRIVATE);
      return renderApiReferencePage();
    },
  );

  app.get('/api/v1/admin/api-description', { preHandler: adminGate }, async (_request, reply) => {
    reply.header('Content-Type', 'application/json').header('Cache-Control', PRIVATE);
    return deps.document();
  });
}
