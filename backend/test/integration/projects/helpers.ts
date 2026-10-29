import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import {
  ProjectDetailResponseSchema,
  ProjectMoveResponseSchema,
  TaskDetailResponseSchema,
  type CreateProjectBody,
  type ProjectDetail,
  type ProjectMoveResult,
  type TaskDetail,
} from '@endora-commerce/contracts';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { withModulesDeactivated } from '../../helpers/modules-deactivated.js';
import { AdminNotification } from '../../helpers/package-entities.js';

/**
 * Shared fixtures of the `projects` contract and integration suites
 * (`specs/163-projects-and-tasks/`). Everything here goes through the HTTP API
 * — the module's own write path — except the clean-up, which deletes the
 * Projects a file created by id.
 */

export const PROJECTS_API = '/api/v1/admin/projects';
/** The harness's administrator: every permission, every Organization. */
export const PROJECTS_ADMIN = { b2b_session: 'stub-admin-session' };

type Cookies = Record<string, string>;
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export function callProjects(
  h: BackendServerHandle,
  method: Method,
  path: string,
  options: { payload?: unknown; cookies?: Cookies | null; headers?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method,
    url: `${PROJECTS_API}${path}`,
    ...(options.cookies === null ? {} : { cookies: options.cookies ?? PROJECTS_ADMIN }),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.payload === undefined ? {} : { payload: options.payload as Record<string, unknown> }),
  });
}

/** Today in `Europe/Warsaw` — the default of `projects.alerts_time_zone`. */
export function warsawToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function plusDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The seeded dictionaries' ids by code — `sales_rep`, `project_manager`; `price`, `competitor`, … */
export async function dictionaryIds(
  h: BackendServerHandle,
  table: 'project_roles' | 'project_loss_reasons',
): Promise<Record<string, string>> {
  const rows = (await h.em().getConnection().execute(`select "id", "code" from "${table}"`)) as Array<{
    id: string;
    code: string;
  }>;
  return Object.fromEntries(rows.map((row) => [row.code, row.id]));
}

export const THREE_STAGES = [
  { name: 'Design', color: '#3b82f6', plannedDurationDays: 10 },
  { name: 'Build', color: '#f59e0b', plannedDurationDays: 0 },
  { name: 'Handover', color: '#22c55e', plannedDurationDays: 5 },
];

/** `POST /projects`; fails the test on anything but 201. */
export async function createProject(
  h: BackendServerHandle,
  body: Partial<CreateProjectBody> & { title?: string },
  cookies?: Cookies,
): Promise<ProjectDetail> {
  const response = await callProjects(h, 'POST', '', {
    payload: { title: 'A project', organizationIds: [], stages: THREE_STAGES, ...body },
    ...(cookies ? { cookies } : {}),
  });
  expect(response.statusCode, response.body).toBe(201);
  return ProjectDetailResponseSchema.parse(response.json()).data;
}

export async function getProject(h: BackendServerHandle, id: string, cookies?: Cookies): Promise<ProjectDetail> {
  const response = await callProjects(h, 'GET', `/${id}`, cookies ? { cookies } : {});
  expect(response.statusCode, response.body).toBe(200);
  return ProjectDetailResponseSchema.parse(response.json()).data;
}

export function moveProject(h: BackendServerHandle, id: string, toStageId: string, version: number, cookies?: Cookies) {
  return callProjects(h, 'POST', `/${id}/move`, { payload: { toStageId, version }, ...(cookies ? { cookies } : {}) });
}

/** `POST /projects/:id/move`; fails the test on anything but 200. */
export async function moveProjectOk(h: BackendServerHandle, id: string, toStageId: string, version: number) {
  const response = await moveProject(h, id, toStageId, version);
  expect(response.statusCode, response.body).toBe(200);
  return ProjectMoveResponseSchema.parse(response.json()).data as ProjectMoveResult;
}

export function closeProject(h: BackendServerHandle, id: string, body: Record<string, unknown>, cookies?: Cookies) {
  return callProjects(h, 'POST', `/${id}/close`, { payload: body, ...(cookies ? { cookies } : {}) });
}

export function reopenProject(h: BackendServerHandle, id: string, version: number, cookies?: Cookies) {
  return callProjects(h, 'POST', `/${id}/reopen`, { payload: { version }, ...(cookies ? { cookies } : {}) });
}

/** The stage named `name` of `project`. */
export function stageNamed(project: ProjectDetail, name: string): string {
  const stage = project.stages.find((s) => s.name === name);
  expect(stage, `no Stage "${name}" on ${project.number}`).toBeDefined();
  return stage!.id;
}

/** A 404's body without its request id, which differs per request by design. */
export function errorShape(body: string): Record<string, unknown> {
  const parsed = JSON.parse(body) as { error: Record<string, unknown> };
  const { requestId: _requestId, ...rest } = parsed.error;
  return rest;
}

