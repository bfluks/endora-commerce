import { describe, expect, it } from 'vitest';
import { decodeInline, encodeInline, textblockPaths, type TiptapNode } from './tiptap-inline-codec.js';

/** Feature 151, T015 — one segment per textblock, marked runs as numbered tags (research R6). */

const LINK = { type: 'link', attrs: { href: 'https://example.com/promo', target: '_blank' } };
const BOLD = { type: 'bold' };

const paragraph: TiptapNode = {
  type: 'paragraph',
  attrs: { textAlign: 'center' },
  content: [
    { type: 'text', text: 'Kup ' },
    { type: 'text', text: 'teraz', marks: [BOLD] },
    { type: 'text', text: ' i ' },
    { type: 'text', text: 'oszczędź', marks: [LINK] },
    { type: 'hardBreak' },
    { type: 'text', text: 'Cześć {{customer.firstName}} <3' },
    { type: 'mention', attrs: { id: 'x' } },
  ],
};

describe('encodeInline', () => {
  it('wraps marked runs in numbered tags, breaks as <br/>, inline nodes as <n/>', () => {
    const { text } = encodeInline(paragraph);
    expect(text).toBe('Kup <0>teraz</0> i <1>oszczędź</1><br/>Cześć {{customer.firstName}} &lt;3<2/>');
  });

  it('never puts a link target in the text', () => {
    expect(encodeInline(paragraph).text).not.toContain('example.com');
  });
});

describe('decodeInline', () => {
  const encoded = encodeInline(paragraph);

  it('restores marks, breaks and inline nodes, and keeps node attrs to the caller', () => {
    const content = decodeInline(
      'Buy <0>now</0> and <1>save</1><br/>Hi {{customer.firstName}} &lt;3<2/>',
      encoded,
    );
    expect(content).toEqual([
      { type: 'text', text: 'Buy ' },
      { type: 'text', text: 'now', marks: [BOLD] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'save', marks: [LINK] },
      { type: 'hardBreak' },
      { type: 'text', text: 'Hi {{customer.firstName}} <3' },
      { type: 'mention', attrs: { id: 'x' } },
    ]);
  });

  it('accepts reordered tags', () => {
    expect(decodeInline('<1>Save</1> <0>now</0><br/>x<2/>', encoded)).not.toBeNull();
  });

  it.each([
    ['a missing tag', 'Buy now and <1>save</1><br/>x<2/>'],
    ['a duplicated tag', '<0>a</0><0>b</0><1>c</1><br/>x<2/>'],
    ['an unknown tag', '<0>a</0><1>c</1><9>d</9><br/>x<2/>'],
    ['an unclosed tag', '<0>a<1>c</1><br/>x<2/>'],
    ['nested tags', '<0>a <1>c</1></0><br/>x<2/>'],
    ['a missing break', '<0>a</0><1>c</1> x<2/>'],
    ['a missing inline node', '<0>a</0><1>c</1><br/>x'],
    ['a stray angle bracket', '<0>a</0><1>c</1><br/>x<2/> <b>'],
  ])('rejects %s', (_label, translated) => {
    expect(decodeInline(translated, encoded)).toBeNull();
  });

  it('drops empty text nodes', () => {
    const plain: TiptapNode = { type: 'paragraph', content: [{ type: 'text', text: 'A', marks: [BOLD] }] };
    const enc = encodeInline(plain);
    expect(decodeInline('<0></0>', enc)).toEqual([]);
  });
});

describe('textblockPaths', () => {
  it('finds paragraphs and headings inside lists, quotes and tables, and skips code blocks', () => {
    const doc: TiptapNode = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'T' }] },
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'L' }] }] }],
        },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Q' }] }] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'C' }] }] }],
            },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;' }] },
        { type: 'paragraph' },
      ],
    };
    expect(textblockPaths(doc)).toEqual([[0], [1, 0, 0], [2, 0], [3, 0, 0, 0]]);
  });
});

