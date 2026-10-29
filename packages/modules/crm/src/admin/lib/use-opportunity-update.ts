import { useCallback } from 'react';
import type { OpportunityDetail, UpdateOpportunityRequest } from '@endora-commerce/contracts';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { crmApi } from '../api.js';
import { errorMessage } from './labels.js';

/**
 * One field of an Opportunity saved where it is shown
 * (`specs/158-crm-opportunity-inline-editing/`, FR-003): the Opportunity's
 * `PATCH` — the one write it always had, through the Command Bus — naming that
 * field alone, under the version on screen as `If-Match`.
 *
 * **Somebody else saved first** (409 `VERSION_CONFLICT`): the Opportunity is
 * read again and put on screen, and the save is refused with a sentence that
 * says so. The draft stays in the field, so a second *Save* is a deliberate
 * choice made against the newer state — never a silent overwrite of it.
 * Any other refusal is the server's own sentence.
 */
export function useOpportunityUpdate(
  opportunity: OpportunityDetail,
  onChange: (next: OpportunityDetail) => void,
): (body: UpdateOpportunityRequest) => Promise<void> {
  const t = useTranslation('crm');
  const { id, version } = opportunity;
  return useCallback(
    async (body: UpdateOpportunityRequest): Promise<void> => {
      try {
        onChange(await crmApi.updateOpportunity(id, body, version));
      } catch (failure) {
        if (
          failure instanceof ApiError &&
          failure.status === 409 &&
          failure.envelope.error.code === 'VERSION_CONFLICT'
        ) {
          try {
            onChange(await crmApi.getOpportunity(id));
          } catch {
            // The sentence below still holds; the screen shows the last good read.
          }
          throw new Error(t('inlineEdit.conflict'));
        }
        throw new Error(errorMessage(failure, t('opportunity.edit.error')));
      }
    },
    [id, version, onChange, t],
  );
}
