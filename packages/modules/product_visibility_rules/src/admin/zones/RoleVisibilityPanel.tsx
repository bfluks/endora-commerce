import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PRODUCT_VISIBILITY_PERMISSIONS, type AdminRoleZoneProps } from '@endora-commerce/contracts';
import { useAuth } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { Button, EditorSection, Skeleton } from '@endora-commerce/admin-kit/ui';
import { RoleEffect } from '../components/RoleEffect.js';
import { roleRowId } from '../lib/labels.js';
import { useRoleVisibility } from '../lib/use-role-visibility.js';

const CONFIG_ROUTE = '/product-visibility';

/**
 * `admin_users.roles.editor.aside` — the open role's product visibility beside the role editor
 * (FR-024). Read-only: the mapping is changed on the module's own screen, which it links to, so
 * the editor's one Save is untouched (research R-14).
 */
export default function RoleVisibilityPanel({ roleId }: AdminRoleZoneProps): ReactNode {
  const t = useTranslation('product_visibility_rules');
  const visibility = useRoleVisibility(roleId);
  // Without manage the screen is read-only: the link says it opens, not that it changes (Jakob).
  const canManage = useAuth().hasPermission(PRODUCT_VISIBILITY_PERMISSIONS.MANAGE);
  return (
    <EditorSection
      as="h3"
      title={t('roleZone.title')}
      action={
        <Button asChild size="sm" variant="outline">
          {/* The role editor's unsaved-changes prompt (AdminRolesPage) intercepts this link like any
              in-app link, so an edited role is not dropped without asking. */}
          <Link to={`${CONFIG_ROUTE}#${roleRowId(roleId)}`}>{canManage ? t('roleZone.manage') : t('roleZone.open')}</Link>
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
