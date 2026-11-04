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

const ME = '00000000-0000-4000-8000-0000000000e1';
const OTHER = '00000000-0000-4000-8000-0000000000e2';

/** The caller's draft/private standing (research R-3): who they are, and whether they hold `tasks:see_private`. */
interface Viewer {
  adminUserId: string | null;
  seePrivate: boolean;
}
const PLAIN: Viewer = { adminUserId: ME, seePrivate: false };

function visibility(contributors: TaskContextDescriptor[], system = false, viewer: Viewer = PLAIN): TaskVisibility {
  return new TaskVisibility({
    contributors: () => contributors,
    isSystemActor: () => system,
    viewer: async () => viewer,
  });
}

/** The draft/private conjunct R-3 adds to every caller but the system. */
const MINE_OR_PUBLISHED = '(t."created_by_admin_user_id" = ?::uuid or (not t."is_draft" and not t."is_private"))';
const MINE_OR_PUBLISHED_WITH_PRIVATE = '(t."created_by_admin_user_id" = ?::uuid or not t."is_draft")';

describe('taskVisibilitySql — the pre-filter of research R-9', () => {
  it('with no contributor present, shows only Tasks without a context', () => {
    expect(taskVisibilitySql({ unrestricted: false, contexts: [], viewer: PLAIN }, 't')).toEqual({
      sql: `(t."context_type" is null) and ${MINE_OR_PUBLISHED}`,
      params: [ME],
    });
  });

  it('with one contributor, adds that type restricted to its visible ids', () => {
    expect(
      taskVisibilitySql({ unrestricted: false, contexts: [{ contextType: 'probe', ids: [A, B] }], viewer: PLAIN }, 't'),
    ).toEqual({
      sql: `(t."context_type" is null or (t."context_type" = ? and t."context_id" = any(?::uuid[]))) and ${MINE_OR_PUBLISHED}`,
      params: ['probe', `{"${A}","${B}"}`, ME],
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
        viewer: PLAIN,
      },
      'x',
    );
    expect(filter).toEqual({
      sql:
        '(x."context_type" is null' +
        ' or (x."context_type" = ? and x."context_id" = any(?::uuid[]))' +
        ' or (x."context_type" = ? and x."context_id" = any(?::uuid[])))' +
        ' and (x."created_by_admin_user_id" = ?::uuid or (not x."is_draft" and not x."is_private"))',
      params: ['probe', `{"${A}"}`, 'other', `{"${C}"}`, ME],
    });
  });

  it('drops a type whose visible set is empty — nothing of it can match', () => {
    expect(
      taskVisibilitySql({ unrestricted: false, contexts: [{ contextType: 'probe', ids: [] }], viewer: PLAIN }, 't'),
    ).toEqual({
      sql: `(t."context_type" is null) and ${MINE_OR_PUBLISHED}`,
      params: [ME],
    });
  });

  it('answers no filter at all for an unrestricted caller', () => {
    expect(taskVisibilitySql({ unrestricted: true }, 't')).toBeNull();
  });
});

/** A Task as `canSee` is asked about it: published, public, somebody else's, unless overridden. */
function task(overrides: Partial<Parameters<TaskVisibility['canSee']>[0]> = {}): Parameters<TaskVisibility['canSee']>[0] {
  return { contextType: null, contextId: null, createdByAdminUserId: OTHER, draft: false, private: false, ...overrides };
}

