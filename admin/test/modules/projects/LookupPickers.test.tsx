import { useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { setMobileViewport } from '../../setup';
import { ADMIN_ID, renderProjects } from './projects-fixtures';

/**
 * The Projects screens' own administrator picker (`components/LookupPickers.tsx`,
 * User Story 5 — task T088).
 *
 * A value the picker did not choose itself — a filter restored from elsewhere,
 * a stored Member — must still be shown by name: the picker asks the module's
 * own lookup for that one id when none of the options it has read names it.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { AdminUserLookup } = await import('../../../../packages/modules/projects/src/admin/components/LookupPickers');

const PEOPLE_PATH = '/api/v1/admin/projects/lookups/admin-users';
const FAR_ID = '00000000-0000-4000-8000-000000000c09';

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === `${PEOPLE_PATH}?id=${FAR_ID}`) {
      return Promise.resolve({ data: [{ id: FAR_ID, name: 'Zofia Far', email: 'zofia@example.com' }] });
    }
    if (path.startsWith(PEOPLE_PATH)) {
      return Promise.resolve({ data: [{ id: ADMIN_ID, name: 'Anna Nowak', email: 'anna@example.com' }] });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

function Harness(props: { initial: string | null }): ReactElement {
  const [value, setValue] = useState<string | null>(props.initial);
  return <AdminUserLookup id="member" ariaLabel="Member" value={value} onChange={setValue} />;
}

describe('AdminUserLookup', () => {
  it('names a value it was given rather than chose, by asking the lookup for that one id', async () => {
    renderProjects(<Harness initial={FAR_ID} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Member' })).toHaveValue('Zofia Far'));
    expect(getSpy).toHaveBeenCalledWith(`${PEOPLE_PATH}?id=${FAR_ID}`);
  });

  it('asks nothing more for a value one of the options it read already names', async () => {
    renderProjects(<Harness initial={ADMIN_ID} />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Member' })).toHaveValue('Anna Nowak'));
    expect(getSpy.mock.calls.map(([path]) => path)).not.toContain(`${PEOPLE_PATH}?id=${ADMIN_ID}`);
  });
});
