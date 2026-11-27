import { z } from 'zod';
import { NEWSLETTER_SETTING_CODES } from '@endora-commerce/contracts';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { clickDestinationHash, type NewsletterTokenHelper } from './token.helper.js';

/**
 * Campaign engagement tracking at send time (feature 048, US6): the open pixel
 * and the click redirect a campaign e-mail carries, minted per send record.
 * The public routes that receive them are in `routes.storefront.ts`.
 */

/** Open and click tokens stay valid as long as unsubscribe links do: one year. */
export const TRACKING_TOKEN_TTL_SECONDS = 365 * 24 * 3600;

/** The module's public route prefix; links under it are never rewritten. */
const NEWSLETTER_PUBLIC_PATH = '/api/v1/newsletter/';

export interface NewsletterTrackingLinks {
  /** The open pixel's absolute URL for a signed `open` token. */
  open(token: string): string;
  /** The click redirect's absolute URL for a signed `click` token and its destination. */
  click(token: string, destination: string): string;
  /**
   * Whether `url` already leads to this module's own public routes —
   * unsubscribe, confirm, or the trackers themselves.
   */
  isOwn(url: string): boolean;
}

/**
 * Builds the tracker URLs on the public API base the unsubscribe and confirm
 * links already use. The token travels in the query string: a signed token is
 * longer than the router's path-parameter limit.
 */
export function newsletterTrackingLinks(publicBaseUrl: string): NewsletterTrackingLinks {
  const base = publicBaseUrl.replace(/\/+$/, '');
  const own = `${base}${NEWSLETTER_PUBLIC_PATH}`;
  return {
    open: (token) => `${own}open.gif?token=${encodeURIComponent(token)}`,
    click: (token, destination) =>
      `${own}click?token=${encodeURIComponent(token)}&u=${encodeURIComponent(destination)}`,
    isOwn: (url) => url.startsWith(own),
  };
}

export interface EngagementTrackingSwitches {
  opens: boolean;
  clicks: boolean;
}

export interface EngagementTrackingOptions extends EngagementTrackingSwitches {
  /** The send record the open and click events are recorded against. */
  sendRecordId: string;
  tokens: NewsletterTokenHelper;
  links: NewsletterTrackingLinks;
}

const ATTR_DECODE: Record<string, string> = {
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

function decodeAttr(value: string): string {
  return value.replace(/&(?:amp|quot|#39|#x27|lt|gt);/gi, (m) => ATTR_DECODE[m.toLowerCase()] ?? m);
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** `href` attributes of `<a>` tags, single- or double-quoted. */
const ANCHOR_HREF = /(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gis;

/**
 * Adds the open pixel and rewrites every absolute http(s) link of a rendered
 * campaign e-mail to the click redirect. `mailto:`, `tel:`, in-page anchors,
 * relative links and links to this module's own routes stay as they are.
 *
 * Link ids number the tracked links in document order (`link-1`, `link-2`, …),
 * so every recipient of one campaign gets the same id for the same link.
 */
export function applyEngagementTracking(html: string, options: EngagementTrackingOptions): string {
  let out = html;
  if (options.clicks) {
    let index = 0;
    out = out.replace(ANCHOR_HREF, (whole, prefix: string, quote: string, raw: string) => {
      const destination = decodeAttr(raw.trim());
      if (!/^https?:\/\//i.test(destination) || options.links.isOwn(destination)) return whole;
      index += 1;
      const token = options.tokens.mint(
        'click',
        {
          id: options.sendRecordId,
          linkId: `link-${index}`,
          urlHash: clickDestinationHash(destination),
        },
        TRACKING_TOKEN_TTL_SECONDS,
      );
      return `${prefix}${quote}${escapeAttr(options.links.click(token, destination))}${quote}`;
    });
  }
  if (options.opens) {
    const token = options.tokens.mint('open', { id: options.sendRecordId }, TRACKING_TOKEN_TTL_SECONDS);
    const pixel =
      `<img src="${escapeAttr(options.links.open(token))}" width="1" height="1" alt="" ` +
      'style="display:block;border:0;width:1px;height:1px;" />';
    const bodyEnd = out.search(/<\/body>/i);
    out = bodyEnd === -1 ? `${out}${pixel}` : `${out.slice(0, bodyEnd)}${pixel}${out.slice(bodyEnd)}`;
  }
  return out;
}

async function readSwitch(
  settings: SettingsReadPort,
  code: string,
  salesChannelId: string | null,
): Promise<boolean> {
  try {
    return await settings.get(code, salesChannelId, z.boolean());
  } catch {
    // A switch that cannot be read tracks nothing.
    return false;
  }
}

/**
 * The operator's two tracking switches for a campaign's sales channel (`null`
 * reads the platform-wide value).
 */
export async function resolveEngagementTracking(
  settings: SettingsReadPort,
  salesChannelId: string | null,
): Promise<EngagementTrackingSwitches> {
  const opens = await readSwitch(settings, NEWSLETTER_SETTING_CODES.TRACKING_OPENS_ENABLED, salesChannelId);
  const clicks = await readSwitch(settings, NEWSLETTER_SETTING_CODES.TRACKING_CLICKS_ENABLED, salesChannelId);
  return { opens, clicks };
}
