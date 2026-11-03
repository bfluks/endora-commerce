import { describe, expect, it } from 'vitest';
import { TASK_HIERARCHY_DEPTH_MAX } from '@endora-commerce/contracts';
import { parentChangeRefusal } from './hierarchy.js';

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `level-${n - i}`);

describe('parentChangeRefusal (FR-027, R-15)', () => {
  it('refuses a Task as its own parent', () => {
    expect(parentChangeRefusal('a', 'a', { parentChain: ['a'], subtreeHeight: 1 })).toBe('cycle');
  });

  it('refuses a Task as the child of one of its descendants, however deep', () => {
    // a ← b ← c: making `a` a child of `c` — `c`'s chain is c, b, a.
    expect(parentChangeRefusal('a', 'c', { parentChain: ['c', 'b', 'a'], subtreeHeight: 3 })).toBe('cycle');
    expect(parentChangeRefusal('a', 'b', { parentChain: ['b', 'a'], subtreeHeight: 3 })).toBe('cycle');
  });

  it('names a cycle before a depth: the cycle is the reason the move can never succeed', () => {
    expect(parentChangeRefusal('a', 'x', { parentChain: [...ids(5), 'a'], subtreeHeight: 4 })).toBe('cycle');
  });

  it(`allows a new Task under level ${TASK_HIERARCHY_DEPTH_MAX - 1} and refuses one under level ${TASK_HIERARCHY_DEPTH_MAX}`, () => {
    expect(
      parentChangeRefusal(null, 'p', { parentChain: ids(TASK_HIERARCHY_DEPTH_MAX - 1), subtreeHeight: 1 }),
    ).toBeNull();
    expect(parentChangeRefusal(null, 'p', { parentChain: ids(TASK_HIERARCHY_DEPTH_MAX), subtreeHeight: 1 })).toBe(
      'too_deep',
    );
  });

  it('counts the levels the moved Task brings with it', () => {
    // A Task with one level of sub-tasks is two levels: under level 3 it reaches 5, under level 4 it reaches 6.
    expect(parentChangeRefusal('t', 'p', { parentChain: ids(3), subtreeHeight: 2 })).toBeNull();
    expect(parentChangeRefusal('t', 'p', { parentChain: ids(4), subtreeHeight: 2 })).toBe('too_deep');
  });

  it('allows a top-level parent and reads a missing height as one level', () => {
    expect(parentChangeRefusal('t', 'p', { parentChain: ['p'], subtreeHeight: 0 })).toBeNull();
    expect(parentChangeRefusal('t', 'p', { parentChain: ['p'], subtreeHeight: 4 })).toBeNull();
    expect(parentChangeRefusal('t', 'p', { parentChain: ['p'], subtreeHeight: 5 })).toBe('too_deep');
  });

  it('honours another bound when one is given', () => {
    expect(parentChangeRefusal(null, 'p', { parentChain: ids(2), subtreeHeight: 1 }, 2)).toBe('too_deep');
  });
});
