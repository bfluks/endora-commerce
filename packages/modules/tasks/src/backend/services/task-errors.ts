import { ERROR_CODES } from '@endora-commerce/contracts';
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
  return new HttpError(422, ERROR_CODES.TASK_ASSIGNEE_INVALID, 'A Task can be assigned only to an active administrator.');
}
