import type { EntityManager } from '@mikro-orm/postgresql';
import { ProjectLossReason } from '../entities/project-loss-reason.entity.js';
import { DictionaryService, type DictionaryServiceDeps } from './dictionary-service.js';

/**
 * Loss reasons (`specs/163-projects-and-tasks/`, User Story 4, FR-005): the
 * five seeded ones and any the operator adds. Closing a Project as lost needs
 * one that is not archived (`move-service.ts`).
 *
 * A reason is **in use** while a Project was lost for it — a reopened Project
 * no longer holds one.
 */
export async function lossReasonInUse(em: EntityManager, id: string): Promise<boolean> {
  const [row] = (await em.execute(
    `select exists (select 1 from "projects" where "loss_reason_id" = ?) as "used"`,
    [id],
  )) as [{ used: boolean }];
  return row.used;
}

export function createLossReasonService(deps: DictionaryServiceDeps): DictionaryService {
  return new DictionaryService(deps, {
    entity: ProjectLossReason,
    table: 'project_loss_reasons',
    objectType: 'project_loss_reason',
    actionPrefix: 'projects.loss_reason',
    fallbackCode: 'reason',
    inUse: lossReasonInUse,
  });
}
