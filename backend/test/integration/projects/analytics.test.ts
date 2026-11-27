import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ProjectAnalyticsDurationsResponseSchema,
  ProjectAnalyticsLossesResponseSchema,
  ProjectAnalyticsManagersResponseSchema,
  ProjectAnalyticsSummaryResponseSchema,
  ProjectAnalyticsTimeInStageResponseSchema,
  ProjectAnalyticsTopOpenResponseSchema,
  ProjectAnalyticsValueResponseSchema,
  ProjectTemplateResponseSchema,
  type ProjectDetail,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCrmAdmin, seedCrmOrganization, seedCrmSalesRep } from '../../helpers/seed-crm.js';
import {
  PROJECTS_ADMIN,
  THREE_STAGES,
  callProjects,
  closeProject,
  createProject,
  deleteProjects,
  dictionaryIds,
  moveProjectOk,
  stageNamed,
} from './helpers.js';

/**
 * User Story 10 — Project analytics, including lost Projects
 * (`specs/163-projects-and-tasks/spec.md` FR-037, FR-038, SC-005; research R-15).
 *
 * Fifty-one Projects are made through the API — created, walked through their
 * Stages, closed as completed or lost — and then dated into 2010 and 2011 by
 * rewriting their timestamps, so every interval is a whole number of days and
 * nothing another file creates today falls into the range. Every expected
 * number below was computed by hand from the table in the comment of
 * `beforeAll`, not by the code under test.
 *
 * The data set (range 2011-01-01 … 2011-12-31; Stages Design → Build → Handover):
 *
 * - **G1, 12 completed**, created 2011-02-01 + k days (k = 0…11). Stays: Design
 *   2 + (k mod 3) days, Build 10, Handover 1 + (k mod 2); closed at the end of
 *   Handover. Value: k 0–5 PLN 1000·(k+1); k 6–9 EUR 500·(k−5); k 10–11 none.
 *   Template *Analytics fit-out* on k 0–3. Members: manager A (Project
 *   Manager) on k 0–7, manager B (Project Manager) on k 5–11, C (Sales Rep, not
 *   a Project Manager) on every one; the outsider is a Member of k 0–1.
 * - **G2, 15 lost**, created 2011-04-01 + k days (k = 0…14). Stays Design 5,
 *   Build 8, Handover 3, closed as lost at the end of the Stage it was lost in:
 *   Design for k 0–6, Build for k 7–11, Handover for k 12–14. k 0–1 name their
 *   first Stage `DESIGN` (grouped with *Design* by name). Reason: *Price* for
 *   even k, *Chose a competitor* for odd. Value: k 0–4 PLN 200·(k+1); k 5–9
 *   EUR 300; k 10–14 none. Organization X on k 0–5.
 * - **G3, 20 open**, created 2011-06-01 + k days (k = 0…19), in Build after 7
 *   days of Design (a stay not yet left is not measured). Value: k 0–9 PLN
 *   10000 + 1000·k; k 10–14 EUR 5000 + 100·k; k 15–19 none. Template on k 0–4;
 *   Organization X on k 0–3; the sales representative is a Member of k 3.
 * - **G4, 2 completed**, created 2010-12-01, through Design 10, Build 15,
 *   Handover 10 days, closed 2011-01-05 — closed in the range, opened before
 *   it, no stay begun in it. Manager A is their Project Manager.
 * - **G5, 2 completed**, created 2010-01-01, closed 2010-02-01 — out of the range.
 *
 * Visibility: every Project is *Members and listed people*, except G2 k 0–4 and
 * G3 k 0–2, which are open to everyone — so no figure depends on the module
 * setting.
 */
