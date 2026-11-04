import { simpleEmailBodyTree } from '@endora-commerce/email-components/defaults/simple-email-body';

/**
 * The default subject and body of the Stage deadline alert e-mail
 * (`specs/163-projects-and-tasks/research.md` R-12), in the two languages an
 * Admin UI is drawn in. An operator edits either, per language, on the e-mail
 * templates screen — or switches the e-mail off, which costs nobody their bell
 * entry.
 *
 * The same facts as the bell entry and no more: the Project's number, the
 * Stage's name, its deadline and the days left — never the Project's title or
 * description. The count is said as a figure after a label, so one sentence
 * holds for every count in both languages.
 *
 * **There is no link**, for CRM's reason (`crm/…/event-reminder-defaults.ts`):
 * an absolute link needs the Admin UI's address, which no module may read yet.
 */

export const STAGE_ALERT_EMAIL_CODE = 'projects_stage_deadline_alert';

export const STAGE_ALERT_DEFAULT = {
  defaultSubject: {
    'en-US': 'Stage deadline: {{var stage.name}} — project {{var project.number}}, {{var stage.deadline}}',
    'pl-PL': 'Termin etapu: {{var stage.name}} — projekt {{var project.number}}, {{var stage.deadline}}',
  } as Record<string, string>,
  defaultContent: {
    schema_version: 1,
    languages: {
      'en-US': simpleEmailBodyTree({
        idPrefix: 'projects-stage-deadline-alert',
        heading: 'Stage deadline',
        text: [
          'Project: {{var project.number}}',
          'Stage: {{var stage.name}}',
          'Deadline: {{var stage.deadline}}',
          'Days left: {{var alert.daysLeft}}',
          'Open the project in the admin panel to see the stage.',
        ].join('\n'),
      }),
      'pl-PL': simpleEmailBodyTree({
        idPrefix: 'projects-stage-deadline-alert',
        heading: 'Termin etapu',
        text: [
          'Projekt: {{var project.number}}',
          'Etap: {{var stage.name}}',
          'Termin: {{var stage.deadline}}',
          'Pozostało dni: {{var alert.daysLeft}}',
          'Otwórz projekt w panelu administracyjnym, aby zobaczyć etap.',
        ].join('\n'),
      }),
    },
  },
};
