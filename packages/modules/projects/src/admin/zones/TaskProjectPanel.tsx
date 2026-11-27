import type { ReactNode } from 'react';
import type { AdminZoneProps } from '@endora-commerce/contracts';
import { ProjectPanel } from './ProjectPanel.js';

/** `projects`' contribution to `task.detail.after`: the Project the record is in (User Story 6). */
export function TaskProjectPanel({ taskId }: AdminZoneProps<'task.detail.after'>): ReactNode {
  return <ProjectPanel kind="task" recordId={taskId} />;
}

/** The default export the zone declaration's dynamic-import factory resolves. */
export default TaskProjectPanel;
