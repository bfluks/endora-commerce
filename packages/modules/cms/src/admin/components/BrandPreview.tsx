import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { BRAND_SCHEMES, type CmsBrandTokens } from '@endora-commerce/contracts';
import { brandTokensToCss } from '@endora-commerce/cms-components';
import { toAbsoluteAssetUrl } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/** Marks what this component writes into the admin document's head, so a change replaces exactly that. */
const FONT_ATTRIBUTE = 'data-cmsb-preview-font';

function brandAssetUrl(fileAssetId: string): string {
  return toAbsoluteAssetUrl(`/assets/file/${encodeURIComponent(fileAssetId)}`);
}

/**
 * `brandTokensToCss` output rewritten for a shadow root: `:root` becomes
 * `:host`, so the variables bind to the preview's host element and to nothing
 * in the admin, and the `[data-cmsb-scheme]` rules stay inside the shadow tree
 * by construction. The `@font-face` rules are split off, because a browser
 * does not register a font face declared inside a shadow tree; they only
 * declare families, so the admin document can carry them without any of its
 * own styles changing.
 */
export function scopeBrandCssToHost(css: string): { scoped: string; fontFaces: string } {
  const lines = css.split('\n');
  const fontFaces = lines.filter((line) => line.startsWith('@font-face'));
  const scoped = lines
    .filter((line) => !line.startsWith('@font-face'))
    .join('\n')
    .replace(/:root\b/g, ':host');
  return { scoped, fontFaces: fontFaces.join('\n') };
}

const SAMPLE: CSSProperties = {
  background: 'var(--cmsb-bg)',
  color: 'var(--cmsb-fg)',
  border: '1px solid var(--cmsb-border)',
  borderRadius: 8,
  padding: 16,
  fontFamily: 'var(--cmsb-font-body)',
};

const HEADING: CSSProperties = {
  margin: '6px 0 8px',
  fontFamily: 'var(--cmsb-t-h3-font)',
  fontSize: 'var(--cmsb-t-h3-size)',
  lineHeight: 'var(--cmsb-t-h3-lh)',
  fontWeight: 'var(--cmsb-t-h3-w)',
  letterSpacing: 'var(--cmsb-t-h3-ls)',
};

const GRADIENT: CSSProperties = {
  backgroundImage: 'var(--cmsb-grad)',
  WebkitBackgroundClip: 'text',
  backgroundClip: 'text',
  color: 'transparent',
};

const BODY: CSSProperties = {
  margin: '0 0 6px',
  fontSize: 'var(--cmsb-t-body-size)',
  lineHeight: 'var(--cmsb-t-body-lh)',
};

const MUTED: CSSProperties = {
  margin: '0 0 12px',
  color: 'var(--cmsb-fg-muted)',
  fontSize: 'var(--cmsb-t-small-size)',
  lineHeight: 'var(--cmsb-t-small-lh)',
};

function button(fill: 'primary' | 'secondary'): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    height: 'var(--cmsb-btn-h-m)',
    padding: '0 16px',
    borderRadius: 'var(--cmsb-btn-radius)',
    background: `var(--cmsb-color-${fill})`,
    color: `var(--cmsb-color-on-${fill})`,
    fontWeight: 'var(--cmsb-btn-weight)',
    textTransform: 'var(--cmsb-btn-transform)' as CSSProperties['textTransform'],
    fontSize: 14,
  };
}

/**
 * Feature 163 — a live sample of the brand tokens in the light, muted and dark
 * schemes (`specs/163-page-builder-marketing-pages/` FR-006, T029).
 *
 * The sample is rendered into a **shadow root**: the tokens are CSS variables
 * and scheme rules that would otherwise reach every element of the admin, and
 * the admin's own utility classes would otherwise reach the sample. It writes
 * the same CSS the storefront's `<style id="cmsb">` carries, rebased onto the
 * host, so what the operator sees before saving is what a page would use.
 */
export function BrandPreview({ tokens }: { tokens: CmsBrandTokens }): ReactElement {
  const t = useTranslation('cms');
  const [root, setRoot] = useState<ShadowRoot | null>(null);
  // Idempotent: under StrictMode the ref runs again over the same node, which
  // already carries its shadow root.
  const hostRef = useCallback((node: HTMLDivElement | null): void => {
    if (node) setRoot(node.shadowRoot ?? node.attachShadow({ mode: 'open' }));
  }, []);

  const brand = useMemo(() => {
    const out = brandTokensToCss(tokens, { assetUrl: brandAssetUrl, mediaUrl: toAbsoluteAssetUrl });
    return { ...scopeBrandCssToHost(out.css), fontLinks: out.fontLinks };
  }, [tokens]);

  useEffect(() => {
    const head = document.head;
    const written: Element[] = [];
    if (brand.fontFaces) {
      const style = document.createElement('style');
      style.setAttribute(FONT_ATTRIBUTE, '');
      style.textContent = brand.fontFaces;
      head.appendChild(style);
      written.push(style);
    }
    for (const font of brand.fontLinks) {
      if (font.rel !== 'stylesheet') continue;
      const link = document.createElement('link');
      link.setAttribute(FONT_ATTRIBUTE, '');
      link.rel = 'stylesheet';
      link.href = font.href;
      head.appendChild(link);
      written.push(link);
    }
    return (): void => {
      for (const node of written) node.remove();
    };
  }, [brand]);

  return (
    <div ref={hostRef} data-brand-preview="">
      {root
        ? createPortal(
            <>
              <style>{`:host{display:block}${brand.scoped}`}</style>
              <div style={{ display: 'grid', gap: 12 }}>
                {BRAND_SCHEMES.map((scheme) => (
                  <div key={scheme} data-cmsb-scheme={scheme} style={SAMPLE}>
                    <p style={{ ...MUTED, margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {t(`brand.schemes.${scheme}`)}
                    </p>
                    <p style={HEADING}>
                      {t('brand.preview.heading')} <span style={GRADIENT}>{t('brand.preview.emphasis')}</span>
                    </p>
                    <p style={BODY}>
                      {t('brand.preview.body')}{' '}
                      <span style={{ color: 'var(--cmsb-link)', textDecoration: 'underline' }}>
                        {t('brand.preview.link')}
                      </span>
                      .
                    </p>
                    <p style={MUTED}>{t('brand.preview.muted')}</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      <span style={button('primary')}>{t('brand.preview.primaryButton')}</span>
                      <span style={button('secondary')}>{t('brand.preview.secondaryButton')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>,
            root,
          )
        : null}
    </div>
  );
}
