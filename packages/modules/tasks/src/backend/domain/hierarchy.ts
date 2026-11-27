import { TASK_HIERARCHY_DEPTH_MAX } from '@endora-commerce/contracts';

/**
 * The sub-task hierarchy's two rules (`specs/165-task-management/` FR-027,
 * research R-15), decided over facts the hierarchy service reads under the
 * hierarchy lock — pure, so each refusal is tested without a database:
 *
 * - **no cycle**: a Task is never its own parent, nor the child of one of its
 *   own descendants — which is exactly when the Task appears in the proposed
 *   parent's chain of ancestors (the parent included);
 * - **at most {@link TASK_HIERARCHY_DEPTH_MAX} levels**: the proposed parent
 *   sits at the depth of its chain (a top-level Task is level 1), and the moved
 *   Task brings the levels of its own sub-tree with it (1 for a Task without
 *   sub-tasks), so the deepest Task afterwards is at their sum.
 *
 * Both counts are taken over **every** Task, whoever may see it: the rules are
 * about the structure, and a hidden descendant is still a descendant.
 */

export type HierarchyRefusal = 'cycle' | 'too_deep';

export interface HierarchyFacts {
  /**
   * The proposed parent and its ancestors, the parent first and the top-level
   * Task last. The service reads at most `TASK_HIERARCHY_DEPTH_MAX + 1` of
   * them, which is enough to refuse.
   */
  readonly parentChain: readonly string[];
  /**
   * How many levels the moved Task's sub-tree spans, the Task included: 1 for
   * a Task without sub-tasks and for a Task about to be created.
   */
  readonly subtreeHeight: number;
}

/**
 * Why `taskId` may not become a sub-task of `parentId`, or `null` when it may.
 * `taskId` is `null` for a Task being created, which can close no cycle.
 */
export function parentChangeRefusal(
  taskId: string | null,
  parentId: string,
  facts: HierarchyFacts,
  maxDepth: number = TASK_HIERARCHY_DEPTH_MAX,
): HierarchyRefusal | null {
  if (taskId !== null && (taskId === parentId || facts.parentChain.includes(taskId))) return 'cycle';
  if (facts.parentChain.length + Math.max(1, facts.subtreeHeight) > maxDepth) return 'too_deep';
  return null;
}
