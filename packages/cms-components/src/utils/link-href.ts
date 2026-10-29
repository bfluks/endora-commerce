import {
  SECTION_ANCHOR_RE,
  isSafeLinkUrl,
  normalizeAnchor,
  type LinkTarget,
  type LinkValue,
} from '@endora-commerce/page-builder-core';
import { absolutizeMediaUrl } from './resolve-image-url.js';

/** What a link needs from the render environment: the asset map and the API origin. */
export interface LinkHrefEnv {
  assets?: Record<string, { url: string }>;
  mediaBaseUrl?: string | undefined;
}

/** The attributes of a rendered link. */
export interface ResolvedLink {
  href: string;
  target?: LinkTarget;
  rel?: string;
}

function withTarget(href: string, target: LinkTarget | undefined): ResolvedLink {
  if (target === '_blank') return { href, target, rel: 'noopener noreferrer' };
  return target ? { href, target } : { href };
}

/**
 * The address a `LinkValue` renders as (`specs/163-page-builder-marketing-pages/`
 * research R-11), or `null` when it renders as no link at all: a missing value,
 * an empty slug, or a `url` outside `https:`, `http:`, `mailto:`, `tel:` and
 * root-relative paths.
 *
 * - `page` → `/<slug>`, `product` → `/p/<slug>`, `category` → `/c/<slug>`, as
 *   `resolveButtonHref` does for today's button;
 * - `asset` → the URL in the render-time asset map, else `/assets/file/<id>`,
 *   either rebased onto the API origin;
 * - `anchor` → `#<anchor>`, normalised if a stored value predates the grammar.
 */
export function resolveLinkHref(link: LinkValue | null | undefined, env: LinkHrefEnv = {}): ResolvedLink | null {
  if (!link) return null;
  switch (link.kind) {
    case 'url': {
      const href = link.href?.trim() ?? '';
      return href && isSafeLinkUrl(href) ? withTarget(href, link.target) : null;
    }
    case 'page': {
      const slug = link.slug?.trim().replace(/^\/+/, '') ?? '';
      return slug ? withTarget(`/${slug}`, link.target) : null;
    }
    case 'product':
    case 'category': {
      const slug = link.slug?.trim() ?? '';
      if (!slug) return null;
      return withTarget(`/${link.kind === 'product' ? 'p' : 'c'}/${encodeURIComponent(slug)}`, link.target);
    }
    case 'asset': {
      if (!link.fileAssetId) return null;
      const fromAssets = env.assets?.[link.fileAssetId]?.url;
      const raw = fromAssets && fromAssets.length > 0 ? fromAssets : `/assets/file/${link.fileAssetId}`;
      return withTarget(absolutizeMediaUrl(raw, env.mediaBaseUrl), link.target);
    }
    case 'anchor': {
      const anchor = SECTION_ANCHOR_RE.test(link.anchor ?? '') ? link.anchor : normalizeAnchor(link.anchor ?? '');
      return anchor ? { href: `#${anchor}` } : null;
    }
    default:
      return null;
  }
}

// ── R17 (T212): the link of a block that stored a URL before ─────────

/** A stored `LinkValue`, recognised by its kind. */
function isLinkValue(value: unknown): value is LinkValue {
  const kind = (value as { kind?: unknown } | null)?.kind;
  return typeof kind === 'string' && ['url', 'page', 'product', 'category', 'asset', 'anchor'].includes(kind);
}

/**
 * The link of a block that stored a URL string before it took a `LinkValue`
 * (`cms.Image`, `cms.Icons`, `cms.LogoStrip`, `cms.AnnouncementBar`, a map
 * marker): the stored `LinkValue` when there is one, else the URL as a link of
 * kind `url` with the target it had, else nothing. `legacyTarget` is the target
 * the block gave that URL (a logo always opened a new tab).
 */
export function blockLink(link: unknown, href: unknown, legacyTarget?: unknown): LinkValue | undefined {
  if (isLinkValue(link)) return link;
  if (typeof link === 'string' && link !== '') return { kind: 'url', href: link, ...(legacyTarget === '_blank' ? { target: '_blank' as const } : {}) };
  if (typeof href === 'string' && href !== '') {
    return { kind: 'url', href, ...(legacyTarget === '_blank' ? { target: '_blank' as const } : {}) };
  }
  return undefined;
}

/**
 * The address and target of {@link blockLink} as these blocks write them:
 * every kind through {@link resolveLinkHref}, so a URL passes the same
 * safe-URL rule as every other link (R18, T221, owner decision) — a safe URL
 * is written as it was typed, an unsafe one (`javascript:`, `data:`, a
 * protocol-relative `//host`, a scheme-less relative path…) gives `null` and
 * the block renders its content unlinked. `null` too when the link leads
 * nowhere (no link, an empty URL or slug). The block adds `rel` itself.
 */
export function blockLinkTarget(link: LinkValue | undefined, env: LinkHrefEnv = {}): { href: string; target?: LinkTarget } | null {
  const resolved = resolveLinkHref(link, env);
  if (!resolved) return null;
  return resolved.target ? { href: resolved.href, target: resolved.target } : { href: resolved.href };
}

/**
 * The editor's `resolveData` step for such a block: a stored URL (and its
 * target) carried into `link`, the URL props cleared (`undefined`, which the
 * saved JSON drops). `null` when there is nothing to carry.
 */
export function carriedBlockLink(
  props: { link?: unknown; href?: unknown; linkTarget?: unknown },
  legacyTarget?: unknown,
): { link: LinkValue | undefined; href: undefined; linkTarget?: undefined } | null {
  if (isLinkValue(props.link)) return null;
  if (props.href === undefined && props.linkTarget === undefined && typeof props.link !== 'string') return null;
  const link = blockLink(props.link, props.href, legacyTarget ?? props.linkTarget);
  return { link, href: undefined, ...('linkTarget' in props ? { linkTarget: undefined } : {}) };
}
