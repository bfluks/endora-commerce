import type { ReactNode } from 'react';
import type { ProjectState } from '@endora-commerce/contracts';
import { Badge } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

const VARIANT: Record<ProjectState, 'secondary' | 'success' | 'destructive'> = {
  open: 'secondary',
  completed: 'success',
  lost: 'destructive',
};

/** A Project's state in words — open, completed or lost. */
export function StateBadge(props: { state: ProjectState; className?: string }): ReactNode {
  const t = useTranslation('projects');
  return (
    <Badge variant={VARIANT[props.state]} className={`shrink-0 font-medium ${props.className ?? ''}`}>
      {t(`state.${props.state}`)}
    </Badge>
  );
}
