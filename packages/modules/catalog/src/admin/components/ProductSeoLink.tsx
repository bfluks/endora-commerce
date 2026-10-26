import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 163 — owner decision "SEO stub = A" (2026-10-26). The product editor's SEO tab
 * links to the SEO screen, where `SeoMetaScopeEditor` edits the meta tags per channel and
 * language. That screen picks the product itself (it has no per-product address), so the
 * hint says to pick this product there.
 *
 * Shown only while `seo` is present and the admin holds `catalog:write` — the code the
 * SEO screen's routes and its `open-seo` palette action are gated by.
 */
export function ProductSeoLink(): ReactNode {
  const t = useTranslation('catalog');
  const isVisible = useSurfaceVisibility();
  if (!isVisible({ module: 'seo', requiredPermission: 'catalog:write' })) return null;
  return (
    <div className="b2b-col" style={{ gap: 8 }}>
      <div className="b2b-label">{t('productEditor.seo.title')}</div>
      <div className="b2b-help" style={{ marginTop: 0 }}>
        {t('productEditor.seo.linkHint')}
      </div>
      <div>
        <Link to="/seo" className="b2b-btn b2b-btn--ghost b2b-btn--sm">
          {t('productEditor.seo.link')}
        </Link>
      </div>
    </div>
  );
}
