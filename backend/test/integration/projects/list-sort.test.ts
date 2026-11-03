import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectListResponseSchema, type ProjectDetail } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { callProjects, createProject, deleteProjects, stageNamed, withTasksOff } from './helpers.js';

/**
 * `GET /projects?sort=value|deadline` (`contracts/admin-api.md` §2.1, the list
 * screen's sort): a keyset over a column that may be empty — the value, or the
 * current Stage's deadline — with the empty ones **last in both directions**,
 * ties broken by creation time and then id in the same direction. Paged two
 * at a time, so every boundary of the keyset is crossed: between equal keys,
 * from a key to an empty one, and between empty ones.
 */
describe('projects — list sorted by value and by deadline', () => {
  let h: BackendServerHandle;
  const marker = `Sort-${randomUUID().slice(0, 8)}`;
  const projects: ProjectDetail[] = [];
  /** Value and manual deadline of each Project, in creation order. */
  const plan: Array<{ value: string | null; deadline: string | null }> = [
    { value: '500.00', deadline: '2031-03-01' },
    { value: null, deadline: null },
    { value: '100.00', deadline: '2031-01-15' },
    { value: '500.00', deadline: null },
    { value: null, deadline: '2031-01-15' },
    { value: '2500.00', deadline: '2030-12-31' },
    { value: '100.00', deadline: '2031-03-01' },
  ];

  async function pages(query: string): Promise<{ ids: string[]; totals: number[] }> {
    const ids: string[] = [];
    const totals: number[] = [];
    let cursor: string | null = null;
    do {
      const response = await callProjects(
        h,
        'GET',
        `?q=${marker}&limit=2&${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      expect(response.statusCode, response.body).toBe(200);
      const page = ProjectListResponseSchema.parse(response.json());
      ids.push(...page.items.map((item) => item.id));
      totals.push(page.total);
      cursor = page.nextCursor;
    } while (cursor);
    return { ids, totals };
  }

  /** The order the database must produce: keyed rows by key, then empty ones; ties by creation. */
  function expected(key: 'value' | 'deadline', order: 'asc' | 'desc'): string[] {
    const sign = order === 'asc' ? 1 : -1;
    const keyOf = (index: number) =>
      key === 'value' ? (plan[index]!.value === null ? null : Number(plan[index]!.value)) : plan[index]!.deadline;
    const indexes = plan.map((_, index) => index);
    const keyed = indexes.filter((index) => keyOf(index) !== null);
    const empty = indexes.filter((index) => keyOf(index) === null);
    keyed.sort((a, b) => {
      const ka = keyOf(a)!;
      const kb = keyOf(b)!;
      if (ka < kb) return -sign;
      if (ka > kb) return sign;
      return sign * (a - b);
    });
    empty.sort((a, b) => sign * (a - b));
    return [...keyed, ...empty].map((index) => projects[index]!.id);
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await withTasksOff(async () => {
      for (const [index, row] of plan.entries()) {
        const project = await createProject(h, {
          title: `${marker} ${index}`,
          ...(row.value ? { value: { amount: row.value, currency: 'PLN' } } : {}),
          stages: [{ name: 'Only', color: '#64748b' }],
        });
        projects.push(project);
        // A Project's deadline is its current Stage's; an empty one is cleared by hand.
        const response = await callProjects(h, 'PATCH', `/${project.id}/stages/${stageNamed(project, 'Only')}`, {
          payload: row.deadline ? { deadlineOn: row.deadline } : { plannedDurationDays: 0 },
        });
        expect(response.statusCode, response.body).toBe(200);
        if (!row.deadline) {
          await h
            .em()
            .getConnection()
            .execute(`update "project_stages" set "deadline_on" = null where "project_id" = ?`, [project.id]);
        }
        // Distinct creation instants, in plan order, whatever the clock's resolution.
        await h
          .em()
          .getConnection()
          .execute(`update "projects" set "created_at" = ? where "id" = ?`, [
            new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
            project.id,
          ]);
      }
    });
  });

  afterAll(async () => {
    await deleteProjects(
      h,
      projects.map((p) => p.id),
    );
    await teardownBackendServer(h);
  });

  for (const key of ['value', 'deadline'] as const) {
    for (const order of ['asc', 'desc'] as const) {
      it(`sort=${key}&order=${order} — empty ${key}s last, ties by creation, every page continuing the last`, async () => {
        const { ids, totals } = await pages(`sort=${key}&order=${order}`);
        expect(ids).toEqual(expected(key, order));
        expect(new Set(totals)).toEqual(new Set([plan.length]));
      });
    }
  }

  it('a cursor issued for one sort is refused by another — 400', async () => {
    const first = await callProjects(h, 'GET', `?q=${marker}&limit=2&sort=value`);
    const cursor = ProjectListResponseSchema.parse(first.json()).nextCursor!;
    const response = await callProjects(h, 'GET', `?q=${marker}&limit=2&sort=deadline&cursor=${encodeURIComponent(cursor)}`);
    expect(response.statusCode, response.body).toBe(400);
  });
});
