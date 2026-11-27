import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  hiddenProductIds,
  isNarrowed,
  isProductHidden as hiddenFrom,
  isVariantHidden,
  SYSTEM_PRODUCT_SCOPE,
  type AdminProductReadScope,
  type CatalogAdminProductVisibility,
  type HiddenProducts,
} from './services/admin-product-visibility.js';

/**
 * Spec 193 (FR-030, FR-035, R-7; threat model TM-1, TM-5) — **a hidden product answers exactly
 * as a product that does not exist**, on every catalog admin route that names one by id.
 *
 * ## Placement is the oracle question
 *
 * The platform moves a route's own `preHandler` chain to `preValidation`
 * (`guards-before-validation.ts`), and appends the API pre-interceptor dispatcher to the end of
 * the route-level `preHandler` chain (`interceptors/dispatch.ts`). This guard is a
 * **plugin-scope** `addHook('preHandler')` on the catalog's own route context, so it runs after
 * schema validation (a malformed body answers `400` for a hidden and a missing id alike) and
 * before the dispatcher (no other module's interceptor ever sees a hidden id).
 *
 * ## The route's own not-found
 *
 * Each route answers a missing product its own way — most `404 PRODUCT_NOT_FOUND`, a few with
 * their sub-resource's not-found (they look the sub-resource up under the product), one with an
 * empty list. {@link HIDDEN_ANSWERS} spells each, and the route-inventory contract test
 * (`test/contract/catalog/visibility-route-inventory.test.ts`) holds every route's hidden answer
 * equal to its missing-id answer, so the table cannot drift from the routes.
 *
 * A route that answers a missing product with something other than its not-found **before**
 * looking it up (a body it parses itself) is `'in-handler'`: the guard abstains and the handler
 * asks {@link CatalogRequestVisibility.assertProductVisible} at its own lookup.
 *
 * Hidden-versus-absent is logged at debug only; nothing in the answer tells them apart.
 */

/** A by-id route: its first path parameter after `/products/` is the product. */
const BY_ID = /^\/api\/v1\/admin\/catalog\/products\/:(id|productId)(?:\/|$)/;

type HiddenAnswer = (params: Readonly<Record<string, string>>) => HttpError | { readonly body: unknown };

const productNotFound: HiddenAnswer = () => new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
const variantNotFound: HiddenAnswer = (p) =>
  new HttpError(404, ERROR_CODES.NOT_FOUND, `Variant ${p['variantId']} not found under Product ${p['productId']}.`);

/**
 * The answer each route gives a product that does not exist, where it is not
 * `404 PRODUCT_NOT_FOUND` "Product not found." (the default).
 */
export const HIDDEN_ANSWERS: Readonly<Record<string, HiddenAnswer | 'in-handler'>> = {
  // Sub-resources looked up under the product: a missing product is a missing sub-resource.
  'DELETE /api/v1/admin/catalog/products/:id/links/:linkId': () =>
    new HttpError(404, ERROR_CODES.PRODUCT_LINK_NOT_FOUND, 'Product link not found.'),
  'DELETE /api/v1/admin/catalog/products/:id/url-redirects/:redirectId': (p) =>
    new HttpError(404, ERROR_CODES.URL_REDIRECT_NOT_FOUND, 'Redirect not found.', { redirectId: p['redirectId'] }),
  'PATCH /api/v1/admin/catalog/products/:productId/attachments/:attachmentId': () =>
    new HttpError(404, ERROR_CODES.ATTACHMENT_NOT_FOUND, 'Attachment not found.'),
  'DELETE /api/v1/admin/catalog/products/:productId/attachments/:attachmentId': () =>
    new HttpError(404, ERROR_CODES.ATTACHMENT_NOT_FOUND, 'Attachment not found.'),
  'PATCH /api/v1/admin/catalog/products/:productId/gallery/:itemId': () =>
    new HttpError(404, ERROR_CODES.GALLERY_ITEM_NOT_FOUND, 'Gallery item not found.'),
  'DELETE /api/v1/admin/catalog/products/:productId/gallery/:itemId': () =>
    new HttpError(404, ERROR_CODES.GALLERY_ITEM_NOT_FOUND, 'Gallery item not found.'),
  'PATCH /api/v1/admin/catalog/products/:productId/packaging-units/:unitId': (p) =>
    new HttpError(
      404,
      ERROR_CODES.PACKAGING_UNIT_NOT_FOUND,
      `Packaging unit ${p['unitId']} not found under Product ${p['productId']}.`,
    ),
  'DELETE /api/v1/admin/catalog/products/:productId/packaging-units/:unitId': (p) =>
    new HttpError(
      404,
      ERROR_CODES.PACKAGING_UNIT_NOT_FOUND,
      `Packaging unit ${p['unitId']} not found under Product ${p['productId']}.`,
    ),
  'PATCH /api/v1/admin/catalog/products/:productId/variants/:variantId': variantNotFound,
  'DELETE /api/v1/admin/catalog/products/:productId/variants/:variantId': variantNotFound,
  // Parses its own query (`kind`) and answers a missing product with an empty list.
  'GET /api/v1/admin/catalog/products/:id/links': 'in-handler',
  // Parse their own query or body (a malformed one answers 400 before the product is read).
  'PUT /api/v1/admin/catalog/products/:id/content/:attributeKey': 'in-handler',
  'GET /api/v1/admin/catalog/products/:id/scoped-values': 'in-handler',
  'PUT /api/v1/admin/catalog/products/:id/scoped-values': 'in-handler',
  'POST /api/v1/admin/catalog/products/:id/scoped-values/copy': 'in-handler',
  'PATCH /api/v1/admin/catalog/products/:id/scopes': 'in-handler',
  'PUT /api/v1/admin/catalog/products/:id/editor-preference': 'in-handler',
  'PUT /api/v1/admin/catalog/products/:id/url-keys': 'in-handler',
  // Parses its `kind`, then refuses the first link id the product does not hold — every one, for a
  // missing product.
  'PUT /api/v1/admin/catalog/products/:id/links/:kind/order': 'in-handler',
};

