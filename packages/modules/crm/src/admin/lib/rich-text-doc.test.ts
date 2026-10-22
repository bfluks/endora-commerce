import { describe, expect, it } from 'vitest';
import { editorDocOf, textOfEditorDoc, type EditorDoc } from './rich-text-doc.js';

/**
 * The formatted field's document and the stored text it stands for
 * (`specs/158-crm-opportunity-inline-editing/`, research R-3): the editor holds
 * a document, the server a string, and these two convert between them.
 */

const ORDER = '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01';
const PERSON = '6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02';

const describeToken = (type: string, id: string) =>
  id === ORDER ? { label: 'ORD-1', available: true } : type === 'admin_user' ? { label: 'Anna', available: true } : null;

describe('editorDocOf', () => {
  it('draws an empty text as one empty paragraph — what an empty editor holds', () => {
    expect(editorDocOf('', describeToken)).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('draws formatting as marks, lists as lists and tokens as named chips', () => {
    expect(
      editorDocOf(`**Hi** [[order:${ORDER}]]\n- [[admin_user:${PERSON}]]\n- [site](https://example.com)`, describeToken),
    ).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' ' },
            { type: 'crmReference', attrs: { refType: 'order', refId: ORDER, label: 'ORD-1', available: true } },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'crmReference',
                      attrs: { refType: 'admin_user', refId: PERSON, label: 'Anna', available: true },
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('draws a token nobody named as an unavailable chip that keeps its token', () => {
    const doc = editorDocOf('[[product:00000000-0000-4000-8000-00000000ffff]]', describeToken);
    expect(doc.content?.[0]?.content?.[0]).toEqual({
      type: 'crmReference',
      attrs: { refType: 'product', refId: '00000000-0000-4000-8000-00000000ffff', label: null, available: false },
    });
  });
});

describe('textOfEditorDoc', () => {
  it('writes an empty editor as the empty text', () => {
    expect(textOfEditorDoc({ type: 'doc', content: [{ type: 'paragraph' }] })).toBe('');
  });

  it('writes back what it drew', () => {
    const stored = `**Deal** _for_ [[order:${ORDER}]]\n\n1. ~~one~~\n2. [two](https://example.com)\n- [[admin_user:${PERSON}]]`;
    expect(textOfEditorDoc(editorDocOf(stored, describeToken))).toBe(stored);
  });

  it('writes a line break inside a paragraph as a new line, and flattens what the text cannot hold', () => {
    const doc: EditorDoc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'outer' }] },
                {
                  type: 'bulletList',
                  content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }] }],
                },
              ],
            },
          ],
        },
        { type: 'heading', content: [{ type: 'text', text: 'pasted heading', marks: [{ type: 'underline' }] }] },
      ],
    };
    expect(textOfEditorDoc(doc)).toBe('a\nb\n- outer\n- inner\npasted heading');
  });

  it('drops a link whose address is not one a reader may follow, keeping its words', () => {
    const doc: EditorDoc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'click', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
        },
      ],
    };
    expect(textOfEditorDoc(doc)).toBe('click');
  });

  it('keeps an empty line the caret has just made — the form trims what it sends', () => {
    const doc: EditorDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }, { type: 'paragraph' }],
    };
    expect(textOfEditorDoc(doc)).toBe('x\n');
  });
});
