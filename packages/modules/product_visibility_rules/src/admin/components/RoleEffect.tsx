import type { ReactNode } from 'react';
import type { ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { roleEffectLabels } from '../lib/labels.js';


type Overview = ProductVisibilityOverviewResponse;

/**
 * FR-024 — what the module does to a role, in words: a category (by its name, operator text
 * rendered as text), "unrestricted", "unrestricted — cannot be mapped" or "no category — sees no
 * products". Shared by the configuration screen and the role screens' zones.
 */
export function RoleEffect({
  role,
  categories,
  showCategory = true,
}: {
  readonly role: Overview['roles'][number];
  readonly categories: Overview['categories'];
  /** Off where a mapping column beside it already names the category. */
  readonly showCategory?: boolean;
}): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const category = showCategory && role.effect === 'mapped' ? categories.find((c) => c.id === role.categoryId) : undefined;
  // Beside a mapping column the category is named there, and "cannot be mapped" is said there
  // with its reason: here the sentence ends in words, once per row.
  const label = showCategory
    ? roleEffectLabels.label(t, role.effect)
    : role.effect === 'mapped'
      ? t('roleEffect.mappedLimited')
      : role.effect === 'unmappable_unrestricted'
        ? roleEffectLabels.label(t, 'unrestricted')
        : roleEffectLabels.label(t, role.effect);
  return (
    <span className="text-sm">
      <span className={role.effect === 'sees_no_products' ? 'font-medium text-destructive' : undefined}>{label}</span>
      {category ? <span className="ml-1 break-words font-medium">{category.name}</span> : null}
    </span>
  );
}
