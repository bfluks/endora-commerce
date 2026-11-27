import { describe, expect, it } from 'vitest';
import {
  CMS_PAGE_PATH_MAX_LEVELS,
  cmsPagePublicPaths,
  cmsPageSummarySchema,
  cmsPageIndexEntrySchema,
  cmsResolvedPageSchema,
  createCmsPageRequestSchema,
  type CmsPagePathNode,
} from './cms.js';

/**
 * `specs/163-page-builder-marketing-pages/` R19D (T280–T283) — a page that
 * opts into "include the parent path in the URL" is served at its ancestors'
 * public path plus its own slug. The rule has one home, here, because three
 * programs ask it: the backend resolving and refusing, the admin previewing,
 * and the storefront linking.
 */
function node(id: string, slug: string, parentPageId: string | null = null, parentPathInUrl = false): CmsPagePathNode {
  return { id, slug, parentPageId, parentPathInUrl };
}

describe('cmsPagePublicPaths (R19D, T280)', () => {
  it('serves a page without the flag at its own slug, whatever its parent', () => {
    const paths = cmsPagePublicPaths([node('a', 'zone'), node('b', 'consulting', 'a')]);
    expect(paths.get('a')).toBe('zone');
    expect(paths.get('b')).toBe('consulting');
  });

  it('prefixes the parent path when the page opts in, through every opted-in level', () => {
    const paths = cmsPagePublicPaths([
      node('c', 'workshops', 'b', true),
      node('b', 'consulting', 'a', true),
      node('a', 'services'),
    ]);
    expect(paths.get('a')).toBe('services');
    expect(paths.get('b')).toBe('services/consulting');
    expect(paths.get('c')).toBe('services/consulting/workshops');
  });

  it('stops at an ancestor that did not opt in: its own path is the prefix', () => {
    const paths = cmsPagePublicPaths([
      node('a', 'root'),
      node('b', 'section', 'a', false),
      node('c', 'leaf', 'b', true),
    ]);
    expect(paths.get('c')).toBe('section/leaf');
  });

  it('falls back to the flat slug when the parent is not among the nodes (not served in this channel)', () => {
    const paths = cmsPagePublicPaths([node('c', 'leaf', 'missing', true)]);
    expect(paths.get('c')).toBe('leaf');
  });

  it('falls back to the flat slug on a stored cycle instead of looping', () => {
    const paths = cmsPagePublicPaths([node('a', 'one', 'b', true), node('b', 'two', 'a', true)]);
    expect(paths.get('a')).toBe('one');
    expect(paths.get('b')).toBe('two');
  });

  it(`falls back to the flat slug past ${CMS_PAGE_PATH_MAX_LEVELS} levels`, () => {
    const nodes: CmsPagePathNode[] = [node('p0', 's0')];
    for (let i = 1; i <= CMS_PAGE_PATH_MAX_LEVELS; i += 1) nodes.push(node(`p${i}`, `s${i}`, `p${i - 1}`, true));
    const paths = cmsPagePublicPaths(nodes);
    expect(paths.get(`p${CMS_PAGE_PATH_MAX_LEVELS - 1}`)?.split('/')).toHaveLength(CMS_PAGE_PATH_MAX_LEVELS);
    expect(paths.get(`p${CMS_PAGE_PATH_MAX_LEVELS}`)).toBe(`s${CMS_PAGE_PATH_MAX_LEVELS}`);
  });

  it('trims stray slashes so a path never carries an empty segment', () => {
    const paths = cmsPagePublicPaths([node('a', '/zone/'), node('b', 'leaf', 'a', true)]);
    expect(paths.get('b')).toBe('zone/leaf');
  });
});

describe('schemas (R19D, T281)', () => {
  it('accepts parentPathInUrl on create and keeps it optional', () => {
    const base = { name: 'P', slug: 'leaf', salesChannelIds: ['00000000-0000-4000-8000-000000000001'], languages: ['en-US'] };
    expect(createCmsPageRequestSchema.parse(base).parentPathInUrl).toBeUndefined();
    expect(createCmsPageRequestSchema.parse({ ...base, parentPathInUrl: true }).parentPathInUrl).toBe(true);
  });

  it('carries parentPathInUrl on the summary, path on the resolved page, its crumbs and the index entry', () => {
    expect(cmsPageSummarySchema.shape.parentPathInUrl).toBeDefined();
    expect(cmsResolvedPageSchema.shape.path).toBeDefined();
    const trail = cmsResolvedPageSchema.shape.breadcrumbs.shape.trail.element;
    expect(trail.parse({ name: 'Zone', slug: 'zone', path: 'zone' })).toEqual({ name: 'Zone', slug: 'zone', path: 'zone' });
    expect(cmsPageIndexEntrySchema.parse({ slug: 'leaf', path: 'zone/leaf', updatedAt: '2026-10-27T00:00:00.000Z' }).path).toBe('zone/leaf');
  });
});
