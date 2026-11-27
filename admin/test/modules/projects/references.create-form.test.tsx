import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { EVERY_PROJECTS_PERMISSION, ORGANIZATION_ID, PROJECT_ID, renderProjects } from './projects-fixtures';

/**
 * The `@@` document list of the create form (carry-over C10 of
 * `specs/163-projects-and-tasks/`): before a Project exists the form names the
 * Organizations chosen on it, so the list offers their Orders and Quote
 * Requests — `GET /projects/lookups/documents?organizationIds=…`. On a Project
 * its own Organizations are the server's answer, and none are sent.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { useProjectReferences } = await import('../../../../packages/modules/projects/src/admin/lib/references');
type Scope = Parameters<typeof useProjectReferences>[0];
type References = ReturnType<typeof useProjectReferences>;

const OTHER_ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a2';
const WITH_DOCUMENTS = [...EVERY_PROJECTS_PERMISSION, 'orders:read'];

let seen: References | null = null;
function Probe(props: { scope: Scope }): ReactElement {
  seen = useProjectReferences(props.scope);
  return <output>{seen.kinds.join(',')}</output>;
}

async function render(scope: Scope): Promise<References> {
  renderProjects(<Probe scope={scope} />, { permissions: WITH_DOCUMENTS });
  await screen.findByRole('status');
  return seen as References;
}

const requested = (): string[] => getSpy.mock.calls.map(([path]) => String(path));

beforeEach(() => {
  seen = null;
  getSpy.mockReset();
  getSpy.mockResolvedValue({ groups: [] });
});

describe('the create form’s @@ list', () => {
  it('offers the document list once an Organization is chosen, and names the chosen Organizations', async () => {
    const references = await render({
      projectId: null,
      hasOrganizations: true,
      organizationIds: [ORGANIZATION_ID, OTHER_ORGANIZATION_ID],
    });
    expect(references.kinds).toContain('document');
    await references.lookups.searchDocuments?.('ORD');
    expect(requested()).toEqual([
      `/api/v1/admin/projects/lookups/documents?organizationIds=${ORGANIZATION_ID}&organizationIds=${OTHER_ORGANIZATION_ID}&q=ORD`,
    ]);
  });

  it('sends no Organizations for a Project — its own are the server’s answer', async () => {
    const references = await render({ projectId: PROJECT_ID, hasOrganizations: true });
    await references.lookups.searchDocuments?.('');
    expect(requested()).toEqual([`/api/v1/admin/projects/lookups/documents?projectId=${PROJECT_ID}`]);
  });
});
