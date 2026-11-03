import type { FastifyInstance } from 'fastify';
import {
  newsletterSubscribeRequestSchema,
  publicUnsubscribeRequestSchema,
  ERROR_CODES,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { NewsletterSubscriberService } from './services/subscriber.service.js';
import type { NewsletterOptInService } from './services/opt-in.service.js';
import { matchesClickDestination, type NewsletterTokenHelper } from './services/token.helper.js';
import type { NewsletterTrackingService } from './services/tracking.service.js';

/** 1×1 transparent GIF for open tracking. */
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

export interface NewsletterStorefrontDeps {
  subscribers: NewsletterSubscriberService;
  optIn: NewsletterOptInService;
  tokens: NewsletterTokenHelper;
  tracking: NewsletterTrackingService;
  /** Resolve a sales-channel code to its id; null when unknown. */
  resolveChannelIdByCode: (code: string) => Promise<string | null>;
  /** The channel a request with no `?channel=` belongs to; null = none. */
  resolveDefaultChannelId: () => Promise<string | null>;
  /** Storefront base used for post-confirm/unsubscribe redirects. */
  storefrontBaseUrl: string;
  /**
   * Feature 167 (FR-034) — a storefront page path under the language prefix of the
   * subscriber's channel (its default language: a subscriber records none). Absent,
   * or for no subscriber: the logical path.
   */
  subscriberPagePath?: (subscriberId: string | null, path: string) => Promise<string>;
}

/**
 * Public storefront newsletter routes (feature 048, US1/US9). Mutating routes
 * never reveal whether an email already exists (no enumeration). Wrapped by
 * `defineModuleRoutes` in plugin.ts so they 503 when the module is disabled.
 */
export async function registerNewsletterStorefrontRoutes(
  app: FastifyInstance,
  deps: NewsletterStorefrontDeps,
): Promise<void> {
  const pagePath = (subscriberId: string | null, path: string): Promise<string> =>
    deps.subscriberPagePath ? deps.subscriberPagePath(subscriberId, path) : Promise.resolve(path);

  app.get('/api/v1/newsletter/status', async (request, reply) => {
    const { channel } = request.query as { channel?: string };
    const channelId = channel ? await deps.resolveChannelIdByCode(channel) : null;
    const optInMode = await deps.optIn.resolveMode(channelId ?? (await deps.resolveDefaultChannelId()));
    return reply.send({ data: { enabled: true, optInMode } });
  });

  app.post('/api/v1/newsletter/subscribe', async (request, reply) => {
    const body = newsletterSubscribeRequestSchema.parse(request.body);
    const channelId = await deps.resolveChannelIdByCode(body.channelCode);
    if (!channelId) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'Unknown sales channel.', {
        code: 'unknown_channel',
      });
    }
    const result = await deps.subscribers.subscribe({
      email: body.email,
      salesChannelId: channelId,
      source: body.source ?? 'storefront',
      ...(body.tags ? { tags: body.tags } : {}),
      ...(body.customFields ? { customFields: body.customFields } : {}),
    });
    return reply.send({ data: result });
  });

  // Feature 154 — the confirmation, unsubscribe and tracking links below are
  // opened from an e-mail, with no storefront channel signal, so they are
  // reachable whatever the sales-channel access rule decides.
  app.get('/api/v1/newsletter/confirm', { config: { salesChannelAccess: 'open' } }, async (request, reply) => {
    const { token } = request.query as { token?: string };
    const claims = token ? deps.tokens.verify(token, 'confirm') : null;
    if (claims) await deps.subscribers.confirm(claims.id);
    const status = claims ? 'ok' : 'invalid';
    const path = await pagePath(claims?.id ?? null, `/newsletter/confirm?status=${status}`);
    return reply.redirect(`${deps.storefrontBaseUrl}${path}`);
  });

  app.get('/api/v1/newsletter/unsubscribe', { config: { salesChannelAccess: 'open' } }, async (request, reply) => {
    const { token } = request.query as { token?: string };
    const claims = token ? deps.tokens.verify(token, 'unsubscribe') : null;
    const valid = claims !== null;
    const path = await pagePath(
      claims?.id ?? null,
      `/newsletter/unsubscribe?token=${encodeURIComponent(token ?? '')}&valid=${valid}`,
    );
    return reply.redirect(`${deps.storefrontBaseUrl}${path}`);
  });

  app.post('/api/v1/newsletter/unsubscribe', { config: { salesChannelAccess: 'open' } }, async (request, reply) => {
    const body = publicUnsubscribeRequestSchema.parse(request.body);
    const claims = deps.tokens.verify(body.token, 'unsubscribe');
    if (claims) await deps.subscribers.unsubscribe(claims.id, body.reason);
    // Always neutral — invalid tokens look the same as success.
    return reply.send({ data: { ok: true } });
  });

  // --- Engagement tracking (US6) -----------------------------------------
  // The signed token travels in the query string: it is longer than the
  // router's default path-parameter limit (`maxParamLength`, 100 characters),
  // which answers 414 before a handler runs. The URLs are minted at send time
  // by `services/engagement-tracking.ts`.
  app.get('/api/v1/newsletter/open.gif', { config: { streamingResponse: true, salesChannelAccess: 'open' } }, async (request, reply) => {
    const { token } = request.query as { token?: string };
    const claims = typeof token === 'string' && token ? deps.tokens.verify(token, 'open') : null;
    if (claims) await deps.tracking.recordOpen(claims.id);
    reply.header('content-type', 'image/gif');
    reply.header('cache-control', 'no-store, no-cache, must-revalidate, private');
    return reply.send(TRACKING_PIXEL);
  });

  app.get('/api/v1/newsletter/click', { config: { salesChannelAccess: 'open' } }, async (request, reply) => {
    const { token, u } = request.query as { token?: string; u?: string };
    const claims = typeof token === 'string' && token ? deps.tokens.verify(token, 'click') : null;
    if (!claims) {
      return reply.status(410).send({ error: { code: 'GONE', message: 'Invalid link.' } });
    }
    // Redirect only to the destination the token was minted for: `u` must be
    // an absolute http(s) URL whose digest the token carries. A valid token
    // that binds no destination, or a `u` that does not match its binding,
    // lands on the storefront home page instead.
    const dest =
      typeof u === 'string' &&
      /^https?:\/\//i.test(u) &&
      claims.urlHash !== undefined &&
      matchesClickDestination(u, claims.urlHash)
        ? u
        : null;
    await deps.tracking.recordClick(claims.id, claims.linkId ?? null, dest);
    return reply.redirect(dest ?? `${deps.storefrontBaseUrl}/`);
  });
}