/** Delete the Projects a file created, whatever state they are in. */
export async function deleteProjects(h: BackendServerHandle, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await h.em().getConnection().execute(`delete from "projects" where "id" = any(?::uuid[])`, [`{${ids.join(',')}}`]);
}

/**
 * Run `body` with the Tasks module switched off on the operator axis — User
 * Story 1 is proved without Tasks (the owner's "a Project without Tasks").
 */
export function withTasksOff<T>(body: () => Promise<T>): Promise<T> {
  return withModulesDeactivated(['tasks'], body);
}

// ---------------------------------------------------------------------------
// User Story 2 — Tasks in a Project's Stages
// ---------------------------------------------------------------------------

export const TASKS_API = '/api/v1/admin/tasks';

export function callTasks(
  h: BackendServerHandle,
  method: Method,
  path: string,
  options: { payload?: unknown; cookies?: Cookies | null } = {},
): Promise<LightMyRequestResponse> {
  return h.app.inject({
    method,
    url: `${TASKS_API}${path}`,
    ...(options.cookies === null ? {} : { cookies: options.cookies ?? PROJECTS_ADMIN }),
    ...(options.payload === undefined ? {} : { payload: options.payload as Record<string, unknown> }),
  });
}

/** `POST /tasks` into one Stage of a Project; fails the test on anything but 201. */
export async function createStageTask(
  h: BackendServerHandle,
  projectId: string,
  stageId: string,
  body: Record<string, unknown> = {},
  cookies?: Cookies,
): Promise<TaskDetail> {
  const response = await callTasks(h, 'POST', '', {
    payload: { title: 'A stage task', ...body, context: { contextType: 'project', contextId: projectId, contextGroupId: stageId } },
    ...(cookies ? { cookies } : {}),
  });
  expect(response.statusCode, response.body).toBe(201);
  return TaskDetailResponseSchema.parse(response.json()).data;
}

/** `PATCH /tasks/:id` with a new status; fails the test on anything but 200. */
export async function setTaskStatus(h: BackendServerHandle, taskId: string, status: string): Promise<void> {
  const response = await callTasks(h, 'PATCH', `/${taskId}`, { payload: { status } });
  expect(response.statusCode, response.body).toBe(200);
}

/** `PATCH /projects/:id/stages/:stageId`; fails the test on anything but 200. */
export async function patchStage(
  h: BackendServerHandle,
  projectId: string,
  stageId: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await callProjects(h, 'PATCH', `/${projectId}/stages/${stageId}`, { payload: body });
  expect(response.statusCode, response.body).toBe(200);
}

/** The Tasks rows of a Project, read directly — what remains whatever anybody may see. */
export async function taskRowsOf(
  h: BackendServerHandle,
  projectId: string,
): Promise<Array<{ id: string; title: string; status: string; context_group_id: string | null }>> {
  return (await h
    .em()
    .getConnection()
    .execute(
      `select "id", "title", "status", "context_group_id" from "tasks"
        where "context_type" = 'project' and "context_id" = ? order by "created_at", "id"`,
      [projectId],
    )) as Array<{ id: string; title: string; status: string; context_group_id: string | null }>;
}

/** Delete the Tasks of the Projects a file created. */
export async function deleteProjectTasks(h: BackendServerHandle, projectIds: readonly string[]): Promise<void> {
  if (projectIds.length === 0) return;
  await h
    .em()
    .getConnection()
    .execute(`delete from "tasks" where "context_type" = 'project' and "context_id" = any(?::uuid[])`, [
      `{${projectIds.join(',')}}`,
    ]);
}

// ---------------------------------------------------------------------------
// User Story 7 — collaboration
// ---------------------------------------------------------------------------

/** Set the module setting `projects.visibility` for the platform. */
export async function setProjectsVisibility(h: BackendServerHandle, value: 'everyone' | 'members'): Promise<void> {
  const response = await h.app.inject({
    method: 'PUT',
    url: '/api/v1/admin/settings/projects.visibility/value',
    cookies: PROJECTS_ADMIN,
    payload: { scope: 'all', value },
  });
  expect(response.statusCode, response.body).toBeLessThan(400);
}

/** The bell entries about one Project, for one administrator, oldest first. */
export async function bellAbout(
  h: BackendServerHandle,
  projectId: string,
  adminUserId: string,
): Promise<Array<{ kind: string; title: string; body: string | null; linkPath: string | null; titleMessage: unknown }>> {
  const rows = await h
    .em()
    .find(
      AdminNotification,
      { targetAdminUserId: adminUserId, subjectId: projectId },
      { filters: false, orderBy: { createdAt: 'asc' } },
    );
  return rows.map((row) => ({
    kind: row.kind,
    title: row.title,
    body: row.body ?? null,
    linkPath: row.linkPath ?? null,
    titleMessage: row.titleMessage ?? null,
  }));
}
