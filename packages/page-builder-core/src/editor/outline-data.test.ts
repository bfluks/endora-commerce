import { describe, expect, it } from 'vitest';
import { collectChildItems, extractRootContent } from './outline-data.js';

describe('extractRootContent', () => {
  it('reads content array from puck data', () => {
    const items = extractRootContent({
      root: { props: {} },
      content: [{ type: 'cms.Row', props: { id: 'r1' } }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('cms.Row');
  });

  it('reads legacy root zones', () => {
    const items = extractRootContent({
      root: { props: {} },
      content: [],
      zones: { 'root:default-zone': [{ type: 'cms.Text', props: { id: 't1' } }] },
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('cms.Text');
  });

  it('normalizes flat puck items without props wrapper', () => {
    const items = extractRootContent({
      root: { props: {} },
      content: [{ type: 'cms.Row', id: 'r1', gap: 8 }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('cms.Row');
    expect(items[0]?.props.id).toBe('r1');
  });

  it('returns empty array for invalid shapes', () => {
    expect(extractRootContent(null)).toEqual([]);
    expect(extractRootContent({ content: 'nope' })).toEqual([]);
    expect(extractRootContent({ content: { type: 'cms.Row', props: { id: 'x' } } })).toEqual([]);
  });
});

describe('collectChildItems', () => {
  it('lists a Row column\'s blocks through its `content` slot', () => {
    const children = collectChildItems({
      content: [{ type: 'cms.Column', props: { id: 'c1', content: [] } }],
    });
    expect(children.map((child) => child.props.id)).toEqual(['c1']);
  });

  // Feature 163 (research R-13): a Tabs or Accordion panel is an array-item
  // slot named `panel`, so the outline reaches the blocks inside a panel.
  it('lists the blocks of an array-item slot whatever its name', () => {
    const children = collectChildItems({
      items: [
        { title: 'One', panel: [{ type: 'cms.MediaText', props: { id: 'm1' } }] },
        { title: 'Two', content: [{ type: 'cms.Text', props: { id: 't1' } }] },
        { title: 'Three', buttons: [{ label: 'Go', style: 'primary' }] },
      ],
    });
    expect(children.map((child) => child.props.id)).toEqual(['m1', 't1']);
  });
});
