import type { ProjectRecord, ProjectReadPort, ProjectRecordKind } from '@endora-commerce/contracts';
import type { ProjectAccess, VisibleProjectRow } from './project-access.js';
import type { ProjectReadService } from './project-read-service.js';
import type { RecordProjectService } from './record-project-service.js';

export interface ProjectReadPortDeps {
  access: Pick<ProjectAccess, 'findVisible'>;
  read: Pick<ProjectReadService, 'summary'>;
  records: Pick<RecordProjectService, 'findByRecord'>;
}

/**
 * `projectReadPort` (`specs/163-projects-and-tasks/contracts/ports-and-events.md`
 * §2) — reading Projects from another module, an overlay or a later feature.
 *
 * Every answer starts from `ProjectAccess` under the caller's own context: by
 * id through `findVisible`, by record through the record panel's link lookup
 * (`record-project-service.ts`), which hands the id it finds to `findVisible`.
 * Out of reach, invisible and missing are one answer, `null`. The record is a
 * plain object, never an entity; its current Stage's name and its
 * Organizations come from the summary the record panel answers with.
 */
export class ProjectReadPortService implements ProjectReadPort {
  constructor(private readonly deps: ProjectReadPortDeps) {}

  async findById(id: string): Promise<ProjectRecord | null> {
    const row = await this.deps.access.findVisible(id);
    return row === null ? null : this.#record(row);
  }

  async findByRecord(kind: ProjectRecordKind, id: string): Promise<ProjectRecord | null> {
    const row = await this.deps.records.findByRecord(kind, id);
    return row === null ? null : this.#record(row);
  }

  async #record(row: VisibleProjectRow): Promise<ProjectRecord> {
    const summary = await this.deps.read.summary(row);
    return {
      id: row.id,
      number: row.number,
      title: row.title,
      state: row.state,
      currentStageId: row.current_stage_id,
      currentStageName: summary.currentStage?.name ?? null,
      organizationIds: summary.organizations.map((organization) => organization.id),
      valueAmount: row.value_amount,
      valueCurrency: row.value_currency,
      templateId: row.template_id,
      closedAt: row.closed_at === null ? null : new Date(row.closed_at),
      createdAt: new Date(row.created_at),
    };
  }
}
