import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { setupTestServer } from '../../helpers/test-server.js';

/**
 * The OpenAPI document as `buildServer` provides it.
 *
 * `buildServer` builds the document; it does not serve it. Serving is gated on
 * `platform.api_description.read`, and the gate is the admin guard, which only
 * exists once `_lifecycle` and `auth` are composed — so a bare server answers
 * neither route. Who may read the served document is
 * `test/contract/http/api-description-access.test.ts`.
 */
describe('OpenAPI document', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await setupTestServer();
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('provides a 3.1 document carrying the metadata the root passed', () => {
    const body = app.apiDescription() as { openapi: string; info: { title: string } };
    expect(body.openapi).toMatch(/^3\.1/);
    expect(body.info.title).toContain('B2B Platform');
  });

  it('a bare server serves neither the document nor the reference page', async () => {
    for (const url of ['/api/v1/_openapi.json', '/api/v1/_docs']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
    }
  });
});
