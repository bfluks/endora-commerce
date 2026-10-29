import { describe, expect, it } from 'vitest';
import * as tasks from './tasks.js';

/**
 * `specs/163-projects-and-tasks/contracts/admin-api.md` §1 — one accept and one
 * reject case per request schema of the Tasks API, plus the Task context's
 * all-or-nothing rule (`data-model.md` §1) and the event names of
 * `contracts/ports-and-events.md` §1.
 */

const UUID_A = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';
const UUID_B = '6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02';
const UUID_C = '2c4d6e8f-1a3b-4c5d-8e7f-9a0b1c2d3e03';

function accepts(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(true);
}

function rejects(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  expect(schema.safeParse(value).success).toBe(false);
}

describe('statuses', () => {
  it('are the four of the spec, in order', () => {
    expect(tasks.taskStatusSchema.options).toEqual(['todo', 'in_progress', 'done', 'cancelled']);
  });
});

describe('TaskContext — all or nothing', () => {
  it('accepts a type and an id, with or without a group', () => {
    accepts(tasks.TaskContextSchema, { contextType: 'project', contextId: UUID_A });
    accepts(tasks.TaskContextSchema, { contextType: 'project', contextId: UUID_A, contextGroupId: UUID_B });
    accepts(tasks.TaskContextSchema, { contextType: 'project', contextId: UUID_A, contextGroupId: null });
  });

  it('refuses a type without an id, an id without a type, and a group without either', () => {
    rejects(tasks.TaskContextSchema, { contextType: 'project' });
    rejects(tasks.TaskContextSchema, { contextId: UUID_A });
    rejects(tasks.TaskContextSchema, { contextGroupId: UUID_B });
    rejects(tasks.TaskContextSchema, { contextId: UUID_A, contextGroupId: UUID_B });
  });

  it('refuses a context type that is not a snake_case code, and an unknown key', () => {
    rejects(tasks.TaskContextSchema, { contextType: 'Project', contextId: UUID_A });
    rejects(tasks.TaskContextSchema, { contextType: 'project', contextId: UUID_A, projectId: UUID_A });
  });
});

describe('§1 GET /tasks — TaskListQuery', () => {
  it('accepts the documented filters and normalises a single status to an array', () => {
    const parsed = tasks.TaskListQuerySchema.parse({
      status: 'todo',
      assignee: 'me',
      dueFrom: '2026-10-01',
      dueTo: '2026-10-31',
      overdue: 'true',
      contextType: 'project',
      contextId: UUID_A,
      q: 'install',
      limit: '25',
    });
    expect(parsed.status).toEqual(['todo']);
    expect(parsed.overdue).toBe(true);
    expect(parsed.limit).toBe(25);
    accepts(tasks.TaskListQuerySchema, { assignee: 'none' });
    accepts(tasks.TaskListQuerySchema, { assignee: UUID_B, status: ['done', 'cancelled'] });
  });

  it('defaults the limit and refuses more than 100, an unknown status and an unknown assignee token', () => {
    expect(tasks.TaskListQuerySchema.parse({}).limit).toBe(50);
    rejects(tasks.TaskListQuerySchema, { limit: '101' });
    rejects(tasks.TaskListQuerySchema, { status: 'open' });
    rejects(tasks.TaskListQuerySchema, { assignee: 'nobody' });
    rejects(tasks.TaskListQuerySchema, { dueFrom: '2026-02-31' });
  });
});

describe('§1 POST /tasks — CreateTaskBody', () => {
  it('accepts a title alone, and every optional field', () => {
    accepts(tasks.CreateTaskBodySchema, { title: 'Measure the showroom' });
    accepts(tasks.CreateTaskBodySchema, {
      title: 'Measure the showroom',
      description: 'Bring the laser.',
      assignedAdminUserId: UUID_A,
      dueOn: '2026-11-03',
      context: { contextType: 'project', contextId: UUID_B, contextGroupId: UUID_C },
    });
    accepts(tasks.CreateTaskBodySchema, { title: 'x', assignedAdminUserId: null, dueOn: null, context: null });
  });

  it('refuses a missing, empty or over-long title', () => {
    rejects(tasks.CreateTaskBodySchema, {});
    rejects(tasks.CreateTaskBodySchema, { title: '   ' });
    rejects(tasks.CreateTaskBodySchema, { title: 'x'.repeat(201) });
    accepts(tasks.CreateTaskBodySchema, { title: 'x'.repeat(200) });
  });

  it('refuses a half context, a description over 20 000 characters and a non-date due date', () => {
    rejects(tasks.CreateTaskBodySchema, { title: 'x', context: { contextType: 'project' } });
    rejects(tasks.CreateTaskBodySchema, { title: 'x', description: 'x'.repeat(20_001) });
    rejects(tasks.CreateTaskBodySchema, { title: 'x', dueOn: 'tomorrow' });
  });
});

