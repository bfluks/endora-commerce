import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  Actor,
  PublicSalesChannel,
  SalesChannelAccessResponse,
} from '@endora-commerce/contracts';
import {
  getResolvedChannel,
  type SalesChannelAccessPort,
  type SalesChannelResolutionPort,
  type SettingsReadPort,
} from '@endora-commerce/platform/kernel';

/**
 * Public read of the resolved sales channel.
 *
 *   GET /api/v1/storefront/sales-channel
 *
 * `PublicSalesChannelSchema` has existed since feature `005-sales-channels`
 * and its own doc block describes this endpoint as "what the storefront app
 * fetches on first paint to know its theme / language / currency". The schema
 * shipped; the route did not. Measured on 2026-08-29: the path appeared in the
 * repository exactly twice, in that comment and in the 005 prose contract, and
 * in no route registration anywhere — so `theme_code`, `logoAssetId`, and the
 * per-channel language and currency scopes had no way of reaching the buyer's
 * first paint at all.
 *
 * ## Channel resolution
 *
 * `getResolvedChannel()` — the sanctioned accessor (Constitution XII). The
 * resolver middleware has already filled the request scope from the api-key
 * binding, the `X-Sales-Channel` header, `?salesChannel`, the host map or the
 * system default, in that order; re-deriving any of that here would be a second
 * answer to a question the platform has already answered, and would be the
 * hand-rolled query Principle XII refuses. Nothing in this file reads
 * `sales_channels` or any bridge table.
 *
 * ## Why the module gate is not a hazard here
 *
 * `sales_channels` declares `activation.nonDeactivatable`, so the seam
 * `ctx.routes` wraps this registration in has no off state to take the
 * storefront's first paint down with. The route would still be the wrong place
 * for a fallback if it did: a buyer-facing page that cannot learn its channel
 * is answered by the storefront's own default theme, not by a backend that
 * invents a channel.
 */
export interface SalesChannelsStorefrontRoutesDeps {
  /** Feature 154 — the access rule, kernel-provided. */
  readonly accessPort: Pick<SalesChannelAccessPort, 'decide' | 'permittedChannelIds'>;
  /** Looks the permitted channels up by id, for their names. */
  readonly resolution: Pick<SalesChannelResolutionPort, 'getById'>;
  /** Reads `sales_channels.storefront_url` per channel. */
  readonly settings: Pick<SettingsReadPort, 'get'>;
}

const STOREFRONT_URL_SETTING = 'sales_channels.storefront_url';

export async function registerSalesChannelsStorefrontRoutes(
  app: FastifyInstance,
  deps: SalesChannelsStorefrontRoutesDeps,
): Promise<void> {
  // Feature 154 — reachable whatever the sales-channel access rule decides: a
  // storefront reads the channel's identity, `anonymousAccess` included, to know
  // that a visitor has to sign in before anything else is shown.
  app.get('/api/v1/storefront/sales-channel', { config: { salesChannelAccess: 'open' } }, async () => {
    const channel = getResolvedChannel();
    const data: PublicSalesChannel = {
      code: channel.code,
      name: channel.name,
      defaultLanguage: channel.defaultLanguage,
      defaultCurrency: channel.defaultCurrency,
      languages: [...channel.languages],
      currencies: [...channel.currencies],
      themeCode: channel.themeCode,
      // Null for the same reason the admin detail returns null: resolving an
      // asset id to an absolute URL needs the assets module, and this route is
      // not the merge request that adds that edge. `logoAssetId` is on the
      // admin shapes and the public schema deliberately carries a URL rather
      // than an id, so the two are answered together or not at all. Recorded
      // here rather than left to be rediscovered — the theme half of this
      // schema is the half this change makes true.
      logoUrl: null,
      anonymousAccess: channel.anonymousAccess,
    };
    return { data };
  });

  /**
   * May **this viewer** use the request's channel — feature 154,
   * `contracts/storefront-api.md` §2 (FR-012).
   *
   * The same decision the kernel's access step makes, through the same port,
   * reported rather than enforced: the route is open, so a refused visitor or
   * customer reads why instead of meeting another refusal. A customer viewer
   * also learns which active stores the account may use, with each store's
   * address where one is configured, so the storefront can point there.
   * Viewer-specific, hence `private, no-store`.
   */
  app.get(
    '/api/v1/storefront/sales-channel/access',
    { config: { salesChannelAccess: 'open' } },
    async (request: FastifyRequest, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      const channel = getResolvedChannel();
      const actor = request.actor as Actor | undefined;
      const base = { channelCode: channel.code, anonymousAccess: channel.anonymousAccess };

      if (actor === undefined || actor.kind === 'anonymous') {
        const decision = await deps.accessPort.decide({ kind: 'anonymous' }, channel);
        const data: SalesChannelAccessResponse['data'] = {
          ...base,
          viewer: 'anonymous',
          permitted: decision.ok,
          reason: decision.ok ? null : 'sign_in_required',
          permittedChannels: [],
        };
        return { data };
      }

      if (actor.kind !== 'customer') {
        // Administrators and API keys are not decided by the rule (D5).
        const data: SalesChannelAccessResponse['data'] = {
          ...base,
          viewer: 'other',
          permitted: true,
          reason: null,
          permittedChannels: [],
        };
        return { data };
      }

      const organizationId = actor.organizationId ?? '';
      const decision = await deps.accessPort.decide(
        { kind: 'customer', organizationId },
        channel,
      );
      const data: SalesChannelAccessResponse['data'] = {
        ...base,
        viewer: 'customer',
        permitted: decision.ok,
        reason: decision.ok ? null : 'not_permitted',
        permittedChannels:
          organizationId === '' ? [] : await permittedChannelsOf(deps, organizationId),
      };
      return { data };
    },
  );
}

/** The active channels an Organization may use, by code, with their storefront address. */
async function permittedChannelsOf(
  deps: SalesChannelsStorefrontRoutesDeps,
  organizationId: string,
): Promise<SalesChannelAccessResponse['data']['permittedChannels']> {
  const ids = [...(await deps.accessPort.permittedChannelIds(organizationId))];
  const channels = (await Promise.all(ids.map((id) => deps.resolution.getById(id))))
    .filter((c): c is NonNullable<typeof c> => c !== null && c.active)
    .sort((a, b) => a.code.localeCompare(b.code));
  return Promise.all(
    channels.map(async (c) => ({
      code: c.code,
      name: c.name,
      storefrontUrl: await storefrontUrlOf(deps, c.id),
    })),
  );
}

/** A channel's configured storefront address, or `null` when none (or none usable) is set. */
async function storefrontUrlOf(
  deps: SalesChannelsStorefrontRoutesDeps,
  channelId: string,
): Promise<string | null> {
  try {
    const value = await deps.settings.get(STOREFRONT_URL_SETTING, channelId, z.string());
    return z.string().url().safeParse(value.trim()).success ? value.trim() : null;
  } catch {
    // An unreadable value names no address; the store is still listed.
    return null;
  }
}
