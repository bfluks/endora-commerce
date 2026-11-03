import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AdminSearchProviderQuery, ProjectSummary } from '@endora-commerce/contracts';
import { createProjectAdminSearchProvider } from './admin-search-provider.js';

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>;

function query(over: Partial<AdminSearchProviderQuery> = {}): AdminSearchProviderQuery {
  return {
    text: 'PRJ-1',
    likeEscaped: 'PRJ-1',
    isUuid: false,
    fields: ['number', 'title'],
    limit: 5,
    language: 'pl',
    adminUserId: 'admin-1',
    signal: { aborted: false },
    ...over,
  };
}

const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 'p1',
  number: 'PRJ-000001',
  title: 'Showroom fit-out',
  state: 'open',
  currentStage: null,
  organizations: [
    { id: 'o1', name: 'Acme' },
    { id: 'o2', name: 'Beta' },
  ],
  value: null,
  projectManagers: [],
  createdAt: '2026-10-20T10:00:00.000Z',
  closedAt: null,
  ...over,
});

describe('projects admin search provider (163 §6)', () => {
  it('declares the Project record type, its permission, weight, icon and three fields', () => {
    const provider = createProjectAdminSearchProvider({
      search: async () => ({ rows: [], hasMore: false }),
      translate: async (key) => key,
    });
    expect(provider).toMatchObject({
      entityType: 'projects.project',
      moduleId: 'projects',
      requiredPermission: 'projects:read',
      weight: 800,
      icon: 'ClipboardList',
      labelKey: 'adminSearch.group.label',
    });
    expect(provider.fields.map((f) => [f.code, f.defaultSelected, f.identifier])).toEqual([
      ['number', true, true],
      ['title', true, false],
      ['organizationName', true, false],
    ]);
    for (const language of ['en', 'pl'] as const) {
      for (const key of [provider.labelKey, ...provider.fields.map((f) => f.labelKey)]) {
        expect(bundle(language)[key], `${language} ${key}`).toEqual(expect.any(String));
      }
    }
  });

  it('passes the query on and maps a Project to a hit: number and title, its Organizations, its state', async () => {
    const search = vi.fn(async () => ({ rows: [project(), project({ id: 'p2', state: 'lost', organizations: [] })], hasMore: true }));
    const translate = vi.fn(async (key: string, language: string) => `${language}:${key}`);
    const provider = createProjectAdminSearchProvider({ search, translate });
    const result = await provider.search(query());
    expect(search).toHaveBeenCalledWith({ text: 'PRJ-1', likeEscaped: 'PRJ-1', isUuid: false, fields: ['number', 'title'], limit: 5 });
    expect(result).toEqual({
      hasMore: true,
      hits: [
        {
          id: 'p1',
          title: 'PRJ-000001 · Showroom fit-out',
          subtitle: 'Acme, Beta',
          status: { code: 'open', label: 'pl:state.open' },
          targetRoute: '/projects/p1',
        },
        {
          id: 'p2',
          title: 'PRJ-000001 · Showroom fit-out',
          subtitle: null,
          status: { code: 'lost', label: 'pl:state.lost' },
          targetRoute: '/projects/p2',
        },
      ],
    });
    // One sentence per state, not per hit.
    expect(translate).toHaveBeenCalledTimes(2);
  });
});
