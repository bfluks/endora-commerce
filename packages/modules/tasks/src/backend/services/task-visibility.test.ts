import { describe, expect, it, vi } from 'vitest';
import type { TaskContextDescriptor } from '@endora-commerce/contracts';
import { TaskVisibility, taskVisibilitySql } from './task-visibility.js';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

/** A descriptor whose answers are fixed: `visible` is every id the caller may see. */
function descriptor(contextType: string, visible: string[]): TaskContextDescriptor {
  return {
    contextType,
    ownerModuleId: `${contextType}_owner`,
    allVisibleContextIds: vi.fn(async () => [...visible]),
    visibleContextIds: vi.fn(async (ids: readonly string[]) => new Set(ids.filter((id) => visible.includes(id)))),
    describe: vi.fn(async () => new Map()),
    canSeeAs: vi.fn(async () => false),
    canChangeTasks: vi.fn(async () => false),
  };
}

function visibility(contributors: TaskContextDescriptor[], system = false): TaskVisibility {
  return new TaskVisibility({ contributors: () => contributors, isSystemActor: () => system });
}

describe('taskVisibilitySql — the pre-filter of research R-9', () => {
  it('with no contributor present, shows only Tasks without a context', () => {
    expect(taskVisibilitySql({ unrestricted: false, contexts: [] }, 't')).toEqual({
      sql: '(t."context_type" is null)',
      params: [],
    });
  });

  it('with one contributor, adds that type restricted to its visible ids', () => {
    expect(taskVisibilitySql({ unrestricted: false, contexts: [{ contextType: 'probe', ids: [A, B] }] }, 't')).toEqual({
      sql: '(t."context_type" is null or (t."context_type" = ? and t."context_id" = any(?::uuid[])))',
      params: ['probe', `{"${A}","${B}"}`],
    });
  });

  it('with two contributors, one disjunct per type, in registration order', () => {
    const filter = taskVisibilitySql(
      {
        unrestricted: false,
        contexts: [
          { contextType: 'probe', ids: [A] },
          { contextType: 'other', ids: [C] },
        ],
      },
      'x',
    );
    expect(filter).toEqual({
      sql:
        '(x."context_type" is null' +
        ' or (x."context_type" = ? and x."context_id" = any(?::uuid[]))' +
        ' or (x."context_type" = ? and x."context_id" = any(?::uuid[])))',
      params: ['probe', `{"${A}"}`, 'other', `{"${C}"}`],
    });
  });

  it('drops a type whose visible set is empty — nothing of it can match', () => {
    expect(taskVisibilitySql({ unrestricted: false, contexts: [{ contextType: 'probe', ids: [] }] }, 't')).toEqual({
      sql: '(t."context_type" is null)',
      params: [],
    });
  });

  it('answers no filter at all for an unrestricted caller', () => {
    expect(taskVisibilitySql({ unrestricted: true }, 't')).toBeNull();
  });
});

describe('TaskVisibility — asking the present contributors', () => {
  it('with no contributor, filters to Tasks without a context', async () => {
    expect(await visibility([]).condition('t')).toEqual({ sql: '(t."context_type" is null)', params: [] });
  });

  it('asks one contributor for every id the caller may see', async () => {
    const probe = descriptor('probe', [A, B]);
    const filter = await visibility([probe]).condition('t');
    expect(probe.allVisibleContextIds).toHaveBeenCalledTimes(1);
    expect(filter?.params).toEqual(['probe', `{"${A}","${B}"}`]);
  });

  it('asks two contributors, each for its own type', async () => {
    const probe = descriptor('probe', [A]);
    const other = descriptor('other', [C]);
    const filter = await visibility([probe, other]).condition('t');
    expect(filter?.params).toEqual(['probe', `{"${A}"}`, 'other', `{"${C}"}`]);
  });

  it('a contributor answering an empty set adds nothing', async () => {
    const probe = descriptor('probe', []);
    expect(await visibility([probe]).condition('t')).toEqual({ sql: '(t."context_type" is null)', params: [] });
  });

  it('does not narrow the system actor, and asks no contributor', async () => {
    const probe = descriptor('probe', [A]);
    expect(await visibility([probe], true).condition('t')).toBeNull();
    expect(probe.allVisibleContextIds).not.toHaveBeenCalled();
  });

  describe('one Task', () => {
    it('a Task without a context is visible to anyone', async () => {
      expect(await visibility([]).canSee({ contextType: null, contextId: null })).toBe(true);
    });

    it('a Task of a present contributor is visible exactly when the contributor lists its id', async () => {
      const probe = descriptor('probe', [A]);
      const subject = visibility([probe]);
      expect(await subject.canSee({ contextType: 'probe', contextId: A })).toBe(true);
      expect(await subject.canSee({ contextType: 'probe', contextId: B })).toBe(false);
      expect(probe.visibleContextIds).toHaveBeenCalledWith([B]);
      expect(probe.allVisibleContextIds).not.toHaveBeenCalled();
    });

    it('a Task of a type no present contributor owns is hidden — fail-closed', async () => {
      expect(await visibility([descriptor('probe', [A])]).canSee({ contextType: 'gone', contextId: A })).toBe(false);
    });

    it('the system actor sees every Task', async () => {
      expect(await visibility([], true).canSee({ contextType: 'gone', contextId: A })).toBe(true);
    });
  });
});
