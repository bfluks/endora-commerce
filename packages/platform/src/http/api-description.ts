import type { FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@endora-commerce/contracts';

import { HttpError } from './error-envelope.js';

/**
 * Who may read the API description, and the reference page that renders it.
 *
 * The OpenAPI document names every route this deployment serves, with its
 * parameters and schemas, so it is available to the people the platform
 * administrator chose and to nobody else:
 *
 *  - an **administrator** whose admin role holds `platform.api_description.read`
 *    (the platform administrator's wildcard role included);
 *  - an **API key** issued with that code among its scopes. A key's scopes are
 *    permission codes held to the issuing administrator's own role, so only an
 *    administrator who holds the code can hand it to an integration.
 *
 * Anybody else is answered by the admin guard: 401 `UNAUTHORIZED` without an
 * administrator session (a customer session included), 403 `FORBIDDEN` for an
 * administrator or an API key without the code — the same envelope as every
 * other admin route.
 *
 * The routes, registered by `../lifecycle/routes.api-description.ts`:
 *
 *  - `GET /api/v1/_openapi.json` — the document, for an administrator's browser
 *    and for an integration's API key;
 *  - `GET /api/v1/_docs` — the interactive reference page (Swagger UI) that
 *    renders it, opened from the Admin UI's *API description* screen. The
 *    admin session cookie is the backend's own and `SameSite=Lax`, so a
 *    top-level navigation from the Admin UI to this page carries it;
 *  - `GET /api/v1/admin/api-description` — the same document on the admin
 *    namespace, which the Admin UI fetches with its ordinary client and which
 *    the command-palette entry's permission is checked against. Administrators
 *    only, like every route under `/api/v1/admin/`.
 *
 * **The sales-channel access rule does not apply to the first two**
 * (`salesChannelAccess: 'open'`, feature 154): the description names no store,
 * and a closed default channel must not take it away from an integration. That
 * is a statement about channels, not about access — the gate below decides who
 * reads it.
 */

/** The code an administrator's role, or an API key's scopes, must hold. */
export const API_DESCRIPTION_PERMISSION = 'platform.api_description.read';

/**
 * The swagger-ui-dist release the reference page loads from jsDelivr, pinned to
 * an exact version, with the Subresource Integrity digest of each file. The
 * browser refuses a file whose bytes differ from the digest, so the page runs
 * exactly the release that was reviewed.
 *
 * To move it: pick the release, then compute both digests from the files
 * jsDelivr serves for that exact version and compare them with the same files
 * in the npm tarball (`npm pack swagger-ui-dist@<version>`):
 *
 *   curl -sL https://cdn.jsdelivr.net/npm/swagger-ui-dist@<version>/swagger-ui.css \
 *     | openssl dgst -sha384 -binary | openssl base64 -A
 *
 * and the same for `swagger-ui-bundle.js`. No `swagger-ui` dependency is added
 * to serve it (Constitution IV).
 */
export const SWAGGER_UI_DIST = {
  version: '5.33.3',
  cssIntegrity: 'sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW',
  jsIntegrity: 'sha384-h00llMzD1afyNow1pDmnZKlHsUZgp9KE9HXLFXF2CvbwsBY0+WBO4f75SfGwvM4K',
} as const;

/** The reference page: a static shell that loads the pinned Swagger UI and points it at the document. */
export function renderApiReferencePage(): string {
  const base = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_DIST.version}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="robots" content="noindex"/>
  <title>B2B Platform API</title>
  <link rel="stylesheet" href="${base}/swagger-ui.css" integrity="${SWAGGER_UI_DIST.cssIntegrity}" crossorigin="anonymous"/>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${base}/swagger-ui-bundle.js" integrity="${SWAGGER_UI_DIST.jsIntegrity}" crossorigin="anonymous"></script>
  <script>
    window.onload = () => SwaggerUIBundle({ url: '/api/v1/_openapi.json', dom_id: '#swagger-ui' });
  </script>
</body>
</html>`;
}

/**
 * The gate on the two public routes: an API key is decided by its scopes, and
 * everything else goes to the admin guard.
 *
 * An API key actor exists only while `api_keys` is on — `auth` resolves a
 * bearer token through that module's gated resolver — so with the module off a
 * bearer token is an anonymous caller and the admin guard answers it 401.
 */
export function createApiDescriptionGate(
  adminGate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply): Promise<void> => {
    // Undecorated in a composition that mounts no auth plugin; the admin guard
    // then answers 401, which is the closed end.
    const actor = (request as { actor?: FastifyRequest['actor'] }).actor;
    if (actor?.kind === 'api_key') {
      if (actor.scopes.includes(API_DESCRIPTION_PERMISSION)) return;
      throw new HttpError(
        403,
        ERROR_CODES.FORBIDDEN,
        `Missing permission: ${API_DESCRIPTION_PERMISSION}.`,
      );
    }
    await adminGate(request, reply);
  };
}
