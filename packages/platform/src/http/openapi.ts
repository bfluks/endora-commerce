import type { FastifyInstance } from 'fastify';
import { OpenApiGeneratorV31, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { OpenAPIV3_1 } from 'openapi-types';

/**
 * Shared OpenAPI registry. Modules call `openApiRegistry.register(...)` during bootstrap
 * so the live OpenAPI document served at /api/v1/_openapi.json is always generated from
 * the same Zod schemas the Fastify routes validate against (R-05, Principle V).
 */
export const openApiRegistry = new OpenAPIRegistry();

const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'head',
  'options',
  'trace',
] as const);

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options' | 'trace';

const seenRoutes = new Set<string>();

/**
 * The two refusals of the sales-channel access rule (feature 154,
 * `specs/154-sales-channel-access/contracts/storefront-api.md` §3), as shared
 * response components: any non-administrative route that does not declare
 * `salesChannelAccess: 'open'` can answer either. Registered once, here, rather
 * than on every auto-registered path, whose responses this file does not know.
 */
const STRING = { type: 'string' as const };
const SALES_CHANNEL_REFUSAL_SCHEMA = {
  type: 'object' as const,
  required: ['error'],
  properties: {
    error: {
      type: 'object' as const,
      required: ['code', 'message', 'details'],
      properties: {
        code: STRING,
        message: STRING,
        details: {
          type: 'object' as const,
          required: ['channelCode'],
          properties: { channelCode: STRING },
        },
        requestId: STRING,
      },
    },
  },
};

openApiRegistry.registerComponent('responses', 'SalesChannelSignInRequired', {
  description:
    '403 `SALES_CHANNEL_SIGN_IN_REQUIRED` — an anonymous request on a sales channel closed to ' +
    'anonymous visitors. `details.channelCode` names the channel.',
  content: { 'application/json': { schema: SALES_CHANNEL_REFUSAL_SCHEMA } },
});
openApiRegistry.registerComponent('responses', 'SalesChannelNotPermitted', {
  description:
    "403 `SALES_CHANNEL_NOT_PERMITTED` — a customer request on a sales channel the customer's " +
    'Organization is not assigned to. `details.channelCode` names the channel.',
  content: { 'application/json': { schema: SALES_CHANNEL_REFUSAL_SCHEMA } },
});

/**
 * Registers an `onRoute` hook so every Fastify route auto-publishes into the OpenAPI
 * registry. Avoids per-module registerPath boilerplate while still letting a module opt
 * into a richer schema by calling `openApiRegistry.registerPath` directly.
 */
export function attachOpenApiAutoRegistration(app: FastifyInstance): void {
  app.addHook('onRoute', (route) => {
    const rawMethod = route.method;
    const methods: string[] = Array.isArray(rawMethod) ? rawMethod : [rawMethod];
    const path = toOpenApiPath(route.url);

    if (path === '/api/v1/_openapi.json' || path === '/api/v1/_docs') return;

    for (const m of methods) {
      const method = m.toLowerCase();
      if (!HTTP_METHODS.has(method as HttpMethod)) continue;
      // Fastify auto-registers HEAD for every GET; skip the duplicate.
      if (method === 'head') continue;

      const key = `${method} ${path}`;
      if (seenRoutes.has(key)) continue;
      seenRoutes.add(key);

      try {
        openApiRegistry.registerPath({
          method: method as HttpMethod,
          path,
          responses: {
            '200': { description: 'OK' },
          },
        });
      } catch {
        // Swallow — auto-registration is best-effort; a route that can't be expressed
        // here should opt into manual registration via openApiRegistry.registerPath.
      }
    }
  });
}

function toOpenApiPath(url: string): string {
  return url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export interface OpenApiMetadata {
  title: string;
  version: string;
  serverUrl: string;
}

function buildDocument(meta: OpenApiMetadata): OpenAPIV3_1.Document {
  const generator = new OpenApiGeneratorV31(openApiRegistry.definitions);
  const doc = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: meta.title,
      version: meta.version,
      description:
        'B2B Platform API. Generated at runtime from the Zod schemas in @endora-commerce/contracts. ' +
        'Source of truth: specs/001-b2b-platform-foundation/contracts/.',
    },
    servers: [{ url: meta.serverUrl }],
  });
  return doc as unknown as OpenAPIV3_1.Document;
}

/**
 * The API description, decorated on the root instance by `buildServer`.
 *
 * Building the document and serving it are two different owners' work. The
 * document is the server's: it is generated from every route Fastify registered,
 * under the title, version and server URL the composition root passed to
 * `buildServer`. **Serving** it is gated — on `platform.api_description.read`,
 * which an administrator holds through an admin role and an API key through its
 * scopes — and a gate is `auth`'s `requireAdmin` port, which only exists once
 * the modules have been composed. So `buildServer` provides the document here,
 * and `_lifecycle` mounts the routes that serve it
 * (`../lifecycle/routes.api-description.ts`; who may read it is
 * `api-description.ts`). A composition
 * that mounts no `_lifecycle` serves no API description at all, which is the
 * closed end of the question rather than an open one.
 */
declare module 'fastify' {
  interface FastifyInstance {
    /** The OpenAPI document for every route this server registered. Built on first call. */
    apiDescription: () => OpenAPIV3_1.Document;
  }
}

export function provideApiDescription(app: FastifyInstance, meta: OpenApiMetadata): void {
  // Built lazily on first request — by then every module has registered its
  // routes via the onRoute hook installed in attachOpenApiAutoRegistration().
  let cached: OpenAPIV3_1.Document | undefined;
  app.decorate('apiDescription', (): OpenAPIV3_1.Document => {
    if (!cached) {
      cached = buildDocument(meta);
    }
    return cached;
  });
}