/** A hidden variant of a visible parent: the variant routes' own not-found (RQ-3 A, TM-6). */
const HIDDEN_VARIANT_ANSWERS: Readonly<Record<string, HiddenAnswer>> = {
  'PATCH /api/v1/admin/catalog/products/:productId/variants/:variantId': variantNotFound,
  'DELETE /api/v1/admin/catalog/products/:productId/variants/:variantId': variantNotFound,
};

/** What a request's handlers ask about visibility; the scope is resolved once per request. */
export interface CatalogRequestVisibility {
  /** The caller's scope — once per request, never across requests (FR-060). */
  scopeOf(request: FastifyRequest): Promise<AdminProductReadScope>;
  /**
   * For an `'in-handler'` route, asked at its own lookup: whether the product exists and is
   * hidden from the caller. The handler then answers exactly as it answers a missing product.
   */
  isProductHidden(request: FastifyRequest, productId: string): Promise<boolean>;
  /** Spec 193 (FR-080, FR-082) — which named products are hidden from this request's caller. */
  hiddenFor(request: FastifyRequest): HiddenProducts;
  /** {@link isProductHidden}, answered with `404 PRODUCT_NOT_FOUND` "Product not found." */
  refuseHiddenProduct(request: FastifyRequest, productId: string): Promise<void>;
}

export function createCatalogRequestVisibility(deps: {
  visibility: CatalogAdminProductVisibility | undefined;
  resolveAdminUserId: ((request: FastifyRequest) => string) | undefined;
  emFactory: () => EntityManager;
}): CatalogRequestVisibility {
  const scopes = new WeakMap<FastifyRequest, Promise<AdminProductReadScope>>();
  const scopeOf = (request: FastifyRequest): Promise<AdminProductReadScope> => {
    const { visibility, resolveAdminUserId } = deps;
    if (!visibility || !resolveAdminUserId) return Promise.resolve(SYSTEM_PRODUCT_SCOPE);
    let scope = scopes.get(request);
    if (!scope) {
      scope = visibility.scopeFor(resolveAdminUserId(request));
      scopes.set(request, scope);
    }
    return scope;
  };
  const isProductHidden = async (request: FastifyRequest, productId: string): Promise<boolean> => {
    if (!isUuidShape(productId)) return false;
    const scope = await scopeOf(request);
    return isNarrowed(scope) && (await hiddenFrom(deps.emFactory(), deps.visibility, scope, productId));
  };
  return {
    scopeOf,
    isProductHidden,
    hiddenFor: (request) => async (productIds) =>
      hiddenProductIds(deps.emFactory(), deps.visibility, await scopeOf(request), productIds),
    async refuseHiddenProduct(request, productId) {
      if (await isProductHidden(request, productId)) {
        request.log.debug({ route: request.routeOptions.url }, 'catalog: admin product hidden by visibility rules');
        throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
      }
    },
  };
}

/**
 * Install the guard on the catalog's route context. A no-op without visibility wiring (fixtures):
 * every scope is then the system scope.
 */
export function installHiddenProductGuard(
  app: FastifyInstance,
  deps: {
    visibility: CatalogAdminProductVisibility | undefined;
    requestVisibility: CatalogRequestVisibility;
    emFactory: () => EntityManager;
  },
): void {
  if (!deps.visibility) return;
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const url = request.routeOptions.url;
    if (!url) return;
    const match = BY_ID.exec(url);
    if (!match) return;
    const key = `${request.method === 'HEAD' ? 'GET' : request.method} ${url}`;
    const answer = HIDDEN_ANSWERS[key] ?? productNotFound;
    if (answer === 'in-handler') return;
    const params = (request.params ?? {}) as Record<string, string>;
    const productId = params[match[1]!];
    if (productId === undefined || !isUuidShape(productId)) return;
    const scope = await deps.requestVisibility.scopeOf(request);
    if (!isNarrowed(scope)) return;
    let hidden: HiddenAnswer | null = null;
    const em = deps.emFactory();
    if (await hiddenFrom(em, deps.visibility, scope, productId)) hidden = answer;
    else {
      const variantId = params['variantId'];
      const variantAnswer = HIDDEN_VARIANT_ANSWERS[key];
      if (variantAnswer && variantId !== undefined && isUuidShape(variantId) && (await isVariantHidden(em, deps.visibility, scope, productId, variantId))) {
        hidden = variantAnswer;
      }
    }
    if (!hidden) return;
    request.log.debug({ route: key }, 'catalog: admin product hidden by visibility rules');
    const out = hidden(params);
    if (out instanceof HttpError) throw out;
    return reply.send(out.body);
  });
}
