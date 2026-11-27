import { describe, expect, it } from 'vitest';
import { collectAnchors } from './anchors.js';

/**
 * Feature 163, T016, T113 — the anchors an in-page link can point at
 * (`specs/163-page-builder-marketing-pages/` research R-8, R-11): those of the
 * top-level `cms.Section` blocks (plan § Owner ruling 2026-10-23).
 */
describe('collectAnchors', () => {
  it('lists the anchors of the top-level cms.Section blocks, in document order, once each (T113)', () => {
    const data = {
      root: { props: { title: 'Home' } },
      content: [
        { type: 'cms.Section', props: { id: 's-1', anchor: 'intro', content: [] } },
        {
          type: 'cms.Section',
          props: {
            id: 's-2',
            anchor: 'services',
            scheme: 'muted',
            content: [
              // Stored nested (the editor refuses it): it renders no wrapper, so no target.
              { type: 'cms.Section', props: { id: 's-nested', anchor: 'nested-one', content: [] } },
            ],
          },
        },
        // Another block's `section` prop, stored while this feature was developed: not rendered, so no target.
        { type: 'cms.Hero', props: { id: 'hero-1', section: { anchor: 'stray' } } },
        // A top-level `anchor` on another block is no section anchor.
        { type: 'cms.Hero', props: { id: 'hero-2', anchor: 'loose' } },
        { type: 'cms.Text', props: { id: 'text-1', text: 'No anchor here' } },
        { type: 'cms.Section', props: { id: 's-3', anchor: 'intro', content: [] } },
      ],
      zones: {
        'row-1:legacy': [{ type: 'cms.Section', props: { id: 's-4', anchor: 'contact' } }],
      },
    };

    expect(collectAnchors(data)).toEqual(['intro', 'services']);
  });

  it('skips an empty or malformed anchor and the pre-T117 `section` object', () => {
    const data = {
      content: [
        { type: 'cms.Section', props: { id: 'a', anchor: '' } },
        { type: 'cms.Section', props: { id: 'b', anchor: 'Not Normalised' } },
        { type: 'cms.Section', props: { id: 'c', anchor: 42 } },
        // The `section` object the Section stored before T117 is not read.
        { type: 'cms.Section', props: { id: 'd', section: { anchor: 'old-shape' } } },
        { type: 'cms.Section', props: { id: 'e', section: 'about' } },
      ],
    };
    expect(collectAnchors(data)).toEqual([]);
  });

  it('lists a top-level cms.SectionGroup\'s anchor and the anchors of the Sections in it (T158)', () => {
    const data = {
      content: [
        { type: 'cms.Section', props: { id: 's-1', anchor: 'intro', content: [] } },
        {
          type: 'cms.SectionGroup',
          props: {
            id: 'g-1',
            anchor: 'dark-run',
            content: [
              { type: 'cms.Section', props: { id: 's-2', anchor: 'services', content: [] } },
              { type: 'cms.Section', props: { id: 's-3', anchor: 'intro', content: [] } },
              // Not a Section (the editor refuses it): no target.
              { type: 'cms.Hero', props: { id: 'hero-1', anchor: 'loose' } },
              {
                type: 'cms.Section',
                props: { id: 's-4', content: [{ type: 'cms.Section', props: { id: 's-deep', anchor: 'deep', content: [] } }] },
              },
            ],
          },
        },
        // A group stored nested renders no wrapper and no Section: no target.
        {
          type: 'cms.Section',
          props: {
            id: 's-5',
            content: [
              { type: 'cms.SectionGroup', props: { id: 'g-n', anchor: 'nested-group', content: [{ type: 'cms.Section', props: { id: 's-6', anchor: 'nested-section' } }] } },
            ],
          },
        },
      ],
    };
    expect(collectAnchors(data)).toEqual(['intro', 'dark-run', 'services']);
  });

  it('answers an empty list for a document that is not one', () => {
    expect(collectAnchors(null)).toEqual([]);
    expect(collectAnchors(undefined)).toEqual([]);
    expect(collectAnchors('text')).toEqual([]);
  });
});