describe('§1 PATCH /tasks/:id — UpdateTaskBody', () => {
  it('accepts any one field, a status change and a cleared assignee, due date or context', () => {
    accepts(tasks.UpdateTaskBodySchema, { status: 'done' });
    accepts(tasks.UpdateTaskBodySchema, { title: 'Renamed' });
    accepts(tasks.UpdateTaskBodySchema, { assignedAdminUserId: null, dueOn: null, context: null });
  });

  it('refuses an empty body, an unknown status, an empty title and an unknown key', () => {
    rejects(tasks.UpdateTaskBodySchema, {});
    rejects(tasks.UpdateTaskBodySchema, { status: 'open' });
    rejects(tasks.UpdateTaskBodySchema, { title: '' });
    rejects(tasks.UpdateTaskBodySchema, { number: 'TSK-000001' });
  });
});

describe('§1 GET /tasks/lookups/assignees — TaskAssigneeLookupQuery', () => {
  it('accepts no query and a short search', () => {
    accepts(tasks.TaskAssigneeLookupQuerySchema, {});
    accepts(tasks.TaskAssigneeLookupQuerySchema, { q: 'anna' });
  });

  it('refuses an over-long search', () => {
    rejects(tasks.TaskAssigneeLookupQuerySchema, { q: 'x'.repeat(201) });
  });
});

describe('responses', () => {
  it('a summary carries the context by label and link, or null', () => {
    accepts(tasks.TaskSummarySchema, {
      id: UUID_A,
      number: 'TSK-000001',
      title: 'Measure',
      status: 'todo',
      dueOn: '2026-11-03',
      overdue: false,
      assignee: { id: UUID_B, name: 'Anna', active: true },
      context: {
        type: 'project',
        available: true,
        label: 'PRJ-000001 Showroom',
        href: `/projects/${UUID_C}`,
        groupLabel: 'Design',
      },
    });
    accepts(tasks.TaskSummarySchema, {
      id: UUID_A,
      number: 'TSK-000002',
      title: 'Call back',
      status: 'in_progress',
      dueOn: null,
      overdue: false,
      assignee: null,
      context: null,
    });
    rejects(tasks.TaskSummarySchema, { id: UUID_A, number: 'TSK-1', title: 'x', status: 'open' });
  });

  it('a context its owner does not describe is unavailable: a label to show, no link', () => {
    const summary = {
      id: UUID_A,
      number: 'TSK-000003',
      title: 'Orphan',
      status: 'todo',
      dueOn: null,
      overdue: false,
      assignee: null,
    };
    accepts(tasks.TaskSummarySchema, {
      ...summary,
      context: { type: 'project', available: false, label: 'Unavailable record', href: null, groupLabel: null },
    });
    // `available` is always said, so a consumer never guesses from an empty label.
    rejects(tasks.TaskSummarySchema, {
      ...summary,
      context: { type: 'project', label: '', href: '', groupLabel: null },
    });
  });

  it('the list page is items and a next cursor', () => {
    accepts(tasks.TaskListResponseSchema, { items: [], nextCursor: null });
    rejects(tasks.TaskListResponseSchema, { data: [] });
  });
});

describe('ports, events and error codes', () => {
  it('names the four events of the module', () => {
    expect(tasks.TASKS_EVENTS).toEqual({
      CREATED: 'tasks.task.created.v1',
      STATUS_CHANGED: 'tasks.task.status_changed.v1',
      ASSIGNED: 'tasks.task.assigned.v1',
      DELETED: 'tasks.task.deleted.v1',
    });
  });

  it('names the error codes the API raises', () => {
    expect(tasks.TASKS_ERROR_CODES).toContain('TASK_NOT_FOUND');
    expect(tasks.TASKS_ERROR_CODES).toContain('TASK_CONTEXT_INVALID');
  });

  it('caps one createMany call at 100 Tasks', () => {
    expect(tasks.TASK_WRITE_PORT_BATCH_MAX).toBe(100);
  });
});
