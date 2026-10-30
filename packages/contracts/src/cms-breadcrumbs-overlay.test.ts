import { describe, expect, it } from 'vitest';
import { cmsPageDetailSchema, cmsResolvedPageSchema, createCmsPageRequestSchema, patchCmsPageRequestSchema } from './cms.js';

/**
 * `specs/163-page-builder-marketing-pages/` R21H (T355): a page may draw its
 * breadcrumb trail over its first section instead of in a band above it.
 * Off by default; optional on create and patch, a boolean on the detail, and
 * optional on the resolved page (an answer cached before the field existed is
 * read as off).
 */
describe('breadcrumbsOverlay (R21H, T355)', () => {
  it('is an optional boolean on create and patch', () => {
    const base = { name: 'About', slug: 'about', salesChannelIds: ['6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'], languages: ['en'] };
    expect(createCmsPageRequestSchema.parse({ ...base, breadcrumbsOverlay: true }).breadcrumbsOverlay).toBe(true);
    expect(createCmsPageRequestSchema.parse(base)).not.toHaveProperty('breadcrumbsOverlay');
    expect(patchCmsPageRequestSchema.safeParse({ breadcrumbsOverlay: false }).success).toBe(true);
    expect(patchCmsPageRequestSchema.safeParse({ breadcrumbsOverlay: 'yes' }).success).toBe(false);
  });

  it('is a boolean on the detail', () => {
    expect(cmsPageDetailSchema.shape.breadcrumbsOverlay.safeParse(false).success).toBe(true);
    expect(cmsPageDetailSchema.shape.breadcrumbsOverlay.safeParse(undefined).success).toBe(false);
  });

  it('is optional on the resolved page\'s breadcrumbs', () => {
    const breadcrumbs = cmsResolvedPageSchema.shape.breadcrumbs;
    expect(breadcrumbs.parse({ visible: true, scheme: 'dark', overlay: true, trail: [] }).overlay).toBe(true);
    expect(breadcrumbs.parse({ visible: true, scheme: 'dark', trail: [] })).not.toHaveProperty('overlay');
  });
});
