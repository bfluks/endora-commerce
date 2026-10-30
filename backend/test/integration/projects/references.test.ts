import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  formatRecordReferenceToken,
  ProjectCommentResponseSchema,
  RecordDocumentLookupResponseSchema,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { createCrmOpportunity, restoreDefaultCrmWorkflow, seedCrmAdmin } from '../../helpers/seed-crm.js';
import { callProjects, createProject, deleteProjects, getProject, setProjectsVisibility } from './helpers.js';

/**
 * Opportunities and Projects as reference kinds in a Project's texts
 * (`specs/165-task-management/` T028, research R-5): the shared grammar gained
 * both, so a Project note or description holding `[[opportunity:…]]` or
 * `[[project:…]]` is stored — no 500 from the widened check — and resolved per
 * reader: a number and a link for a reader holding `crm:read` /
 * `projects:read` while the owner is present, unavailable otherwise. The `@@`
 * list offers both groups on the same terms.
 */
describe('projects — references to Opportunities and Projects (165)', () => {
  let h: BackendServerHandle;
  let reader: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  let opportunity: { id: string; number: string };
  let target: { id: string; number: string };
  const projects: string[] = [];

  const stored = async (projectId: string) =>
    (
      (await h
        .em()
        .getConnection()
        .execute(`select "source_kind", "target_type", "target_id" from "project_references" where "project_id" = ?`, [
          projectId,
        ])) as Array<{ source_kind: string; target_type: string; target_id: string }>
    )
      .map((row) => `${row.source_kind}:${row.target_type}:${row.target_id}`)
      .sort();

  beforeAll(async () => {
    h = await setupBackendServer();
    await setProjectsVisibility(h, 'everyone');
    await restoreDefaultCrmWorkflow(h.em());
    reader = await seedCrmAdmin(h.em(), 'proj-refs-165', ['projects:read', 'projects:write']);
    opportunity = await createCrmOpportunity(h, { title: 'Referenced from a Project' });
    const created = await createProject(h, { title: 'Referenced Project' });
    projects.push(created.id);
    target = { id: created.id, number: created.number };
  });

  afterAll(async () => {
    reader?.undo();
    await deleteProjects(h, projects);
    await h.em().getConnection().execute(`delete from "crm_opportunities" where "id" = ?`, [opportunity.id]);
    await restoreDefaultCrmWorkflow(h.em());
    await setProjectsVisibility(h, 'members');
    await teardownBackendServer(h);
  });

  it('stores and resolves both kinds in the description and in a note', async () => {
    const description = `${formatRecordReferenceToken('opportunity', opportunity.id)} ${formatRecordReferenceToken('project', target.id)}`;
    const project = await createProject(h, { title: 'Referring Project', description });
    projects.push(project.id);
    const resolved = [
      {
        type: 'opportunity',
        id: opportunity.id,
        available: true,
        label: opportunity.number,
        url: `/crm/opportunities/${opportunity.id}`,
      },
      { type: 'project', id: target.id, available: true, label: target.number, url: `/projects/${target.id}` },
    ];
    expect((await getProject(h, project.id)).references).toEqual(resolved);

    const written = await callProjects(h, 'POST', `/${project.id}/comments`, { payload: { kind: 'note', body: description } });
    expect(written.statusCode, written.body).toBe(201);
    const note = ProjectCommentResponseSchema.parse(written.json()).data;
    expect(note.references).toEqual(resolved);
    expect(await stored(project.id)).toEqual(
      [
        `description:opportunity:${opportunity.id}`,
        `description:project:${target.id}`,
        `comment:opportunity:${opportunity.id}`,
        `comment:project:${target.id}`,
      ].sort(),
    );

    // A reader without crm:read sees the Opportunity as unavailable.
    const narrow = await getProject(h, project.id, reader.cookies);
    expect(narrow.references[0]).toEqual({
      type: 'opportunity',
      id: opportunity.id,
      available: false,
      label: null,
      url: null,
    });
    expect(narrow.references[1]).toMatchObject({ available: true });
    // With CRM off, nobody sees it.
    await withModuleOff('crm', 'deactivated', async () => {
      expect((await getProject(h, project.id)).references[0]).toMatchObject({ type: 'opportunity', available: false });
    });
  });

  it('offers both groups after @@ only to their readers and while their owners are present', async () => {
    const groups = async (cookies?: Record<string, string>) => {
      const response = await callProjects(h, 'GET', '/lookups/documents?q=', cookies ? { cookies } : {});
      expect(response.statusCode, response.body).toBe(200);
      return RecordDocumentLookupResponseSchema.parse(response.json()).groups;
    };
    const all = await groups();
    expect(all.map((g) => g.kind)).toEqual(expect.arrayContaining(['opportunity', 'project']));
    expect(all.find((g) => g.kind === 'project')!.items.map((i) => i.id)).toContain(target.id);
    const narrow = (await groups(reader.cookies)).map((g) => g.kind);
    expect(narrow).not.toContain('opportunity');
    expect(narrow).toContain('project');
    await withModuleOff('crm', 'deactivated', async () => {
      expect((await groups()).map((g) => g.kind)).not.toContain('opportunity');
    });
  });
});
