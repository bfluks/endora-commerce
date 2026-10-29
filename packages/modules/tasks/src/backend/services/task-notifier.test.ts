import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { taskLinkPath, taskNotificationText } from './task-notifier.js';

/**
 * A bell entry of this module is translatable and says no more than the Task's
 * number (FR-032; the CRM rule — a bell is read outside any record's
 * visibility). The English template filled with the params **is** the finished
 * sentence, so the fallback and the translation cannot drift apart, and every
 * key exists in both bundles.
 */
const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<
    string,
    string
  >;

describe('taskNotificationText', () => {
  const text = taskNotificationText.assigned('TSK-000042');

  it('names the Task by its number only', () => {
    expect(text.title).toBe('Task TSK-000042 was assigned to you');
    expect(text.titleMessage).toEqual({
      scope: 'tasks',
      key: 'notifications.assigned.title',
      params: { number: 'TSK-000042' },
    });
  });

  it('addresses a key of this module’s bundle in both languages; the English template filled is the sentence', () => {
    for (const language of ['en', 'pl'] as const) {
      const template = bundle(language)[text.titleMessage.key];
      expect(template, `${language}: ${text.titleMessage.key}`).toBeTypeOf('string');
      expect([...template!.matchAll(/\{(\w+)\}/g)].map((m) => m[1])).toEqual(['number']);
    }
    expect(bundle('en')[text.titleMessage.key]!.replace('{number}', 'TSK-000042')).toBe(text.title);
  });

  it('links to the Task’s screen', () => {
    expect(taskLinkPath('7d3c8f1e-0000-4000-8000-000000000001')).toBe('/tasks/7d3c8f1e-0000-4000-8000-000000000001');
  });
});
