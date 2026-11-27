/**
 * The Stage workflow of one Project — pure domain (FR-011, research R-5).
 *
 * A Project's Stages, ordered by position, and the moves permitted between
 * them. The loader builds a `StageGraph` from the persisted rows and asks it
 * whether a move is permitted and which Stages no move reaches. The model is
 * CRM's `opportunity-status-graph.ts`, with two differences: the outcome of a
 * Project is not a Stage (a Project can be lost from any Stage, FR-005), so
 * there are no kinds and no initial-status rule; and the workflow belongs to
 * one Project, so a move naming a Stage of another is a structural error.
 */

/** A Stage as the workflow sees it. */
export interface StageNode {
  id: string;
  position: number;
}

/** A permitted move between two Stages of the same Project. */
export interface StageMoveDef {
  fromStageId: string;
  toStageId: string;
}

/** The structural rules a set of moves must keep, by name. */
export type StageGraphRule = 'move_unknown_stage' | 'move_self' | 'move_duplicate';

export class StageGraphError extends Error {
  constructor(
    readonly rule: StageGraphRule,
    message: string,
  ) {
    super(message);
    this.name = 'StageGraphError';
  }
}

function byPosition(stages: readonly StageNode[]): StageNode[] {
  return [...stages].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

/** The default workflow (FR-011): each Stage → the next one by position. */
export function defaultLinearMoves(stages: readonly StageNode[]): StageMoveDef[] {
  const ordered = byPosition(stages);
  const moves: StageMoveDef[] = [];
  for (let index = 0; index + 1 < ordered.length; index += 1) {
    moves.push({ fromStageId: ordered[index]!.id, toStageId: ordered[index + 1]!.id });
  }
  return moves;
}

/** An immutable view of one Project's workflow. Build one per operation and ask it. */
export class StageGraph {
  private readonly ordered: StageNode[];
  private readonly positionOf: Map<string, number>;
  private readonly adjacency = new Map<string, Set<string>>();

  /** Throws {@link StageGraphError} when a move breaks a structural rule. */
  constructor(
    stages: readonly StageNode[],
    public readonly moves: readonly StageMoveDef[],
  ) {
    this.ordered = byPosition(stages);
    this.positionOf = new Map(this.ordered.map((stage) => [stage.id, stage.position]));
    for (const move of moves) {
      if (!this.positionOf.has(move.fromStageId) || !this.positionOf.has(move.toStageId)) {
        throw new StageGraphError(
          'move_unknown_stage',
          `A move names a Stage that is not one of this Project's: ${move.fromStageId} → ${move.toStageId}.`,
        );
      }
      if (move.fromStageId === move.toStageId) {
        throw new StageGraphError('move_self', 'A move must connect two different Stages.');
      }
      const targets = this.adjacency.get(move.fromStageId) ?? new Set<string>();
      if (targets.has(move.toStageId)) {
        throw new StageGraphError('move_duplicate', 'Each move may appear once.');
      }
      targets.add(move.toStageId);
      this.adjacency.set(move.fromStageId, targets);
    }
  }

  has(stageId: string): boolean {
    return this.positionOf.has(stageId);
  }

  /** The first Stage by position, or `null` when there is none. */
  first(): string | null {
    return this.ordered[0]?.id ?? null;
  }

  /** The last Stage by position, or `null` when there is none. */
  last(): string | null {
    return this.ordered[this.ordered.length - 1]?.id ?? null;
  }

  /** True when both ends are Stages of this Project and the move `from → to` is permitted. */
  canMove(from: string, to: string): boolean {
    if (!this.positionOf.has(from) || !this.positionOf.has(to)) return false;
    return this.adjacency.get(from)?.has(to) ?? false;
  }

  /** The Stages `from` may move to, by position. */
  targets(from: string): string[] {
    return [...(this.adjacency.get(from) ?? [])].sort(
      (a, b) => (this.positionOf.get(a) ?? 0) - (this.positionOf.get(b) ?? 0),
    );
  }

  /**
   * Stages no chain of permitted moves reaches from the first Stage, by
   * position — a warning for the workflow editor, never a refusal (spec edge
   * case "a Stage's permitted moves leave it unreachable").
   */
  unreachable(): string[] {
    const start = this.first();
    if (start === null) return [];
    const reached = new Set<string>([start]);
    const queue = [start];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of this.adjacency.get(current) ?? []) {
        if (reached.has(next)) continue;
        reached.add(next);
        queue.push(next);
      }
    }
    return this.ordered.filter((stage) => !reached.has(stage.id)).map((stage) => stage.id);
  }
}
