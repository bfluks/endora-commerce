import { describe, expect, it } from 'vitest';
import {
  resolveTaskStatusName,
  TaskStatusGraph,
  TaskWorkflowConfigError,
  type TaskStatusDef,
  type TaskTransitionDef,
} from './task-status-graph.js';

function status(code: string, category: TaskStatusDef['category'], overrides: Partial<TaskStatusDef> = {}): TaskStatusDef {
  return { code, name: {}, defaultName: code, category, isInitial: false, weight: 100, color: '#64748b', ...overrides };
}

const edge = (fromCode: string, toCode: string): TaskTransitionDef => ({ fromCode, toCode });

/** The seeded workflow of `data-model.md` §3: four statuses, every move between them. */
function seededStatuses(): TaskStatusDef[] {
  return [
    status('todo', 'open', { isInitial: true, weight: 10 }),
    status('in_progress', 'open', { weight: 20 }),
    status('done', 'done', { weight: 30 }),
    status('cancelled', 'cancelled', { weight: 40 }),
  ];
}

function seededTransitions(): TaskTransitionDef[] {
  const codes = seededStatuses().map((s) => s.code);
  return codes.flatMap((from) => codes.filter((to) => to !== from).map((to) => edge(from, to)));
}

function ruleOf(act: () => void): string | undefined {
  try {
    act();
  } catch (error) {
    if (error instanceof TaskWorkflowConfigError) return error.rule;
    throw error;
  }
  return undefined;
}

describe('TaskStatusGraph (research R-1)', () => {
  const graph = new TaskStatusGraph(seededStatuses(), seededTransitions());

  it('knows the configured codes and their categories, and nothing else', () => {
    expect(graph.has('in_progress')).toBe(true);
    expect(graph.has('in_review')).toBe(false);
    expect(graph.categoryOf('todo')).toBe('open');
    expect(graph.categoryOf('done')).toBe('done');
    expect(graph.categoryOf('cancelled')).toBe('cancelled');
    expect(graph.categoryOf('in_review')).toBeUndefined();
  });

  it('closed means category done or cancelled (FR-017); an unknown code closes nothing', () => {
    expect(graph.isClosed('todo')).toBe(false);
    expect(graph.isClosed('in_progress')).toBe(false);
    expect(graph.isClosed('done')).toBe(true);
    expect(graph.isClosed('cancelled')).toBe(true);
    expect(graph.isClosed('in_review')).toBe(false);
  });

  it('answers the one initial status', () => {
    expect(graph.initial().code).toBe('todo');
  });

  it('canTransition: a configured edge between two configured statuses only', () => {
    const narrow = new TaskStatusGraph(seededStatuses(), [edge('todo', 'in_progress'), edge('in_progress', 'done')]);
    expect(narrow.canTransition('todo', 'in_progress')).toBe(true);
    expect(narrow.canTransition('todo', 'done')).toBe(false);
    expect(narrow.canTransition('in_progress', 'todo')).toBe(false);
    expect(narrow.canTransition('todo', 'in_review')).toBe(false);
    expect(narrow.canTransition('in_review', 'todo')).toBe(false);
    expect(narrow.canTransition('todo', 'todo')).toBe(false);
  });

  it('canTransition: a closed status may have outgoing edges — reopening is a move', () => {
    expect(graph.canTransition('done', 'todo')).toBe(true);
    expect(graph.canTransition('cancelled', 'in_progress')).toBe(true);
  });

  it('allowedTargets: the targets of a status, by weight; none for an unknown code', () => {
    expect(graph.allowedTargets('in_progress')).toEqual(['todo', 'done', 'cancelled']);
    expect(graph.allowedTargets('in_review')).toEqual([]);
    const withGhost = new TaskStatusGraph(seededStatuses(), [edge('todo', 'ghost'), edge('todo', 'done')]);
    expect(withGhost.allowedTargets('todo')).toEqual(['done']);
  });

  it('resolveTaskStatusName: the language, then the default name, then the code', () => {
    expect(resolveTaskStatusName({ code: 'todo', name: { en: 'To do', pl: 'Do zrobienia' }, defaultName: 'To do' }, 'pl')).toBe(
      'Do zrobienia',
    );
    expect(resolveTaskStatusName({ code: 'todo', name: {}, defaultName: 'To do' }, 'pl')).toBe('To do');
    expect(resolveTaskStatusName({ code: 'todo', name: {}, defaultName: '' }, 'pl')).toBe('todo');
  });

  describe('assertValid — one refusal per FR-013 rule', () => {
    it('accepts the seeded workflow', () => {
      expect(ruleOf(() => graph.assertValid())).toBeUndefined();
    });

    it('refuses a workflow with no initial status', () => {
      const statuses = seededStatuses().map((s) => ({ ...s, isInitial: false }));
      expect(ruleOf(() => new TaskStatusGraph(statuses, seededTransitions()).assertValid())).toBe('exactly_one_initial');
    });

    it('refuses a workflow with two initial statuses', () => {
      const statuses = seededStatuses().map((s) => (s.code === 'in_progress' ? { ...s, isInitial: true } : s));
      expect(ruleOf(() => new TaskStatusGraph(statuses, seededTransitions()).assertValid())).toBe('exactly_one_initial');
    });

    it('refuses an initial status that is not open', () => {
      const statuses = seededStatuses().map((s) => ({ ...s, isInitial: s.code === 'done' }));
      expect(ruleOf(() => new TaskStatusGraph(statuses, seededTransitions()).assertValid())).toBe('initial_must_be_open');
    });

    it('refuses a workflow with no done status', () => {
      const statuses = seededStatuses().filter((s) => s.category !== 'done');
      const transitions = seededTransitions().filter((t) => t.fromCode !== 'done' && t.toCode !== 'done');
      expect(ruleOf(() => new TaskStatusGraph(statuses, transitions).assertValid())).toBe('done_status_required');
    });

    it('refuses a workflow with no cancelled status', () => {
      const statuses = seededStatuses().filter((s) => s.category !== 'cancelled');
      const transitions = seededTransitions().filter((t) => t.fromCode !== 'cancelled' && t.toCode !== 'cancelled');
      expect(ruleOf(() => new TaskStatusGraph(statuses, transitions).assertValid())).toBe('cancelled_status_required');
    });

    it('refuses a transition naming an unknown status, at either end', () => {
      expect(
        ruleOf(() => new TaskStatusGraph(seededStatuses(), [...seededTransitions(), edge('todo', 'ghost')]).assertValid()),
      ).toBe('transition_unknown_status');
      expect(
        ruleOf(() => new TaskStatusGraph(seededStatuses(), [...seededTransitions(), edge('ghost', 'todo')]).assertValid()),
      ).toBe('transition_unknown_status');
    });

    it('initial() throws the same rule for a workflow without one', () => {
      expect(ruleOf(() => new TaskStatusGraph([], []).initial())).toBe('exactly_one_initial');
    });
  });
});
