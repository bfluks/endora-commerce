import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  TaskDetailResponseSchema,
  TaskReminderListResponseSchema,
  TaskReminderResponseSchema,
  type EmailMailerSendInput,
  type EmailMailerSendOutcome,
  type TaskDetail,
  type TaskReminder,
} from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import { attachEscapeHatchAuditWriter } from '@endora-commerce/platform/lifecycle';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { AdminNotification } from '../../helpers/package-entities.js';
import { seedCrmAdmin } from '../../helpers/seed-crm.js';
import { runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';
import type { TaskReminderService } from '../../../../packages/modules/tasks/src/backend/services/reminder-service.js';
import {
  TASKS_REMINDERS_SCOPE_REASON,
  runTasksRemindersJob,
  type TasksRemindersJob,
} from '../../../../packages/modules/tasks/src/backend/workers/tasks-reminders-worker.js';

/**
 * User Story 7 — reminders (`specs/165-task-management/` spec US7 scenarios
 * 1–4 and 6, FR-034, FR-035, SC-004; research R-17).
 *
 * **A controlled clock.** The sweep is driven directly with the `now` a tick of
 * the Job Scheduler would have had, as Projects' stage-alert tests do; every
 * moment a case measures is in 2032, where no other file has a reminder. What
 * runs is the service and the job the module composes, over the real bell and
 * the real transactional sender; only the mail transport is a stand-in that
 * records what it was handed.
 *
 * The people: Ann writes Tasks and sets the reminders; Ben and Cid read Tasks
 * and are assignees; Dee reads Tasks and is nobody's assignee; Eve may not
 * read Tasks at all.
 */
describe('tasks — reminders (US7)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void; email: string };
  let ann: Person;
  let ben: Person;
  let cid: Person;
  let dee: Person;
  let eve: Person;
  const admin = { b2b_session: 'stub-admin-session' };
  const API = '/api/v1/admin/tasks';
  const created: string[] = [];

  const mail: { sent: EmailMailerSendInput[] } = { sent: [] };
  const mailer = {
    async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
      mail.sent.push(input);
      return { status: 'sent' };
    },
  };

  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const composed = () => h.container.resolve('tasksReminderService') as TaskReminderService;
  /** One pass, as the worker runs it: inside the system scope. */
  const sweep = (now: Date) => enterSystemScope('test: tasks reminders', () => composed().sweep(now));
  /** One tick as the consumer runs it — presence, the probe outside any scope, then the passes. */
  const job = (now: Date): Promise<void> =>
    runWithoutTenantContext(() => runTasksRemindersJob(h.container.resolve('tasksRemindersJob') as TasksRemindersJob, now));

  function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, payload?: unknown, cookies = admin) {
    return h.app.inject({
      method,
      url: `${API}${path}`,
      cookies,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  async function create(body: Record<string, unknown>, cookies = ann.cookies): Promise<TaskDetail> {
    const response = await call('POST', '', body, cookies);
    expect(response.statusCode, response.body).toBe(201);
    const { data } = TaskDetailResponseSchema.parse(response.json());
    created.push(data.id);
    return data;
  }

  async function patch(id: string, body: Record<string, unknown>, cookies = ann.cookies): Promise<TaskDetail> {
    const response = await call('PATCH', `/${id}`, body, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return TaskDetailResponseSchema.parse(response.json()).data;
  }

  async function remind(taskId: string, body: Record<string, unknown>, cookies = ann.cookies): Promise<TaskReminder> {
    const response = await call('POST', `/${taskId}/reminders`, body, cookies);
    expect(response.statusCode, response.body).toBe(201);
    return TaskReminderResponseSchema.parse(response.json()).data;
  }

  async function remindersOf(taskId: string, cookies = ann.cookies): Promise<TaskReminder[]> {
    const response = await call('GET', `/${taskId}/reminders`, undefined, cookies);
    expect(response.statusCode, response.body).toBe(200);
    return TaskReminderListResponseSchema.parse(response.json()).data;
  }

  /** A Task of Ann's, assigned to Ben and Cid. */
  const assignedTask = (title: string, extra: Record<string, unknown> = {}) =>
    create({ title, assigneeIds: [ben.adminUserId, cid.adminUserId], ...extra });

  const bells = (taskId: string, who?: Person) =>
    h.em().find(
      AdminNotification,
      { subjectId: taskId, kind: 'tasks.task.reminder', ...(who ? { targetAdminUserId: who.adminUserId } : {}) },
      { filters: false, orderBy: { createdAt: 'asc' } },
    );

  const deliveries = async (reminderId: string) =>
    (await h
      .em()
      .getConnection()
      .execute(`select "admin_user_id", "outcome" from "task_reminder_deliveries" where "reminder_id" = ? order by "admin_user_id"`, [
        reminderId,
      ])) as Array<{ admin_user_id: string; outcome: string }>;

  const mailsTo = (who: Person) => mail.sent.filter((message) => message.to === who.email);

  const audit = (taskId: string) =>
    h.auditLogService.query({ objectType: 'task', objectId: taskId }).then((rows) => [...rows].reverse());

  const person = async (label: string, permissions: string[]): Promise<Person> => {
    const seeded = await seedCrmAdmin(h.em(), `reminders-${label}`, permissions);
    const rows = (await h.em().getConnection().execute(`select "email" from "admin_users" where "id" = ?`, [
      seeded.adminUserId,
    ])) as Array<{ email: string }>;
    return { ...seeded, email: rows[0]!.email };
  };

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    // The default zone — set, not assumed: another file may have written it.
    const zone = await call('PUT', '/settings/time-zone', { timeZone: 'Europe/Warsaw' });
    expect(zone.statusCode, zone.body).toBe(200);
    ann = await person('ann', ['tasks:read', 'tasks:write']);
    ben = await person('ben', ['tasks:read']);
    cid = await person('cid', ['tasks:read']);
    dee = await person('dee', ['tasks:read']);
    eve = await person('eve', ['orders:read']);
  });

  beforeEach(() => {
    mail.sent.length = 0;
  });

  afterAll(async () => {
    for (const who of [ann, ben, cid, dee, eve]) who?.undo();
    if (created.length > 0) {
      await h.em().getConnection().execute(`delete from "tasks" where "id" = any(?::uuid[])`, [`{${created.join(',')}}`]);
    }
    await teardownBackendServer(h);
  });

  describe('the Tasks time zone (R-17, admin-api §4)', () => {
    it('is read on tasks:read, written on tasks:configure, and refuses a zone that is not one', async () => {
      const read = await call('GET', '/settings/time-zone', undefined, ben.cookies);
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json()).toEqual({ data: { timeZone: 'Europe/Warsaw' } });
      const writer = await call('PUT', '/settings/time-zone', { timeZone: 'UTC' }, ann.cookies);
      expect(writer.statusCode, writer.body).toBe(403);
      const unknown = await call('PUT', '/settings/time-zone', { timeZone: 'Mars/Olympus_Mons' });
      expect(unknown.statusCode, unknown.body).toBe(422);
      const after = await call('GET', '/settings/time-zone', undefined, ben.cookies);
      expect(after.json()).toEqual({ data: { timeZone: 'Europe/Warsaw' } });
    });
  });

  describe('setting reminders (FR-034)', () => {
    it('adds an absolute reminder for the caller and an assignee, lists it, and records it in the history', async () => {
      const task = await assignedTask('Measure the showroom');
      const reminder = await remind(task.id, {
        remindAt: '2032-03-10T09:00:00.000Z',
        recipientIds: [ann.adminUserId, ben.adminUserId],
      });
      expect(reminder).toMatchObject({ mode: 'absolute', remindAt: '2032-03-10T09:00:00.000Z', offsetMinutes: null, done: false });
      expect(reminder.recipients.map((r) => r.id).sort()).toEqual([ann.adminUserId, ben.adminUserId].sort());
      expect(reminder.createdBy?.id).toBe(ann.adminUserId);

      expect((await remindersOf(task.id)).map((r) => r.id)).toEqual([reminder.id]);
      const history = await audit(task.id);
      expect(history.map((entry) => entry.action)).toContain('tasks.reminder.add');
    });

    it('shows a reader only their own reminders and those that name them — on the list and on the Task', async () => {
      const task = await assignedTask('Who sees which reminder');
      const forBen = await remind(task.id, { remindAt: '2032-03-10T09:00:00.000Z', recipientIds: [ben.adminUserId] });
      await remind(task.id, { remindAt: '2032-03-10T10:00:00.000Z', recipientIds: [ann.adminUserId] });

      expect((await remindersOf(task.id, ben.cookies)).map((r) => r.id)).toEqual([forBen.id]);
      expect(await remindersOf(task.id, cid.cookies)).toEqual([]);
      const seen = await call('GET', `/${task.id}`, undefined, ben.cookies);
      expect(TaskDetailResponseSchema.parse(seen.json()).data.reminders.map((r) => r.id)).toEqual([forBen.id]);
      const own = await call('GET', `/${task.id}`, undefined, ann.cookies);
      expect(TaskDetailResponseSchema.parse(own.json()).data.reminders).toHaveLength(2);
    });

    it('limits recipients to the caller and the assignees — 422 TASK_REMINDER_INVALID', async () => {
      const task = await assignedTask('Recipients');
      for (const recipientIds of [[dee.adminUserId], [ann.adminUserId, eve.adminUserId]]) {
        const refused = await call('POST', `/${task.id}/reminders`, { remindAt: '2032-03-10T09:00:00.000Z', recipientIds });
        expect(refused.statusCode, refused.body).toBe(422);
        expect(refused.json().error.code).toBe(ERROR_CODES.TASK_REMINDER_INVALID);
      }
      expect(await remindersOf(task.id)).toEqual([]);
    });

    it('refuses more than 10 reminders on one Task, and a relative one on a Task with no due moment', async () => {
      const task = await assignedTask('Too many reminders');
      for (let i = 0; i < 10; i += 1) {
        await remind(task.id, { remindAt: `2032-03-1${i}T09:00:00.000Z`, recipientIds: [ann.adminUserId] });
      }
      const eleventh = await call('POST', `/${task.id}/reminders`, {
        remindAt: '2032-03-20T09:00:00.000Z',
        recipientIds: [ann.adminUserId],
      });
      expect(eleventh.statusCode, eleventh.body).toBe(422);
      expect(eleventh.json().error.code).toBe(ERROR_CODES.TASK_REMINDER_INVALID);

      const undated = await assignedTask('No due moment');
      const relative = await call('POST', `/${undated.id}/reminders`, { offsetMinutes: 60, recipientIds: [ann.adminUserId] });
      expect(relative.statusCode, relative.body).toBe(422);
      expect(relative.json().error.code).toBe(ERROR_CODES.TASK_REMINDER_INVALID);
    });

    it('lets the reminder’s creator or a writer remove it; a reader who did not set it may not', async () => {
      const task = await assignedTask('Removing reminders', { assigneeIds: [ben.adminUserId] });
      // A reader may not add one: adding is a write (admin-api §2).
      const byBen = await call('POST', `/${task.id}/reminders`, {
        remindAt: '2032-03-10T09:00:00.000Z',
        recipientIds: [ben.adminUserId],
      }, ben.cookies);
      expect(byBen.statusCode, byBen.body).toBe(403);
      const reminder = await remind(task.id, { remindAt: '2032-03-10T09:00:00.000Z', recipientIds: [ben.adminUserId] });

      const refused = await call('DELETE', `/${task.id}/reminders/${reminder.id}`, undefined, ben.cookies);
      expect(refused.statusCode, refused.body).toBe(403);
      const removed = await call('DELETE', `/${task.id}/reminders/${reminder.id}`, undefined, ann.cookies);
      expect(removed.statusCode, removed.body).toBe(204);
      expect(await remindersOf(task.id)).toEqual([]);
      expect((await audit(task.id)).map((entry) => entry.action)).toContain('tasks.reminder.remove');
      const again = await call('DELETE', `/${task.id}/reminders/${reminder.id}`, undefined, ann.cookies);
      expect(again.statusCode, again.body).toBe(404);
    });
  });

  describe('relative reminders follow the due moment (US7 scenario 3)', () => {
    it('moves with a changed due time, counts a date-only due date at 09:00 local, and goes with a removed due date', async () => {
      const task = await assignedTask('Relative', { dueAt: '2032-03-10T10:00:00.000Z' });
      const reminder = await remind(task.id, { offsetMinutes: 60, recipientIds: [ann.adminUserId, ben.adminUserId] });
      expect(reminder).toMatchObject({ mode: 'relative', offsetMinutes: 60, remindAt: '2032-03-10T09:00:00.000Z' });

      await patch(task.id, { dueAt: '2032-03-11T15:30:00.000Z' });
      expect((await remindersOf(task.id))[0]!.remindAt).toBe('2032-03-11T14:30:00.000Z');

      // A date alone: 09:00 in Europe/Warsaw (CET, UTC+1, on 12 March 2032), less an hour.
      await patch(task.id, { dueOn: '2032-03-12' });
      expect((await remindersOf(task.id))[0]!.remindAt).toBe('2032-03-12T07:00:00.000Z');

      // An absolute reminder beside it does not move, and does not go.
      const absolute = await remind(task.id, { remindAt: '2032-03-09T09:00:00.000Z', recipientIds: [ann.adminUserId] });

      await patch(task.id, { dueOn: null });
      expect((await remindersOf(task.id)).map((r) => r.id)).toEqual([absolute.id]);
      const removedWithDue = (await audit(task.id)).filter((entry) => entry.action === 'tasks.reminder.removed_with_due');
      expect(removedWithDue).toHaveLength(1);
      expect(removedWithDue[0]!.stateBefore).toMatchObject({ reminderId: reminder.id, offsetMinutes: 60 });
    });

    it('re-arms a delivered relative reminder whose due moment moved', async () => {
      const task = await assignedTask('Re-armed', { dueAt: '2032-04-01T10:00:00.000Z' });
      const reminder = await remind(task.id, { offsetMinutes: 30, recipientIds: [ann.adminUserId] });
      await sweep(new Date('2032-04-01T09:31:00.000Z'));
      expect(await bells(task.id, ann)).toHaveLength(1);

      await patch(task.id, { dueAt: '2032-04-02T10:00:00.000Z' });
      expect(await deliveries(reminder.id)).toEqual([]);
      await sweep(new Date('2032-04-02T09:31:00.000Z'));
      expect(await bells(task.id, ann)).toHaveLength(2);
    });
  });

  describe('delivery (US7 scenarios 1, 2 and 4; FR-035; SC-004)', () => {
    it('tells each recipient once, at the moment, in the bell and by e-mail', async () => {
      const task = await assignedTask('Install the racks');
      const reminder = await remind(task.id, {
        remindAt: '2032-05-10T08:00:00.000Z',
        recipientIds: [ann.adminUserId, ben.adminUserId],
      });

      await sweep(new Date('2032-05-10T07:59:00.000Z'));
      expect(await bells(task.id)).toHaveLength(0);

      await sweep(new Date('2032-05-10T08:00:30.000Z'));
      const told = await bells(task.id);
      expect(told.map((n) => n.targetAdminUserId).sort()).toEqual([ann.adminUserId, ben.adminUserId].sort());
      for (const entry of told) {
        expect(entry.title).toContain(task.number);
        expect(entry.title).not.toContain('Install the racks');
        expect(entry.linkPath).toBe(`/tasks/${task.id}`);
      }
      expect(mailsTo(ann)).toHaveLength(1);
      expect(mailsTo(ben)).toHaveLength(1);
      expect(mailsTo(ben)[0]!.subject).toContain(task.number);
      expect(mailsTo(ben)[0]!.messageId).toMatch(/^tasks_task_reminder:/);
      expect((await deliveries(reminder.id)).map((d) => d.outcome)).toEqual(['delivered', 'delivered']);

      // A later pass sends nothing again; the reminder reads as done.
      await sweep(new Date('2032-05-10T08:05:00.000Z'));
      expect(await bells(task.id)).toHaveLength(2);
      expect(mail.sent).toHaveLength(2);
      expect((await remindersOf(task.id))[0]!.done).toBe(true);
    });

    it('two passes at once still tell each recipient once — the delivery row is the claim', async () => {
      const task = await assignedTask('Concurrent passes');
      const reminder = await remind(task.id, {
        remindAt: '2032-05-11T08:00:00.000Z',
        recipientIds: [ann.adminUserId, ben.adminUserId, cid.adminUserId],
      });
      const at = new Date('2032-05-11T08:01:00.000Z');
      await Promise.all([sweep(at), sweep(at), sweep(at)]);

      const told = await bells(task.id);
      expect(told.map((n) => n.targetAdminUserId).sort()).toEqual(
        [ann.adminUserId, ben.adminUserId, cid.adminUserId].sort(),
      );
      expect(mail.sent).toHaveLength(3);
      expect(await deliveries(reminder.id)).toHaveLength(3);
    });

    it('skips a closed Task, a draft, a recipient who can no longer see it, and a deactivated recipient', async () => {
      const closed = await assignedTask('Closed before its reminder');
      const closedReminder = await remind(closed.id, { remindAt: '2032-05-12T08:00:00.000Z', recipientIds: [ben.adminUserId] });
      const moved = await call('POST', `/${closed.id}/status`, { from: 'todo', to: 'done' }, ann.cookies);
      expect(moved.statusCode, moved.body).toBe(200);

      const draft = await assignedTask('A draft');
      const draftReminder = await remind(draft.id, { remindAt: '2032-05-12T08:00:00.000Z', recipientIds: [ann.adminUserId] });
      await h.em().getConnection().execute(`update "tasks" set "is_draft" = true where "id" = ?`, [draft.id]);

      const hidden = await assignedTask('Made private');
      const hiddenReminder = await remind(hidden.id, {
        remindAt: '2032-05-12T08:00:00.000Z',
        recipientIds: [ann.adminUserId, ben.adminUserId],
      });
      await h.em().getConnection().execute(`update "tasks" set "is_private" = true where "id" = ?`, [hidden.id]);

      const gone = await person('gone', ['tasks:read']);
      const left = await create({ title: 'Assignee deactivated', assigneeIds: [gone.adminUserId] });
      const leftReminder = await remind(left.id, { remindAt: '2032-05-12T08:00:00.000Z', recipientIds: [gone.adminUserId] });
      await h.em().getConnection().execute(`update "admin_users" set "status" = 'inactive' where "id" = ?`, [gone.adminUserId]);

      await sweep(new Date('2032-05-12T08:01:00.000Z'));

      expect(await deliveries(closedReminder.id)).toEqual([{ admin_user_id: ben.adminUserId, outcome: 'skipped' }]);
      expect(await deliveries(draftReminder.id)).toEqual([{ admin_user_id: ann.adminUserId, outcome: 'skipped' }]);
      const hiddenRows = await deliveries(hiddenReminder.id);
      expect(Object.fromEntries(hiddenRows.map((d) => [d.admin_user_id, d.outcome]))).toEqual({
        [ann.adminUserId]: 'delivered',
        [ben.adminUserId]: 'skipped',
      });
      expect(await deliveries(leftReminder.id)).toEqual([{ admin_user_id: gone.adminUserId, outcome: 'skipped' }]);
      expect(await bells(closed.id)).toHaveLength(0);
      expect(await bells(draft.id)).toHaveLength(0);
      expect((await bells(hidden.id)).map((n) => n.targetAdminUserId)).toEqual([ann.adminUserId]);
      expect(await bells(left.id)).toHaveLength(0);
      expect(mail.sent.map((m) => m.to)).toEqual([ann.email]);
      gone.undo();
    });

    it('delivers a reminder 2 h late; records one 25 h late as expired and sends nothing', async () => {
      const task = await assignedTask('Late passes');
      const late = await remind(task.id, { remindAt: '2032-05-13T06:00:00.000Z', recipientIds: [ben.adminUserId] });
      const stale = await remind(task.id, { remindAt: '2032-05-12T07:00:00.000Z', recipientIds: [cid.adminUserId] });

      await sweep(new Date('2032-05-13T08:00:00.000Z'));

      expect(await deliveries(late.id)).toEqual([{ admin_user_id: ben.adminUserId, outcome: 'delivered' }]);
      expect(await deliveries(stale.id)).toEqual([{ admin_user_id: cid.adminUserId, outcome: 'expired' }]);
      expect((await bells(task.id)).map((n) => n.targetAdminUserId)).toEqual([ben.adminUserId]);
      expect(mail.sent.map((m) => m.to)).toEqual([ben.email]);
    });
  });

  describe('Tasks switched off (US7 scenario 6, Constitution XVII)', () => {
    it('sends nothing while Tasks is off; on return, only what fell due within 24 h goes', async () => {
      const task = await assignedTask('While Tasks was off');
      const recent = await remind(task.id, { remindAt: '2032-06-01T08:00:00.000Z', recipientIds: [ben.adminUserId] });
      const old = await remind(task.id, { remindAt: '2032-05-30T08:00:00.000Z', recipientIds: [cid.adminUserId] });

      await withModuleOff('tasks', 'deactivated', () => job(new Date('2032-06-01T08:01:00.000Z')));
      expect(await deliveries(recent.id)).toEqual([]);
      expect(await deliveries(old.id)).toEqual([]);
      expect(mail.sent).toEqual([]);

      await job(new Date('2032-06-01T10:00:00.000Z'));
      expect(await deliveries(recent.id)).toEqual([{ admin_user_id: ben.adminUserId, outcome: 'delivered' }]);
      expect(await deliveries(old.id)).toEqual([{ admin_user_id: cid.adminUserId, outcome: 'expired' }]);
      expect(mail.sent.map((m) => m.to)).toEqual([ben.email]);
    });
  });

  describe('an idle tick enters no system scope (issue #120)', () => {
    let writer: ReturnType<typeof attachEscapeHatchAuditWriter>;

    beforeAll(() => {
      writer = attachEscapeHatchAuditWriter({
        em: () => h.orm.em.fork() as EntityManager,
        flushIntervalMs: 3_600_000,
        log: () => undefined,
      });
    });

    afterAll(async () => {
      await writer.detach();
    });

    async function recorded(): Promise<number> {
      await writer.flush();
      const rows = (await h
        .em()
        .getConnection()
        .execute(
          `select coalesce(sum(("state_after"->>'occurrences')::int), 0)::text as "n"
             from "audit_log_entries"
            where "action" = 'tenant.escape_hatch' and "state_after"->>'reason' = ?`,
          [TASKS_REMINDERS_SCOPE_REASON],
        )) as Array<{ n: string }>;
      return Number(rows[0]!.n);
    }

    it('writes no escape-hatch row for a tick with nothing due, and one for a tick with work', async () => {
      // Everything earlier in this file is handled; nothing falls due before 2032-07.
      await job(new Date('2032-06-30T00:00:00.000Z'));
      const before = await recorded();
      for (let i = 0; i < 3; i += 1) await job(new Date(Date.parse('2032-06-30T00:00:00.000Z') + i * MINUTE));
      expect(await recorded()).toBe(before);

      const task = await assignedTask('Work for a tick');
      await remind(task.id, { remindAt: '2032-07-01T08:00:00.000Z', recipientIds: [ann.adminUserId] });
      await job(new Date(Date.parse('2032-07-01T08:00:00.000Z') + HOUR));
      expect(await recorded()).toBeGreaterThan(before);
      expect(await bells(task.id, ann)).toHaveLength(1);
    });
  });
});
