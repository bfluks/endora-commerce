import { describe, expect, it } from 'vitest';
import {
  MEGAMENU_LABEL_INHERITING_KINDS,
  MEGAMENU_TAB_KINDS,
  megamenuAudienceSchema,
  megamenuItemSchema,
  resolvedMegamenuSchema,
} from './index.js';

/**
 * `specs/168-megamenu-navigation-bar/` (issue #522) — tabs with a presentation,
 * column groups, category trees and audiences.
 */
const uuid = '11111111-1111-4111-8111-111111111111';

describe('megamenu item shapes (feature 168)', () => {
  it('accepts a tab with a presentation and an alignment', () => {
    const parsed = megamenuItemSchema.parse({
      position: 0,
      kind: 'cms-page-link',
      labels: {},
      presentation: 'link',
      alignment: 'end',
      target: { pageId: uuid },
    });
    expect(parsed).toMatchObject({ presentation: 'link', alignment: 'end', labels: {} });
  });

  it('refuses an unknown presentation or alignment', () => {
    const base = { position: 0, kind: 'group', labels: { 'pl-PL': 'Usługi' }, target: {} };
    expect(megamenuItemSchema.safeParse({ ...base, presentation: 'grid' }).success).toBe(false);
    expect(megamenuItemSchema.safeParse({ ...base, presentation: 'mega', alignment: 'middle' }).success).toBe(false);
  });

  it('accepts a group with an empty target', () => {
    expect(
      megamenuItemSchema.parse({ position: 0, kind: 'group', labels: { 'pl-PL': 'Doradztwo' }, target: {} }).kind,
    ).toBe('group');
  });

  it('accepts a category tree rooted at a category or at the whole catalogue', () => {
    for (const rootCategoryId of [uuid, null]) {
      const parsed = megamenuItemSchema.parse({
        position: 0,
        kind: 'category-tree',
        labels: {},
        target: { rootCategoryId, depth: 2 },
      });
      expect(parsed.target).toEqual({ rootCategoryId, depth: 2 });
    }
  });

  it('refuses a category tree depth outside 1 to 3', () => {
    for (const depth of [0, 4, 1.5]) {
      const parsed = megamenuItemSchema.safeParse({
        position: 0,
        kind: 'category-tree',
        labels: {},
        target: { rootCategoryId: null, depth },
      });
      expect(parsed.success, `depth ${depth}`).toBe(false);
    }
  });

  it('accepts every audience kind', () => {
    for (const audience of [
      { kind: 'everyone' },
      { kind: 'guests' },
      { kind: 'signed_in' },
      { kind: 'customer_groups', customerGroupIds: [uuid] },
    ]) {
      expect(megamenuAudienceSchema.parse(audience)).toEqual(audience);
    }
  });

  it('refuses a customer-group audience without groups or with a repeated group', () => {
    expect(megamenuAudienceSchema.safeParse({ kind: 'customer_groups', customerGroupIds: [] }).success).toBe(false);
    expect(
      megamenuAudienceSchema.safeParse({ kind: 'customer_groups', customerGroupIds: [uuid, uuid] }).success,
    ).toBe(false);
  });

  it('names the kinds a tab may be and the kinds whose label is inherited', () => {
    expect([...MEGAMENU_TAB_KINDS].sort()).toEqual(
      ['button', 'category-link', 'cms-page-link', 'external-link', 'group'].sort(),
    );
    expect([...MEGAMENU_LABEL_INHERITING_KINDS].sort()).toEqual(
      ['category-link', 'category-tree', 'cms-page-link'].sort(),
    );
  });
});

describe('a tab whose click follows its link (feature 168 review)', () => {
  it('accepts clickNavigates on an item and carries it on a resolved tab', () => {
    const parsed = megamenuItemSchema.parse({
      position: 0,
      kind: 'category-link',
      labels: {},
      presentation: 'mega',
      clickNavigates: true,
      target: { categoryId: uuid },
    });
    expect(parsed.clickNavigates).toBe(true);
    const resolved = resolvedMegamenuSchema.parse({
      megamenuId: uuid,
      name: 'Main',
      language: 'pl-PL',
      items: [{ id: uuid, parentId: null, kind: 'category-link', label: 'Tools', url: '/c/tools', presentation: 'mega', clickNavigates: true, children: [] }],
    });
    expect(resolved.items[0]?.clickNavigates).toBe(true);
  });
});

describe('resolved megamenu shape (feature 168)', () => {
  it('carries tabs with a presentation, and an expanded category with a composite id', () => {
    const parsed = resolvedMegamenuSchema.parse({
      megamenuId: uuid,
      name: 'Main navigation',
      language: 'pl-PL',
      items: [
        {
          id: uuid,
          parentId: null,
          kind: 'group',
          label: 'Wszystkie kategorie',
          presentation: 'catalog',
          alignment: 'start',
          children: [
            {
              id: `${uuid}:${uuid}`,
              parentId: uuid,
              kind: 'category-link',
              label: 'Narzędzia',
              url: '/c/narzedzia',
              children: [],
            },
          ],
        },
      ],
    });
    expect(parsed.items[0]?.children[0]?.id).toBe(`${uuid}:${uuid}`);
  });

  it('never carries a category tree or an audience', () => {
    const parsed = resolvedMegamenuSchema.safeParse({
      megamenuId: uuid,
      name: 'Main navigation',
      language: 'pl-PL',
      items: [{ id: uuid, parentId: null, kind: 'category-tree', label: 'x', children: [] }],
    });
    expect(parsed.success).toBe(false);
    const stripped = resolvedMegamenuSchema.parse({
      megamenuId: uuid,
      name: 'Main navigation',
      language: 'pl-PL',
      items: [
        { id: uuid, parentId: null, kind: 'external-link', label: 'x', url: 'https://x', audience: { kind: 'guests' }, children: [] },
      ],
    });
    expect(stripped.items[0]).not.toHaveProperty('audience');
  });
});
