import type { ReactNode } from 'react';
import type { ProductVisibilityOverviewResponse } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { roleEffectLabels } from '../lib/labels.js';

const MODULE = 'product_visibility_rules';

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
  const t = useTranslation(MODULE);
  const category = showCategory && role.effect === 'mapped' ? categories.find((c) => c.id === role.categoryId) : undefined;
  return (
    <span className="text-sm">
      <span className={role.effect === 'sees_no_products' ? 'font-medium text-destructive' : undefined}>
        {roleEffectLabels.label(t, role.effect)}
      </span>
      {category ? <span className="ml-1 break-words font-medium">{category.name}</span> : null}
    </span>
  );
}
