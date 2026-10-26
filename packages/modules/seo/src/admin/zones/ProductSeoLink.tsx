import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 163 — owner decision "SEO stub = A" (2026-10-26). `seo`'s contribution to the
 * product editor's SEO tab (`product.editor.seo.after`): a link to the SEO screen, where
 * `SeoMetaScopeEditor` edits the meta tags per channel and language. That screen picks
 * the product itself (it has no per-product address), so the hint says to pick this
 * product there; `productId` is carried for when it gains one.
 *
 * Presence and the `catalog:write` code (the SEO screen's routes and its `open-seo`
 * action) are applied by the zone renderer from this module's declaration.
 */
export type ProductSeoLinkProps = AdminZoneProps<'product.editor.seo.after'>;

export function ProductSeoLink(): ReactNode {
  const t = useTranslation('seo');
  return (
    <div className="b2b-col" style={{ gap: 8 }}>
      <div className="b2b-label">{t('productLink.title')}</div>
      <div className="b2b-help" style={{ marginTop: 0 }}>
        {t('productLink.hint')}
      </div>
      <div>
        <Link to="/seo" className="b2b-btn b2b-btn--ghost b2b-btn--sm">
          {t('productLink.link')}
        </Link>
      </div>
    </div>
  );
}

/** The zone renderer reads a contribution's default export (feature 091, FR-013). */
export default ProductSeoLink;
