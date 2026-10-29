import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  TASKS_EVENTS,
  type TaskAssignedEvent,
  type TaskContext,
  type TaskCreatedEvent,
  type TaskDeletedEvent,
  type TaskStatus,
  type TaskStatusChangedEvent,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { randomUUID } from 'crypto';
import { Task } from '../entities/task.entity.js';
import { taskNotFound } from './task-errors.js';
import { nextTaskNumber } from './task-number.js';

/**
 * The Commands every write of a Task runs (`data-model.md` §1, Constitution
 * XIII) — one action per kind of change, each with its own audit row and, where
 * the contract names one, its own event on commit:
 *
 * | Action | Event |
 * | --- | --- |
 * | `tasks.task.create` | `tasks.task.created.v1` |
 * | `tasks.task.update` (title, description, due date, context) | — |
 * | `tasks.task.assign` | `tasks.task.assigned.v1` |
 * | `tasks.task.status_change` | `tasks.task.status_changed.v1` |
 * | `tasks.task.delete` | `tasks.task.deleted.v1` |
 *
 * Shared by the HTTP service and the write port, so a Task created by another
 * module is the same Command as one created on the Tasks screen. Every
 * validation a Command depends on — the context's owner, the assignee — is the
 * caller's to make **before** it runs the first Command.
 *
 * Audit states carry no description text: the audit trail is not tenant-scoped
 * and a description may hold whatever its writer typed — its length is enough
 * to show that it changed (the CRM rule, `data-model.md` §2.4).
 */

/** A Task's fields as a Command writes them. */
export interface NewTaskFields {
  title: string;
  description: string;
  assignedAdminUserId: string | null;
  dueOn: string | null;
  contextNote: string | null;
}

/** The editable fields a `tasks.task.update` changes; `undefined` leaves one as it is. */
export interface TaskFieldChanges {
  title?: string;
  description?: string;
  dueOn?: string | null;
  context?: TaskContext | null;
}

export function auditSnapshot(task: Task): Record<string, unknown> {
  return {
    number: task.number,
    title: task.title,
    descriptionLength: task.description.length,
    status: task.status,
    assignedAdminUserId: task.assignedAdminUserId ?? null,
    dueOn: task.dueOn ?? null,
    completedAt: task.completedAt ? task.completedAt.toISOString() : null,
    contextType: task.contextType ?? null,
    contextId: task.contextId ?? null,
    contextGroupId: task.contextGroupId ?? null,
    contextNote: task.contextNote ?? null,
  };
}

function envelope(): { eventId: string; occurredAt: string } {
  return { eventId: randomUUID(), occurredAt: new Date().toISOString() };
}

async function lockedTask(em: EntityManager, id: string): Promise<Task> {
  const task = await em.findOne(Task, { id }, { lockMode: LockMode.PESSIMISTIC_WRITE });
  if (!task) throw taskNotFound();
  return task;
}

/** `tasks.task.create` — the result is the new Task's id. */
export function createTaskCommand(context: TaskContext | null, input: NewTaskFields): Command<string> {
  const id = randomUUID();
  let created: Task | null = null;
  return {
    action: 'tasks.task.create',
    objectType: 'task',
    objectId: id,
    run: async ({ em, actor }) => {
      if (actor.actorAdminUserId === null) {
        // `created_by_admin_user_id` is not null (data-model §1): a Task is
        // created on behalf of somebody, and the caller acts for them.
        throw new Error('tasks: a Task is created by an administrator; the ambient actor is none.');
      }
      const task = em.create(Task, {
        id,
        number: await nextTaskNumber(em as EntityManager),
        title: input.title,
        description: input.description,
        assignedAdminUserId: input.assignedAdminUserId,
        dueOn: input.dueOn,
        createdByAdminUserId: actor.actorAdminUserId,
        contextType: context?.contextType ?? null,
        contextId: context?.contextId ?? null,
        contextGroupId: context?.contextGroupId ?? null,
        contextNote: input.contextNote,
      });
      created = task;
      return { result: id, before: null, after: auditSnapshot(task) };
    },
    event: () => {
      const task = created!;
      const payload: TaskCreatedEvent = {
        ...envelope(),
        taskId: task.id,
        contextType: task.contextType ?? null,
        contextId: task.contextId ?? null,
        contextGroupId: task.contextGroupId ?? null,
        assignedAdminUserId: task.assignedAdminUserId ?? null,
      };
      return { eventName: TASKS_EVENTS.CREATED, payload };
    },
  };
}

