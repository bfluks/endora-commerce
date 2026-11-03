import type { ReactNode } from 'react';
import { KanbanSquare, List } from 'lucide-react';
import type { AdminListViewMode } from '@endora-commerce/contracts';
import { Button } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * *List* or *Board* (`specs/165-task-management/` FR-018): two toggle buttons
 * in a named group, the pressed one saying which view is on screen in words,
 * not by colour alone. The screen keeps the choice; this only shows and changes it.
 */
export function ViewModeToggle(props: { mode: AdminListViewMode; onChange: (mode: AdminListViewMode) => void }): ReactNode {
  const t = useTranslation('tasks');
  const option = (mode: AdminListViewMode, icon: ReactNode): ReactNode => (
    <Button
      type="button"
      variant={props.mode === mode ? 'secondary' : 'ghost'}
      size="sm"
      className="min-h-11 sm:min-h-9"
      aria-pressed={props.mode === mode}
      onClick={(): void => {
        if (props.mode !== mode) props.onChange(mode);
      }}
    >
      {icon}
      {t(`view.${mode}`)}
    </Button>
  );
  return (
    <div role="group" aria-label={t('view.label')} className="inline-flex rounded-md border p-0.5">
      {option('list', <List aria-hidden="true" />)}
      {option('board', <KanbanSquare aria-hidden="true" />)}
    </div>
  );
}
