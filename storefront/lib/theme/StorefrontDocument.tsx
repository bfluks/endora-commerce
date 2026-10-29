import type { ReactNode } from 'react';
import type { CmsBrandTokens } from '@endora-commerce/contracts';
import { brandTokensToCss } from '@endora-commerce/cms-components/brand/brand-css';
import { toAbsoluteAssetUrl } from '../asset-url';
import type { ResolvedStorefrontTheme } from './theme';

/**
 * How far below the top of the viewport a scrolled-to section lands: the
 * height of what stays pinned there (feature 163, US1 acceptance 2). Section
 * anchors read it as `scroll-margin-top: var(--cmsb-header-offset, 0px)`.
 *
 * It is the sticky stack of `components/Header.tsx` as `app/globals.css` sizes
 * it: `.industria-header` (72 px plus its 1 px bottom border) and, from 877 px
 * up where it is shown, the sticky `.industria-nav` beneath it (pinned at
 * 72 px, 48 px plus its border). A theme that replaces the header changes these
 * numbers here.
 */
const HEADER_OFFSET_CSS =
  ':root{--cmsb-header-offset:73px;}@media (min-width: 877px){:root{--cmsb-header-offset:121px;}}';

/** An asset-library font file, served by the backend: rebased onto the public API origin. */
function brandAssetUrl(fileAssetId: string): string {
  return toAbsoluteAssetUrl(`/assets/file/${encodeURIComponent(fileAssetId)}`);
}

/**
 * The brand tokens as `<style id="cmsb">` plus their font links — feature 163
 * (research R-3). Server-rendered, so the first paint is already on brand. The
 * CSS comes from `brandTokensToCss`, which is written for exactly this place:
 * nothing it emits can close the `<style>` element.
 */
function BrandHead({ tokens }: { tokens: CmsBrandTokens }): ReactNode {
  const { css, fontLinks } = brandTokensToCss(tokens, { assetUrl: brandAssetUrl, mediaUrl: toAbsoluteAssetUrl });
  return (
    <>
      {fontLinks.map((link) =>
        link.rel === 'stylesheet' ? (
          <link key={link.href} rel="stylesheet" href={link.href} />
        ) : (
          <link key={link.href} rel="preload" href={link.href} as={link.as} crossOrigin={link.crossOrigin} />
        ),
      )}
      <style id="cmsb" dangerouslySetInnerHTML={{ __html: css }} />
    </>
  );
}

/**
 * The document element the root layout returns — feature `005-sales-channels`.
 *
 * It exists as its own component for one reason: `data-theme` is the entire
 * per-channel theming mechanism, and it has to be provable. A test can render
 * *this* server-side and read the attribute out of the emitted HTML, which is
 * the same string a browser receives on first paint; rendering `app/layout.tsx`
 * for the same assertion would drag in the dictionary provider, the megamenu,
 * the cart badge and six analytics configs, none of which have anything to do
 * with the theme.
 *
 * It lives under `lib/` rather than `components/`. `THEMING.md` says everything
 * under `components/` may be replaced freely, and a theme that replaced the
 * `<html>` element would silently drop the channel's brand along with it.
 *
 * Both attributes are stamped server-side and neither is ever set from the
 * client: `lang` for crawlers (Principle VII / FR-103), `data-theme` because a
 * theme applied after hydration is a flash of the wrong brand.
 *
 * ## The third attribute, and why it is not decoration
 *
 * `data-theme-requested` appears **when and only when** the request fell back —
 * the channel named a theme this storefront does not have, so `data-theme`
 * carries the default instead. It is absent on every correct render and absent
 * when the channel names no theme at all.
 *
 * It exists because the mistake is made in the **admin** and the signal appears
 * in the **storefront's** container log: a different deployment, read by a
 * different person, hours later. This puts the answer in the artefact that
 * already carries the question, so "why is this channel not branded" is
 * answerable from `view-source` by whoever is asking. It replaces no log line —
 * `themeForChannel`'s once-per-process warning stays — and it reports nothing
 * anywhere: there is no channel from a storefront back to the platform, in
 * either direction (D-195).
 *
 * ## The head: brand tokens (feature 163)
 *
 * `brandTokens` is the channel's effective brand set, or `null` when there is
 * none to apply (`cms` off, or the read failed). With a set, `<head>` carries
 * `<style id="cmsb">` and the font links; without one it does not, and the
 * page builder's stylesheet falls back to today's literals. The header offset
 * section anchors scroll to is set either way.
 *
 * The component takes the whole decision rather than a code plus an optional
 * marker, so the "when and only when" is derived here and there is nothing for
 * a caller to forget. The one operator-typed lowercase token it discloses, on a
 * channel that is already misconfigured, is an accepted cost (owner ruling,
 * 2026-09-03).
 */
export function StorefrontDocument({
  lang,
  theme,
  brandTokens = null,
  children,
}: {
  lang: string;
  theme: ResolvedStorefrontTheme;
  brandTokens?: CmsBrandTokens | null;
  children: ReactNode;
}): ReactNode {
  return (
    <html
      lang={lang}
      data-theme={theme.code}
      {...(theme.unknownRequest !== null ? { 'data-theme-requested': theme.unknownRequest } : {})}
    >
      <head>
        <style id="cmsb-header-offset" dangerouslySetInnerHTML={{ __html: HEADER_OFFSET_CSS }} />
        {brandTokens ? <BrandHead tokens={brandTokens} /> : null}
      </head>
      {/* suppressHydrationWarning: browser extensions (Grammarly, password
          managers, etc.) inject attributes onto <body> before React hydrates
          — e.g. data-gr-ext-installed. This suppresses the warning for the
          <body> element's own attributes only (not its descendants), so real
          mismatches inside the tree are still reported. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
