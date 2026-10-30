import { cookies, headers } from 'next/headers';
import type { CmsBrandTokens, I18nConfigResponse } from '@endora-commerce/contracts';
import { getBrandTokens } from './api/brand';
import { getI18nConfig } from './api/i18n';
import { getPublicSalesChannel } from './api/sales-channel';
import { themeForChannel, type ResolvedStorefrontTheme } from './theme/theme';
import { getModulePresence, type ModulePresenceSet } from './api/module-presence';
import { resolvePageLocale } from './i18n/locale';
import { LANGUAGE_REQUEST_HEADER, type UrlLanguageState } from './i18n/locale-path';
import { getSessionCookie } from './session';
import type { RequestContext } from './api/client';
import { SALES_CHANNEL_REQUEST_HEADER } from './channel/channel-header';

/**
 * Per-request context resolution. Pages call `getRequestContext()` once
 * and pass the result down into `lib/api/*` calls so every backend
 * request carries the same Sales Channel + locale.
 *
 * The Sales Channel header is read from `X-Sales-Channel` so a reverse
 * proxy / multi-storefront deployment can stamp it per-host. When no proxy
 * stamps it, `middleware.ts` stamps the code of the channel the backend
 * resolves for this storefront, so the header is there on every request it
 * served (`specs/154-sales-channel-access/contracts/storefront-ux.md` §1.2).
 * Should the middleware have been unable to read that channel, the code of
 * the channel identity read here is used instead; only when neither is known
 * is the code left undefined and the backend resolves its default.
 */
export interface ServerContext {
  config: I18nConfigResponse;
  locale: string;
  /** Buyer-selected display currency (from the `currency` cookie), or undefined. */
  currency: string | undefined;
  ctx: RequestContext;
  /**
   * The effective enabled-set (feature 073). A page renders a module's
   * contribution only when this says the module is there; it never infers
   * absence from the module's API answering 503, because nearly every
   * storefront fetch already swallows errors into defaults and would keep
   * rendering an empty surface.
   */
  modules: ModulePresenceSet;
  /**
   * The token set this request renders in, resolved from the channel's
   * `themeCode` (feature `005-sales-channels`). Stamped onto `<html
   * data-theme>` by the root layout, server-side, so the first paint already
   * carries the channel's brand.
   *
   * The whole decision rather than the code alone: `unknownRequest` is what the
   * document element stamps as `data-theme-requested` when the channel named a
   * theme this storefront does not have (feature 102).
   */
  theme: ResolvedStorefrontTheme;
  /**
   * Whether this store serves anonymous visitors
   * (`specs/154-sales-channel-access/`). `false` only when the channel says so;
   * a channel that could not be read counts as open, because the backend
   * refuses on its own and the storefront must not invent a closed store.
   */
  anonymousAccess: boolean;
  /**
   * The channel's effective brand tokens (feature 163, research R-3), which the
   * root layout writes into `<style id="cmsb">`. `null` while `cms` is off or
   * when the read failed: the page builder then renders on its built-in look.
   */
  brandTokens: CmsBrandTokens | null;
  /**
   * The channel's URL languages and the language of this URL (feature 167) — what
   * `localizePath` needs to put the right prefix on every link and redirect. Empty
   * `languages` when the channel could not be read: links then stay as written.
   */
  urlState: UrlLanguageState;
}

export async function getServerContext(): Promise<ServerContext> {
  const h = await headers();
  const jar = await cookies();
  const stampedChannelCode = h.get(SALES_CHANNEL_REQUEST_HEADER) || undefined;

  // All three resolve on every page. Fetched together rather than in sequence
  // so neither presence nor the channel identity costs a round-trip on the
  // critical path (Constitution VII). The header read moved above this call
  // because the channel read is the one that has to carry `X-Sales-Channel` —
  // asking the backend which channel this is, without telling it, would get the
  // system default on every host.
  //
  // The brand tokens ride along (feature 163): the same channel signal, and a
  // read the first byte of HTML needs, so it is not a round-trip of its own.
  const channelSignal = stampedChannelCode !== undefined ? { salesChannelCode: stampedChannelCode } : {};
  const [config, modules, channel, brandTokens] = await Promise.all([
    getI18nConfig(),
    getModulePresence(),
    getPublicSalesChannel(channelSignal),
    getBrandTokens(channelSignal),
  ]);
  const salesChannelCode = stampedChannelCode ?? channel?.code;
  // A channel that could not be read is not a channel with no theme, but the
  // buyer-facing answer is the same one: the reference token set. See
  // `lib/theme/theme.ts` for what "refuses rather than guesses" means here.
  const theme = themeForChannel(channel?.themeCode ?? null, channel?.code ?? salesChannelCode);

  // Feature 167 (`specs/167-storefront-locale-path/`) — the page language is the
  // path's (OR-4). The middleware parsed the prefix and forwarded the language; it is
  // validated against the channel's own languages (FR-005), never the platform-wide
  // active list, and falls back to the channel default. The `lang` cookie and
  // `Accept-Language` decide nothing for a rendered page: the cookie only chooses
  // the target of the middleware's 307 for an unprefixed URL (OR-11).
  const currency = jar.get('currency')?.value || undefined;
  // Issue #265 — who is in front of the page, for the readers that carry a
  // price. Resolved once here rather than per call site so a page cannot ask
  // one surface as the buyer and the next as the public; `apiGetForViewer` is
  // the only reader that acts on it.
  const viewerSession = (await getSessionCookie()) ?? undefined;

  const urlLanguages = channel?.urlLanguages ?? [];
  const locale = resolvePageLocale({
    pathLanguage: h.get(LANGUAGE_REQUEST_HEADER),
    channelLanguages: urlLanguages.map((l) => l.languageCode),
    channelDefault: channel?.defaultLanguage ?? null,
    config,
  });

  return {
    config,
    locale,
    currency,
    modules,
    theme,
    anonymousAccess: channel?.anonymousAccess !== false,
    brandTokens,
    urlState: { languages: urlLanguages, aliases: channel?.urlLanguageAliases ?? [], current: locale },
    ctx: {
      ...(salesChannelCode !== undefined ? { salesChannelCode } : {}),
      locale,
      ...(currency !== undefined ? { currency } : {}),
      ...(viewerSession !== undefined ? { viewerSession } : {}),
    },
  };
}