/**
 * Feature 163, T163 — an icon inside a heading's inline rich text
 * (`{type: 'inlineIcon', attrs: {name}}`) is one atomic `<n/>` tag: its name
 * never reaches the translator, it may move within the sentence, and a
 * translation that drops or repeats it is refused.
 */
describe('an inline icon (feature 163, T163)', () => {
  const ICON = { type: 'inlineIcon', attrs: { name: 'sparkles' } };
  const MARKED_ICON = { type: 'inlineIcon', attrs: { name: 'arrowRight' }, marks: [{ type: 'emphasis', attrs: { variant: 'accent' } }] };
  const heading: TiptapNode = {
    type: 'paragraph',
    content: [ICON, { type: 'text', text: ' New ' }, { type: 'text', text: 'ideas', marks: [BOLD] }, MARKED_ICON],
  };
  const encoded = encodeInline(heading);

  it('is one self-closing tag, without its name', () => {
    expect(encoded.text).toBe('<0/> New <1>ideas</1><2/>');
    expect(encoded.text).not.toContain('sparkles');
  });

  it('comes back as the same node, marks included, wherever the translation puts it', () => {
    expect(decodeInline('<0/> Nowe <1>pomysły</1><2/>', encoded)).toEqual([
      ICON,
      { type: 'text', text: ' Nowe ' },
      { type: 'text', text: 'pomysły', marks: [BOLD] },
      MARKED_ICON,
    ]);
    expect(decodeInline('<1>Pomysły</1> <2/>nowe <0/>', encoded)).not.toBeNull();
  });

  it.each([
    ['a dropped icon', ' Nowe <1>pomysły</1><2/>'],
    ['a repeated icon', '<0/><0/> Nowe <1>pomysły</1><2/>'],
    ['an icon used as a run', '<0>x</0> Nowe <1>pomysły</1><2/>'],
  ])('rejects %s', (_label, translated) => {
    expect(decodeInline(translated, encoded)).toBeNull();
  });
});

/**
 * Feature 163, T166 — an inline icon's size and vertical offset are attributes
 * of the same atomic node: they never reach the translator and come back as
 * they were, wherever the translation puts the icon.
 */
describe('an inline icon with a size and an offset (feature 163, T166)', () => {
  const SIZED = { type: 'inlineIcon', attrs: { name: 'sparkles', size: '0.5em', offset: 0.35 } };
  const heading: TiptapNode = { type: 'paragraph', content: [{ type: 'text', text: 'New ideas ' }, SIZED] };
  const encoded = encodeInline(heading);

  it('is one self-closing tag, without its name, size or offset', () => {
    expect(encoded.text).toBe('New ideas <0/>');
    for (const attribute of ['sparkles', '0.5em', '0.35']) expect(encoded.text).not.toContain(attribute);
  });

  it('comes back with its size and offset, wherever the translation puts it', () => {
    expect(decodeInline('<0/> Nowe pomysły', encoded)).toEqual([SIZED, { type: 'text', text: ' Nowe pomysły' }]);
  });
});

describe('an emphasis with a colour (feature 163, T175)', () => {
  const COLOURED = { type: 'emphasis', attrs: { variant: 'gradient', color: 'token:primary' } };
  const heading: TiptapNode = {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Safety ' },
      { type: 'text', text: 'built in', marks: [COLOURED] },
    ],
  };

  it('is one numbered tag, without its variant or colour', () => {
    const { text } = encodeInline(heading);
    expect(text).toBe('Safety <0>built in</0>');
    expect(text).not.toContain('primary');
  });

  it('comes back with its variant and colour, wherever the translation puts it', () => {
    expect(decodeInline('<0>Wbudowane</0> bezpieczeństwo', encodeInline(heading))).toEqual([
      { type: 'text', text: 'Wbudowane', marks: [COLOURED] },
      { type: 'text', text: ' bezpieczeństwo' },
    ]);
  });
});
