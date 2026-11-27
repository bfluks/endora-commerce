import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';

import { createDemoComposition, DEMO_COMPOSITION_STEP_NAMES } from './composition.js';
import {
  DEMO_PROJECT_IDS,
  DEMO_PROJECT_TASK_IDS,
  DEMO_PROJECT_TASKS,
  DEMO_PROJECT_TASKS_MODULES,
  DEMO_PROJECT_TASKS_STEP_NAME,
  DEMO_PROJECT_TEMPLATE,
  DEMO_PROJECTS,
  DEMO_PROJECTS_MODULES,
  DEMO_PROJECTS_STEP_NAME,
  demoProjectsStep,
  demoProjectTasksStep,
} from './projects.js';

/**
 * What the demo Projects are, read off their declaration
 * (`specs/163-projects-and-tasks/` T134, research R-20).
 *
 * `backend/test/integration/demo/demo-shop.test.ts` seeds them into a database
 * and holds the rows to its recorded delta. These are the statements that need
 * no database: one Template *Showroom fit-out* whose first Stage is gated by
 * Stage Tasks (the manual walk of `quickstart.md`), four Projects — open,
 * completed, lost and internal — walked along that Template's workflow in the
 * order time runs, Tasks only in a step of their own that asks for `tasks`,
 * every one of them created by the demo administrator, and a step whose module
 * is absent a reported skip that touches nothing.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** The Project Roles and loss reasons `projects`' init migration seeds. */
const SEEDED_ROLES = ['sales_rep', 'project_manager'];
const SEEDED_LOSS_REASONS = ['price', 'competitor', 'cancelled_by_client', 'no_decision', 'other'];

const untouchable = new Proxy({} as EntityManager, {
  get(_target, property) {
    throw new Error(`the composition used the EntityManager (${String(property)})`);
  },
});

const stageOf = (key: string) => DEMO_PROJECT_TEMPLATE.stages.find((stage) => stage.key === key);
const moves = new Set(DEMO_PROJECT_TEMPLATE.moves.map(([from, to]) => `${from}->${to}`));

