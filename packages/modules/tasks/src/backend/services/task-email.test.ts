import { describe, expect, it, vi } from 'vitest';
import type { TransactionalEmailSendInput } from '@endora-commerce/contracts';
import { createTaskEmail, digestItem, dueWords, taskEmailLanguage } from './task-email.js';

describe('the Task e-mails (R-17, R-18)', () => {
  it('writes Polish for a Polish preference and English for everything else', () => {
    expect(taskEmailLanguage('pl')).toBe('pl-PL');
    expect(taskEmailLanguage('pl-PL')).toBe('pl-PL');
    for (const other of ['en', 'de', null, '']) expect(taskEmailLanguage(other)).toBe('en-US');
  });

  it('says a due time in the Tasks time zone, and a date alone as a date', () => {
    expect(dueWords({ dueOn: '2032-03-10', dueAt: new Date('2032-03-10T09:30:00Z') }, 'en-US', 'Europe/Warsaw')).toContain('10:30');
    expect(dueWords({ dueOn: '2032-03-10', dueAt: null }, 'en-US', 'Europe/Warsaw')).toBe('March 10, 2032');
    expect(dueWords({ dueOn: null, dueAt: null }, 'en-US', 'Europe/Warsaw')).toBeNull();
  });

  it('hands the template each digest Task’s facts, never a sentence', () => {
    expect(digestItem({ number: 'TSK-1', title: ' Call\nthe  installer ', dueOn: '2032-03-01', dueAt: null }, '2032-03-10', 'en-US')).toEqual({
      number: 'TSK-1',
      title: 'Call the installer',
      due: 'March 1, 2032',
      overdue: true,
      today: false,
    });
    expect(digestItem({ number: 'TSK-2', title: 'Due', dueOn: '2032-03-10', dueAt: null }, '2032-03-10', 'pl-PL')).toMatchObject({
      overdue: false,
      today: true,
    });
  });

  it('sends one message per delivery row and one per person and day, with no Sales Channel', async () => {
    const sent: TransactionalEmailSendInput[] = [];
    const email = createTaskEmail({
      sender: () => ({
        send: async (input) => {
          sent.push(input);
          return { status: 'sent' };
        },
      }),
      log: vi.fn(),
    });
    const recipient = { adminUserId: 'a1', to: 'ann@example.test', preferredLanguage: 'pl' };
    await email.reminder({
      ...recipient,
      deliveryId: 'd1',
      taskId: 't1',
      number: 'TSK-1',
      title: 'Measure',
      dueOn: null,
      dueAt: null,
      timeZone: 'Europe/Warsaw',
    });
    await email.digest({
      ...recipient,
      date: '2032-03-10',
      timeZone: 'Europe/Warsaw',
      tasks: [{ number: 'TSK-1', title: 'Measure', dueOn: '2032-03-10', dueAt: null }],
    });
    expect(sent.map((m) => [m.code, m.messageId, m.salesChannelId, m.language])).toEqual([
      ['tasks_task_reminder', 'tasks_task_reminder:d1', null, 'pl-PL'],
      ['tasks_daily_digest', 'tasks_daily_digest:a1:2032-03-10', null, 'pl-PL'],
    ]);
  });

  it('answers what happened and never throws for a message that did not go out', async () => {
    const log = vi.fn();
    const failing = createTaskEmail({
      sender: () => ({
        send: async () => {
          throw new Error('smtp down');
        },
      }),
      log,
    });
    const input = { adminUserId: 'a1', to: 'ann@example.test', preferredLanguage: null, date: '2032-03-10', timeZone: 'UTC', tasks: [] };
    await expect(failing.digest(input)).resolves.toEqual({ sent: false, reason: 'failed' });
    await expect(createTaskEmail({ sender: () => undefined, log }).digest(input)).resolves.toEqual({ sent: false, reason: 'no_sender' });
    await expect(failing.digest({ ...input, to: '' })).resolves.toEqual({ sent: false, reason: 'no_address' });
  });
});
