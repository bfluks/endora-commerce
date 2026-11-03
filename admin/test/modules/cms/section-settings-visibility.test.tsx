import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Data } from '@puckeditor/core';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import {
  fieldsPanel,
  mountPageBuilderEditor,
  outlineButtons,
  selectOutlineItem,
  stubEditorApi,
} from './page-builder-editor-harness';

/**
 * Feature 163, T096, T111 — **section settings show only on `cms.Section`, in
 * the real editor** (`specs/163-page-builder-marketing-pages/` FR-000, plan
 * § *Owner ruling 2026-10-23*).
 *
 * `SectionBlock.test.tsx` asserts the config. This file asserts it where it
 * matters: in `PageBuilderEditor`'s own Puck, whose `resolveFields` receives
 * the parent Puck computes. A block in the page's root zone has Puck's root
 * node as its parent (`{ type: 'root', props: { id: 'root' } }`), not `null`.
 * (Before the ruling, this file asserted the group on a root `cms.MediaText`
 * and a root `cms.Row`; both now carry none.)
 *
 * The "Section settings" group is recognised by its "Colour scheme" control,
 * which no other field carries.
 */

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

afterEach(() => {
  vi.mocked(apiClient.get).mockReset();
});

function page(): Data {
  return {
    root: { props: {} },
    content: [
      {
        type: 'cms.Section',
        props: { id: 'pb163-section', content: [{ type: 'cms.MediaText', props: { id: 'pb163-mt-section' } }] },
      },
      { type: 'cms.MediaText', props: { id: 'pb163-mt-root' } },
      {
        type: 'cms.Row',
        props: {
          id: 'pb163-row',
          content: [
            {
              type: 'cms.Column',
              props: { id: 'pb163-col', content: [{ type: 'cms.MediaText', props: { id: 'pb163-mt-column' } }] },
            },
          ],
        },
      },
      {
        type: 'cms.Tabs',
        props: {
          id: 'pb163-tabs',
          items: [{ title: 'One', panel: [{ type: 'cms.MediaText', props: { id: 'pb163-mt-tab' } }] }],
        },
      },
    ],
  } as unknown as Data;
}

/** Outline order: Section, MediaText (in it), MediaText, Row, Column, MediaText (in the column), Tabs, MediaText (in the panel). */
const SECTION = 0;
const IN_SECTION = 1;
const AT_ROOT = 2;
const ROW = 3;
const COLUMN = 4;
const IN_COLUMN = 5;
const IN_TAB_PANEL = 7;

function showsSectionGroup(): boolean {
  // R17 (T205, deliberately changed): US spelling.
  return (fieldsPanel()?.textContent ?? '').includes('Color scheme');
}

describe('section settings in the real editor config (T096, T111)', () => {
  it('a Section at the root shows the "Section settings" group', async () => {
    stubEditorApi(vi.mocked(apiClient));
    await mountPageBuilderEditor(page());
    const outline = outlineButtons().map((button) => button.textContent ?? '');
    expect(outline.map((label) => label.replace(/^\W+/u, ''))).toEqual([
      'Section',
      'Media and text',
      'Media and text',
      'Row',
      'Column',
      'Media and text',
      'Tabs',
      'Media and text',
    ]);

    await selectOutlineItem(SECTION);
    expect(showsSectionGroup()).toBe(true);
  });

  it('a block inside the Section, and the same block at the root, carry none', async () => {
    stubEditorApi(vi.mocked(apiClient));
    await mountPageBuilderEditor(page());
    for (const index of [IN_SECTION, AT_ROOT]) {
      await selectOutlineItem(index);
      expect(fieldsPanel()?.textContent ?? '').toContain('Heading level');
      expect(showsSectionGroup()).toBe(false);
    }
  });

  it('inside a Row column or a Tabs panel, none either', async () => {
    stubEditorApi(vi.mocked(apiClient));
    await mountPageBuilderEditor(page());
    for (const index of [IN_COLUMN, IN_TAB_PANEL]) {
      await selectOutlineItem(index);
      expect(fieldsPanel()?.textContent ?? '').toContain('Heading level');
      expect(showsSectionGroup()).toBe(false);
    }
  });

  it('a Row at the root and its Column carry none (the Row is back to its origin/master shape, T112)', async () => {
    stubEditorApi(vi.mocked(apiClient));
    await mountPageBuilderEditor(page());
    await selectOutlineItem(ROW);
    expect(showsSectionGroup()).toBe(false);
    await selectOutlineItem(COLUMN);
    expect(showsSectionGroup()).toBe(false);
  });
});
