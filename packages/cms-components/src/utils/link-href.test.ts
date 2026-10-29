import { describe, expect, it } from 'vitest';
import { resolveLinkHref } from './link-href.js';

/**
 * `specs/163-page-builder-marketing-pages/` research R-11 — one pure helper
 * turns every `LinkValue` kind into the address a block renders.
 */

const ASSET = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('resolveLinkHref', () => {
  it('maps a page, a product and a category to their storefront paths', () => {
    expect(resolveLinkHref({ kind: 'page', slug: 'about-us' })).toEqual({ href: '/about-us' });
    expect(resolveLinkHref({ kind: 'page', slug: '/company/team' })).toEqual({ href: '/company/team' });
    expect(resolveLinkHref({ kind: 'product', slug: 'acme widget' })).toEqual({ href: '/p/acme%20widget' });
    expect(resolveLinkHref({ kind: 'category', slug: 'widgets' })).toEqual({ href: '/c/widgets' });
  });

  it('maps an anchor to a fragment', () => {
    expect(resolveLinkHref({ kind: 'anchor', anchor: 'contact' })).toEqual({ href: '#contact' });
  });

  it('keeps a safe URL as it is', () => {
    expect(resolveLinkHref({ kind: 'url', href: 'https://example.com/offer' })).toEqual({
      href: 'https://example.com/offer',
    });
    expect(resolveLinkHref({ kind: 'url', href: 'mailto:hello@example.com' })).toEqual({
      href: 'mailto:hello@example.com',
    });
  });

  it('gives null for an unsafe URL', () => {
    expect(resolveLinkHref({ kind: 'url', href: 'javascript:alert(1)' })).toBeNull();
    expect(resolveLinkHref({ kind: 'url', href: 'data:text/html,x' })).toBeNull();
    expect(resolveLinkHref({ kind: 'url', href: '//example.com' })).toBeNull();
  });

  it('gives null for a missing link and an empty slug', () => {
    expect(resolveLinkHref(undefined)).toBeNull();
    expect(resolveLinkHref(null)).toBeNull();
    expect(resolveLinkHref({ kind: 'page', slug: '  ' })).toBeNull();
  });

  it('uses the asset URL from the render-time map first', () => {
    expect(
      resolveLinkHref(
        { kind: 'asset', fileAssetId: ASSET },
        { assets: { [ASSET]: { url: 'https://cdn.example.com/brochure.pdf' } }, mediaBaseUrl: 'https://api.example.com' },
      ),
    ).toEqual({ href: 'https://cdn.example.com/brochure.pdf' });
  });

  it('falls back to /assets/file/<id>, rebased by mediaBaseUrl', () => {
    expect(resolveLinkHref({ kind: 'asset', fileAssetId: ASSET })).toEqual({ href: `/assets/file/${ASSET}` });
    expect(
      resolveLinkHref({ kind: 'asset', fileAssetId: ASSET }, { assets: {}, mediaBaseUrl: 'https://api.example.com/' }),
    ).toEqual({ href: `https://api.example.com/assets/file/${ASSET}` });
  });

  it('adds rel="noopener noreferrer" to a _blank target', () => {
    expect(resolveLinkHref({ kind: 'url', href: 'https://example.com', target: '_blank' })).toEqual({
      href: 'https://example.com',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
    expect(resolveLinkHref({ kind: 'page', slug: 'about-us', target: '_self' })).toEqual({
      href: '/about-us',
      target: '_self',
    });
  });
});