/** `tasks.task.update` — the fields that are not an assignment or a status. No event. */
export function updateTaskCommand(id: string, changes: TaskFieldChanges): Command<null> {
  return {
    action: 'tasks.task.update',
    objectType: 'task',
    objectId: id,
    run: async ({ em }) => {
      const task = await lockedTask(em as EntityManager, id);
      const before = auditSnapshot(task);
      if (changes.title !== undefined) task.title = changes.title;
      if (changes.description !== undefined) task.description = changes.description;
      if (changes.dueOn !== undefined) task.dueOn = changes.dueOn;
      if (changes.context !== undefined) {
        task.contextType = changes.context?.contextType ?? null;
        task.contextId = changes.context?.contextId ?? null;
        task.contextGroupId = changes.context?.contextGroupId ?? null;
      }
      return { result: null, before, after: auditSnapshot(task) };
    },
  };
}

/**
 * `tasks.task.assign` — the result is who held it before, or `undefined` when
 * the Task already had this assignee (nothing written, nothing audited).
 */
export function assignTaskCommand(id: string, to: string | null): Command<{ from: string | null } | undefined> {
  return {
    action: 'tasks.task.assign',
    objectType: 'task',
    objectId: id,
    run: async ({ em }) => {
      const task = await lockedTask(em as EntityManager, id);
      const from = task.assignedAdminUserId ?? null;
      if (from === to) return { result: undefined, skipAudit: true };
      const before = auditSnapshot(task);
      task.assignedAdminUserId = to;
      return { result: { from }, before, after: auditSnapshot(task) };
    },
    event: (result) => {
      if (!result) return undefined;
      const payload: TaskAssignedEvent = { ...envelope(), taskId: id, from: result.from, to };
      return { eventName: TASKS_EVENTS.ASSIGNED, payload };
    },
  };
}

/**
 * `tasks.task.status_change` — any status to any other; `done` stamps the
 * completion time and leaving `done` clears it. The result is the status it
 * left, or `undefined` when it was already in `to`.
 */
export function changeTaskStatusCommand(
  id: string,
  to: TaskStatus,
): Command<{ from: TaskStatus; context: Pick<TaskStatusChangedEvent, 'contextType' | 'contextId' | 'contextGroupId'> } | undefined> {
  return {
    action: 'tasks.task.status_change',
    objectType: 'task',
    objectId: id,
    run: async ({ em }) => {
      const task = await lockedTask(em as EntityManager, id);
      const from = task.status;
      if (from === to) return { result: undefined, skipAudit: true };
      const before = auditSnapshot(task);
      task.status = to;
      task.completedAt = to === 'done' ? new Date() : null;
      return {
        result: {
          from,
          context: {
            contextType: task.contextType ?? null,
            contextId: task.contextId ?? null,
            contextGroupId: task.contextGroupId ?? null,
          },
        },
        before,
        after: auditSnapshot(task),
      };
    },
    event: (result) => {
      if (!result) return undefined;
      const payload: TaskStatusChangedEvent = { ...envelope(), taskId: id, from: result.from, to, ...result.context };
      return { eventName: TASKS_EVENTS.STATUS_CHANGED, payload };
    },
  };
}

/** `tasks.task.delete` — `false` when the Task was already gone (nothing audited). */
export function deleteTaskCommand(id: string): Command<boolean> {
  let gone: { contextType: string | null; contextId: string | null } | null = null;
  return {
    action: 'tasks.task.delete',
    objectType: 'task',
    objectId: id,
    run: async ({ em }) => {
      const task = await em.findOne(Task, { id });
      if (!task) return { result: false, skipAudit: true };
      const before = auditSnapshot(task);
      gone = { contextType: task.contextType ?? null, contextId: task.contextId ?? null };
      em.remove(task);
      return { result: true, before, after: null };
    },
    event: (deleted) => {
      if (!deleted || !gone) return undefined;
      const payload: TaskDeletedEvent = { ...envelope(), taskId: id, ...gone };
      return { eventName: TASKS_EVENTS.DELETED, payload };
    },
  };
}