describe('the demo Template', () => {
  it('is Showroom fit-out, its first Stage gated by Stage Tasks, its last the one a Project completes in', () => {
    expect(DEMO_PROJECT_TEMPLATE.name).toBe('Showroom fit-out');
    const [first] = DEMO_PROJECT_TEMPLATE.stages;
    expect(first?.completionGate).toBe(true);
    expect(first?.tasks.length).toBeGreaterThanOrEqual(2);
    expect(DEMO_PROJECT_TEMPLATE.stages.at(-1)?.completionPermitted).toBe(true);
    for (const stage of DEMO_PROJECT_TEMPLATE.stages.slice(0, -1)) expect(stage.completionPermitted, stage.name).toBe(false);
  });

  it('moves each Stage on to the next, and names only the Roles the migration seeds', () => {
    const keys = DEMO_PROJECT_TEMPLATE.stages.map((stage) => stage.key);
    for (const [index, key] of keys.slice(0, -1).entries()) expect(moves.has(`${key}->${keys[index + 1]}`), key).toBe(true);
    for (const [from, to] of DEMO_PROJECT_TEMPLATE.moves) {
      expect(stageOf(from), from).toBeDefined();
      expect(stageOf(to), to).toBeDefined();
    }
    for (const stage of DEMO_PROJECT_TEMPLATE.stages) {
      for (const role of stage.responsibleRoles) expect(SEEDED_ROLES).toContain(role);
      for (const task of stage.tasks) if (task.role) expect(SEEDED_ROLES).toContain(task.role);
      expect(stage.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('the demo Projects', () => {
  it('are four — open, completed, lost and an internal one — each on a fixed id of its own', () => {
    expect(DEMO_PROJECTS.map((project) => [project.state, project.internal === true])).toEqual([
      ['open', false],
      ['completed', false],
      ['lost', false],
      ['open', true],
    ]);
    const ids = [
      DEMO_PROJECT_TEMPLATE.id,
      ...DEMO_PROJECT_TEMPLATE.stages.flatMap((stage) => [stage.id, ...stage.tasks.map((task) => task.id)]),
      ...DEMO_PROJECT_IDS,
      ...DEMO_PROJECT_TASK_IDS,
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(UUID);
  });

  it('walk the Template’s workflow from its first Stage, in the order time runs, none in the future', () => {
    for (const project of DEMO_PROJECTS) {
      expect(project.path[0]?.stage, project.title).toBe(DEMO_PROJECT_TEMPLATE.stages[0]?.key);
      const days = project.path.map((step) => step.daysAgo);
      expect(days, project.title).toEqual([...days].sort((a, b) => b - a));
      expect(Math.min(...days), project.title).toBeGreaterThan(0);
      for (const [index, step] of project.path.entries()) {
        if (index === 0) continue;
        expect(moves.has(`${project.path[index - 1]!.stage}->${step.stage}`), `${project.title}: ${step.stage}`).toBe(true);
      }
      if (project.closed) expect(project.closed.daysAgo, project.title).toBeLessThan(project.path.at(-1)!.daysAgo);
    }
  });

  it('close only where the workflow lets them: completed in a Stage that permits it, lost for a seeded reason', () => {
    const completed = DEMO_PROJECTS.find((project) => project.state === 'completed')!;
    expect(stageOf(completed.path.at(-1)!.stage)?.completionPermitted).toBe(true);
    const lost = DEMO_PROJECTS.find((project) => project.state === 'lost')!;
    expect(SEEDED_LOSS_REASONS).toContain(lost.closed?.lossReason);
    for (const project of DEMO_PROJECTS) expect(project.closed === undefined, project.title).toBe(project.state === 'open');
  });

  it('have the demo administrator as a Project Manager of each, and Members holding seeded Roles', () => {
    for (const project of DEMO_PROJECTS) {
      expect(project.members.find((member) => member.person === 'admin')?.roles, project.title).toContain(
        'project_manager',
      );
      for (const member of project.members) for (const role of member.roles) expect(SEEDED_ROLES).toContain(role);
    }
  });
});

describe('the demo Tasks', () => {
  it('are the Stage Tasks of the Stages each Project has entered, in a step that asks for tasks', () => {
    expect(DEMO_PROJECT_TASKS_MODULES).toContain('tasks');
    expect(DEMO_PROJECTS_MODULES).not.toContain('tasks');
    expect(DEMO_PROJECT_TASK_IDS).toHaveLength(DEMO_PROJECT_TASKS.length);
    for (const task of DEMO_PROJECT_TASKS) {
      const project = DEMO_PROJECTS.find((candidate) => candidate.id === task.projectId);
      expect(project, task.title).toBeDefined();
      expect(project!.path.map((step) => step.stage), task.title).toContain(task.stage);
      expect(stageOf(task.stage)?.tasks.map((definition) => definition.title), task.title).toContain(task.title);
    }
  });

  it('leave the open Project’s gated Stage with open Tasks, so the gate has something to refuse', () => {
    const open = DEMO_PROJECTS.find((project) => project.state === 'open' && project.internal !== true)!;
    const current = open.path.at(-1)!.stage;
    expect(stageOf(current)?.completionGate).toBe(true);
    const tasks = DEMO_PROJECT_TASKS.filter((task) => task.projectId === open.id && task.stage === current);
    expect(tasks.some((task) => task.status === 'todo' || task.status === 'in_progress')).toBe(true);
  });

  it('are all closed on a closed Project', () => {
    for (const project of DEMO_PROJECTS.filter((candidate) => candidate.state !== 'open')) {
      for (const task of DEMO_PROJECT_TASKS.filter((candidate) => candidate.projectId === project.id)) {
        expect(['done', 'cancelled'], `${project.title}: ${task.title}`).toContain(task.status);
      }
    }
  });
});

describe('the two steps', () => {
  it('follow the sales pipeline, the Tasks after the Projects they belong to', () => {
    const names = [...DEMO_COMPOSITION_STEP_NAMES];
    expect(names.indexOf(DEMO_PROJECTS_STEP_NAME)).toBeGreaterThan(-1);
    expect(names.indexOf(DEMO_PROJECT_TASKS_STEP_NAME)).toBe(names.indexOf(DEMO_PROJECTS_STEP_NAME) + 1);
    expect(demoProjectsStep.modules).toEqual(DEMO_PROJECTS_MODULES);
    expect(demoProjectTasksStep.modules).toEqual(DEMO_PROJECT_TASKS_MODULES);
  });

  it('skip, naming the module, where projects or tasks is absent — and touch nothing to decide it', async () => {
    // `tasks` present and `projects` not: neither step runs, and both say why.
    const withoutProjects = await createDemoComposition({
      em: untouchable,
      isPresent: (moduleId) => moduleId === 'tasks',
    }).apply();
    const skipped = new Map(withoutProjects.skipped.map((entry) => [entry.step, entry.reason]));
    expect(skipped.get(DEMO_PROJECTS_STEP_NAME)).toContain('projects');
    expect(skipped.get(DEMO_PROJECT_TASKS_STEP_NAME)).toContain('projects');
    // `tasks` is present, so the reason does not name it.
    expect(skipped.get(DEMO_PROJECT_TASKS_STEP_NAME)).not.toMatch(/\btasks\b/);
    // Only `tasks` absent: the Tasks step says so by name.
    const withoutTasks = await createDemoComposition({ em: untouchable, isPresent: () => false }).apply();
    const reasons = new Map(withoutTasks.skipped.map((entry) => [entry.step, entry.reason]));
    expect(reasons.get(DEMO_PROJECT_TASKS_STEP_NAME)).toContain('tasks');
  });
});
