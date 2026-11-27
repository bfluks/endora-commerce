import type { ReactNode } from 'react';
import type { AdminProductListVisibility } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Alert, AlertDescription } from '@endora-commerce/admin-kit/ui';

/**
 * Spec 193 (FR-023, US1-6, US1-11; `specs/193-product-visibility-rules/contracts/admin-api.md` §2)
 * — the product list says when the operator's role narrows it. Driven only by the list answer's
 * `visibility` field, which is absent for an unrestricted caller and whenever product visibility
 * rules are off, so this renders nothing then and the list names no other module. It never says
 * how many products are hidden (TM-2). The category name is operator text, rendered as text.
 */
export function ProductVisibilityBanner({ visibility }: { readonly visibility: AdminProductListVisibility | undefined }): ReactNode {
  const t = useTranslation('catalog');
  if (!visibility) return null;
  return (
    <Alert data-testid="product-visibility-banner" variant={visibility.reason === 'no_category' ? 'warning' : 'default'}>
      <AlertDescription>
        {visibility.reason === 'no_category'
          ? t('productsList.visibility.noCategory')
          : visibility.categoryName
            ? // One sentence with the name in it; the name is text, never markup.
              t('productsList.visibility.restrictedNamed', { name: visibility.categoryName })
            : t('productsList.visibility.restrictedUnnamed')}
      </AlertDescription>
    </Alert>
  );
}
