import { createContext, useContext, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import type { CmsBrandTokens } from '@endora-commerce/contracts';
import { brandTokensToCss } from '@endora-commerce/cms-components';
import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';

/** Marks the font links this component owns in the iframe head, so a change replaces exactly them. */
const FONT_LINK_ATTRIBUTE = 'data-cmsb-font';

function brandAssetUrl(fileAssetId: string): string {
  return toAbsoluteAssetUrl(`/assets/file/${encodeURIComponent(fileAssetId)}`);
}

/**
 * The tokens the preview applies, provided around `<Puck>`. Puck's overrides
 * are memoised once per editor, so they read the descriptor's tokens from here
 * rather than closing over them; the iframe is rendered through a portal, which
 * keeps this context.
 */
const PreviewBrandTokensContext = createContext<CmsBrandTokens | null>(null);

export function PreviewBrandTokensProvider({
  tokens,
  children,
}: {
  tokens: CmsBrandTokens | null | undefined;
  children: ReactNode;
}): ReactElement {
  return <PreviewBrandTokensContext.Provider value={tokens ?? null}>{children}</PreviewBrandTokensContext.Provider>;
}

/**
 * Feature 163 — the page-builder preview styled with the page's brand tokens
 * (`specs/163-page-builder-marketing-pages/` research R-4, FR-038).
 *
 * Mounted by Puck's `overrides.iframe`, which hands it the iframe's document:
 * it writes `<style id="cmsb">` and the font links into **that** head — the
 * same output `brandTokensToCss` gives the storefront's `<head>` — and keeps
 * them in step with the descriptor. With no tokens it removes them, and the
 * page builder's stylesheet falls back to its built-in look. The admin's own
 * document is never touched.
 *
 * `tokens` defaults to the nearest {@link PreviewBrandTokensProvider}'s.
 */
export function PreviewBrandTokens({
  document: frameDocument,
  tokens,
  children,
}: {
  document?: Document | undefined;
  tokens?: CmsBrandTokens | null | undefined;
  children: ReactNode;
}): ReactElement {
  const provided = useContext(PreviewBrandTokensContext);
  const effective = tokens === undefined ? provided : tokens;
  const brand = useMemo(
    () => (effective ? brandTokensToCss(effective, { assetUrl: brandAssetUrl, mediaUrl: toAbsoluteAssetUrl }) : null),
    [effective],
  );

  useEffect(() => {
    const head = frameDocument?.head;
    if (!head) return undefined;
    for (const link of Array.from(head.querySelectorAll(`link[${FONT_LINK_ATTRIBUTE}]`))) link.remove();
    const existing = head.querySelector<HTMLStyleElement>('style#cmsb');
    if (!brand) {
      existing?.remove();
      return undefined;
    }
    const style = existing ?? frameDocument.createElement('style');
    style.id = 'cmsb';
    style.textContent = brand.css;
    if (!existing) head.appendChild(style);
    for (const font of brand.fontLinks) {
      const link = frameDocument.createElement('link');
      link.setAttribute(FONT_LINK_ATTRIBUTE, '');
      link.rel = font.rel;
      link.href = font.href;
      if (font.as) link.as = font.as;
      if (font.crossOrigin) link.crossOrigin = font.crossOrigin;
      head.insertBefore(link, style);
    }
    return undefined;
  }, [frameDocument, brand]);

  return <>{children}</>;
}
