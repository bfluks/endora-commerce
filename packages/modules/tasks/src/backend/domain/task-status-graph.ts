import type { TaskStatusCategory } from '@endora-commerce/contracts';

/**
 * The Task status workflow — pure domain (`specs/165-task-management/`
 * research R-1), copied from CRM's `OpportunityStatusGraph` with a category in
 * place of CRM's kind.
 *
 * A set of statuses and a set of permitted directed moves between them, both
 * configured at runtime. This file holds the database-free representation and
 * its structural rules (FR-013); the loader builds a `TaskStatusGraph` from the
 * persisted rows and asks it "is this move allowed?". A status's `category`
 * says what it means for the Task: still worked (`open`), finished (`done`) or
 * abandoned (`cancelled`) — *closed* is either of the last two (FR-017). A
 * closed status may have outgoing moves, which is how a Task is reopened.
 */

export interface TaskStatusDef {
  code: string;
  /** Localized labels, e.g. `{ en: 'To do', pl: 'Do zrobienia' }`. */
  name: Record<string, string>;
  /** Fallback when the viewer's language has no entry in `name`. */
  defaultName: string;
  category: TaskStatusCategory;
  isInitial: boolean;
  /** Display order, and the board's column order. */
  weight: number;
  /** `#rrggbb`. */
  color: string;
}

export interface TaskTransitionDef {
  fromCode: string;
  toCode: string;
}

/**
 * The structural rules of a workflow, by name — what a refused configuration
 * write reports as 422 `TASK_WORKFLOW_INVALID {rule}`.
 */
export type TaskWorkflowRule =
  | 'exactly_one_initial'
  | 'initial_must_be_open'
  | 'done_status_required'
  | 'cancelled_status_required'
  | 'transition_unknown_status';

export class TaskWorkflowConfigError extends Error {
  constructor(
    readonly rule: TaskWorkflowRule,
    message: string,
  ) {
    super(message);
    this.name = 'TaskWorkflowConfigError';
  }
}

/** A status's label in a language: `name[language]`, the default name, the code. */
export function resolveTaskStatusName(
  def: { name: Record<string, string>; defaultName?: string | null; code: string },
  language: string,
): string {
  return def.name[language] || def.defaultName || def.code;
}

/** An immutable view of the configured workflow. Build one per operation and ask it. */
export class TaskStatusGraph {
  private readonly byCode: Map<string, TaskStatusDef>;
  private readonly adjacency: Map<string, Set<string>>;

  constructor(
    public readonly statuses: readonly TaskStatusDef[],
    public readonly transitions: readonly TaskTransitionDef[],
  ) {
    this.byCode = new Map(statuses.map((status) => [status.code, status]));
    this.adjacency = new Map();
    for (const transition of transitions) {
      const targets = this.adjacency.get(transition.fromCode) ?? new Set<string>();
      targets.add(transition.toCode);
      this.adjacency.set(transition.fromCode, targets);
    }
  }

  has(code: string): boolean {
    return this.byCode.has(code);
  }

  get(code: string): TaskStatusDef | undefined {
    return this.byCode.get(code);
  }

  /** `undefined` for a code that is not a configured status. */
  categoryOf(code: string): TaskStatusCategory | undefined {
    return this.byCode.get(code)?.category;
  }

  /** Category `done` or `cancelled`. A code the workflow no longer holds closes nothing. */
  isClosed(code: string): boolean {
    const category = this.categoryOf(code);
    return category === 'done' || category === 'cancelled';
  }

  /** The one initial status. Throws when the workflow does not have exactly one. */
  initial(): TaskStatusDef {
    const initials = this.statuses.filter((status) => status.isInitial);
    const [only] = initials;
    if (initials.length !== 1 || only === undefined) {
      throw new TaskWorkflowConfigError(
        'exactly_one_initial',
        `Exactly one initial status is required, found ${initials.length}.`,
      );
    }
    return only;
  }

  /** The configured targets of `from` that are configured statuses, by weight. */
  allowedTargets(from: string): string[] {
    const weightOf = (code: string): number => this.byCode.get(code)?.weight ?? 0;
    return [...(this.adjacency.get(from) ?? [])]
      .filter((code) => this.byCode.has(code))
      .sort((a, b) => weightOf(a) - weightOf(b));
  }

  /** Both ends configured and the edge `from → to` exists. The category of `from` is not consulted. */
  canTransition(from: string, to: string): boolean {
    if (!this.byCode.has(from) || !this.byCode.has(to)) return false;
    return this.adjacency.get(from)?.has(to) ?? false;
  }

  /**
   * FR-013, checked at the end of every configuration Command: exactly one
   * initial status and it is open; at least one done and one cancelled status;
   * every move names two configured statuses.
   */
  assertValid(): void {
    const initial = this.initial();
    if (initial.category !== 'open') {
      throw new TaskWorkflowConfigError(
        'initial_must_be_open',
        `The initial status "${initial.code}" must be an open status.`,
      );
    }
    if (!this.statuses.some((status) => status.category === 'done')) {
      throw new TaskWorkflowConfigError('done_status_required', 'At least one status that finishes a Task is required.');
    }
    if (!this.statuses.some((status) => status.category === 'cancelled')) {
      throw new TaskWorkflowConfigError(
        'cancelled_status_required',
        'At least one status that cancels a Task is required.',
      );
    }
    for (const transition of this.transitions) {
      if (!this.byCode.has(transition.fromCode) || !this.byCode.has(transition.toCode)) {
        throw new TaskWorkflowConfigError(
          'transition_unknown_status',
          `A move names a status that is not configured: ${transition.fromCode} → ${transition.toCode}.`,
        );
      }
    }
  }
}
