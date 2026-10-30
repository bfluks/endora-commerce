import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

/**
 * The default subject and body of the Task reminder e-mail
 * (`specs/165-task-management/` research R-17), in the two languages an Admin
 * UI is drawn in. An operator edits either, per language, on the e-mail
 * templates screen — or switches the e-mail off, which costs nobody their bell
 * entry.
 *
 * Sent to one recipient who may see the Task at that moment, so it names the
 * Task by its number and its title, and says when it is due. **There is no
 * link**, for CRM's and Projects' reason: an absolute link needs the Admin
 * UI's address, which no module may read yet.
 */

export const TASK_REMINDER_EMAIL_CODE = 'tasks_task_reminder';

export const TASK_REMINDER_DEFAULT = {
  defaultSubject: {
    'en-US': 'Reminder: task {{var task.number}} — {{var task.title}}',
    'pl-PL': 'Przypomnienie: zadanie {{var task.number}} — {{var task.title}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'tasks-task-reminder',
        heading: 'Task reminder',
        text: [
          'Task: {{var task.number}}',
          'Title: {{var task.title}}',
          '{{if task.due}}Due: {{var task.due}}{{/if}}',
          'Open the task in the admin panel to see it.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'tasks-task-reminder',
        heading: 'Przypomnienie o zadaniu',
        text: [
          'Zadanie: {{var task.number}}',
          'Tytuł: {{var task.title}}',
          '{{if task.due}}Termin: {{var task.due}}{{/if}}',
          'Otwórz zadanie w panelu administracyjnym, aby je zobaczyć.',
        ].join('\n'),
      }),
    },
  },
};
