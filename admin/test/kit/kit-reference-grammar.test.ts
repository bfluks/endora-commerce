import { describe, expect, it } from 'vitest';
import {
  clipReferenceText,
  editorDocOf,
  findMentionTrigger,
  MENTION_QUERY_LIMIT,
  REFERENCE_NODE,
  textOfEditorDoc,
  type EditorDoc,
  type ReferenceTriggerKind,
} from '@endora-commerce/admin-kit/components';

/**
 * The reference grammar's two pure halves, as `@endora-commerce/admin-kit`
 * publishes them (`specs/163-projects-and-tasks/` research R-17, T099): what a
 * run of `@`s asks for, and the formatted field's document ⇄ the stored text.
 *
 * Ported from CRM's `lib/mention-trigger.test.ts` and `lib/rich-text-doc.test.ts`
 * when the two files moved into the kit. The trigger table they read is a
 * parameter; since CRM adopted the `@@` document list (T107, FR-044) there is
 * one table, the standard — `@` a person, `@@` a document, `@@@` a Product.
 */

/** The standard trigger table, as every module passes it. */
const STANDARD_KINDS: readonly ReferenceTriggerKind[] = ['admin_user', 'document', 'product'];

/** `text` with the caret where `|` is. */
function at(marked: string): ReturnType<typeof findMentionTrigger> {
  const caret = marked.indexOf('|');
  return findMentionTrigger(marked.replace('|', ''), caret, STANDARD_KINDS);
}

describe('findMentionTrigger (User Story 18, FR-082)', () => {
  it('opens on @ at the start of the text and after white space', () => {
    expect(at('@|')).toEqual({ kind: 'admin_user', start: 0, end: 1, query: '' });
    expect(at('Hello @|')).toEqual({ kind: 'admin_user', start: 6, end: 7, query: '' });
    expect(at('Hello\n@|')).toEqual({ kind: 'admin_user', start: 6, end: 7, query: '' });
    expect(at('Hello\t@|')).toMatchObject({ kind: 'admin_user', start: 6 });
  });

  it('a second @ asks for a document and a third for a Product', () => {
    expect(at('see @@|')).toEqual({ kind: 'document', start: 4, end: 6, query: '' });
    expect(at('see @@@|')).toEqual({ kind: 'product', start: 4, end: 7, query: '' });
    expect(at('@@ORD-10|')).toEqual({ kind: 'document', start: 0, end: 8, query: 'ORD-10' });
    expect(at('@@@cargo van|')).toEqual({ kind: 'product', start: 0, end: 12, query: 'cargo van' });
  });

  it('what follows the @ is the search, a first name and a surname included', () => {
    expect(at('@Tom|')).toEqual({ kind: 'admin_user', start: 0, end: 4, query: 'Tom' });
    expect(at('ok @Tomasz Now| - take this over')).toEqual({
      kind: 'admin_user',
      start: 3,
      end: 14,
      query: 'Tomasz Now',
    });
    expect(at('@Żak|')).toMatchObject({ query: 'Żak' });
  });

  it('does not open for an e-mail address or any @ inside a word', () => {
    expect(at('jan@|')).toBeNull();
    expect(at('jan@firma|.pl')).toBeNull();
    expect(at('write to jan.kowalski@example.com|')).toBeNull();
    expect(at('a@@|')).toBeNull();
    expect(at('price@@@van|')).toBeNull();
  });

  it('does not open when a space follows the @s, for four of them, or across a line', () => {
    expect(at('@ |')).toBeNull();
    expect(at('@@ |')).toBeNull();
    expect(at('meet @ noon|')).toBeNull();
    expect(at('@@@@|')).toBeNull();
    expect(at('@@@@van|')).toBeNull();
    expect(at('@Tomasz\nNowak|')).toBeNull();
  });

  it('looks only at what is before the caret, and only at the run the caret is in', () => {
    expect(at('|@Tomasz')).toBeNull();
    expect(at('@Tom|asz')).toMatchObject({ query: 'Tom', end: 4 });
    // An earlier address in the same line does not stop a later mention…
    expect(at('cc jan@example.com and @An|')).toMatchObject({ kind: 'admin_user', query: 'An' });
    // …and a later @ ends an earlier run.
    expect(at('@Tomasz jan@example|')).toBeNull();
  });

  it('gives up on a search longer than a name or a number would be', () => {
    const long = 'x'.repeat(MENTION_QUERY_LIMIT);
    expect(at(`@${long}|`)).toMatchObject({ query: long });
    expect(at(`@${long}x|`)).toBeNull();
  });

  it('a stored token is not a trigger', () => {
    expect(at('[[admin_user:00000000-0000-4000-8000-0000000000a1]]|')).toBeNull();
    expect(at('[[admin_user:00000000-0000-4000-8000-0000000000a1]] ok|')).toBeNull();
  });
});

describe('clipReferenceText', () => {
  const token = '[[admin_user:00000000-0000-4000-8000-0000000000a1]]';

  it('leaves a text within the limit as it is, however long its tokens are', () => {
    const text = `Ask ${token} and ${token}.`;
    expect(clipReferenceText(text, 20)).toBe(text);
  });

  it('cuts a long text at the limit and says so, counting a token as one character', () => {
    expect(clipReferenceText('abcdefghij', 4)).toBe('abcd…');
    expect(clipReferenceText(`ab${token}cdef`, 4)).toBe(`ab${token}c…`);
  });

  it('never cuts a token in two', () => {
    const clipped = clipReferenceText(`abcd${token} and more`, 4);
    expect(clipped).toBe('abcd…');
    expect(clipReferenceText(`abc${token}${token}`, 4)).toBe(`abc${token}…`);
  });
});

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
            { type: REFERENCE_NODE, attrs: { refType: 'order', refId: ORDER, label: 'ORD-1', available: true } },
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
                      type: REFERENCE_NODE,
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
      type: REFERENCE_NODE,
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

describe('findMentionTrigger — the trigger table is a parameter', () => {
  const run = (marked: string, kinds?: readonly ReferenceTriggerKind[]): ReturnType<typeof findMentionTrigger> => {
    const caret = marked.indexOf('|');
    return kinds === undefined
      ? findMentionTrigger(marked.replace('|', ''), caret)
      : findMentionTrigger(marked.replace('|', ''), caret, kinds);
  };

  it('reads the standard table by default: @ a person, @@ a document, @@@ a Product', () => {
    expect(run('@|')).toEqual({ kind: 'admin_user', start: 0, end: 1, query: '' });
    expect(run('see @@QR|')).toEqual({ kind: 'document', start: 4, end: 8, query: 'QR' });
    expect(run('@@@van|')).toEqual({ kind: 'product', start: 0, end: 6, query: 'van' });
  });

  it('opens nothing for a run whose length no offered kind answers', () => {
    expect(run('@@|', ['admin_user', 'product'])).toBeNull();
    expect(run('@|', ['document'])).toBeNull();
    expect(run('@@@|', [])).toBeNull();
    // An e-mail address opens nothing whatever is offered.
    expect(run('jan@|', ['admin_user', 'document', 'product'])).toBeNull();
  });
});