describe('TaskVisibility — asking the present contributors', () => {
  it('with no contributor, filters to Tasks without a context', async () => {
    expect(await visibility([]).condition('t')).toEqual({
      sql: `(t."context_type" is null) and ${MINE_OR_PUBLISHED}`,
      params: [ME],
    });
  });

  it('asks one contributor for every id the caller may see', async () => {
    const probe = descriptor('probe', [A, B]);
    const filter = await visibility([probe]).condition('t');
    expect(probe.allVisibleContextIds).toHaveBeenCalledTimes(1);
    expect(filter?.params).toEqual(['probe', `{"${A}","${B}"}`, ME]);
  });

  it('asks two contributors, each for its own type', async () => {
    const probe = descriptor('probe', [A]);
    const other = descriptor('other', [C]);
    const filter = await visibility([probe, other]).condition('t');
    expect(filter?.params).toEqual(['probe', `{"${A}"}`, 'other', `{"${C}"}`, ME]);
  });

  it('a contributor answering an empty set adds nothing', async () => {
    const probe = descriptor('probe', []);
    expect(await visibility([probe]).condition('t')).toEqual({
      sql: `(t."context_type" is null) and ${MINE_OR_PUBLISHED}`,
      params: [ME],
    });
  });

  it('does not narrow the system actor, and asks no contributor', async () => {
    const probe = descriptor('probe', [A]);
    expect(await visibility([probe], true).condition('t')).toBeNull();
    expect(probe.allVisibleContextIds).not.toHaveBeenCalled();
  });

  describe('one Task', () => {
    it('a Task without a context is visible to anyone', async () => {
      expect(await visibility([]).canSee(task({ contextType: null, contextId: null }))).toBe(true);
    });

    it('a Task of a present contributor is visible exactly when the contributor lists its id', async () => {
      const probe = descriptor('probe', [A]);
      const subject = visibility([probe]);
      expect(await subject.canSee(task({ contextType: 'probe', contextId: A }))).toBe(true);
      expect(await subject.canSee(task({ contextType: 'probe', contextId: B }))).toBe(false);
      expect(probe.visibleContextIds).toHaveBeenCalledWith([B]);
      expect(probe.allVisibleContextIds).not.toHaveBeenCalled();
    });

    it('a Task of a type no present contributor owns is hidden — fail-closed', async () => {
      expect(await visibility([descriptor('probe', [A])]).canSee(task({ contextType: 'gone', contextId: A }))).toBe(false);
    });

    it('the system actor sees every Task', async () => {
      expect(await visibility([], true).canSee(task({ contextType: 'gone', contextId: A }))).toBe(true);
    });
  });
});

describe('TaskVisibility — drafts and private Tasks (research R-3)', () => {
  const SEES_PRIVATE: Viewer = { adminUserId: ME, seePrivate: true };

  it('the Creator sees their own draft and their own private Task', async () => {
    const subject = visibility([]);
    expect(await subject.canSee(task({ createdByAdminUserId: ME, draft: true }))).toBe(true);
    expect(await subject.canSee(task({ createdByAdminUserId: ME, private: true }))).toBe(true);
    expect(await subject.canSee(task({ createdByAdminUserId: ME, draft: true, private: true }))).toBe(true);
  });

  it('another admin sees neither', async () => {
    const subject = visibility([]);
    expect(await subject.canSee(task({ draft: true }))).toBe(false);
    expect(await subject.canSee(task({ private: true }))).toBe(false);
    expect(await subject.canSee(task())).toBe(true);
  });

  it('a holder of tasks:see_private sees the private Task and not the draft', async () => {
    const subject = visibility([], false, SEES_PRIVATE);
    expect(await subject.canSee(task({ private: true }))).toBe(true);
    expect(await subject.canSee(task({ draft: true }))).toBe(false);
    expect(await subject.canSee(task({ draft: true, private: true }))).toBe(false);
  });

  it('the system actor sees everything, and is not asked who it is', async () => {
    const viewer = vi.fn(async () => PLAIN);
    const subject = new TaskVisibility({ contributors: () => [], isSystemActor: () => true, viewer });
    expect(await subject.canSee(task({ draft: true }))).toBe(true);
    expect(await subject.canSee(task({ private: true }))).toBe(true);
    expect(await subject.condition('t')).toBeNull();
    expect(viewer).not.toHaveBeenCalled();
  });

  it('a hidden draft is hidden before its context is asked about', async () => {
    const probe = descriptor('probe', [A]);
    expect(await visibility([probe]).canSee(task({ contextType: 'probe', contextId: A, draft: true }))).toBe(false);
    expect(probe.visibleContextIds).not.toHaveBeenCalled();
  });

  it('the list pre-filter carries the same rule: own rows, or published and public — or published for a see_private holder', async () => {
    expect((await visibility([]).condition('t'))?.sql).toContain(MINE_OR_PUBLISHED);
    const withPrivate = await visibility([], false, SEES_PRIVATE).condition('t');
    expect(withPrivate).toEqual({
      sql: `(t."context_type" is null) and ${MINE_OR_PUBLISHED_WITH_PRIVATE}`,
      params: [ME],
    });
  });

  it('a caller with no administrator behind it sees no draft and no private Task at all', async () => {
    const anonymous = visibility([], false, { adminUserId: null, seePrivate: false });
    expect(await anonymous.condition('t')).toEqual({
      sql: '(t."context_type" is null) and (not t."is_draft" and not t."is_private")',
      params: [],
    });
    expect(await anonymous.canSee(task({ private: true }))).toBe(false);
  });
});
