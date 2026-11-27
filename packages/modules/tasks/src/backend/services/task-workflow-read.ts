import type { EntityManager } from '@mikro-orm/postgresql';
import type { TaskPriorityRef, TaskStatusRef } from '@endora-commerce/contracts';
import { resolveTaskStatusName, TaskStatusGraph } from '../domain/task-status-graph.js';
import { TaskPriority } from '../entities/task-priority.entity.js';
import { TaskStatus } from '../entities/task-status.entity.js';
import { TaskStatusTransition } from '../entities/task-status-transition.entity.js';

/**
 * The configured workflow and priority list, read (`specs/165-task-management/`
 * research R-1, R-9) — both `@GlobalEntity` configuration, small, read per
 * operation and never cached across requests, so an operator's change is seen
 * by the next read.
 */

/** A status code the workflow no longer holds is shown as itself, open and grey. */
const UNKNOWN_STATUS_COLOR = '#94a3b8';

export class TaskWorkflowRead {
  constructor(private readonly emFactory: () => EntityManager) {}

  async graph(em: EntityManager = this.emFactory()): Promise<TaskStatusGraph> {
    const [statuses, transitions] = await Promise.all([
      em.find(TaskStatus, {}, { orderBy: { weight: 'asc', code: 'asc' } }),
      em.find(TaskStatusTransition, {}, { orderBy: { fromCode: 'asc', toCode: 'asc' } }),
    ]);
    return new TaskStatusGraph(
      statuses.map((status) => ({
        code: status.code,
        name: status.name,
        defaultName: status.defaultName,
        category: status.category,
        isInitial: status.isInitial,
        weight: status.weight,
        color: status.color,
      })),
      transitions.map((transition) => ({ fromCode: transition.fromCode, toCode: transition.toCode })),
    );
  }

  async priorities(em: EntityManager = this.emFactory()): Promise<TaskPriority[]> {
    return em.find(TaskPriority, {}, { orderBy: { weight: 'asc', code: 'asc' } });
  }
}

/** A status as a reader is shown it. A code the workflow no longer holds is open, named by its code. */
export function statusRef(graph: TaskStatusGraph, code: string, language: string): TaskStatusRef {
  const def = graph.get(code);
  if (!def) return { code, name: code, color: UNKNOWN_STATUS_COLOR, category: 'open' };
  return { code, name: resolveTaskStatusName(def, language), color: def.color, category: def.category };
}

/** A priority as a reader is shown it; `null` for none, or for a code no longer configured. */
export function priorityRef(
  priorities: readonly TaskPriority[],
  code: string | null,
  language: string,
): TaskPriorityRef | null {
  if (code === null) return null;
  const priority = priorities.find((candidate) => candidate.code === code);
  if (!priority) return null;
  return { code, name: resolveTaskStatusName(priority, language), color: priority.color };
}
