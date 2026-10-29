import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import type { StorefrontResolver } from './services/storefront-resolver.js';
import type { CmsBrandTokensService } from './services/brand-tokens-service.js';

/**
 * The request's sales channel, resolved once by the canonical resolver
 * middleware (feature 053 / FR-002). Storefront modules read this instead of
 * re-parsing the `x-sales-channel` header.
 */
function resolvedChannel(request: FastifyRequest): {
  id: string;
  code: string;
  defaultLanguage: string;
} {
  const ch = getResolvedChannel(request);
  return { id: ch.id, code: ch.code, defaultLanguage: ch.defaultLanguage };
}

export async function registerCmsStorefrontRoutes(
  app: FastifyInstance,
  deps: { storefrontResolver: StorefrontResolver; brandTokensService: CmsBrandTokensService },
): Promise<void> {
  /**
   * Feature 163 — the brand tokens every storefront page is styled from
   * (`contracts/storefront-and-admin-api.md` §1, research R-3).
   *
   * The channel is the request's resolved one, which always resolves and falls
   * back to the system default; its own set wins, then the global set, then
   * the built-in defaults — so one channel's override is never served on
   * another (Principle XII). Public and briefly cacheable: the storefront also
   * keeps it in its Data Cache under `cms:brand`, revalidated on every write.
   *
   * Reachable whatever the sales-channel access rule decides (feature 154): a
   * store closed to anonymous visitors still styles its sign-in page with its
   * brand. Brand tokens are presentation, not data.
   */
  app.get('/api/v1/storefront/cms/brand-tokens', { config: { salesChannelAccess: 'open' } }, async (request, reply) => {
    const tokens = await deps.brandTokensService.effective(resolvedChannel(request).id);
    reply.header('cache-control', 'public, max-age=60');
    return { data: tokens };
  });

  app.get('/api/v1/cms/pages/by-slug', async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const slug = query['slug'];
    if (!slug) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Missing CMS page slug.');
    }

    const page = await deps.storefrontResolver.resolvePageBySlug({
      slug,
      resolvedChannel: resolvedChannel(request),
      language: query['language'] ?? readHeader(request.headers['accept-language'])?.split(',')[0],
    });
    if (!page) {
      throw new HttpError(404, ERROR_CODES.CMS_PAGE_NOT_FOUND, 'CMS Page not found.');
    }
    return { data: page };
  });

  /**
   * The published pages of this request's sales channel, so the shop can tell a
   * crawler they exist (feature 105, FR-021; `contracts/cms-page-url.md` §4.1).
   *
   * Until this endpoint the storefront advertised **no CMS URL at all**: the
   * sitemap's `SITEMAP_DYNAMIC_ROUTES` names `/[...slug]` as a route *pattern*
   * for the check's reconciliation, and nothing enumerated the rows behind it.
   *
   * The admin listing is not the answer to that and could not be: it is
   * `cms.read`-gated, is not scoped to the request's channel, and returns
   * drafts and archived pages, so a sitemap built from it would advertise
   * unpublished content (`research.md` D-6).
   *
   * It takes no language, unlike the three lookups around it. A sitemap carries
   * addresses, and a page's address is the same in every language it is served
   * in; the language is resolved when the document is fetched, by `by-slug`.
   */
  app.get('/api/v1/cms/pages/by-channel', async (request) => {
    const pages = await deps.storefrontResolver.listPublishedPages({
      resolvedChannel: resolvedChannel(request),
    });
    return { data: { pages } };
  });

  app.get('/api/v1/cms/blocks/by-code', async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const code = query['code'];
    if (!code) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Missing CMS block code.');
    }

    const block = await deps.storefrontResolver.resolveBlockByCode({
      code,
      resolvedChannel: resolvedChannel(request),
      language: query['language'] ?? readHeader(request.headers['accept-language'])?.split(',')[0],
    });
    if (!block) {
      throw new HttpError(404, ERROR_CODES.CMS_BLOCK_NOT_FOUND, 'CMS Block not found.');
    }
    return { data: block };
  });

  app.get('/api/v1/cms/hooks/by-code', async (request) => {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const code = query['code'];
    if (!code) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Missing CMS hook code.');
    }

    const hook = await deps.storefrontResolver.resolveHookByCode({
      code,
      resolvedChannel: resolvedChannel(request),
      language: query['language'] ?? readHeader(request.headers['accept-language'])?.split(',')[0],
    });
    if (!hook) {
      throw new HttpError(404, ERROR_CODES.CMS_HOOK_NOT_FOUND, 'CMS Hook not found.');
    }
    return { data: hook };
  });
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
