import { describe, expect, it } from 'vitest';
import { defaultLinearMoves, StageGraph, StageGraphError, type StageNode } from './stage-graph.js';

/**
 * The Stage workflow of one Project — pure domain (FR-011, research R-5).
 */

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';
const D = 'aaaaaaaa-0000-4000-8000-000000000004';
const FOREIGN = 'ffffffff-0000-4000-8000-000000000009';

/** Positions deliberately out of array order: the graph reads positions, not the array. */
const stages: StageNode[] = [
  { id: C, position: 3 },
  { id: A, position: 1 },
  { id: B, position: 2 },
];

describe('defaultLinearMoves', () => {
  it('lets each Stage move to the next one by position', () => {
    expect(defaultLinearMoves(stages)).toEqual([
      { fromStageId: A, toStageId: B },
      { fromStageId: B, toStageId: C },
    ]);
  });

  it('is empty for one Stage and for none', () => {
    expect(defaultLinearMoves([{ id: A, position: 1 }])).toEqual([]);
    expect(defaultLinearMoves([])).toEqual([]);
  });
});

describe('StageGraph', () => {
  it('canMove answers the configured edges only, in their direction', () => {
    const graph = new StageGraph(stages, defaultLinearMoves(stages));
    expect(graph.canMove(A, B)).toBe(true);
    expect(graph.canMove(B, C)).toBe(true);
    expect(graph.canMove(B, A)).toBe(false);
    expect(graph.canMove(A, C)).toBe(false);
    expect(graph.canMove(A, A)).toBe(false);
  });

  it('canMove is false for a Stage that is not the Project’s', () => {
    const graph = new StageGraph(stages, defaultLinearMoves(stages));
    expect(graph.canMove(A, FOREIGN)).toBe(false);
    expect(graph.canMove(FOREIGN, A)).toBe(false);
  });

  it('a backward and a skipping move are honoured once configured', () => {
    const graph = new StageGraph(stages, [
      ...defaultLinearMoves(stages),
      { fromStageId: C, toStageId: A },
      { fromStageId: A, toStageId: C },
    ]);
    expect(graph.canMove(C, A)).toBe(true);
    expect(graph.canMove(A, C)).toBe(true);
    expect(graph.targets(A)).toEqual([B, C]);
  });

  it('names the first and the last Stage by position', () => {
    const graph = new StageGraph(stages, []);
    expect(graph.first()).toBe(A);
    expect(graph.last()).toBe(C);
    expect(new StageGraph([], []).first()).toBeNull();
  });

  describe('unreachable()', () => {
    it('is empty for the default linear workflow', () => {
      expect(new StageGraph(stages, defaultLinearMoves(stages)).unreachable()).toEqual([]);
    });

    it('names, by position, every Stage no permitted move reaches from the first', () => {
      const four = [...stages, { id: D, position: 4 }];
      // A → B, and C → D: neither C nor D can be reached from A.
      const graph = new StageGraph(four, [
        { fromStageId: A, toStageId: B },
        { fromStageId: C, toStageId: D },
      ]);
      expect(graph.unreachable()).toEqual([C, D]);
    });

    it('follows skips and cycles without looping', () => {
      const graph = new StageGraph(stages, [
        { fromStageId: A, toStageId: C },
        { fromStageId: C, toStageId: A },
      ]);
      expect(graph.unreachable()).toEqual([B]);
    });

    it('a single Stage is reachable — it is the first', () => {
      expect(new StageGraph([{ id: A, position: 1 }], []).unreachable()).toEqual([]);
    });
  });

  describe('refuses a workflow it cannot hold', () => {
    it('a move naming a Stage of another Project', () => {
      expect(() => new StageGraph(stages, [{ fromStageId: A, toStageId: FOREIGN }])).toThrow(StageGraphError);
      try {
        new StageGraph(stages, [{ fromStageId: FOREIGN, toStageId: A }]);
      } catch (error) {
        expect(error).toBeInstanceOf(StageGraphError);
        expect((error as StageGraphError).rule).toBe('move_unknown_stage');
      }
    });

    it('a move from a Stage to itself', () => {
      expect(() => new StageGraph(stages, [{ fromStageId: A, toStageId: A }])).toThrow(
        expect.objectContaining({ rule: 'move_self' }),
      );
    });

    it('the same move twice', () => {
      expect(
        () =>
          new StageGraph(stages, [
            { fromStageId: A, toStageId: B },
            { fromStageId: A, toStageId: B },
          ]),
      ).toThrow(expect.objectContaining({ rule: 'move_duplicate' }));
    });
  });
});
