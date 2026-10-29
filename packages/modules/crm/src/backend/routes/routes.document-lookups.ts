import type { FastifyInstance } from 'fastify';
import {
  OpportunityDocumentLookupQuerySchema,
  OpportunityQuoteRequestLookupQuerySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { CrmDocumentLookupService } from '../services/crm-document-lookup-service.js';

export interface DocumentLookupRoutesDeps {
  documentLookupService: CrmDocumentLookupService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The Quote Requests an Opportunity's link picker chooses from
 * (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §10a), and the
 * `@@` document list of its texts (below). Gated
 * `crm:write`: a document is chosen only to be linked, and a link is a write —
 * **and `rfqs:handle`**, the code the Quote Requests module reads one with
 * (research N-R13): the answer names an Organization's Quote Requests and their
 * statuses, and linking one asks for the same code. That second code is asked
 * by the service, after it has decided the module is present: off is 503, as
 * the contract has it, whoever asks.
 */
export async function registerCrmDocumentLookupRoutes(
  app: FastifyInstance,
  deps: DocumentLookupRoutesDeps,
): Promise<void> {
  const { requireAdmin, documentLookupService: lookups } = deps;

  app.get(
    '/api/v1/admin/crm/lookups/quote-requests',
    { preHandler: requireAdmin('crm:write') },
    async (request) => ({
      data: await lookups.quoteRequests(
        OpportunityQuoteRequestLookupQuerySchema.parse(request.query ?? {}),
      ),
    }),
  );

  // The `@@` document list of an Opportunity's texts
  // (`specs/163-projects-and-tasks/` FR-044): `crm:write`, because a document is
  // chosen only while writing. Each group's own read code and its owner's
  // presence are the service's to decide — a switchable owner's code on the
  // route would answer 403 where the list should simply leave the group out.
  // The answer is `RecordDocumentLookupResponse` as it stands, the shape
  // Projects serves at `GET /projects/lookups/documents`.
  app.get(
    '/api/v1/admin/crm/lookups/documents',
    { preHandler: requireAdmin('crm:write') },
    async (request) =>
      lookups.documents(OpportunityDocumentLookupQuerySchema.parse(request.query ?? {})),
  );
}
