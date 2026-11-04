import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

/**
 * The default subject and body of the daily Task digest
 * (`specs/165-task-management/` research R-18), in the two languages an Admin
 * UI is drawn in.
 *
 * **The list is a repeated block.** The directive engine of
 * `@endora-commerce/email-components` supports `{{for alias in path}} …
 * {{/for}}` (`directives/directive-engine.ts`), and the body uses it over
 * `digest.tasks` — each `{number, title, due, overdue, today}` — one line per
 * Task, so the HTML part breaks the lines as the text part does (a single
 * preformatted variable would be escaped into one HTML line), and the words
 * around them ("overdue since", "due today") are the template's, per
 * language. `digest.taskList`, the number, title and due date of each joined
 * by line, is sent too: it is the variable the manifest declares, so an
 * operator editing the template sees a sample and may use it in a plain block.
 *
 * Never sent on a day with nothing due (FR-036). No link, as for the reminder.
 */

export const TASK_DIGEST_EMAIL_CODE = 'tasks_daily_digest';

export const TASK_DIGEST_DEFAULT = {
  defaultSubject: {
    'en-US': 'Your tasks for {{var digest.date}}: {{var digest.taskCount}} due or overdue',
    'pl-PL': 'Twoje zadania na {{var digest.date}}: {{var digest.taskCount}} na dziś lub po terminie',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'tasks-daily-digest',
        heading: 'Your tasks for today',
        text: [
          'Due today or overdue: {{var digest.taskCount}}',
          '{{for task in digest.tasks}}{{var task.number}} {{var task.title}} — {{if task.overdue}}overdue since {{var task.due}}{{/if}}{{if task.today}}due today{{/if}}',
          '{{/for}}Open My tasks in the admin panel to see them.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'tasks-daily-digest',
        heading: 'Twoje zadania na dziś',
        text: [
          'Na dziś lub po terminie: {{var digest.taskCount}}',
          '{{for task in digest.tasks}}{{var task.number}} {{var task.title}} — {{if task.overdue}}po terminie od {{var task.due}}{{/if}}{{if task.today}}na dziś{{/if}}',
          '{{/for}}Otwórz Moje zadania w panelu administracyjnym, aby je zobaczyć.',
        ].join('\n'),
      }),
    },
  },
};
