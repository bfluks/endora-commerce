import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { TaskSummary } from '@endora-commerce/contracts';
import type { ResponsiveColumn } from '@endora-commerce/admin-kit/components';
import { useAppLanguage, useTranslation } from '@endora-commerce/admin-kit/i18n';
import { calendarDateLabel } from '../lib/labels.js';
import { ContextLabel } from './ContextLabel.js';
import { StatusBadge } from './StatusBadge.js';

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

/** The columns both Task lists share — the full list and *My Tasks*. */
export function useTaskColumns(): ResponsiveColumn<TaskSummary>[] {
  const t = useTranslation('tasks');
  return [
    {
      id: 'number',
      header: t('list.col.number'),
      primary: true,
      render: (row) => (
        <Link to={`/tasks/${row.id}`} className="font-medium text-primary underline-offset-4 hover:underline">
          {row.number}
        </Link>
      ),
    },
    {
      id: 'title',
      header: t('list.col.title'),
      primary: true,
      render: (row) => <span className="[overflow-wrap:anywhere]">{row.title}</span>,
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
        row.assignee ? (
          <span className="[overflow-wrap:anywhere]">{row.assignee.name}</span>
        ) : (
          <span className="text-muted-foreground">{t('list.unassigned')}</span>
        ),
    },
    {
      id: 'context',
      header: t('list.col.context'),
      hideOnMobile: true,
      render: (row) => <ContextLabel context={row.context} />,
    },
  ];
}
