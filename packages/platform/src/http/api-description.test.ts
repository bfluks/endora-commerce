import type { FastifyInstance } from 'fastify';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from '../composition/index.js';
import type { RequireAdminFactory } from '../kernel/ports/require-admin.js';
import { registerApiDescriptionRoutes } from '../lifecycle/routes.api-description.js';
import {
  API_DESCRIPTION_PERMISSION,
  SWAGGER_UI_DIST,
  renderApiReferencePage,
} from './api-description.js';
import { HttpError } from './error-envelope.js';

/**
 * The API description routes, with the admin guard replaced by a stand-in that
 * admits a request carrying `x-admin: <codes>` holding the code it is asked for.
 * The real guard and the real API-key resolution are
 * `backend/test/contract/http/api-description-access.test.ts`.
 */

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const asked: Array<string | undefined> = [];

const standInAdminGuard: RequireAdminFactory = (permission) => {
  asked.push(permission);
  return async (request) => {
    const header = request.headers['x-admin'];
    if (typeof header !== 'string') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
    }
    if (permission && !header.split(',').includes(permission)) {
      throw new HttpError(403, ERROR_CODES.FORBIDDEN, `Missing permission: ${permission}.`);
    }
  };
};

async function serve(): Promise<FastifyInstance> {
  app = await buildServer({
    sessionCookieSecret: 'test-secret-do-not-use-in-production',
    openApi: { title: 'api description test', version: 'test', serverUrl: 'http://localhost' },
    disableRateLimit: true,
    modules: [
      (instance): void => {
        // Stands in for `auth`'s request hook: `x-api-key-scopes` makes the
        // caller an API key holding those scopes.
        instance.decorateRequest('actor', null as never);
        instance.addHook('onRequest', async (request) => {
          const scopes = request.headers['x-api-key-scopes'];
          request.actor =
            typeof scopes === 'string'
              ? { kind: 'api_key', apiKeyId: 'key-1', scopes: scopes.split(',') }
              : { kind: 'anonymous' };
        });
        registerApiDescriptionRoutes(instance, {
          requireAdmin: standInAdminGuard,
          document: () => instance.apiDescription(),
        });
      },
    ],
  });
  await app.ready();
  return app;
}

describe('the API description routes', () => {
  it('ask the admin guard for platform.api_description.read', async () => {
    asked.length = 0;
    await serve();
    expect(API_DESCRIPTION_PERMISSION).toBe('platform.api_description.read');
    expect(asked).toEqual([API_DESCRIPTION_PERMISSION]);
  });

  it.each(['/api/v1/_openapi.json', '/api/v1/_docs', '/api/v1/admin/api-description'])(
    '%s: 401 anonymous, 403 without the code, 200 with it',
    async (url) => {
      const served = await serve();
      expect((await served.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect(
        (await served.inject({ method: 'GET', url, headers: { 'x-admin': 'orders:read' } }))
          .statusCode,
      ).toBe(403);
      const ok = await served.inject({
        method: 'GET',
        url,
        headers: { 'x-admin': API_DESCRIPTION_PERMISSION },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.headers['cache-control']).toBe('private, no-store');
    },
  );

  it.each(['/api/v1/_openapi.json', '/api/v1/_docs'])(
    '%s: an API key is decided by its scopes',
    async (url) => {
      const served = await serve();
      const withScope = await served.inject({
        method: 'GET',
        url,
        headers: { 'x-api-key-scopes': `catalog:read,${API_DESCRIPTION_PERMISSION}` },
      });
      expect(withScope.statusCode).toBe(200);

      const without = await served.inject({
        method: 'GET',
        url,
        headers: { 'x-api-key-scopes': 'catalog:read' },
      });
      expect(without.statusCode).toBe(403);
      expect((without.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.FORBIDDEN,
      );
    },
  );

  it('the admin route does not take an API key', async () => {
    const served = await serve();
    const res = await served.inject({
      method: 'GET',
      url: '/api/v1/admin/api-description',
      headers: { 'x-api-key-scopes': API_DESCRIPTION_PERMISSION },
    });
    expect(res.statusCode).toBe(401);
  });

  it('serves the document buildServer provides', async () => {
    const served = await serve();
    const res = await served.inject({
      method: 'GET',
      url: '/api/v1/_openapi.json',
      headers: { 'x-admin': API_DESCRIPTION_PERMISSION },
    });
    const body = res.json() as { openapi: string; info: { title: string } };
    expect(body.openapi).toMatch(/^3\.1/);
    expect(body.info.title).toBe('api description test');
  });
});

describe('the reference page', () => {
  const html = renderApiReferencePage();

  it('loads an exact swagger-ui-dist release', () => {
    expect(SWAGGER_UI_DIST.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(html).toContain(`swagger-ui-dist@${SWAGGER_UI_DIST.version}/swagger-ui.css`);
    expect(html).toContain(`swagger-ui-dist@${SWAGGER_UI_DIST.version}/swagger-ui-bundle.js`);
    expect(html).not.toMatch(/swagger-ui-dist\//);
  });

  it('carries an integrity digest and crossorigin on both tags', () => {
    const css = html.match(/<link[^>]*swagger-ui\.css[^>]*>/)?.[0] ?? '';
    const js = html.match(/<script[^>]*swagger-ui-bundle\.js[^>]*>/)?.[0] ?? '';
    expect(css).toContain(`integrity="${SWAGGER_UI_DIST.cssIntegrity}"`);
    expect(js).toContain(`integrity="${SWAGGER_UI_DIST.jsIntegrity}"`);
    expect(css).toContain('crossorigin="anonymous"');
    expect(js).toContain('crossorigin="anonymous"');
    for (const digest of [SWAGGER_UI_DIST.cssIntegrity, SWAGGER_UI_DIST.jsIntegrity]) {
      expect(digest).toMatch(/^sha384-[A-Za-z0-9+/]{64}$/);
    }
  });

  it('points Swagger UI at the gated document on the same origin', () => {
    expect(html).toContain("url: '/api/v1/_openapi.json'");
  });
});
