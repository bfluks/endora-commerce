import type { AdminNotificationMessage, AdminNotificationRecordPort } from '@endora-commerce/contracts';
import { effectiveState, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';

/** `not-present` is the operator's choice — the bell is switched off — never a failure. */
export type TaskNotificationOutcome = 'recorded' | 'not-present';

/**
 * What a bell entry about a Task says, twice over: the finished English
 * sentence, and the address of its template in this module's bundle with the
 * params that fill it — one entry is read later, in the reader's own language
 * (`specs/conventions/module-i18n.md`).
 *
 * A sentence names a Task **by its number** and nothing else: a bell is read
 * outside any record's visibility, so never a title (the CRM rule). The params
 * are held to the same rule — `task-notifier.test.ts` proves the English
 * template filled with them is the sentence.
 */
export const taskNotificationText = {
  assigned: (number: string): { title: string; titleMessage: AdminNotificationMessage } => ({
    title: `Task ${number} was assigned to you`,
    titleMessage: { scope: 'tasks', key: 'notifications.assigned.title', params: { number } },
  }),
};

/** Where a bell entry about a Task leads: its screen in the Admin UI. */
export function taskLinkPath(taskId: string): string {
  return `/tasks/${taskId}`;
}

export interface TaskNotifier {
  /** Tell `targetAdminUserId` that Task `number` is now theirs (FR-032). */
  assigned(input: { targetAdminUserId: string; taskId: string; number: string }): Promise<TaskNotificationOutcome>;
}

/**
 * Bell entries about a Task, through `admin_notifications`' own port.
 *
 * That module is operator-switchable and this one only *degrades* without it
 * (the manifest's `degrades-without` edge): an assignment succeeds either way,
 * and with the bell off nobody is told. So presence is **decided first**,
 * outside any `try` — a closed gate throws rather than answering, and a refusal
 * caught afterwards would be indistinguishable from a defect. Nothing here
 * catches anything (CRM's `crm-notifier.ts`, the model).
 */
export function createTaskNotifier(adminNotifications: AdminNotificationRecordPort): TaskNotifier {
  return {
    async assigned({ targetAdminUserId, taskId, number }): Promise<TaskNotificationOutcome> {
      if (!effectiveState.isPresent('admin_notifications')) return 'not-present';
      const text = taskNotificationText.assigned(number);
      await adminNotifications.record({
        audience: 'admin_user',
        targetAdminUserId,
        kind: 'tasks.task.assigned',
        subjectType: 'task',
        subjectId: taskId,
        title: text.title,
        titleMessage: text.titleMessage,
        linkPath: taskLinkPath(taskId),
      });
      return 'recorded';
    },
  };
}

/**
 * Tell somebody about a write **that has already committed**. If telling fails
 * the request would answer 500 for an assignment that happened, so the failure
 * is logged and tolerated here, narrowly; a module switched off is not a
 * failure of this kind and is thrown as it is (CRM's `tellAfterCommit`).
 */
export async function tellAfterCommit(taskId: string, tell: () => Promise<unknown>): Promise<void> {
  try {
    await tell();
  } catch (error) {
    rethrowIfModuleDisabled(error);
    console.warn('tasks: a notification about a committed change could not be written', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
