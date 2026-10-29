// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { Render, type ComponentConfig, type Config, type Data } from '@puckeditor/core';
import { describe, expect, it, vi } from 'vitest';
import { defaultPageBuilderConfig } from '../index.js';
import { CmsRenderProvider } from './render-context.js';
import { markerPopup } from './Map.js';

vi.hoisted(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/**
 * `specs/163-page-builder-marketing-pages/` R17 (T212) — the image, icon, logo
 * and announcement-bar links are the shared `LinkValue` (a page, a product, a
 * category, a file, a section or a URL, with "Open in new tab"), as every
 * newer block's link is. A URL stored before (`href`, with the image's and the
 * icon's `linkTarget`; a logo always opened a new tab) reads as a link of kind
 * `url` with the same target, and renders byte for byte as before; the editor
 * carries it into `link` when the block is opened.
 */

const config = defaultPageBuilderConfig as Config;

function html(type: string, props: Record<string, unknown>): string {
  const defaults = (config.components[type]?.defaultProps ?? {}) as Record<string, unknown>;
  const data = { root: { props: {} }, content: [{ type, props: { ...defaults, id: `${type}-1`, ...props } }] } as unknown as Data;
  return renderToString(
    <CmsRenderProvider embeds={{ blocks: {}, templates: {} }} mediaBaseUrl="https://api.example.com">
      <Render config={config} data={data} />
    </CmsRenderProvider>,
  );
}

async function carried(type: string, props: Record<string, unknown>): Promise<Record<string, unknown>> {
  const component = config.components[type] as ComponentConfig;
  const defaults = (component.defaultProps ?? {}) as Record<string, unknown>;
  const result = await component.resolveData!({ props: { ...defaults, id: `${type}-1`, ...props } } as never, { changed: {}, lastData: null, metadata: {}, trigger: 'load' } as never);
  return (result as { props: Record<string, unknown> }).props;
}

function anchor(markup: string): HTMLAnchorElement {
  const host = document.createElement('div');
  host.innerHTML = markup;
  const found = host.querySelector('a');
  if (!found) throw new Error(`no link in:\n${markup}`);
  return found;
}

const IMAGE = { imageSource: 'url', src: 'https://example.com/a.jpg', alt: 'A' };
const LOGOS = (item: Record<string, unknown>) => ({ items: [{ imageSource: 'url', src: 'https://example.com/logo.png', alt: 'Partner', ...item }] });

describe('a URL stored before reads as a URL link (T212)', () => {
  it.each([
    ['cms.Image', { ...IMAGE, href: '/contact', linkTarget: '_blank' }, { href: '/contact', target: '_blank', rel: 'noreferrer' }],
    // R18 (T221) deliberately changed: `contact.html` → `/contact.html` (a scheme-less relative path is refused by the shared rule).
    ['cms.Image', { ...IMAGE, href: '/contact.html', linkTarget: '_self' }, { href: '/contact.html', target: '_self', rel: null }],
    ['cms.Icons', { name: 'star', href: '/x', linkTarget: '_blank' }, { href: '/x', target: '_blank', rel: 'noreferrer' }],
    ['cms.LogoStrip', LOGOS({ href: 'https://partner.example.com' }), { href: 'https://partner.example.com', target: '_blank', rel: 'noopener noreferrer' }],
    ['cms.AnnouncementBar', { text: 'Sale', href: '/sale' }, { href: '/sale', target: null, rel: null }],
  ])('%s: renders the link it always rendered', (type, props, expected) => {
    const link = anchor(html(type, props));
    expect(link.getAttribute('href')).toBe(expected.href);
    expect(link.getAttribute('target')).toBe(expected.target);
    expect(link.getAttribute('rel')).toBe(expected.rel);
  });

  it.each([
    ['cms.Image', { ...IMAGE, href: '/contact', linkTarget: '_blank' }],
    ['cms.Image', { ...IMAGE, href: '/contact', linkTarget: '_self' }],
    ['cms.Icons', { name: 'star', href: '/x', linkTarget: '_self' }],
    ['cms.LogoStrip', LOGOS({ href: 'https://partner.example.com' })],
    ['cms.AnnouncementBar', { text: 'Sale', href: '/sale' }],
  ])('%s: the editor carries the URL into `link`, and the page renders byte for byte the same', async (type, props) => {
    const before = html(type, props);
    const next = await carried(type, props);
    const link = (type === 'cms.LogoStrip' ? (next['items'] as Array<Record<string, unknown>>)[0]!['link'] : next['link']) as { kind?: string };
    expect(link?.kind).toBe('url');
    expect(html(type, next)).toBe(before);
  });
});

describe('any kind of link (T212)', () => {
  it.each([
    ['cms.Image', { ...IMAGE, link: { kind: 'page', slug: 'about' } }],
    ['cms.Icons', { name: 'star', link: { kind: 'page', slug: 'about' } }],
    ['cms.LogoStrip', LOGOS({ link: { kind: 'page', slug: 'about' } })],
    ['cms.AnnouncementBar', { text: 'Sale', link: { kind: 'page', slug: 'about' } }],
  ])('%s: a page link', (type, props) => {
    expect(anchor(html(type, props)).getAttribute('href')).toBe('/about');
  });

  it('a new image starts with no link, and a link with no address renders none', () => {
    expect(block('cms.Image').defaultProps).not.toHaveProperty('href');
    expect(html('cms.Image', { ...IMAGE, link: { kind: 'url', href: '' } })).not.toContain('<a ');
  });

  it('a map marker stored with a URL keeps it as a link, and a marker may link to a page', async () => {
    const markers = [{ lat: 1, lng: 2, label: 'Office', link: '/contact' }];
    const next = await carried('cms.Map', { markers });
    expect((next['markers'] as Array<{ link?: unknown }>)[0]?.link).toEqual({ kind: 'url', href: '/contact' });
  });
});

function block(name: string): ComponentConfig {
  return config.components[name] as ComponentConfig;
}

/**
 * R18 (T221, owner decision): a URL in these blocks passes the same safe-URL
 * rule as every other link (`isSafeLinkUrl`, through `resolveLinkHref`). An
 * unsafe one renders no link — the image, icon, logo, text or marker label
 * stays, unlinked — whether it was stored as `href` before R17 or as a `url`
 * link since; a safe one renders as before.
 */
describe('an unsafe URL renders no link (R18, T221)', () => {
  const UNSAFE = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:msgbox(1)', '//evil.example.com'];
  const CONTENT: Record<string, string> = {
    'cms.Image': 'src="https://example.com/a.jpg"',
    'cms.Icons': '<svg',
    'cms.LogoStrip': 'src="https://example.com/logo.png"',
    'cms.AnnouncementBar': 'Sale',
  };
  const legacy = (type: string, href: string): Record<string, unknown> =>
    type === 'cms.Image'
      ? { ...IMAGE, href, linkTarget: '_blank' }
      : type === 'cms.Icons'
        ? { name: 'star', href, linkTarget: '_blank' }
        : type === 'cms.LogoStrip'
          ? LOGOS({ href })
          : { text: 'Sale', href };
  const current = (type: string, href: string): Record<string, unknown> => {
    const link = { kind: 'url', href, target: '_blank' };
    if (type === 'cms.Image') return { ...IMAGE, link };
    if (type === 'cms.Icons') return { name: 'star', link };
    if (type === 'cms.LogoStrip') return LOGOS({ link });
    return { text: 'Sale', link };
  };
  const cases = Object.keys(CONTENT).flatMap((type) => UNSAFE.map((href) => [type, href] as const));

  it.each(cases)('%s: a stored `href` of %s', (type, href) => {
    const markup = html(type, legacy(type, href));
    expect(markup).not.toContain('<a ');
    expect(markup).toContain(CONTENT[type]);
  });

  it.each(cases)('%s: a `url` link to %s', (type, href) => {
    const markup = html(type, current(type, href));
    expect(markup).not.toContain('<a ');
    expect(markup).toContain(CONTENT[type]);
  });

  it.each(UNSAFE)('cms.Map: a marker linked to %s shows its label unlinked (stored string and `url` link)', (href) => {
    expect(markerPopup({ label: 'Office', link: href }, {})).toBe('Office');
    expect(markerPopup({ label: 'Office', link: { kind: 'url', href } }, {})).toBe('Office');
  });

  it.each([
    ['cms.Image', 'https://example.com/offer'],
    ['cms.Image', 'mailto:hello@example.com'],
    ['cms.Icons', 'tel:+48123456789'],
    ['cms.LogoStrip', 'http://partner.example.com/'],
    ['cms.AnnouncementBar', '/sale?from=bar#top'],
  ])('%s: a safe URL %s renders as it always did, stored either way', (type, href) => {
    const before = html(type, legacy(type, href));
    expect(anchor(before).getAttribute('href')).toBe(href);
    expect(anchor(html(type, current(type, href))).getAttribute('href')).toBe(href);
  });

  it('a scheme-less relative path or a bare fragment is refused, as the shared rule refuses it in every other link', () => {
    expect(html('cms.Image', { ...IMAGE, href: 'contact.html' })).not.toContain('<a ');
    expect(html('cms.AnnouncementBar', { text: 'Sale', link: { kind: 'url', href: '#offer' } })).not.toContain('<a ');
  });

  it('cms.Map: a marker linked to a safe URL keeps its link', () => {
    const popup = markerPopup({ label: 'Office', link: '/contact' }, {}) as HTMLAnchorElement;
    expect(popup.getAttribute('href')).toBe('/contact');
    expect(popup.textContent).toBe('Office');
  });
});

/**
 * R18 (T221, audit): `cms.Social` wrote each profile URL as typed. It keeps a
 * plain URL per item, so an unsafe one is treated as the item's missing URL —
 * the `#` placeholder the block already rendered for an empty one (the icon
 * and its accessible name stay); a safe one is written as before.
 */
describe('cms.Social: an unsafe profile URL is no URL (R18, T221)', () => {
  const social = (url: string): string => html('cms.Social', { items: [{ network: 'facebook', label: 'Facebook', url }] });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '//evil.example.com'])('%s renders the empty placeholder', (url) => {
    expect(anchor(social(url)).getAttribute('href')).toBe('#');
  });

  it.each(['https://www.facebook.com/example', 'mailto:hello@example.com', '/contact'])('%s renders as before', (url) => {
    expect(anchor(social(url)).getAttribute('href')).toBe(url);
  });

  it('an empty URL keeps the placeholder', () => {
    expect(anchor(social('')).getAttribute('href')).toBe('#');
  });
});
