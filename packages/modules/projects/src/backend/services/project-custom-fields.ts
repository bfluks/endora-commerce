import {
  ERROR_CODES,
  isCustomFieldValidationFailure,
  type CustomFieldValuePort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * The custom-field half of a Project write (User Story 9, FR-036, research
 * R-18).
 *
 * `custom_fields` validates and merges; it writes nothing and audits nothing.
 * The bag this returns is assigned to the Project **inside the Project's own
 * Command**, so the values are persisted and audited by the one write that
 * changed them (Constitution XIII and XIV).
 *
 * `patch` absent means "nothing was said about the fields": the bag is
 * returned as it is and no definition is consulted — so a required field
 * defined after a Project was created does not refuse an unrelated edit. A
 * caller that wants the definitions enforced passes a bag, `{}` included; the
 * create form always does.
 *
 * A value that breaks its definition is 422 `CUSTOM_FIELD_VALUE_INVALID` with
 * one issue per field, each naming it. The code is `custom_fields`' own; this
 * module declares none for it.
 */
export async function mergeProjectCustomFields(
  customFields: CustomFieldValuePort,
  current: Record<string, unknown>,
  patch: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  if (patch === undefined) return current;
  try {
    return await customFields.validateAndMerge('project', current, patch);
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
