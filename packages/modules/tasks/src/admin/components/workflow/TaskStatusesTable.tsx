import type { ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import type { TaskStatusConfig } from '@endora-commerce/contracts';
import { statusBadgeStyle } from '@endora-commerce/admin-kit/lib';
import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { workflowStatusName } from '../../lib/labels.js';

export interface TaskStatusesTableProps {
  statuses: readonly TaskStatusConfig[];
  language: string;
  onEdit: (status: TaskStatusConfig) => void;
  onDelete: (status: TaskStatusConfig) => void;
}

/**
 * The statuses of the Task workflow, in workflow order
 * (`specs/165-task-management/contracts/admin-surfaces.md` §1; CRM's
 * `StatusesTable`, the model).
 *
 * Remove is offered on every row, the start status and a status in use
 * included: the server is the authority on both — `inUseCount` counts only
 * the Tasks *this* operator may see — and the screen shows its sentence rather
 * than guessing from a number that can be an undercount.
 */
export function TaskStatusesTable(props: TaskStatusesTableProps): ReactNode {
  const t = useTranslation('tasks');
  const ordered = [...props.statuses].sort((a, b) => a.weight - b.weight || a.code.localeCompare(b.code));

  return (
    <Table aria-label={t('workflow.statuses.title')}>
      <TableHeader>
        <TableRow>
          <TableHead>{t('workflow.col.name')}</TableHead>
          <TableHead>{t('workflow.col.code')}</TableHead>
          <TableHead>{t('workflow.col.category')}</TableHead>
          <TableHead className="text-right">{t('workflow.col.position')}</TableHead>
          <TableHead className="text-right">{t('workflow.col.inUse')}</TableHead>
          <TableHead>
            <span className="sr-only">{t('workflow.col.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ordered.map((status) => {
          const name = workflowStatusName(status, props.language);
          return (
            <TableRow key={status.code}>
              <TableCell>
                <Badge className="font-medium" style={statusBadgeStyle(status.color)}>
                  {name}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs">{status.code}</TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{t(`workflow.category.${status.category}`)}</span>
                  {status.isInitial ? <Badge variant="outline">{t('workflow.flag.initial')}</Badge> : null}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{status.weight}</TableCell>
              <TableCell className="text-right tabular-nums">{status.inUseCount}</TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button
                    className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
                    variant="ghost"
                    size="sm"
                    aria-label={t('workflow.status.editLabel', { name })}
                    onClick={(): void => props.onEdit(status)}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
                    variant="ghost"
                    size="sm"
                    aria-label={t('workflow.status.deleteLabel', { name })}
                    onClick={(): void => props.onDelete(status)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
