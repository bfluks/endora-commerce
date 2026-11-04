import { describe, expect, it } from 'vitest';
import { rewritePageLinkSlugs } from './content-tree-walker.js';

/**
 * `specs/163-page-builder-marketing-pages/` R19D (T283): a Page Builder link of
 * kind `page` stores the target's flat slug; the storefront resolver rewrites it
 * to the public path the target is served under in the request's channel, so a
 * link to a nested page needs no redirect.
 */
describe('rewritePageLinkSlugs (R19D, T283)', () => {
  it('rewrites a page link to the public path, leaving every other value untouched', () => {
    const tree = {
      root: { props: {} },
      content: [
        { type: 'cms.Button', props: { link: { kind: 'page', slug: 'leaf', target: '_blank' } } },
        { type: 'cms.Button', props: { link: { kind: 'page', slug: 'flat' } } },
        { type: 'cms.Button', props: { link: { kind: 'url', href: '/leaf' } } },
        { type: 'cms.Text', props: { text: 'leaf' } },
      ],
    };
    const out = rewritePageLinkSlugs(tree, new Map([['leaf', 'zone/leaf']])) as typeof tree;
    expect(out.content[0]!.props.link).toEqual({ kind: 'page', slug: 'zone/leaf', target: '_blank' });
    expect(out.content[1]!.props.link).toEqual({ kind: 'page', slug: 'flat' });
    expect(out.content[2]!.props.link).toEqual({ kind: 'url', href: '/leaf' });
    expect(out.content[3]!.props).toEqual({ text: 'leaf' });
  });

  it('returns the very same tree when no link moves, and never mutates its input', () => {
    const tree = { content: [{ props: { link: { kind: 'page', slug: 'leaf' } } }] };
    const snapshot = structuredClone(tree);
    expect(rewritePageLinkSlugs(tree, new Map())).toBe(tree);
    expect(rewritePageLinkSlugs(tree, new Map([['flat', 'zone/flat']]))).toBe(tree);
    rewritePageLinkSlugs(tree, new Map([['leaf', 'zone/leaf']]));
    expect(tree).toEqual(snapshot);
  });

  it('matches a stored slug with a leading slash or upper case', () => {
    const out = rewritePageLinkSlugs({ link: { kind: 'page', slug: '/Leaf' } }, new Map([['leaf', 'zone/leaf']]));
    expect(out).toEqual({ link: { kind: 'page', slug: 'zone/leaf' } });
  });
});
