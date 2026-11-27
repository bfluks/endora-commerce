import type { CustomFieldCarryReceiverPort } from '@endora-commerce/contracts';
import type { CrmOpportunity } from '../entities/crm-opportunity.entity.js';
import type { OriginatedDocument } from './opportunity-origin-link-service.js';

/**
 * Opportunity → Order / Quote Request custom-field carry
 * (`specs/162-custom-fields-value-carry/`, research R-10): the Opportunity's
 * values pushed to the owner of the document just linked to it, which carries
 * them into empty fields in a Command of its own and records what it skipped.
 *
 * `orders` is a binding dependency of this module. `quote_requests` is not:
 * its receiver is reached only while {@link quoteRequestsPresent} says the
 * module is present — the same decision `crm-quote-requests.ts` makes in front
 * of that owner's gate — so a switched-off quote desk is never called and
 * nothing is caught.
 */
export function createCarryIntoDocument(deps: {
  orders: CustomFieldCarryReceiverPort;
  quoteRequests: CustomFieldCarryReceiverPort;
  quoteRequestsPresent: () => boolean;
}): (document: OriginatedDocument, opportunity: CrmOpportunity) => Promise<void> {
  return async (document, opportunity) => {
    const values = { ...(opportunity.customFieldValues ?? {}) };
    if (Object.keys(values).length === 0) return;
    const input = {
      recordId: document.id,
      organizationId: document.organizationId,
      source: {
        entityType: 'opportunity' as const,
        recordId: opportunity.id,
        reference: opportunity.number,
        values,
      },
    };
    if (document.kind === 'order') {
      await deps.orders.receiveCarriedValues(input);
      return;
    }
    if (deps.quoteRequestsPresent()) await deps.quoteRequests.receiveCarriedValues(input);
  };
}
