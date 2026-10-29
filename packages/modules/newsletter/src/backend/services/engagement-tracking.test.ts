import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { SettingsReadPort } from '@endora-commerce/platform/kernel';
import { NEWSLETTER_SETTING_CODES } from '@endora-commerce/contracts';
import {
  applyEngagementTracking,
  newsletterTrackingLinks,
  resolveEngagementTracking,
} from './engagement-tracking.js';
import { NewsletterTokenHelper, matchesClickDestination } from './token.helper.js';

const BASE = 'https://api.shop.test';
const tokens = new NewsletterTokenHelper('engagement-secret');
const links = newsletterTrackingLinks(BASE);
const RECORD = '5b0f7b5e-0b8f-4a4b-9a57-1b9e8f1f2c3d';

function html(body: string): string {
  return `<!doctype html><html><body>${body}</body></html>`;
}

function hrefs(out: string): string[] {
  return [...out.matchAll(/<a\b[^>]*?\bhref="([^"]*)"/gi)].map((m) => m[1] ?? '');
}

function decodeAttr(value: string): string {
  return value.replace(/&amp;/g, '&');
}

describe('newsletter tracking links', () => {
  it('carries the token in the query string, not in a path segment', () => {
    expect(links.open('tok')).toBe(`${BASE}/api/v1/newsletter/open.gif?token=tok`);
    expect(links.click('tok', 'https://shop.test/a?b=1&c=2')).toBe(
      `${BASE}/api/v1/newsletter/click?token=tok&u=${encodeURIComponent('https://shop.test/a?b=1&c=2')}`,
    );
  });

  it('tolerates a trailing slash on the public base URL', () => {
    expect(newsletterTrackingLinks(`${BASE}/`).open('tok')).toBe(`${BASE}/api/v1/newsletter/open.gif?token=tok`);
  });
});

describe('applyEngagementTracking', () => {
  const both = { sendRecordId: RECORD, opens: true, clicks: true, tokens, links };

  it('adds an open pixel bound to the send record before </body>', () => {
    const out = applyEngagementTracking(html('<p>Hi</p>'), both);
    const match = out.match(/<img src="([^"]+)"[^>]*><\/body>/);
    expect(match).not.toBeNull();
    const src = decodeAttr(match?.[1] ?? '');
    expect(src.startsWith(`${BASE}/api/v1/newsletter/open.gif?token=`)).toBe(true);
    const token = decodeURIComponent(new URL(src).searchParams.get('token') ?? '');
    expect(tokens.verify(token, 'open')).toEqual({ id: RECORD });
  });

  it('rewrites an http(s) link to the click route with a token bound to its destination', () => {
    const dest = 'https://shop.test/deal?utm_source=newsletter&utm_medium=email';
    const escaped = dest.replace(/&/g, '&amp;');
    const out = applyEngagementTracking(html(`<a href="${escaped}" target="_blank">Deal</a>`), both);
    const [href] = hrefs(out);
    const url = new URL(decodeAttr(href ?? ''));
    expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/api/v1/newsletter/click`);
    expect(url.searchParams.get('u')).toBe(dest);
    const claims = tokens.verify(url.searchParams.get('token') ?? '', 'click');
    expect(claims?.id).toBe(RECORD);
    expect(claims?.linkId).toBe('link-1');
    expect(matchesClickDestination(dest, claims?.urlHash ?? '')).toBe(true);
    expect(out).toContain('target="_blank">Deal</a>');
  });

  it('numbers links in document order, so the same content yields the same link ids', () => {
    const body = '<a href="https://a.test/">A</a><a href=\'https://b.test/\'>B</a><a href="https://a.test/">A again</a>';
    const out = applyEngagementTracking(html(body), both);
    const ids = hrefs(out.replace(/href='/g, 'href="').replace(/'>/g, '">')).map(
      (h) => tokens.verify(new URL(decodeAttr(h)).searchParams.get('token') ?? '', 'click')?.linkId,
    );
    expect(ids).toEqual(['link-1', 'link-2', 'link-3']);
  });

  it('leaves mailto:, tel:, anchors and the module’s own links untouched', () => {
    const own = [
      `${BASE}/api/v1/newsletter/unsubscribe?token=abc`,
      `${BASE}/api/v1/newsletter/confirm?token=abc`,
      `${BASE}/api/v1/newsletter/click?token=abc&amp;u=x`,
    ];
    const untouched = ['mailto:hello@shop.test', 'tel:+48123456789', '#top', '/relative', ...own];
    const body = untouched.map((h) => `<a href="${h}">x</a>`).join('');
    const out = applyEngagementTracking(html(body), { ...both, opens: false });
    expect(out).toBe(html(body));
  });

  it('changes nothing when both kinds of tracking are off', () => {
    const body = '<a href="https://shop.test/">Shop</a>';
    expect(applyEngagementTracking(html(body), { ...both, opens: false, clicks: false })).toBe(html(body));
  });

  it('adds only the pixel when click tracking is off', () => {
    const body = '<a href="https://shop.test/">Shop</a>';
    const out = applyEngagementTracking(html(body), { ...both, clicks: false });
    expect(hrefs(out)).toEqual(['https://shop.test/']);
    expect(out).toContain('/api/v1/newsletter/open.gif?token=');
  });

  it('rewrites links only when open tracking is off', () => {
    const out = applyEngagementTracking(html('<a href="https://shop.test/">Shop</a>'), { ...both, opens: false });
    expect(out).not.toContain('open.gif');
    expect(hrefs(out)[0]).toContain('/api/v1/newsletter/click?token=');
  });

  it('appends the pixel when the document has no </body>', () => {
    const out = applyEngagementTracking('<p>fragment</p>', { ...both, clicks: false });
    expect(out.startsWith('<p>fragment</p><img src="')).toBe(true);
  });
});

describe('resolveEngagementTracking', () => {
  function settingsWith(values: Record<string, unknown>, seen: Array<string | null> = []): SettingsReadPort {
    return {
      get: async <T>(code: string, channelId: string | null, schema: z.ZodType<T>) => {
        seen.push(channelId);
        if (!(code in values)) throw new Error(`not registered: ${code}`);
        return schema.parse(values[code]);
      },
      getMany: async () => new Map(),
    };
  }

  it('reads both switches for the given channel', async () => {
    const seen: Array<string | null> = [];
    const settings = settingsWith(
      {
        [NEWSLETTER_SETTING_CODES.TRACKING_OPENS_ENABLED]: true,
        [NEWSLETTER_SETTING_CODES.TRACKING_CLICKS_ENABLED]: false,
      },
      seen,
    );
    expect(await resolveEngagementTracking(settings, 'chan-1')).toEqual({ opens: true, clicks: false });
    expect(seen).toEqual(['chan-1', 'chan-1']);
  });

  it('tracks nothing a switch cannot be read for', async () => {
    const settings = settingsWith({ [NEWSLETTER_SETTING_CODES.TRACKING_OPENS_ENABLED]: true });
    expect(await resolveEngagementTracking(settings, null)).toEqual({ opens: true, clicks: false });
  });
});
