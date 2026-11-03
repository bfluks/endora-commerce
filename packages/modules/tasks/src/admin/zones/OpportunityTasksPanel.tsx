import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { TasksPanel } from './TasksPanel.js';

/** `tasks`' contribution to `opportunity.detail.after`: the Tasks linked to the record (User Story 6). */
export function OpportunityTasksPanel({ opportunityId }: AdminZoneProps<'opportunity.detail.after'>): ReactNode {
  return <TasksPanel kind="opportunity" recordId={opportunityId} />;
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default OpportunityTasksPanel;
