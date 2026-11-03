import { expect } from 'vitest';
import type { BackendServerHandle } from '../../helpers/test-server.js';
import { closeProject, createProject } from '../../integration/projects/helpers.js';
import { describeDictionaryContract } from './dictionary-contract.js';

/**
 * Loss reasons — `specs/163-projects-and-tasks/contracts/admin-api.md` §2.5,
 * User Story 4 and FR-005. A Project uses a reason by being closed as lost
 * for it; an archived reason stays on that Project and is not offered to the
 * next one (422 `PROJECT_LOSS_REASON_INVALID`).
 */
async function loseFor(h: BackendServerHandle, id: string) {
  const project = await createProject(h, { title: 'Lost for a reason', visibility: 'everyone' });
  const response = await closeProject(h, project.id, { outcome: 'lost', lossReasonId: id, version: project.version });
  return { response, projectId: project.id };
}

describeDictionaryContract({
  path: '/loss-reasons',
  table: 'project_loss_reasons',
  objectType: 'project_loss_reason',
  actionPrefix: 'projects.loss_reason',
  seeded: [
    { code: 'price', en: 'Price', pl: 'Cena' },
    { code: 'competitor', en: 'Chose a competitor', pl: 'Wybór konkurencji' },
    { code: 'cancelled_by_client', en: 'Cancelled by the client', pl: 'Anulowany przez klienta' },
    { code: 'no_decision', en: 'No decision', pl: 'Brak decyzji' },
    { code: 'other', en: 'Other', pl: 'Inny powód' },
  ],
  use: async (h, id) => {
    const { response, projectId } = await loseFor(h, id);
    expect(response.statusCode, response.body).toBe(200);
    return projectId;
  },
  shown: (project, id) => (project.lossReason?.id === id ? project.lossReason : undefined),
  useAnew: loseFor,
  archivedRefusal: 'PROJECT_LOSS_REASON_INVALID',
});
