import type { ReactNode } from 'react';
import type { TaskSummary } from '@endora-commerce/contracts';
import { Badge } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * What sets a Task apart in a list or on a board card (`specs/165-task-management/`
 * T092): *Draft* and *Private* badges, as on the Task's own screen, and the
 * parent it is a sub-task of — by number, or as a Task the reader cannot see.
 * Plain text, never a link: on a card the title is the only link, so a link
 * never starts a drag. Renders nothing for a published, shared, top-level Task.
 */
export function TaskMarkers(props: { task: Pick<TaskSummary, 'draft' | 'private' | 'parent'> }): ReactNode {
  const { task } = props;
  const t = useTranslation('tasks');
  if (!task.draft && !task.private && task.parent === null) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {task.draft ? <Badge variant="outline">{t('detail.draftBadge')}</Badge> : null}
      {task.private ? <Badge variant="secondary">{t('detail.privateBadge')}</Badge> : null}
      {task.parent ? (
        <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {task.parent.available && task.parent.number
            ? t('list.subtaskOf', { number: task.parent.number })
            : t('list.subtaskOfHidden')}
        </span>
      ) : null}
    </span>
  );
}
