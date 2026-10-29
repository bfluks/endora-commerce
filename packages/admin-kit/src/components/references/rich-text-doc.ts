import {
  formatRecordRichText,
  isSafeRecordRichHref,
  parseRecordRichText,
  type RecordReferenceType,
  type RecordRichBlock,
  type RecordRichInline,
  type RecordRichMark,
} from '@endora-commerce/contracts';

/**
 * The formatted field's document, and the stored text it stands for
 * (`specs/158-crm-opportunity-inline-editing/` research R-3; promoted from CRM
 * by `specs/163-projects-and-tasks/` research R-17).
 *
 * **The stored text is still the truth.** The editor holds a TipTap document —
 * paragraphs, two kinds of list, bold, italic, strikethrough, links and the
 * reference chip — and every change is written back to the text grammar of
 * `@endora-commerce/contracts` (`record-rich-text.ts`) before it leaves the
 * field. Whatever the editor can hold that the text cannot — a
 * pasted heading, an underline, a list inside a list, a line break inside a
 * paragraph — is written as the nearest thing the text has, so nothing typed is
 * lost and nothing the server stores is HTML.
 *
 * The shape here is TipTap's JSON, written out rather than imported, so the
 * conversion is plain data and tested without an editor.
 */

export interface EditorMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface EditorDoc {
  type: string;
  attrs?: Record<string, unknown>;
  content?: EditorDoc[];
  marks?: EditorMark[];
  text?: string;
}

/**
 * The node a reference token is drawn as. Never stored and never in the
 * clipboard's text — a chip leaves the field as its token — so the name is the
 * editor's own.
 */
export const REFERENCE_NODE = 'recordReference';

/** What the field knows about a token's target: its name, or that the reader may not see it. */
export type DescribeReference = (
  type: RecordReferenceType,
  id: string,
) => { label: string | null; available: boolean } | null;

const MARK_NODE: Record<RecordRichMark, string> = { bold: 'bold', italic: 'italic', strike: 'strike' };
const MARK_OF_NODE: Record<string, RecordRichMark> = { bold: 'bold', italic: 'italic', strike: 'strike' };

function inlineNodes(content: readonly RecordRichInline[], describe: DescribeReference): EditorDoc[] {
  return content.map((node) => {
    const marks: EditorMark[] = node.marks.map((mark) => ({ type: MARK_NODE[mark] }));
    if (node.kind === 'reference') {
      const known = describe(node.type, node.id);
      return {
        type: REFERENCE_NODE,
        attrs: {
          refType: node.type,
          refId: node.id,
          label: known?.available ? known.label : null,
          available: known?.available === true && known.label !== null,
        },
        ...(marks.length > 0 ? { marks } : {}),
      };
    }
    if (node.href) marks.push({ type: 'link', attrs: { href: node.href } });
    return { type: 'text', text: node.text, ...(marks.length > 0 ? { marks } : {}) };
  });
}

function paragraph(content: readonly RecordRichInline[], describe: DescribeReference): EditorDoc {
  const nodes = inlineNodes(content, describe);
  return nodes.length > 0 ? { type: 'paragraph', content: nodes } : { type: 'paragraph' };
}

/** The document that draws `text`. An empty text is one empty paragraph — what an empty editor holds. */
export function editorDocOf(text: string, describe: DescribeReference): EditorDoc {
  const blocks = parseRecordRichText(text);
  if (blocks.length === 0) return { type: 'doc', content: [{ type: 'paragraph' }] };
  return {
    type: 'doc',
    content: blocks.map((block): EditorDoc => {
      if (block.kind === 'paragraph') return paragraph(block.content, describe);
      const items = block.items.map((item) => ({ type: 'listItem', content: [paragraph(item, describe)] }));
      return block.kind === 'bullet_list'
        ? { type: 'bulletList', content: items }
        : { type: 'orderedList', attrs: { start: block.start }, content: items };
    }),
  };
}

// --- Back to the text ------------------------------------------------------------

/** The inline content of a textblock, as lines: a line break inside it starts a new one. */
function linesOf(node: EditorDoc): RecordRichInline[][] {
  const lines: RecordRichInline[][] = [[]];
  const walk = (children: readonly EditorDoc[] | undefined): void => {
    for (const child of children ?? []) {
      const current = lines[lines.length - 1] as RecordRichInline[];
      if (child.type === 'hardBreak') {
        lines.push([]);
        continue;
      }
      const marks = (child.marks ?? [])
        .map((mark) => MARK_OF_NODE[mark.type])
        .filter((mark): mark is RecordRichMark => mark !== undefined);
      if (child.type === 'text') {
        const link = child.marks?.find((mark) => mark.type === 'link');
        const href = typeof link?.attrs?.['href'] === 'string' ? (link.attrs['href'] as string) : undefined;
        current.push({
          kind: 'text',
          text: child.text ?? '',
          marks,
          ...(href && isSafeRecordRichHref(href) ? { href } : {}),
        });
        continue;
      }
      if (child.type === REFERENCE_NODE) {
        const type = child.attrs?.['refType'];
        const id = child.attrs?.['refId'];
        if (typeof type === 'string' && typeof id === 'string') {
          current.push({ kind: 'reference', type: type as RecordReferenceType, id, marks });
        }
        continue;
      }
      // Anything else inline — kept as its words.
      walk(child.content);
    }
  };
  walk(node.content);
  return lines;
}

/** Every textblock under a node, in order — a list inside a list is read flat. */
function textblocksOf(node: EditorDoc): EditorDoc[] {
  if (node.type === 'bulletList' || node.type === 'orderedList' || node.type === 'listItem' || node.type === 'blockquote') {
    return (node.content ?? []).flatMap(textblocksOf);
  }
  return [node];
}

/** The stored text of a document — the inverse of `editorDocOf`. */
export function textOfEditorDoc(doc: EditorDoc): string {
  const blocks: RecordRichBlock[] = [];
  for (const node of doc.content ?? []) {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const items = textblocksOf(node).flatMap(linesOf);
      const start = typeof node.attrs?.['start'] === 'number' ? (node.attrs['start'] as number) : 1;
      blocks.push(
        node.type === 'bulletList' ? { kind: 'bullet_list', items } : { kind: 'ordered_list', start, items },
      );
      continue;
    }
    for (const textblock of textblocksOf(node)) {
      for (const line of linesOf(textblock)) blocks.push({ kind: 'paragraph', content: line });
    }
  }
  return formatRecordRichText(blocks);
}
