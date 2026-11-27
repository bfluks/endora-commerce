import type { ReactNode } from 'react';
import type { AdminRoleZoneProps } from '@endora-commerce/contracts';
import { RoleEffect } from '../components/RoleEffect.js';
import { useRoleVisibility } from '../lib/use-role-visibility.js';

/**
 * `admin_users.roles.list.columns` — the role's product visibility under its name in the role
 * list (FR-024). Text only: the zone sits inside the row's button. Nothing while loading or when
 * the read fails (a line is reserved while loading); the configuration screen is where a failure is reported.
 */
export default function RoleListVisibility({ roleId }: AdminRoleZoneProps): ReactNode {
  const visibility = useRoleVisibility(roleId);
  if (visibility.state === 'loading') {
    // The line is reserved while the read is in flight, so the list does not jump when it lands.
    return <span data-testid="role-visibility-placeholder" aria-hidden="true" className="block h-4" />;
  }
  if (visibility.state !== 'ready' || visibility.role === null) return null;
  return (
    <span className="block text-xs text-muted-foreground">
      <RoleEffect role={visibility.role} categories={visibility.categories} />
    </span>
  );
}
