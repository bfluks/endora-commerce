import {
  ERROR_CODES,
  isCustomFieldValidationFailure,
  type CustomFieldValuePort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The custom-field half of a Task write (`specs/165-task-management/` FR-007,
 * research R-8) — Projects' `project-custom-fields.ts`, copied.
 *
 * `custom_fields` validates and merges; it writes nothing and audits nothing.
 * The bag this returns is written by the Task's own Command
 * (`tasks.task.custom_fields_change`, or the create), so the values are
 * persisted and audited by the one write that changed them (Constitution XIII
 * and XIV).
 *
 * `patch` absent means "nothing was said about the fields": the bag is
 * returned as it is and no definition is consulted — so a required field
 * defined after a Task was created does not refuse an unrelated edit. The
 * create form always passes a bag, `{}` included.
 *
 * A value that breaks its definition is 422 `CUSTOM_FIELD_VALUE_INVALID` with
 * one issue per field, each naming it. The code is `custom_fields`' own.
 */
export async function mergeTaskCustomFields(
  customFields: CustomFieldValuePort,
  current: Record<string, unknown>,
  patch: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  if (patch === undefined) return current;
  try {
    return await customFields.validateAndMerge('task', current, patch);
  } catch (error) {
    if (isCustomFieldValidationFailure(error)) {
      throw new HttpError(
        422,
        ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID,
        'One or more custom fields are invalid.',
        error.errors.map((issue) => ({ path: issue.field, issue: issue.message })),
      );
    }
    throw error;
  }
}
