import { ERROR_CODES, TASK_ASSIGNEES_MAX } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The refusals of the Tasks API (`contracts/admin-api.md` §1), one statement
 * each, for the service, the Commands and the write port alike.
 */

/** No such Task, or one whose context the caller may not see — indistinguishable. */
export function taskNotFound(): HttpError {
  return new HttpError(404, ERROR_CODES.TASK_NOT_FOUND, 'Task not found.');
}

export function taskContextInvalid(message: string): HttpError {
  return new HttpError(422, ERROR_CODES.TASK_CONTEXT_INVALID, message);
}

export function taskAssigneeInvalid(): HttpError {
  return new HttpError(
    422,
    ERROR_CODES.TASK_ASSIGNEE_INVALID,
    `A Task can be assigned only to active administrators who may read Tasks, at most ${TASK_ASSIGNEES_MAX} of them.`,
  );
}

/**
 * An assignee who may not see the record the Task belongs to (spec, Edge
 * Cases; issue #506): refused, naming them. `details.code` keys the sentence
 * (`errors.TASK_ASSIGNEE_INVALID.context_hidden`) and `details.name` fills it.
 * The caller sees the record, so the refusal says nothing they do not know.
 */
export function taskAssigneeContextHidden(person: { id: string; name: string }): HttpError {
  return new HttpError(
    422,
    ERROR_CODES.TASK_ASSIGNEE_INVALID,
    `${person.name} may not see the record this Task belongs to, so the Task cannot be assigned to them.`,
    { code: 'context_hidden', name: person.name, adminUserId: person.id },
  );
}

/** A private Task given an assignee other than its Creator (FR-038, research R-3). */
export function taskPrivateAssignee(): HttpError {
  return new HttpError(
    422,
    ERROR_CODES.TASK_PRIVATE_ASSIGNEE,
    'A private Task can be assigned only to the administrator who created it.',
  );
}

/** Publishing a Task that is not a draft: publishing is one-way (FR-037). */
export function taskAlreadyPublished(): HttpError {
  return new HttpError(409, ERROR_CODES.TASK_ALREADY_PUBLISHED, 'This Task is already published.');
}

/** A private Task in a context (FR-038): the service's refusal and the database check's say the same. */
export function taskPrivateInContext(): HttpError {
  return new HttpError(422, ERROR_CODES.TASK_CONTEXT_INVALID, 'A private Task cannot belong to a record.', {
    reason: 'private',
  });
}

/**
 * The two checks of `tasks` that guard draft and private (data-model §1), as
 * the 422s the service raises before it writes. The service refuses both
 * first; a violation reaching the database is a write racing another
 * (`tasks_private_context_check`) or a caller the service does not front
 * (`tasks_draft_source_check`), and still answers in the contract's words.
 */
export function mapDraftPrivateViolation(error: unknown): never {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('tasks_private_context_check')) throw taskPrivateInContext();
  if (message.includes('tasks_draft_source_check')) {
    throw taskContextInvalid('A Task created by a record is published at once; it cannot be a draft.');
  }
  throw error;
}
