import type { AdminNotificationMessage, AdminNotificationRecordPort } from '@endora-commerce/contracts';
import { effectiveState, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';

/** `not-present` is the operator's choice — the bell is switched off — never a failure. */
export type ProjectNotificationOutcome = 'recorded' | 'not-present';

export type ProjectNotificationKind =
  | 'projects.project.message'
  | 'projects.project.mention'
  | 'projects.project.stage_deadline';

/**
 * What a bell entry says, twice over: the finished English sentence, and the
 * address of its template in this module's bundle with the params that fill it
 * — one entry is read later by its recipient in their own language
 * (`specs/conventions/module-i18n.md`).
 */
export interface ProjectNotificationText {
  title: string;
  titleMessage: AdminNotificationMessage;
}

const message = (key: string, params: Record<string, string>): AdminNotificationMessage => ({
  scope: 'projects',
  key: `notifications.${key}.title`,
  params,
});

/**
 * Every sentence this module records in the bell. A sentence names a Project
 * **by its number** and a colleague by their name, and nothing else: a bell is
 * read outside the Project's visibility, so never a title and never a text
 * (the CRM rule, `crm-notifier.ts`). A deadline alert names the Stage as well,
 * and its deadline — what the alert is about (User Story 8), told only to a
 * Member who may see the Project at the moment it is sent. `project-notifier.test.ts` proves the
 * English template filled with the params is the sentence, so the params
 * cannot say more than it does. A mention with no known author is a sentence
 * of its own: a template cannot drop a clause.
 */
export const projectNotificationText = {
  message: (number: string): ProjectNotificationText => ({
    title: `New message on project ${number}`,
    titleMessage: message('message', { number }),
  }),
  mention: (number: string, authorName: string | null): ProjectNotificationText =>
    authorName === null
      ? {
          title: `You were mentioned in project ${number}`,
          titleMessage: message('mention', { number }),
        }
      : {
          title: `${authorName} mentioned you in project ${number}`,
          titleMessage: message('mentionByAuthor', { author: authorName, number }),
        },
  /**
   * A Stage's deadline is `daysLeft` days away. The count is said as a figure
   * after a label, so one sentence holds for every count in both languages.
   */
  stageDeadline: (number: string, stageName: string, deadlineOn: string, daysLeft: number): ProjectNotificationText => ({
    title: `Stage "${stageName}" of project ${number} is due on ${deadlineOn} (days left: ${daysLeft})`,
    titleMessage: message('stageDeadline', { number, stage: stageName, deadline: deadlineOn, days: String(daysLeft) }),
  }),
};

export interface ProjectNotification extends ProjectNotificationText {
  kind: ProjectNotificationKind;
  targetAdminUserId: string;
  projectId: string;
}

export interface ProjectNotifier {
  notify(notification: ProjectNotification): Promise<ProjectNotificationOutcome>;
}

/**
 * Where a bell entry about a Project leads: its screen — on the Messages tab
 * for a message, on the Stages tab for a deadline alert.
 */
export function projectLinkPath(projectId: string, kind: ProjectNotificationKind): string {
  const path = `/projects/${projectId}`;
  if (kind === 'projects.project.message') return `${path}?tab=messages`;
  if (kind === 'projects.project.stage_deadline') return `${path}?tab=stages`;
  return path;
}

/** The longest sentence `admin_notifications` stores as an entry's `title`. */
const BELL_TITLE_MAX_LENGTH = 255;

function bellTitle(sentence: string): string {
  return sentence.length <= BELL_TITLE_MAX_LENGTH ? sentence : `${sentence.slice(0, BELL_TITLE_MAX_LENGTH - 1)}…`;
}

/**
 * Bell entries about a Project, through `admin_notifications`' own port.
 *
 * That module is operator-switchable and this one only *degrades* without it
 * (the manifest's `degrades-without` edge): a message or a mention is stored
 * either way, and with the bell off nobody is told. So presence is **decided
 * first**, outside any `try` — nothing here catches anything. Who may be told
 * at all (`ProjectAccess.canSeeAs`) is the caller's question, asked before.
 *
 * A function rather than an object literal at the composition site:
 * `check:port-catches` follows the port through the value.
 */
export function createProjectNotifier(adminNotifications: AdminNotificationRecordPort): ProjectNotifier {
  return {
    async notify(notification: ProjectNotification): Promise<ProjectNotificationOutcome> {
      if (!effectiveState.isPresent('admin_notifications')) return 'not-present';
      await adminNotifications.record({
        audience: 'admin_user',
        targetAdminUserId: notification.targetAdminUserId,
        kind: notification.kind,
        subjectType: 'project',
        subjectId: notification.projectId,
        title: bellTitle(notification.title),
        titleMessage: notification.titleMessage,
        linkPath: projectLinkPath(notification.projectId, notification.kind),
      });
      return 'recorded';
    },
  };
}

/**
 * Tell somebody about a write **that has already committed**. If telling fails
 * the request would answer 500 for a note or a message that is stored, and a
 * client that retries would post it twice — so the failure is logged and
 * tolerated here, narrowly. A module switched off is not a failure of this
 * kind and is thrown as it is (CRM's `tellAfterCommit`).
 */
export async function tellAfterCommit(projectId: string, tell: () => Promise<void>): Promise<void> {
  try {
    await tell();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    console.warn('projects: a notification about a committed change could not be written', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
