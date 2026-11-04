/**
 * The word split of the word reveal — `specs/163-page-builder-marketing-pages/`
 * US10, FR-037, research R-21.
 *
 * A text is split into its words and the whitespace between them, at render
 * time, so the server HTML carries the full text: every character is kept, the
 * whitespace stays plain text between the word spans, and markup around the
 * words (marks, links, paragraphs) is left as it was. A word is anything
 * between runs of ASCII whitespace, so a non-breaking space keeps its two
 * halves together, as it does on the page.
 */

/** The class of one revealed word; the stylesheet staggers it by `--i`. */
export const WORD_CLASS = 'cmsc-w';

export type WordPart = { word: string } | { space: string };

const WHITESPACE_RUN = /([ \t\n\r\f]+)/;

/** The words and whitespace runs of `text`, in order; their joined text is `text`. */
export function splitWords(text: string): WordPart[] {
  const parts: WordPart[] = [];
  for (const piece of text.split(WHITESPACE_RUN)) {
    if (piece === '') continue;
    parts.push(WHITESPACE_RUN.test(piece) && piece.trim() === '' ? { space: piece } : { word: piece });
  }
  return parts;
}

/** How many words `text` holds. */
export function countWords(text: string): number {
  return splitWords(text).filter((part) => 'word' in part).length;
}

/**
 * Wraps every word of the text in an HTML string in
 * `<span class="cmsc-w" style="--i:n">`, numbering from `start`. Tags (with
 * their attributes), entities and whitespace are copied as they were. The
 * input is markup this package produced and sanitized; the spans only wrap
 * text that contains no `<`, so nothing new can be introduced.
 */
export function splitHtmlWords(html: string, start = 0): { html: string; count: number } {
  let index = start;
  let out = '';
  for (const match of html.matchAll(/(<[^>]*>)|([^<]+)/g)) {
    if (match[1] !== undefined) {
      out += match[1];
      continue;
    }
    for (const part of splitWords(match[2] ?? '')) {
      if ('space' in part) out += part.space;
      else out += `<span class="${WORD_CLASS}" style="--i:${index++}">${part.word}</span>`;
    }
  }
  return { html: out, count: index - start };
}