describe('projects — analytics (US10, SC-005)', () => {
  let h: BackendServerHandle;
  type Person = { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let managerA: Person;
  let managerB: Person;
  let salesRepMember: Person;
  let outsider: Person;
  let readerOnly: Person;
  let rep: Person;
  let repWithoutReach: Person;
  let orgX: string;
  let templateId: string;
  let roles: Record<string, string>;
  let reasons: Record<string, string>;
  const created: string[] = [];
  const g3: ProjectDetail[] = [];

  const RANGE = 'from=2011-01-01&to=2011-12-31';
  const DAY = 86_400_000;
  const at = (iso: string, plusDays = 0): Date => new Date(new Date(`${iso}T00:00:00.000Z`).getTime() + plusDays * DAY);

  /**
   * Re-date one Project: its creation, its close and each of its Stage entries
   * in the order they were written. The entries are the API's own; only their
   * times move.
   */
  async function backdate(projectId: string, createdAt: Date, entryTimes: Date[], closedAt: Date | null): Promise<void> {
    const connection = h.em().getConnection();
    await connection.execute(`update "projects" set "created_at" = ?, "closed_at" = ? where "id" = ?`, [
      createdAt,
      closedAt,
      projectId,
    ]);
    const entries = (await connection.execute(
      `select "id" from "project_stage_entries" where "project_id" = ? order by "at", "id"`,
      [projectId],
    )) as Array<{ id: string }>;
    expect(entries.length, `entries of ${projectId}`).toBe(entryTimes.length);
    for (const [index, entry] of entries.entries()) {
      await connection.execute(`update "project_stage_entries" set "at" = ? where "id" = ?`, [entryTimes[index], entry.id]);
    }
  }

  const value = (amount: number | null, currency: string) =>
    amount === null ? {} : { value: { amount: amount.toFixed(2), currency } };

  type Path = 'Design' | 'Build' | 'Handover';

  /**
   * Create a Project and walk it to `last` (entering every Stage before it),
   * then close it as `outcome` there, or leave it open. Returns the Project.
   */
  async function make(options: {
    title: string;
    body: Record<string, unknown>;
    last: Path;
    outcome: 'completed' | 'lost' | null;
    lossReason?: string;
  }): Promise<ProjectDetail> {
    let project = await createProject(h, { title: options.title, ...options.body });
    created.push(project.id);
    const order: Path[] = ['Design', 'Build', 'Handover'];
    for (const stage of order.slice(1, order.indexOf(options.last) + 1)) {
      project = (await moveProjectOk(h, project.id, stageNamed(project, stage), project.version)).project;
    }
    if (options.outcome) {
      const response = await closeProject(h, project.id, {
        outcome: options.outcome,
        version: project.version,
        ...(options.outcome === 'lost' ? { lossReasonId: options.lossReason } : {}),
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    return project;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    roles = await dictionaryIds(h, 'project_roles');
    reasons = await dictionaryIds(h, 'project_loss_reasons');
    const PERMISSIONS = ['projects:read', 'projects:analytics'];
    managerA = await seedCrmAdmin(h.em(), 'analytics-pm-a', ['projects:read']);
    managerB = await seedCrmAdmin(h.em(), 'analytics-pm-b', ['projects:read']);
    salesRepMember = await seedCrmAdmin(h.em(), 'analytics-rep-member', ['projects:read']);
    outsider = await seedCrmAdmin(h.em(), 'analytics-outsider', PERMISSIONS);
    readerOnly = await seedCrmAdmin(h.em(), 'analytics-reader', ['projects:read']);
    orgX = await seedCrmOrganization(h.em(), 'analytics X');
    rep = await seedCrmSalesRep(h.em(), [orgX], PERMISSIONS);
    repWithoutReach = await seedCrmSalesRep(h.em(), [], PERMISSIONS);

    const template = await callProjects(h, 'POST', '/templates', {
      payload: {
        name: `Analytics fit-out ${Date.now()}`,
        roleIds: [roles.project_manager, roles.sales_rep],
        stages: THREE_STAGES.map((stage, index) => ({ key: `s${index}`, ...stage, completionPermitted: index === 2 })),
        moves: [
          { fromStageKey: 's0', toStageKey: 's1' },
          { fromStageKey: 's1', toStageKey: 's2' },
        ],
      },
    });
    expect(template.statusCode, template.body).toBe(201);
    templateId = ProjectTemplateResponseSchema.parse(template.json()).data.id;

    const pm = roles.project_manager!;
    const salesRole = roles.sales_rep!;
    const hidden = { visibility: 'members_and_listed' } as const;
    const open = { visibility: 'everyone' } as const;

    // G1 — 12 completed.
    for (let k = 0; k < 12; k += 1) {
      const members = [
        ...(k <= 7 ? [{ adminUserId: managerA.adminUserId, roleIds: [pm] }] : []),
        ...(k >= 5 ? [{ adminUserId: managerB.adminUserId, roleIds: [pm] }] : []),
        { adminUserId: salesRepMember.adminUserId, roleIds: [salesRole] },
        ...(k <= 1 ? [{ adminUserId: outsider.adminUserId, roleIds: [] }] : []),
      ];
      const amount = k <= 5 ? 1000 * (k + 1) : k <= 9 ? 500 * (k - 5) : null;
      const project = await make({
        title: `analytics G1 ${k}`,
        body: {
          ...hidden,
          members,
          ...value(amount, k <= 5 ? 'PLN' : 'EUR'),
          ...(k <= 3 ? { templateId, stages: undefined } : {}),
        },
        last: 'Handover',
        outcome: 'completed',
      });
      const start = at('2011-02-01', k);
      const design = 2 + (k % 3);
      const handover = 1 + (k % 2);
      await backdate(
        project.id,
        start,
        [start, at('2011-02-01', k + design), at('2011-02-01', k + design + 10), at('2011-02-01', k + design + 10 + handover)],
        at('2011-02-01', k + design + 10 + handover),
      );
    }

    // G2 — 15 lost.
    for (let k = 0; k < 15; k += 1) {
      const last: Path = k <= 6 ? 'Design' : k <= 11 ? 'Build' : 'Handover';
      const amount = k <= 4 ? 200 * (k + 1) : k <= 9 ? 300 : null;
      const stages = k <= 1 ? [{ ...THREE_STAGES[0]!, name: 'DESIGN' }, THREE_STAGES[1]!, THREE_STAGES[2]!] : THREE_STAGES;
      let project = await createProject(h, {
        title: `analytics G2 ${k}`,
        ...(k <= 4 ? open : hidden),
        ...value(amount, k <= 4 ? 'PLN' : 'EUR'),
        stages,
        organizationIds: k <= 5 ? [orgX] : [],
      });
      created.push(project.id);
      for (const stage of (['Build', 'Handover'] as const).slice(0, last === 'Design' ? 0 : last === 'Build' ? 1 : 2)) {
        project = (await moveProjectOk(h, project.id, stageNamed(project, stage), project.version)).project;
      }
      const lost = await closeProject(h, project.id, {
        outcome: 'lost',
        version: project.version,
        lossReasonId: k % 2 === 0 ? reasons.price : reasons.competitor,
      });
      expect(lost.statusCode, lost.body).toBe(200);
      const start = at('2011-04-01', k);
      const times = [start];
      if (last !== 'Design') times.push(at('2011-04-01', k + 5));
      if (last === 'Handover') times.push(at('2011-04-01', k + 13));
      const closedAt = at('2011-04-01', k + (last === 'Design' ? 5 : last === 'Build' ? 13 : 16));
      times.push(closedAt);
      await backdate(project.id, start, times, closedAt);
    }

    // G3 — 20 open, in Build.
    for (let k = 0; k < 20; k += 1) {
      const amount = k <= 9 ? 10000 + 1000 * k : k <= 14 ? 5000 + 100 * k : null;
      const project = await make({
        title: `analytics G3 ${k}`,
        body: {
          ...(k <= 2 ? open : hidden),
          ...value(amount, k <= 9 ? 'PLN' : 'EUR'),
          organizationIds: k <= 3 ? [orgX] : [],
          ...(k === 3 ? { members: [{ adminUserId: rep.adminUserId, roleIds: [] }] } : {}),
          ...(k <= 4 ? { templateId, stages: undefined } : {}),
        },
        last: 'Build',
        outcome: null,
      });
      g3.push(project);
      const start = at('2011-06-01', k);
      await backdate(project.id, start, [start, at('2011-06-01', k + 7)], null);
    }

    // G4 — 2 completed in the range, opened before it.
    for (let k = 0; k < 2; k += 1) {
      const project = await make({
        title: `analytics G4 ${k}`,
        body: { ...hidden, members: [{ adminUserId: managerA.adminUserId, roleIds: [pm] }] },
        last: 'Handover',
        outcome: 'completed',
      });
      await backdate(
        project.id,
        at('2010-12-01'),
        [at('2010-12-01'), at('2010-12-11'), at('2010-12-26'), at('2011-01-05')],
        at('2011-01-05'),
      );
    }

    // G5 — 2 completed out of the range.
    for (let k = 0; k < 2; k += 1) {
      const project = await make({
        title: `analytics G5 ${k}`,
        body: { ...hidden, members: [{ adminUserId: managerA.adminUserId, roleIds: [pm] }] },
        last: 'Handover',
        outcome: 'completed',
      });
      await backdate(
        project.id,
        at('2010-01-01'),
        [at('2010-01-01'), at('2010-01-10'), at('2010-01-20'), at('2010-02-01')],
        at('2010-02-01'),
      );
    }
    expect(created).toHaveLength(51);
  }, 300_000);

  afterAll(async () => {
    for (const person of [managerA, managerB, salesRepMember, outsider, readerOnly, rep, repWithoutReach]) person?.undo();
    await deleteProjects(h, created);
    if (templateId) {
      await h.em().getConnection().execute(`delete from "project_templates" where "id" = ?`, [templateId]);
    }
    await teardownBackendServer(h);
  });

  async function figure(name: string, query = '', cookies: { b2b_session: string } = PROJECTS_ADMIN): Promise<unknown> {
    const response = await callProjects(h, 'GET', `/analytics/${name}?${RANGE}${query}`, { cookies });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  describe('every figure over the whole data set', () => {
    it('summary: opened, completed, lost and the completion rate', async () => {
      const answer = ProjectAnalyticsSummaryResponseSchema.parse(await figure('summary'));
      expect(answer).toMatchObject({ from: '2011-01-01', to: '2011-12-31', projectCount: 49, excluded: { noValue: 0 } });
      expect(answer.data).toEqual({ opened: 47, completed: 14, lost: 15, completionRate: expect.closeTo(14 / 29, 9) });
    });

    it('durations: creation to close, in days, per outcome', async () => {
      const answer = ProjectAnalyticsDurationsResponseSchema.parse(await figure('durations'));
      expect(answer).toMatchObject({ projectCount: 29, excluded: { noValue: 0 } });
      expect(answer.data.completedCount).toBe(14);
      expect(answer.data.completedAverageDays).toBeCloseTo(244 / 14, 6);
      expect(answer.data.lostCount).toBe(15);
      expect(answer.data.lostAverageDays).toBeCloseTo(148 / 15, 6);
    });

    it('time in Stage: per Stage name, over the stays begun in the range and left', async () => {
      const answer = ProjectAnalyticsTimeInStageResponseSchema.parse(await figure('time-in-stage'));
      expect(answer).toMatchObject({ projectCount: 47, excluded: { noValue: 0 } });
      expect(answer.data.map((row) => [row.stageName, row.sampleCount])).toEqual([
        ['Design', 47],
        ['Build', 20],
        ['Handover', 15],
      ]);
      expect(answer.data[0]!.averageDays).toBeCloseTo(251 / 47, 6);
      expect(answer.data[1]!.averageDays).toBeCloseTo(184 / 20, 6);
      expect(answer.data[2]!.averageDays).toBeCloseTo(27 / 15, 6);
    });

    it('losses: by the Stage lost in (ranked), by reason, and the value lost per currency', async () => {
      const answer = ProjectAnalyticsLossesResponseSchema.parse(await figure('losses'));
      expect(answer).toMatchObject({ projectCount: 15, excluded: { noValue: 5 } });
      expect(answer.data.byStage).toEqual([
        { stageName: 'Design', count: 7, share: expect.closeTo(7 / 15, 9) },
        { stageName: 'Build', count: 5, share: expect.closeTo(5 / 15, 9) },
        { stageName: 'Handover', count: 3, share: expect.closeTo(3 / 15, 9) },
      ]);
      expect(answer.data.byReason).toEqual([
        { lossReasonId: reasons.price, code: 'price', name: 'Price', count: 8, share: expect.closeTo(8 / 15, 9) },
        {
          lossReasonId: reasons.competitor,
          code: 'competitor',
          name: 'Chose a competitor',
          count: 7,
          share: expect.closeTo(7 / 15, 9),
        },
      ]);
      expect(answer.data.lostValue).toEqual([
        { currency: 'EUR', amount: '1500.00' },
        { currency: 'PLN', amount: '3000.00' },
      ]);
    });

    it('losses: a reason is named in the reader’s language', async () => {
      const polish = await seedCrmAdmin(h.em(), 'analytics-pl', ['projects:read', 'projects:analytics']);
      try {
        await h
          .em()
          .getConnection()
          .execute(`update "admin_users" set "preferred_language" = 'pl' where "id" = ?`, [polish.adminUserId]);
        const answer = ProjectAnalyticsLossesResponseSchema.parse(await figure('losses', '', polish.cookies));
        // The Projects open to everyone: G2 k 0–4, three for the price and two for a competitor.
        expect(answer.data.byReason.map((row) => [row.name, row.count])).toEqual([
          ['Cena', 3],
          ['Wybór konkurencji', 2],
        ]);
      } finally {
        polish.undo();
      }
    });

    it('value: the average per currency, never across them; Projects without a value are excluded and counted', async () => {
      const answer = ProjectAnalyticsValueResponseSchema.parse(await figure('value'));
      expect(answer).toMatchObject({ projectCount: 47, excluded: { noValue: 12 } });
      expect(answer.data.average).toEqual([
        { currency: 'EUR', amount: '2678.57', count: 14 },
        { currency: 'PLN', amount: '8047.62', count: 21 },
      ]);
    });

    it('top open: the most valuable open Projects, five per currency', async () => {
      const answer = ProjectAnalyticsTopOpenResponseSchema.parse(await figure('top-open'));
      expect(answer).toMatchObject({ projectCount: 20, excluded: { noValue: 5 } });
      expect(answer.data.map((p) => p.id)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5].map((k) => g3[k]!.id));
      expect(answer.data[0]!.value).toEqual({ amount: '6400.00', currency: 'EUR' });
    });

    it('managers: the Project Managers with the most completed Projects', async () => {
      const answer = ProjectAnalyticsManagersResponseSchema.parse(await figure('managers'));
      expect(answer).toMatchObject({ projectCount: 14, excluded: { noValue: 0 } });
      expect(answer.data.map((row) => [row.adminUser.id, row.completedCount])).toEqual([
        [managerA.adminUserId, 10],
        [managerB.adminUserId, 7],
      ]);
      expect(answer.data[0]!.adminUser.name).toContain('analytics-pm-a');
    });
  });

  describe('filters', () => {
    it('Template: every figure counts only Projects created from it', async () => {
      const query = `&templateId=${templateId}`;
      const summary = ProjectAnalyticsSummaryResponseSchema.parse(await figure('summary', query));
      expect(summary.projectCount).toBe(9);
      expect(summary.data).toMatchObject({ opened: 9, completed: 4, lost: 0 });
      const durations = ProjectAnalyticsDurationsResponseSchema.parse(await figure('durations', query));
      expect(durations.data.completedAverageDays).toBeCloseTo(57 / 4, 6);
      const losses = ProjectAnalyticsLossesResponseSchema.parse(await figure('losses', query));
      expect(losses).toMatchObject({ projectCount: 0, data: { byStage: [], byReason: [], lostValue: [] } });
    });

    it('Organization: only Projects that have it', async () => {
      const losses = ProjectAnalyticsLossesResponseSchema.parse(await figure('losses', `&organizationId=${orgX}`));
      expect(losses).toMatchObject({ projectCount: 6, excluded: { noValue: 0 } });
      expect(losses.data.byStage).toEqual([{ stageName: 'Design', count: 6, share: 1 }]);
      expect(losses.data.byReason.map((row) => [row.code, row.count])).toEqual([
        ['competitor', 3],
        ['price', 3],
      ]);
      expect(losses.data.lostValue).toEqual([
        { currency: 'EUR', amount: '300.00' },
        { currency: 'PLN', amount: '3000.00' },
      ]);
      const summary = ProjectAnalyticsSummaryResponseSchema.parse(await figure('summary', `&organizationId=${orgX}`));
      expect(summary.data).toMatchObject({ opened: 10, completed: 0, lost: 6 });
    });

    it('Project Manager: only Projects they manage', async () => {
      const summary = ProjectAnalyticsSummaryResponseSchema.parse(
        await figure('summary', `&projectManagerId=${managerB.adminUserId}`),
      );
      expect(summary).toMatchObject({ projectCount: 7, data: { opened: 7, completed: 7, lost: 0 } });
      // A Sales Rep is a Member, not a Project Manager: nothing is theirs.
      const none = ProjectAnalyticsSummaryResponseSchema.parse(
        await figure('summary', `&projectManagerId=${salesRepMember.adminUserId}`),
      );
      expect(none).toMatchObject({ projectCount: 0, data: { opened: 0, completed: 0, lost: 0, completionRate: null } });
    });
  });

  describe('who reads (spec US10 sc. 5, FR-020)', () => {
    it('a reader who is a Member of none of the hidden Projects counts only the ones they may see', async () => {
      const cookies = outsider.cookies;
      const summary = ProjectAnalyticsSummaryResponseSchema.parse(await figure('summary', '', cookies));
      expect(summary).toMatchObject({ projectCount: 10, data: { opened: 10, completed: 2, lost: 5 } });

      const durations = ProjectAnalyticsDurationsResponseSchema.parse(await figure('durations', '', cookies));
      expect(durations.projectCount).toBe(7);
      expect(durations.data.completedAverageDays).toBeCloseTo(14, 6);
      expect(durations.data.lostAverageDays).toBeCloseTo(5, 6);

      const stages = ProjectAnalyticsTimeInStageResponseSchema.parse(await figure('time-in-stage', '', cookies));
      expect(stages.projectCount).toBe(10);
      expect(stages.data.map((row) => [row.stageName, row.sampleCount])).toEqual([
        ['Design', 10],
        ['Build', 2],
        ['Handover', 2],
      ]);
      expect(stages.data[0]!.averageDays).toBeCloseTo(5.1, 6);
      expect(stages.data[2]!.averageDays).toBeCloseTo(1.5, 6);

      const losses = ProjectAnalyticsLossesResponseSchema.parse(await figure('losses', '', cookies));
      expect(losses).toMatchObject({ projectCount: 5, excluded: { noValue: 0 } });
      expect(losses.data.byStage).toEqual([{ stageName: 'Design', count: 5, share: 1 }]);
      expect(losses.data.byReason.map((row) => [row.code, row.count])).toEqual([
        ['price', 3],
        ['competitor', 2],
      ]);
      expect(losses.data.lostValue).toEqual([{ currency: 'PLN', amount: '3000.00' }]);

      const value = ProjectAnalyticsValueResponseSchema.parse(await figure('value', '', cookies));
      expect(value).toMatchObject({ projectCount: 10, excluded: { noValue: 0 } });
      expect(value.data.average).toEqual([{ currency: 'PLN', amount: '3900.00', count: 10 }]);

      const top = ProjectAnalyticsTopOpenResponseSchema.parse(await figure('top-open', '', cookies));
      expect(top.projectCount).toBe(3);
      expect(top.data.map((p) => p.id)).toEqual([2, 1, 0].map((k) => g3[k]!.id));

      const managers = ProjectAnalyticsManagersResponseSchema.parse(await figure('managers', '', cookies));
      expect(managers.projectCount).toBe(2);
      expect(managers.data.map((row) => [row.adminUser.id, row.completedCount])).toEqual([[managerA.adminUserId, 2]]);
    });

    it('a sales representative counts only visible Projects of the Organizations they reach', async () => {
      const summary = ProjectAnalyticsSummaryResponseSchema.parse(await figure('summary', '', rep.cookies));
      expect(summary).toMatchObject({ projectCount: 9, data: { opened: 9, completed: 0, lost: 5 } });
      const value = ProjectAnalyticsValueResponseSchema.parse(await figure('value', '', rep.cookies));
      // G2 k 0–4 (PLN 3000 together) and G3 k 0–3 (PLN 10000 … 13000): 49000 / 9.
      expect(value.data.average).toEqual([{ currency: 'PLN', amount: '5444.44', count: 9 }]);
    });

    it('a reader who reaches no Organization gets every figure empty', async () => {
      const cookies = repWithoutReach.cookies;
      expect(ProjectAnalyticsSummaryResponseSchema.parse(await figure('summary', '', cookies))).toMatchObject({
        projectCount: 0,
        data: { opened: 0, completed: 0, lost: 0, completionRate: null },
      });
      for (const name of ['durations', 'time-in-stage', 'losses', 'value', 'top-open', 'managers']) {
        const answer = (await figure(name, '', cookies)) as { projectCount: number };
        expect(answer.projectCount, name).toBe(0);
      }
    });
  });

  describe('the gate and the query', () => {
    const FIGURES = ['summary', 'durations', 'time-in-stage', 'losses', 'value', 'top-open', 'managers'];

    it.each(FIGURES)('GET /analytics/%s needs projects:analytics — 403 for a reader without it', async (name) => {
      const response = await callProjects(h, 'GET', `/analytics/${name}?${RANGE}`, { cookies: readerOnly.cookies });
      expect(response.statusCode, response.body).toBe(403);
    });

    it.each(FIGURES)('GET /analytics/%s refuses a range that ends before it starts — 400', async (name) => {
      const response = await callProjects(h, 'GET', `/analytics/${name}?from=2011-02-01&to=2011-01-01`);
      expect(response.statusCode, response.body).toBe(400);
    });
  });
});
