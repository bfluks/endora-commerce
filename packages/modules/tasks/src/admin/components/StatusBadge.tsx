import type { ReactNode } from 'react';
import type { TaskStatusRef } from '@endora-commerce/contracts';
import { Badge } from '@endora-commerce/admin-kit/ui';

/**
 * A Task's status in words — the workflow's own name, served with the Task in
 * the reader's language (`specs/165-task-management/` research R-1). The
 * colour, the operator's choice for that status, only repeats what the word
 * says: it is a dot beside the name, never the only signal.
 */
export function StatusBadge(props: { status: Pick<TaskStatusRef, 'name' | 'color'>; className?: string }): ReactNode {
  return (
    <Badge variant="outline" className={`shrink-0 gap-1.5 font-medium ${props.className ?? ''}`}>
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: props.status.color }} />
      {props.status.name}
    </Badge>
  );
}
