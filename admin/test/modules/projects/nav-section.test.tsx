import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderResult } from '@testing-library/react';
import type { AdminContributions } from '@endora-commerce/contracts';
import { AdminNavSectionNameSchema } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import {
  adminSession,
  everyDeclaredModule,
  everyDeclaredPermission,
  modulePresence,
  withSession,
} from '../../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../../src/modules.generated.js';

/**
 * The host's "Projects & tasks" sidebar section (`specs/163-projects-and-tasks/`,
 * research R-16, `contracts/admin-surfaces.md` §1).
 *
 * The section is the **shell's**: a module may not invent one (D-23), so the
 * enum member, the `NAV` row and the heading's translation are host changes and
 * this file is their proof. It is driven with a contribution declared here
 * rather than with the `projects` package's own, deliberately — the subject is
 * the section, and it has to hold before either module ships a screen.
 *
 * Grep made before the section was added (T007), for every test enumerating the
 * sections: `grep -rn "AdminNavSectionNameSchema\|appShell.section\|'crm'"
 * admin/test backend/test packages/*\/src`. No test enumerates the whole set —
 * each names the sections it asserts on, and `crm/nav-section.test.tsx` only
 * asserts `options` *contains* `crm` — so none needed updating.
 *
 * The heading is asserted against the **shipped** bundles, read from
 * `packages/modules/_i18n/i18n/`, so "labelled Projects & tasks" is a statement
 * about what an operator reads and not about a key echoing itself.
 */

vi.mock('../../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

const { AppShell } = await import('../../../../packages/admin-shell/src/components/AppShell');

function shippedCoreBundle(language: 'en' | 'pl'): Record<string, string> {
  const path = resolve(process.cwd(), `../packages/modules/_i18n/i18n/${language}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
}

const PROJECTS_ROUTE = '/projects';

/** One sidebar entry in the `work` section, as the `projects` module will declare it. */
const projectsContribution = {
  moduleId: 'projects',
  contributions: {
    routes: [],
    nav: [
      {
        to: PROJECTS_ROUTE,
        labelKey: 'nav.projects.label',
        icon: 'ClipboardList',
        section: 'work',
        weight: 100,
        requiredPermission: 'projects:read',
      },
    ],
  } as unknown as AdminContributions,
};

function renderShell(options: { projectsPresent: boolean; permissions: readonly string[] }): RenderResult {
  setMobileViewport(false);
  const present = [
    ...everyDeclaredModule().filter((id) => id !== 'projects'),
    ...(options.projectsPresent ? ['projects'] : []),
  ];
  return renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Home content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
      {
        session: adminSession({ permissions: [...options.permissions] }),
        presence: modulePresence({ present }),
        registry: [
          ...MODULE_ADMIN_CONTRIBUTIONS.filter((entry) => entry.moduleId !== 'projects'),
          projectsContribution,
        ],
      },
    ),
    { core: shippedCoreBundle('en'), projects: { 'nav.projects.label': 'Projects' } },
  );
}

function sectionHeadings(): string[] {
  return [...document.querySelectorAll('.b2b-sidebar__group-label')].map(
    (heading) => heading.textContent?.trim() ?? '',
  );
}

function hrefsUnder(heading: string): (string | null)[] {
  const label = [...document.querySelectorAll('.b2b-sidebar__group-label')].find(
    (candidate) => candidate.textContent?.trim() === heading,
  );
  expect(label).toBeDefined();
  const group = (label as Element).closest('.b2b-sidebar__group');
  expect(group).not.toBeNull();
  return [...(group as Element).querySelectorAll('a')].map((a) => a.getAttribute('href'));
}

const HEADING = 'Projects & tasks';
const everyPermission = [...everyDeclaredPermission(), 'orders:read', 'crm:read', 'projects:read'];

describe('the host declares a "Projects & tasks" sidebar section', () => {
  it('is a section a module may join', () => {
    expect(AdminNavSectionNameSchema.options).toContain('work');
  });

  it('is labelled "Projects & tasks" / "Projekty i zadania"', () => {
    expect(shippedCoreBundle('en')['appShell.section.work']).toBe(HEADING);
    expect(shippedCoreBundle('pl')['appShell.section.work']).toBe('Projekty i zadania');
  });

  it('renders a contribution with section "work" under its heading, placed directly after CRM', () => {
    renderShell({ projectsPresent: true, permissions: everyPermission });
    const headings = sectionHeadings();
    // The positive control for the ordering claim: CRM is on screen.
    expect(headings).toContain('CRM');
    expect(headings).toContain(HEADING);
    expect(headings.indexOf(HEADING)).toBe(headings.indexOf('CRM') + 1);
    expect(hrefsUnder(HEADING)).toEqual([PROJECTS_ROUTE]);
  });

  it('renders no heading while the contributing module is switched off', () => {
    renderShell({ projectsPresent: false, permissions: everyPermission });
    expect(sectionHeadings()).toContain('CRM');
    expect(sectionHeadings()).not.toContain(HEADING);
  });

  it('renders no heading for an operator who may see none of its entries', () => {
    renderShell({
      projectsPresent: true,
      permissions: everyPermission.filter((code) => code !== 'projects:read'),
    });
    expect(sectionHeadings()).toContain('CRM');
    expect(sectionHeadings()).not.toContain(HEADING);
  });
});
