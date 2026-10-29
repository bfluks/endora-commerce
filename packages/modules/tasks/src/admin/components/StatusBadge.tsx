import type { ReactNode } from 'react';
import type { TaskStatus } from '@endora-commerce/contracts';
import { Badge } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

const VARIANT: Record<TaskStatus, 'secondary' | 'warning' | 'success' | 'outline'> = {
  todo: 'secondary',
  in_progress: 'warning',
  done: 'success',
  cancelled: 'outline',
};

/** A Task's status in words — the colour only repeats what the word says. */
export function StatusBadge(props: { status: TaskStatus; className?: string }): ReactNode {
  const t = useTranslation('tasks');
  return (
    <Badge variant={VARIANT[props.status]} className={`shrink-0 font-medium ${props.className ?? ''}`}>
      {t(`status.${props.status}`)}
    </Badge>
  );
}
