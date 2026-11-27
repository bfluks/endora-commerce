import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AdminRoleZoneProps } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Button, EditorSection, Skeleton } from '@endora-commerce/admin-kit/ui';
import { RoleEffect } from '../components/RoleEffect.js';
import { useRoleVisibility } from '../lib/use-role-visibility.js';

const MODULE = 'product_visibility_rules';
const CONFIG_ROUTE = '/product-visibility';

/**
 * `admin_users.roles.editor.aside` — the open role's product visibility beside the role editor
 * (FR-024). Read-only: the mapping is changed on the module's own screen, which it links to, so
 * the editor's one Save is untouched (research R-14).
 */
export default function RoleVisibilityPanel({ roleId }: AdminRoleZoneProps): ReactNode {
  const t = useTranslation(MODULE);
  const visibility = useRoleVisibility(roleId);
  return (
    <EditorSection
      as="h3"
      title={t('roleZone.title')}
      action={
        <Button asChild size="sm" variant="outline">
          <Link to={CONFIG_ROUTE}>{t('roleZone.manage')}</Link>
        </Button>
      }
    >
      <div aria-busy={visibility.state === 'loading'}>
        {visibility.state === 'loading' ? (
          <Skeleton className="h-4 w-48" />
        ) : visibility.state === 'failed' ? (
          <p className="text-sm text-muted-foreground">{t('roleZone.failed')}</p>
        ) : visibility.role === null ? (
          <p className="text-sm text-muted-foreground">{t('roleZone.unknown')}</p>
        ) : (
          <RoleEffect role={visibility.role} categories={visibility.categories} />
        )}
      </div>
    </EditorSection>
  );
}
