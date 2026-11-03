import { describe, expect, it } from 'vitest';
import { ERROR_CODES, RESERVED_ANCHORS } from '@endora-commerce/contracts';
import { assertAnchors, collectTreeAnchors } from './anchor-guard.js';

/**
 * The anchor guard (`specs/163-page-builder-marketing-pages/` R-8, R-14,
 * data-model §6): one anchor names one place in a language tree, and never a
 * place the storefront layout already renders.
 */

function section(type: string, anchor: string, extra: Record<string, unknown> = {}) {
  return { type, props: { id: `${type}-${anchor}`, anchor, scheme: 'light', ...extra } };
}

function headingDoc(...anchors: Array<string | null>) {
  return {
    type: 'doc',
    content: anchors.map((anchor, i) => ({
      type: 'heading',
      attrs: { level: 2, ...(anchor !== null ? { anchor } : {}) },
      content: [{ type: 'text', text: `Heading ${i}` }],
    })),
  };
}

function richContent(...anchors: Array<string | null>) {
  return {
    type: 'cms.RichContent',
    props: {
      id: `rich-${anchors.join('-')}`,
      content: headingDoc(...anchors),
      // The synced HTML repeats the anchors; counting it would see every one twice.
      html: anchors.map((a) => (a ? `<h2 id="${a}">x</h2>` : '<h2>x</h2>')).join(''),
    },
  };
}

function errorOf(fn: () => void): { statusCode?: number; code?: string; details?: unknown } {
  try {
    fn();
  } catch (err) {
    return err as { statusCode?: number; code?: string; details?: unknown };
  }
  throw new Error('expected a refusal');
}

describe('collectTreeAnchors', () => {
  it('finds top-level section anchors and rich-text heading anchors in document order', () => {
    const tree = {
      root: { props: {} },
      content: [section('cms.Section', 'intro'), richContent('pricing', null, 'faq'), section('cms.Section', 'contact')],
    };

    expect(collectTreeAnchors({ 'en-US': tree })).toEqual({
      'en-US': ['intro', 'pricing', 'faq', 'contact'],
    });
  });

  it('reads section anchors at the root only, and heading anchors at any depth: slots, array items, slides', () => {
    const tree = {
      root: { props: {} },
      content: [
        {
          type: 'cms.Row',
          props: {
            id: 'row-1',
            columns: [
              { span: 6, content: [section('cms.Section', 'nested-in-column')] },
              { span: 6, content: [richContent('heading-in-column')] },
            ],
          },
        },
        {
          type: 'cms.Carousel',
          props: {
            id: 'carousel-1',
            slides: [
              { title: 'One', content: [section('cms.Section', 'slide-one')] },
              { title: 'Two', content: [{ type: 'cms.Tabs', props: { id: 't', items: [{ body: [richContent('deep')] }] } }] },
            ],
          },
        },
      ],
      zones: { 'legacy:zone': [section('cms.Section', 'in-zone')] },
    };

    // `nested-in-column`, `slide-one` and `in-zone` are section anchors of nested
    // blocks: they render nothing, so they are not read.
    expect(collectTreeAnchors({ 'en-US': tree })['en-US']).toEqual(['heading-in-column', 'deep']);
  });

  it('reads a legacy TipTap doc on a text block, and ignores empty or missing anchors', () => {
    const tree = {
      root: { props: {} },
      content: [
        { type: 'cms.Text', props: { id: 'text-1', tiptapContent: headingDoc('legacy-heading', '') } },
        { type: 'cms.Section', props: { id: 'section-1', anchor: '' } },
        { type: 'cms.Section', props: { id: 'section-2', scheme: 'dark' } },
        { type: 'cms.Section', props: { id: 'section-3' } },
      ],
    };

    expect(collectTreeAnchors({ 'en-US': tree })['en-US']).toEqual(['legacy-heading']);
  });

  it('does not follow an embedded block: only the tree itself is read', () => {
    const tree = {
      root: { props: {} },
      content: [{ type: 'cms.InsertBlock', props: { id: 'ib', code: 'shared-footer' } }],
    };

    expect(collectTreeAnchors({ 'en-US': tree })['en-US']).toEqual([]);
  });

  it('keeps every language tree apart and tolerates a tree that is not an object', () => {
    expect(
      collectTreeAnchors({
        'en-US': { content: [section('cms.Section', 'intro')] },
        'pl-PL': { content: [section('cms.Section', 'wstep')] },
        'de-DE': null,
      }),
    ).toEqual({ 'en-US': ['intro'], 'pl-PL': ['wstep'], 'de-DE': [] });
  });
});

