import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * The Task workflow the `tasks_task_management` migration seeds
 * (`specs/165-task-management/` data-model §2, FR-014), stated again here as
 * what a test may assume.
 *
 * The workflow is platform-wide configuration, and a file that changes it
 * calls {@link restoreDefaultTaskWorkflow} in its `beforeAll` (it does not
 * trust what an earlier file left) **and** in its `afterAll` (it leaves nothing
 * for a later one) — CRM's `restoreDefaultCrmWorkflow`, the model.
 */
const DEFAULT_STATUSES: ReadonlyArray<{
  code: string;
  name: Record<string, string>;
  defaultName: string;
  category: 'open' | 'done' | 'cancelled';
  isInitial: boolean;
  weight: number;
  color: string;
}> = [
  { code: 'todo', name: { en: 'To do', pl: 'Do zrobienia' }, defaultName: 'To do', category: 'open', isInitial: true, weight: 10, color: '#64748b' },
  { code: 'in_progress', name: { en: 'In progress', pl: 'W toku' }, defaultName: 'In progress', category: 'open', isInitial: false, weight: 20, color: '#f59e0b' },
  { code: 'done', name: { en: 'Done', pl: 'Zrobione' }, defaultName: 'Done', category: 'done', isInitial: false, weight: 30, color: '#10b981' },
  { code: 'cancelled', name: { en: 'Cancelled', pl: 'Anulowane' }, defaultName: 'Cancelled', category: 'cancelled', isInitial: false, weight: 40, color: '#94a3b8' },
];

/** The four seeded statuses, every move between them permitted; Tasks keep their codes. */
export async function restoreDefaultTaskWorkflow(em: EntityManager): Promise<void> {
  const connection = em.getConnection();
  await connection.execute('delete from "task_status_transitions"');
  await connection.execute('delete from "task_statuses"');
  for (const status of DEFAULT_STATUSES) {
    await connection.execute(
      `insert into "task_statuses" ("code", "name", "default_name", "category", "is_initial", "weight", "color")
       values (?, ?::jsonb, ?, ?, ?, ?, ?)`,
      [
        status.code,
        JSON.stringify(status.name),
        status.defaultName,
        status.category,
        status.isInitial,
        status.weight,
        status.color,
      ],
    );
  }
  await connection.execute(
    `insert into "task_status_transitions" ("from_code", "to_code")
     select f."code", t."code" from "task_statuses" f cross join "task_statuses" t where f."code" <> t."code"`,
  );
}
