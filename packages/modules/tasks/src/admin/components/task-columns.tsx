import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { TaskSummary } from '@endora-commerce/contracts';
import { TagChips, type ResponsiveColumn } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { calendarDateLabel, NO_VALUE } from '../lib/labels.js';
import { ContextLabel } from './ContextLabel.js';
import { StatusBadge } from './StatusBadge.js';
import { TaskMarkers } from './TaskMarkers.js';

/** A Task's due date, and "Overdue" in words when it has passed while the Task is open. */
function DueCell(props: { task: TaskSummary }): ReactNode {
  const t = useTranslation('tasks');
  const { language } = useAppLanguage();
  const { task } = props;
  if (!task.dueOn) return <span className="text-muted-foreground">{t('list.noDueDate')}</span>;
  return (
    <span className={task.overdue ? 'font-medium text-destructive' : undefined}>
      <span className="tabular-nums">{calendarDateLabel(task.dueOn, language)}</span>
      {task.overdue ? (
        <>
          {' · '}
          <span>{t('list.overdue')}</span>
        </>
      ) : null}
    </span>
  );
}

/** The columns both Task lists share — the Tasks screen and *My Tasks* (priority and tags added by 165 US3). */
export function useTaskColumns(): ResponsiveColumn<TaskSummary>[] {
  const t = useTranslation('tasks');
  return [
    {
      id: 'number',
      header: t('list.col.number'),
      primary: true,
      render: (row) => (
        // `whitespace-nowrap`: the number would otherwise break at its hyphen (T095).
        <Link
          to={`/tasks/${row.id}`}
          className="whitespace-nowrap font-medium text-primary underline-offset-4 hover:underline"
        >
          {row.number}
        </Link>
      ),
    },
    {
      id: 'title',
      header: t('list.col.title'),
      primary: true,
      // Draft, private and sub-task markers beside the title (T092).
      render: (row) => (
        <span className="flex flex-col gap-1">
          <span className="[overflow-wrap:anywhere]">{row.title}</span>
          <TaskMarkers task={row} />
        </span>
      ),
    },
    {
      id: 'status',
      header: t('list.col.status'),
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      id: 'due',
      header: t('list.col.due'),
      render: (row) => <DueCell task={row} />,
    },
    {
      id: 'assignee',
      header: t('list.col.assignee'),
      render: (row) =>
        row.assignees.length > 0 ? (
          <span className="[overflow-wrap:anywhere]">{row.assignees.map((person) => person.name).join(', ')}</span>
        ) : (
          <span className="text-muted-foreground">{t('list.unassigned')}</span>
        ),
    },
    {
      id: 'priority',
      header: t('list.col.priority'),
      hideOnMobile: true,
      render: (row) =>
        row.priority ? (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.priority.color }} />
            {row.priority.name}
          </span>
        ) : (
          <span className="text-muted-foreground">{NO_VALUE}</span>
        ),
    },
    {
      id: 'tags',
      header: t('list.col.tags'),
      hideOnMobile: true,
      render: (row) => (row.tags.length > 0 ? <TagChips tags={row.tags} /> : <span className="text-muted-foreground">{NO_VALUE}</span>),
    },
    {
      id: 'context',
      header: t('list.col.context'),
      hideOnMobile: true,
      render: (row) => <ContextLabel context={row.context} />,
    },
  ];
}