describe('assertAnchors', () => {
  it('reads section anchors only from cms.Section: a stray `section` on another top-level block renders no id (T113)', () => {
    const anchors = collectTreeAnchors({
      'en-US': {
        content: [
          section('cms.Section', 'intro'),
          // Stored by this feature's development builds, before the owner's ruling of 2026-10-23.
          { type: 'cms.Hero', props: { id: 'hero-1', section: { anchor: 'intro', scheme: 'dark' } } },
          { type: 'cms.Row', props: { id: 'row-1', section: { anchor: 'stray' } } },
          // A top-level `anchor` on any other block is no section anchor either.
          { type: 'cms.Hero', props: { id: 'hero-2', anchor: 'loose' } },
        ],
      },
    });
    expect(anchors['en-US']).toEqual(['intro']);
    expect(() =>
      assertAnchors({
        'en-US': { content: [section('cms.Section', 'intro'), { type: 'cms.Hero', props: { id: 'h', anchor: 'intro' } }] },
      }),
    ).not.toThrow();
  });

  // T117: the Section's settings are its own top-level props; the `section`
  // object it stored before is gone (unreleased, no compatibility).
  it('reads the Section\'s top-level `anchor`, not a `section` object', () => {
    const anchors = collectTreeAnchors({
      'en-US': {
        content: [
          { type: 'cms.Section', props: { id: 's-1', anchor: 'flat', content: [] } },
          { type: 'cms.Section', props: { id: 's-2', section: { anchor: 'old-shape' }, content: [] } },
        ],
      },
    });
    expect(anchors['en-US']).toEqual(['flat']);
  });

  it('accepts distinct anchors', () => {
    expect(() =>
      assertAnchors({ 'en-US': { content: [section('cms.Section', 'intro'), richContent('details')] } }),
    ).not.toThrow();
  });

  it('refuses a duplicate between two sections with CMS_DUPLICATE_ANCHOR naming the anchor', () => {
    const err = errorOf(() =>
      assertAnchors({ 'en-US': { content: [section('cms.Section', 'intro'), section('cms.Section', 'intro')] } }),
    );
    expect(err).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.CMS_DUPLICATE_ANCHOR,
      details: { anchor: 'intro' },
    });
  });

  it('reads a top-level cms.SectionGroup\'s anchor and those of the Sections in it, in document order (T158)', () => {
    const group = {
      type: 'cms.SectionGroup',
      props: {
        id: 'g-1',
        anchor: 'dark-run',
        content: [
          section('cms.Section', 'services', { content: [richContent('details')] }),
          section('cms.Section', 'contact'),
          // Not a Section, and a Section stored inside a grouped Section: neither renders an id.
          section('cms.Hero', 'loose'),
          section('cms.Section', 'outer', { content: [section('cms.Section', 'deep')] }),
        ],
      },
    };
    expect(collectTreeAnchors({ 'en-US': { content: [section('cms.Section', 'intro'), group] } })).toEqual({
      'en-US': ['intro', 'dark-run', 'services', 'details', 'contact', 'outer'],
    });
    // A group stored nested renders no wrapper: neither its anchor nor its Sections' count.
    const nested = section('cms.Section', 'host', { content: [{ ...group, props: { ...group.props, id: 'g-n' } }] });
    expect(collectTreeAnchors({ 'en-US': { content: [nested] } })).toEqual({ 'en-US': ['host', 'details'] });
  });

  it('refuses a group anchor or a grouped Section anchor that repeats another (T158)', () => {
    const grouped = (anchor: string, inner: string) => ({
      type: 'cms.SectionGroup',
      props: { id: `g-${anchor}`, anchor, content: [section('cms.Section', inner)] },
    });
    expect(errorOf(() => assertAnchors({ 'en-US': { content: [section('cms.Section', 'intro'), grouped('run', 'intro')] } }))).toMatchObject({
      code: ERROR_CODES.CMS_DUPLICATE_ANCHOR,
      details: { anchor: 'intro' },
    });
    expect(errorOf(() => assertAnchors({ 'en-US': { content: [grouped('run', 'run')] } }))).toMatchObject({
      code: ERROR_CODES.CMS_DUPLICATE_ANCHOR,
      details: { anchor: 'run' },
    });
    expect(errorOf(() => assertAnchors({ 'en-US': { content: [grouped('main-content', 'ok')] } }))).toMatchObject({
      code: ERROR_CODES.CMS_RESERVED_ANCHOR,
    });
  });

  it('ignores a nested block carrying the same section anchor as a root section', () => {
    expect(() =>
      assertAnchors({
        'en-US': {
          content: [
            section('cms.Section', 'intro'),
            { type: 'cms.Row', props: { id: 'r', columns: [{ content: [section('cms.Section', 'intro')] }] } },
          ],
        },
      }),
    ).not.toThrow();
  });

  it('refuses a root section anchor repeated by a nested rich-text heading anchor', () => {
    const err = errorOf(() =>
      assertAnchors({
        'en-US': {
          content: [
            section('cms.Section', 'pricing'),
            { type: 'cms.Row', props: { id: 'r', columns: [{ content: [richContent('pricing')] }] } },
          ],
        },
      }),
    );
    expect(err).toMatchObject({ code: ERROR_CODES.CMS_DUPLICATE_ANCHOR, details: { anchor: 'pricing' } });
  });

  it('refuses two heading anchors repeated within one rich-text document', () => {
    const err = errorOf(() => assertAnchors({ 'en-US': { content: [richContent('faq', 'faq')] } }));
    expect(err).toMatchObject({ code: ERROR_CODES.CMS_DUPLICATE_ANCHOR, details: { anchor: 'faq' } });
  });

  it('allows the same anchor in two language trees', () => {
    expect(() =>
      assertAnchors({
        'en-US': { content: [section('cms.Section', 'intro')] },
        'pl-PL': { content: [section('cms.Section', 'intro')] },
      }),
    ).not.toThrow();
  });

  it('reserves main-content and cmsb', () => {
    expect(RESERVED_ANCHORS).toEqual(expect.arrayContaining(['main-content', 'cmsb']));
  });

  it.each([...RESERVED_ANCHORS])('refuses the reserved anchor %s with CMS_RESERVED_ANCHOR', (anchor) => {
    const asSection = errorOf(() => assertAnchors({ 'en-US': { content: [section('cms.Section', anchor)] } }));
    expect(asSection).toMatchObject({
      statusCode: 422,
      code: ERROR_CODES.CMS_RESERVED_ANCHOR,
      details: { anchor },
    });

    const asHeading = errorOf(() => assertAnchors({ 'en-US': { content: [richContent(anchor)] } }));
    expect(asHeading).toMatchObject({ code: ERROR_CODES.CMS_RESERVED_ANCHOR, details: { anchor } });
  });
});
