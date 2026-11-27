import { describe, expect, it } from 'vitest';
import { filterForViewer, isVisibleTo, needsCustomerGroup, type AudiencedItem, type MenuViewer } from './audience.js';

/**
 * `specs/168-megamenu-navigation-bar/` FR-017..FR-020 — who sees an item, and
 * what reaches a visitor who may not.
 */
const guest: MenuViewer = { signedIn: false, customerGroupId: null };
const buyer: MenuViewer = { signedIn: true, customerGroupId: null };
const distributor: MenuViewer = { signedIn: true, customerGroupId: 'g-distributors' };

function node(id: string, over: Partial<AudiencedItem> = {}): AudiencedItem {
  return { id, parentId: null, kind: 'external-link', label: id, url: `/${id}`, children: [], ...over };
}

describe('isVisibleTo (feature 168)', () => {
  it('shows an everyone item to every visitor, and an item with no audience as everyone', () => {
    for (const viewer of [guest, buyer, distributor]) {
      expect(isVisibleTo({ kind: 'everyone' }, viewer)).toBe(true);
      expect(isVisibleTo(undefined, viewer)).toBe(true);
    }
  });

  it('shows a guests item to guests only and a signed-in item to signed-in customers only', () => {
    expect([guest, buyer].map((v) => isVisibleTo({ kind: 'guests' }, v))).toEqual([true, false]);
    expect([guest, buyer].map((v) => isVisibleTo({ kind: 'signed_in' }, v))).toEqual([false, true]);
  });

  it('shows a customer-group item to a customer of a named group only', () => {
    const audience = { kind: 'customer_groups' as const, customerGroupIds: ['g-distributors', 'g-vip'] };
    expect([guest, buyer, distributor].map((v) => isVisibleTo(audience, v))).toEqual([false, false, true]);
    expect(isVisibleTo({ kind: 'customer_groups', customerGroupIds: ['g-gone'] }, distributor)).toBe(false);
  });
});

describe('filterForViewer (feature 168)', () => {
  const tree: AudiencedItem[] = [
    node('pricing', { audience: { kind: 'signed_in' }, presentation: 'link', alignment: 'start' }),
    node('partners', {
      kind: 'group',
      url: undefined,
      presentation: 'mega',
      alignment: 'start',
      audience: { kind: 'customer_groups', customerGroupIds: ['g-distributors'] },
      children: [node('portal', { parentId: 'partners' })],
    }),
    node('account', {
      kind: 'group',
      url: undefined,
      presentation: 'dropdown',
      alignment: 'end',
      children: [node('register', { parentId: 'account', audience: { kind: 'guests' } })],
    }),
  ];

  it('drops what a visitor may not see, with its subtree', () => {
    const ids = (items: ReturnType<typeof filterForViewer>): string[] =>
      items.flatMap((item) => [item.id, ...ids(item.children)]);
    expect(ids(filterForViewer(tree, guest))).toEqual(['account', 'register']);
    expect(ids(filterForViewer(tree, buyer))).toEqual(['pricing']);
    expect(ids(filterForViewer(tree, distributor))).toEqual(['pricing', 'partners', 'portal']);
  });

  it('carries no audience in what it answers', () => {
    const answered = JSON.stringify(filterForViewer(tree, distributor));
    expect(answered).not.toContain('audience');
    expect(answered).not.toContain('g-distributors');
  });

  it('drops a tab or a group left with nothing to open, and keeps a tab that has its own link', () => {
    const withLink = node('services', {
      kind: 'cms-page-link',
      presentation: 'mega',
      alignment: 'start',
      children: [node('hidden', { parentId: 'services', audience: { kind: 'guests' } })],
    });
    const column = node('column', {
      kind: 'group',
      url: undefined,
      parentId: 'services',
      children: [node('also-hidden', { parentId: 'column', audience: { kind: 'guests' } })],
    });
    withLink.children.push(column);
    const [kept] = filterForViewer([withLink], buyer);
    expect(kept).toMatchObject({ id: 'services', children: [] });
  });
});

describe('needsCustomerGroup (feature 168)', () => {
  it('is true only when an item anywhere names customer groups', () => {
    expect(needsCustomerGroup([node('a', { children: [node('b', { audience: { kind: 'signed_in' } })] })])).toBe(false);
    expect(
      needsCustomerGroup([
        node('a', { children: [node('b', { audience: { kind: 'customer_groups', customerGroupIds: ['g'] } })] }),
      ]),
    ).toBe(true);
  });
});
