import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CMS_STOREFRONT_CACHE_TAGS, DEFAULT_BRAND_TOKENS, type CmsBrandTokens } from '@endora-commerce/contracts';
import { getBrandTokens } from '../../lib/api/brand';
import { StorefrontDocument } from '../../lib/theme/StorefrontDocument';
import { DEFAULT_STOREFRONT_THEME_CODE } from '../../lib/theme/instance-themes';

/**
 * Feature 163 — the brand tokens reach every storefront page as one
 * server-rendered `<style id="cmsb">` in the document head
 * (`specs/163-page-builder-marketing-pages/` research R-3, contract §1).
 *
 * - With tokens the tag is there, written by the same `brandTokensToCss` the
 *   admin preview uses; with no tokens (`cms` off: the read answers 404) it is
 *   absent, and the page builder's stylesheet falls back to today's literals.
 * - The CSS is text inside a `<style>`, so a stored value must never close it.
 * - `--cmsb-header-offset` is set either way: a section anchor scrolls to just
 *   below the sticky header whether or not a brand is configured (US1
 *   acceptance 2).
 */

vi.mock('next/headers', () => ({
  headers: async () => {
    throw new Error('`headers` was called outside a request scope.');
  },
}));

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const THEME = { code: DEFAULT_STOREFRONT_THEME_CODE, unknownRequest: null } as const;

function tokensWithPrimary(primary: string): CmsBrandTokens {
  return { ...DEFAULT_BRAND_TOKENS, colors: { ...DEFAULT_BRAND_TOKENS.colors, primary } };
}

function render(brandTokens: CmsBrandTokens | null): string {
  return renderToString(
    <StorefrontDocument lang="en-US" theme={THEME} brandTokens={brandTokens}>
      <div />
    </StorefrontDocument>,
  );
}

function headOf(html: string): string {
  return /<head>([\s\S]*)<\/head>/.exec(html)?.[1] ?? '';
}

describe('getBrandTokens', () => {
  it('reads the channel\'s effective set, cached under the brand tag', async () => {
    type Init = { headers?: Record<string, string>; next?: { revalidate?: number; tags?: string[] } };
    const calls: Array<{ url: string; init: Init }> = [];
    globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: (init ?? {}) as Init });
      return new Response(JSON.stringify({ data: tokensWithPrimary('#1d4ed8') }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const tokens = await getBrandTokens({ salesChannelCode: 'acme' });

    expect(tokens?.colors.primary).toBe('#1d4ed8');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/api\/v1\/storefront\/cms\/brand-tokens$/);
    expect(calls[0]!.init.next).toEqual({ revalidate: 300, tags: [CMS_STOREFRONT_CACHE_TAGS.brand] });
    const headers = Object.fromEntries(
      Object.entries(calls[0]!.init.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
    );
    expect(headers['x-sales-channel']).toBe('acme');
  });

  it('answers null when cms is off (404) or the read fails', async () => {
    for (const status of [404, 503]) {
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }), { status }),
      ) as unknown as typeof fetch;
      expect(await getBrandTokens({ salesChannelCode: 'acme' }), String(status)).toBeNull();
    }
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await getBrandTokens({ salesChannelCode: 'acme' })).toBeNull();
  });
});

describe('StorefrontDocument brand style', () => {
  it('renders <style id="cmsb"> in the head when tokens are present', () => {
    const head = headOf(render(tokensWithPrimary('#1d4ed8')));
    const style = /<style id="cmsb">([\s\S]*?)<\/style>/.exec(head);
    expect(style).not.toBeNull();
    expect(style![1]).toContain('--cmsb-color-primary:#1d4ed8;');
  });

  it('renders the font links beside it', () => {
    const tokens: CmsBrandTokens = {
      ...DEFAULT_BRAND_TOKENS,
      fonts: {
        heading: { kind: 'stylesheet', family: 'Acme Serif', generic: 'serif', url: 'https://fonts.example.com/acme.css' },
        body: {
          kind: 'asset',
          family: 'Acme Sans',
          generic: 'sans-serif',
          faces: [{ weight: 400, style: 'normal', fileAssetId: '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' }],
        },
      },
    };
    const head = headOf(render(tokens));
    expect(head).toMatch(/<link rel="stylesheet" href="https:\/\/fonts\.example\.com\/acme\.css"\/?>/);
    // Asset fonts are served by the backend: rebased onto the public API origin.
    expect(head).toMatch(
      /<link rel="preload" href="http:\/\/api\.test\/assets\/file\/6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" as="font" crossorigin="anonymous"\/?>/i,
    );
    expect(head).toContain('url("http://api.test/assets/file/6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d")');
  });

  it('renders no brand style when the tokens are null', () => {
    const html = render(null);
    expect(html).not.toContain('id="cmsb"');
    expect(html).not.toContain('--cmsb-color-');
  });

  it('cannot be broken out of by a stored value', () => {
    const hostile = {
      ...DEFAULT_BRAND_TOKENS,
      colors: { ...DEFAULT_BRAND_TOKENS.colors, primary: '</style><script>alert(1)</script>' },
      fonts: {
        heading: { kind: 'stylesheet', family: '</style><script>', generic: 'serif', url: 'https://fonts.example.com/a.css' },
        body: DEFAULT_BRAND_TOKENS.fonts.body,
      },
    } as unknown as CmsBrandTokens;
    const html = render(hostile);
    expect(html).not.toContain('<script>');
    expect(html.match(/<\/style>/g)?.length).toBe(html.match(/<style\b/g)?.length);
  });

  it('sets --cmsb-header-offset on :root with and without tokens', () => {
    for (const tokens of [tokensWithPrimary('#1d4ed8'), null]) {
      const head = headOf(render(tokens));
      expect(head, String(tokens !== null)).toMatch(/:root\s*\{\s*--cmsb-header-offset:\s*\d+px;?\s*\}/);
    }
  });
});
