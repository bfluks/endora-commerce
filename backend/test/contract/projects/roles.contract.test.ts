import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { callProjects, createProject, THREE_STAGES } from '../../integration/projects/helpers.js';
import { describeDictionaryContract } from './dictionary-contract.js';

/**
 * Project Roles — `specs/163-projects-and-tasks/contracts/admin-api.md` §2.5,
 * User Story 4 (FR-007). A Project uses a Role by a Member holding it; an
 * archived Role stays on that Member and is not handed out again
 * (422 `PROJECT_MEMBER_INVALID`). That a Role grants no permission (FR-009) is
 * `integration/projects/roles-grant-nothing.test.ts`.
 */
describeDictionaryContract({
  path: '/roles',
  table: 'project_roles',
  objectType: 'project_role',
  actionPrefix: 'projects.role',
  seeded: [
    { code: 'sales_rep', en: 'Sales Rep', pl: 'Handlowiec' },
    { code: 'project_manager', en: 'Project Manager', pl: 'Kierownik Projektu' },
  ],
  use: async (h, id) =>
    (
      await createProject(h, {
        title: 'Uses a role',
        visibility: 'everyone',
        members: [{ adminUserId: TEST_ADMIN_ID, roleIds: [id] }],
      })
    ).id,
  shown: (project, id) => project.members.flatMap((member) => member.roles).find((role) => role.id === id),
  useAnew: async (h, id) => {
    const response = await callProjects(h, 'POST', '', {
      payload: {
        title: 'Takes an archived role',
        organizationIds: [],
        stages: THREE_STAGES,
        members: [{ adminUserId: TEST_ADMIN_ID, roleIds: [id] }],
      },
    });
    return { response, projectId: response.statusCode === 201 ? (response.json() as { data: { id: string } }).data.id : '' };
  },
  archivedRefusal: 'PROJECT_MEMBER_INVALID',
});
