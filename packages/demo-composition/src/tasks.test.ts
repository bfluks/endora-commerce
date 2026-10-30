import type { EntityManager } from '@mikro-orm/postgresql';
import { extractRecordReferenceTokens } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import { createDemoComposition, DEMO_COMPOSITION_STEP_NAMES } from './composition.js';
import { DEMO_PROJECT_TASKS_STEP_NAME } from './projects.js';
import {
  DEMO_TASK_COMMENTS,
  DEMO_TASK_IDS,
  DEMO_TAG_IDS,
  DEMO_TASK_TAGS,
  DEMO_TASKS,
  DEMO_TASKS_MODULES,
  DEMO_TASKS_STEP_NAME,
  demoTasksStep,
} from './tasks.js';

/**
 * What the standalone demo Tasks are, read off their declaration
 * (`specs/165-task-management/` T088, research R-23).
 *
 * `backend/test/integration/demo/demo-shop.test.ts` seeds them and holds the
 * rows to its recorded delta. These need no database: ten Tasks without a
 * Project — two tags and a priority, a parent with three sub-tasks, two
 * comments carrying references, one private Task and one draft of the demo
 * administrator's — in a step of their own after the Project Tasks, which
 * skips naming `tasks` where it is absent.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SEEDED_PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const SEEDED_STATUSES = ['todo', 'in_progress', 'done', 'cancelled'];

const untouchable = new Proxy({} as EntityManager, {
  get(_target, property) {
    throw new Error(`the composition used the EntityManager (${String(property)})`);
  },
});

describe('the standalone demo Tasks', () => {
  it('are ten, with fixed distinct ids, none in a context', () => {
    expect(DEMO_TASKS).toHaveLength(10);
    expect(new Set(DEMO_TASK_IDS).size).toBe(10);
    for (const id of [...DEMO_TASK_IDS, ...DEMO_TAG_IDS, ...DEMO_TASK_COMMENTS.map((comment) => comment.id)]) {
      expect(id).toMatch(UUID);
    }
  });

  it('use only the seeded statuses and priorities, at least one priority and two tags', () => {
    for (const task of DEMO_TASKS) {
      expect(SEEDED_STATUSES).toContain(task.status);
      if (task.priority !== null) expect(SEEDED_PRIORITIES).toContain(task.priority);
    }
    expect(DEMO_TASKS.some((task) => task.priority !== null)).toBe(true);
    expect(DEMO_TASK_TAGS).toHaveLength(2);
    const used = new Set(DEMO_TASKS.flatMap((task) => task.tags));
    expect(used).toEqual(new Set(DEMO_TASK_TAGS.map((tag) => tag.key)));
  });

  it('hold a parent with three sub-tasks, the parent before them', () => {
    const parents = DEMO_TASKS.filter((task) => DEMO_TASKS.some((child) => child.parent === task.id));
    expect(parents).toHaveLength(1);
    const children = DEMO_TASKS.filter((task) => task.parent === parents[0]!.id);
    expect(children).toHaveLength(3);
    const order = DEMO_TASKS.map((task) => task.id);
    for (const child of children) expect(order.indexOf(child.id)).toBeGreaterThan(order.indexOf(parents[0]!.id));
  });

  it('carry two comments whose bodies hold references, on demo Tasks', () => {
    expect(DEMO_TASK_COMMENTS).toHaveLength(2);
    for (const comment of DEMO_TASK_COMMENTS) {
      expect(DEMO_TASK_IDS).toContain(comment.taskId);
      expect(comment.body.some((part) => typeof part !== 'string')).toBe(true);
    }
  });

  it('keep one private Task and one draft, neither assigned to anybody but the demo administrator', () => {
    const hidden = DEMO_TASKS.filter((task) => task.private || task.draft);
    expect(hidden.filter((task) => task.private)).toHaveLength(1);
    expect(hidden.filter((task) => task.draft)).toHaveLength(1);
    for (const task of hidden) {
      expect(task.parent).toBeNull();
      expect(task.assignees.every((person) => person === 'admin')).toBe(true);
    }
    // A draft is open work nobody has been told about yet.
    expect(DEMO_TASKS.find((task) => task.draft)!.status).toBe('todo');
  });

  it('name a referenced Task only among the demo Tasks, in the token grammar', () => {
    for (const comment of DEMO_TASK_COMMENTS) {
      for (const part of comment.body) {
        if (typeof part !== 'string' && 'task' in part) expect(DEMO_TASK_IDS).toContain(part.task);
      }
    }
    // The grammar is the contracts package's: a rendered token round-trips.
    expect(extractRecordReferenceTokens(`[[task:${DEMO_TASK_IDS[0]}]]`)).toEqual([
      { type: 'task', id: DEMO_TASK_IDS[0] },
    ]);
  });
});

describe('the step', () => {
  it('follows the Project Tasks and names what it touches', () => {
    const names = [...DEMO_COMPOSITION_STEP_NAMES];
    expect(names.indexOf(DEMO_TASKS_STEP_NAME)).toBe(names.indexOf(DEMO_PROJECT_TASKS_STEP_NAME) + 1);
    expect(demoTasksStep.modules).toEqual(DEMO_TASKS_MODULES);
    expect(DEMO_TASKS_MODULES).toContain('tasks');
    expect(DEMO_TASKS_MODULES).not.toContain('projects');
  });

  it('skips, naming tasks, where tasks is absent — and touches nothing to decide it', async () => {
    const result = await createDemoComposition({ em: untouchable, isPresent: () => false }).apply();
    const reasons = new Map(result.skipped.map((entry) => [entry.step, entry.reason]));
    expect(reasons.get(DEMO_TASKS_STEP_NAME)).toContain('tasks');
  });
});
