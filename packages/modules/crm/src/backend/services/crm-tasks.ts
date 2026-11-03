import type { TaskReadPort, TaskRecord } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';

export interface CrmTasks {
  /** Whether `tasks` is effectively present. Ask before anything else here. */
  isPresent(): boolean;
  /**
   * The Tasks of `ids` the caller may see — hidden, missing and malformed ids
   * are absent. **Only while {@link CrmTasks.isPresent}**: with the owner off
   * the port's gate throws, and nothing here catches it.
   */
  findByIds(ids: readonly string[]): Promise<TaskRecord[]>;
  /** Tasks the caller may see by number or title, newest first. The same precondition. */
  search(q: string, limit: number): Promise<TaskRecord[]>;
}

/**
 * Tasks, through `tasks`' own read port (`specs/163-projects-and-tasks/`
 * FR-044, research R-14) — a reference to a Task in an Opportunity's text, and
 * the Tasks group of the `@@` document list.
 *
 * `tasks` is operator-switchable and this module only *degrades* without it
 * (the manifest's `degrades-without` edge): a Task referred to renders as
 * unavailable and Tasks are not offered after `@@`. So every caller **decides
 * presence first** — `isPresent()` — as `crm-quote-requests.ts` has it for
 * Quote Requests, and nothing here or in a caller catches a closed gate as a
 * signal. What a Task's context hides from the caller (research R-9) the port
 * already leaves out.
 *
 * A function rather than an object literal at the composition site, for
 * `check:port-catches`, which follows the port through the value.
 */
export function createCrmTasks(port: TaskReadPort): CrmTasks {
  return {
    isPresent: () => effectiveState.isPresent('tasks'),
    findByIds: (ids) => port.findByIds(ids),
    search: (q, limit) => port.search({ q, limit }),
  };
}
