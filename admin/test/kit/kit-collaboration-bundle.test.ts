import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RECORD_DOCUMENT_KINDS, RECORD_REFERENCE_TYPES } from '@endora-commerce/contracts';

/**
 * The collaboration components promoted from CRM speak from the shared `core`
 * bundle (`specs/163-projects-and-tasks/` research R-17), so the bundle — not
 * CRM's any more — carries every sentence they ask for, in English and Polish.
 * The CRM bundle test (`crm/src/admin/index.test.ts`) held these families
 * while the components were CRM's.
 */

const KIT = resolve(process.cwd(), '../packages/admin-kit/src/components');
const DIRECTORIES = ['references', 'comments', 'attachments', 'record-history'];

function bundle(language: 'en' | 'pl'): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/_i18n/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
}

const sources = DIRECTORIES.flatMap((directory) =>
  readdirSync(join(KIT, directory))
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => readFileSync(join(KIT, directory, name), 'utf8')),
);

const en = bundle('en');
const pl = bundle('pl');

describe('the core bundle carries the collaboration components’ sentences', () => {
  it('reads the sources it claims to read', () => {
    expect(sources.length).toBeGreaterThanOrEqual(10);
  });

  it('carries every key the components ask for by name, in both languages', () => {
    const asked = new Set<string>();
    for (const text of sources) {
      for (const match of text.matchAll(/\bt\(\s*'([^']+)'/g)) asked.add(match[1] as string);
    }
    expect(asked.size).toBeGreaterThan(30);
    expect([...asked].filter((key) => en[key] === undefined || pl[key] === undefined)).toEqual([]);
  });

  it('carries every member of the key families the components compose', () => {
    const triggers = ['person', 'document', 'product'];
    const families: Record<string, readonly string[]> = {
      'references.insert.': triggers,
      'references.shortcut.': triggers,
      'references.search.': triggers.flatMap((kind) => [kind, `${kind}Placeholder`, `${kind}Empty`]),
      'references.suggest.title.': triggers,
      'references.suggest.empty.': triggers,
      'references.inserted.': RECORD_REFERENCE_TYPES,
      'references.kind.': RECORD_REFERENCE_TYPES,
      'references.unavailable.': RECORD_REFERENCE_TYPES,
      'references.group.': RECORD_DOCUMENT_KINDS,
      'editor.format.': ['bold', 'italic', 'strike', 'bulletList', 'orderedList', 'link'],
    };
    const composed = sources.flatMap((text) =>
      [...text.matchAll(/\bt\(\s*`([^`$]+)\$\{/g)].map((match) => match[1] as string),
    );
    expect([...new Set(composed)].sort()).toEqual(Object.keys(families).sort());
    const missing = Object.entries(families).flatMap(([prefix, members]) =>
      members.map((member) => `${prefix}${member}`).filter((key) => en[key] === undefined || pl[key] === undefined),
    );
    expect(missing).toEqual([]);
  });
});
