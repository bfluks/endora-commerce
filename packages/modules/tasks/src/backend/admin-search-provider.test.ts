import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AdminSearchProviderQuery } from '@endora-commerce/contracts';
import { createTaskAdminSearchProvider } from './admin-search-provider.js';

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>;

function query(over: Partial<AdminSearchProviderQuery> = {}): AdminSearchProviderQuery {
  return {
    text: 'TSK-1',
    likeEscaped: 'TSK-1',
    isUuid: false,
    fields: ['number', 'title'],
    limit: 5,
    language: 'en',
    adminUserId: 'admin-1',
    signal: { aborted: false },
    ...over,
  };
}

describe('tasks admin search provider (163 §6)', () => {
  it('declares the Task record type, its permission, weight, icon and two fields', () => {
    const provider = createTaskAdminSearchProvider({
      search: async () => ({ rows: [], hasMore: false }),
      statusLabel: async (code) => code,
    });
    expect(provider).toMatchObject({
      entityType: 'tasks.task',
      moduleId: 'tasks',
      requiredPermission: 'tasks:read',
      weight: 810,
      icon: 'ListChecks',
      labelKey: 'adminSearch.group.label',
    });
    expect(provider.fields.map((f) => [f.code, f.defaultSelected, f.identifier])).toEqual([
      ['number', true, true],
      ['title', true, false],
    ]);
    for (const language of ['en', 'pl'] as const) {
      for (const key of [provider.labelKey, ...provider.fields.map((f) => f.labelKey)]) {
        expect(bundle(language)[key], `${language} ${key}`).toEqual(expect.any(String));
      }
    }
  });

  it('passes the query on and maps a Task to a hit: number and title, its status', async () => {
    const search = vi.fn(async () => ({
      rows: [{ id: 't1', number: 'TSK-000001', title: 'Order the glass', status: 'in_progress' as const }],
      hasMore: false,
    }));
    const provider = createTaskAdminSearchProvider({ search, statusLabel: async (code, language) => `${language}:${code}` });
    expect(await provider.search(query())).toEqual({
      hasMore: false,
      hits: [
        {
          id: 't1',
          title: 'TSK-000001 · Order the glass',
          subtitle: null,
          status: { code: 'in_progress', label: 'en:in_progress' },
          targetRoute: '/tasks/t1',
        },
      ],
    });
    expect(search).toHaveBeenCalledWith({ text: 'TSK-1', likeEscaped: 'TSK-1', isUuid: false, fields: ['number', 'title'], limit: 5 });
  });
});
