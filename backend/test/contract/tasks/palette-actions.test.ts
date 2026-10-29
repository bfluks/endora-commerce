import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contributions as tasksAdmin } from '@endora-commerce/mod-tasks/admin';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  actionRouteFindings,
  expectDeclared,
  expectLabels,
  expectTargetsOwnRoutes,
  type ExpectedAction,
} from '../projects/palette-actions-shared.js';

/**
 * Tasks under ⌘K (`specs/163-projects-and-tasks/` FR-041, T130;
 * `contracts/admin-surfaces.md` §4): three actions, each on a screen of the
 * module's own, gated by the code that screen and its API enforce. The ids are
 * the slugs §4's `tasks.open`, `tasks.mine` and `tasks.new` stand for.
 */
const EXPECTED: readonly ExpectedAction[] = [
  {
    id: 'open-tasks',
    route: '/tasks',
    permission: 'tasks:read',
    icon: 'ListChecks',
    label: { en: 'Tasks', pl: 'Zadania' },
  },
  {
    id: 'open-my-tasks',
    route: '/tasks/mine',
    permission: 'tasks:read',
    icon: 'ListChecks',
    label: { en: 'My tasks', pl: 'Moje zadania' },
  },
  {
    id: 'new-task',
    route: '/tasks/new',
    permission: 'tasks:write',
    icon: 'Plus',
    label: { en: 'New task', pl: 'Nowe zadanie' },
  },
];

describe('tasks palette actions (163 FR-041, T130)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('declares the three actions of §4', () => {
    expectDeclared('tasks', EXPECTED);
  });

  it('each opens a screen of the module’s own admin layer, on the action’s code', () => {
    expectTargetsOwnRoutes('tasks', tasksAdmin);
  });

  it('each resolves to a real API route with that route’s permission (check:action-route-permissions)', () => {
    const result = actionRouteFindings('tasks');
    expect(result.findings).toEqual([]);
  });

  it('serves the three, labelled in English and Polish', async () => {
    await expectLabels(h, 'tasks', EXPECTED);
  });
});
